// 卒業した学年を消す・もどす。期限後の片付けは、この画面を開いている間だけ行う。
import { el, confirmDialog, toast, statusChip } from '../ui.js';
import { CONFIG } from '../config.js';
import { PROBE_ID } from '../rules-probe.js';
import { cohorts, daysLeft, matchesYear } from '../graduate-logic.js';
import { removeCohort, restoreCohort, purgeCohort } from '../graduate-flow.js';
import { teacherNav } from './parts/teacher-nav.js';

// 離れた画面の通信が終わる前に、同じ処理を重ねない。
let running = null;

function errorMessage(error) {
  if (error?.code === 'changed') return '名簿が変わっていたので、消しませんでした。もう一度『この学年の記録を消す』を押してください。';
  if (error?.name === 'AbortError') return '完全に消すのを止めました。「続きから消す」で再開できます。';
  if (error?.code === 'files') return '写真・PDF を消せなかったので、止めました。学校の回線では消せないことがあります。家などの回線で、この画面をもう一度開いてください。';
  if (error?.code === 'unknown-files') return `Drive で確かめられなかったファイルが ${error.count} 個あったので、止めました。時間をおいて『続きから消す』を押してください。`;
  if (error?.code === 'skipped') return '消してよい生徒かどうかを確かめられなかったファイルがあったので、止めました。もう一度ためしても同じときは、Claude Code に伝えてください。';
  if (error?.code === 'denied') return 'データベースの規則が古いため、消せませんでした。規則を入れ直してください。';
  return 'つながりません。電波を確かめて、もう一度ためしてください。';
}

export function mount(root, ctx) {
  let alive = true;
  let busy = true;
  let controller = null;
  let purging = null;
  let list = [];
  let confirming = null;
  let inputValue = '';
  const reasons = new Map();
  const progress = new Map();
  const message = el('div', { role: 'status', 'aria-live': 'polite' });
  const rows = el('div', { class: 'graduate-list' });

  async function okToLeave() {
    if (purging === null) return true;
    return confirmDialog({ title: '完全に消している途中です',
      body: '完全に消している途中です。離れると止まります（次に開くと、続きから消します）。',
      okLabel: '離れる', cancelLabel: 'この画面に残る' });
  }
  ctx.setLeaveGuard?.(okToLeave);
  const beforeUnload = (event) => {
    if (purging === null) return;
    event.preventDefault();
    event.returnValue = '';
  };
  window.addEventListener('beforeunload', beforeUnload);
  const bar = teacherNav({ ...ctx, okToLeave, signOutAll: async () => {
    controller?.abort();
    await ctx.signOutAll();
  } }, 'graduates');
  root.replaceChildren(bar, el('main', { class: 'page-main' },
    el('h1', { text: '卒業' }),
    el('p', { text: '卒業した学年の記録を消す画面です。消す前に、生徒が『記録をまとめて保存』で自分の記録を残したかを確かめてください。' }),
    message, rows));

  const button = (text, onclick) => el('button', { type: 'button', class: 'btn', text, disabled: busy, onclick });

  function render() {
    if (!alive) return;
    for (const b of bar.querySelectorAll('button')) b.disabled = busy;
    if (!list.length) {
      rows.replaceChildren(el('p', { class: 'home-empty', text: busy ? '読みこんでいます…' : 'まだ生徒がいません。' }));
      return;
    }
    rows.replaceChildren(...list.map((group) => {
      const actions = el('div', { class: 'page-actions' });
      const row = el('section', { class: 'card graduate-row', 'aria-label': `${group.year} 年度入学` },
        el('h2', { text: `${group.year} 年度入学` }), el('p', { text: `生徒 ${group.total} 人` }));
      if (group.state === 'active') row.append(el('p', {}, statusChip('ok', '使用中')));
      if (group.state === 'removed' || group.restorable.length) {
        const days = group.restoreUntil === null ? 0 : daysLeft(group.restoreUntil, ctx.now(), 0);
        row.append(el('p', { text: `消してあります（${group.removed.length} 人）。あと ${days} 日は、もどせます。` }));
      }
      if (group.state === 'purging') {
        const p = progress.get(group.yy) ?? { doneLessons: 0, totalLessons: 0, doneStudents: 0, totalStudents: group.purgeable.length };
        const lead = group.purgeable.some((s) => s.purging) ? '' : '30 日をすぎました。';
        row.append(el('p', { role: 'status', 'aria-live': 'polite', text: purging === group.yy
          ? p.phase === 'scan' ? `記録をさがしています…（クラス ${p.doneClasses} / ${p.totalClasses}）`
            : `${lead}完全に消しています… 授業 ${p.doneLessons} / ${p.totalLessons}、生徒 ${p.doneStudents} / ${p.totalStudents} 人`
          : `${lead}完全に消すのを待っています。` }));
        if (purging === group.yy) actions.append(el('button', {
          type: 'button', class: 'btn', text: '止める', disabled: controller?.signal.aborted,
          onclick: () => { controller?.abort(); render(); },
        }));
        else {
          actions.append(button('続きから消す', () => work(purge)));
          if (reasons.get(group.yy)?.code === 'unknown-files') actions.append(button('確かめられないファイルをとばして続ける', () => work(async () => {
            const ok = await confirmDialog({ title: '確かめられないファイルをとばしますか？',
              body: 'とばしたファイルは、先生の Google ドライブの『授業ログ_生徒』のフォルダに残ることがあります。記録の方は消えるので、アプリからはたどれなくなります。',
              okLabel: 'はい', cancelLabel: 'いいえ', danger: true });
            if (ok && alive) await purge(group.yy);
          })));
        }
      }
      if (reasons.has(group.yy)) row.append(el('p', { class: 'error', role: 'alert', text: errorMessage(reasons.get(group.yy)) }));
      if (group.restorable.length) actions.append(button('もどす', () => work(() => change(group.yy, false))));
      if (group.active.length) actions.append(button('この学年の記録を消す', () => {
        confirming = group.yy; inputValue = ''; render();
        rows.querySelectorAll('input')[0]?.focus();
      }));
      row.append(actions);
      if (confirming === group.yy) row.append(confirmForm(group));
      return row;
    }));
  }

  function confirmForm(group) {
    const id = `graduate-year-${group.yy}`;
    const submit = el('button', { type: 'submit', class: 'btn btn-danger', text: '消す',
      disabled: busy || !matchesYear(inputValue, group.year) });
    const input = el('input', { id, type: 'text', inputmode: 'numeric', autocomplete: 'off', value: inputValue, disabled: busy,
      oninput: (event) => { inputValue = event.target.value; submit.disabled = busy || !matchesYear(inputValue, group.year); } });
    return el('form', { class: 'inline-form', onsubmit: (event) => {
      event.preventDefault();
      if (busy || !matchesYear(inputValue, group.year)) return;
      work(() => change(group.yy, true));
    } },
    el('p', { text: `${group.year} 年度入学の生徒 ${group.active.length} 人が、ログインできなくなります。30 日の間は『もどす』で元にもどせます。30 日をすぎると、記録・写真・PDF・手書きが完全に消え、もどせません。` }),
    el('div', { class: 'field' }, el('label', { class: 'label', for: id, text: `確かめのため、入学年度（${group.year}）を入れてください` }), input),
    el('div', { class: 'dialog-actions' }, button('やめる', () => { confirming = null; render(); }), submit));
  }

  async function load() {
    const [students, removed] = await Promise.all([ctx.repo.listStudents(), ctx.repo.listRemoved()]);
    if (!alive) return;
    list = cohorts({ students, removed, now: ctx.now(), graceDays: CONFIG.graduate.graceDays, exclude: [PROBE_ID] });
  }

  async function change(yy, removing) {
    // 入力中に 30 日の境界を越えたり、出し直したりした場合は、最新の状態で決める。
    await load();
    if (!alive) return;
    const group = list.find((c) => c.yy === yy);
    if (!group) return;
    try {
      if (removing) await removeCohort({ repo: ctx.repo, cohort: group, now: ctx.now() });
      else await restoreCohort({ repo: ctx.repo, cohort: group });
      confirming = null;
      reasons.delete(yy);
      await load();
    } catch (error) {
      if (error?.code === 'changed') { confirming = null; inputValue = ''; }
      reasons.set(yy, error);
      await load();
    }
  }

  async function purge(allowUnknownYear = null) {
    controller = new AbortController();
    await load();
    while (alive && !controller.signal.aborted) {
      const group = list.find((c) => c.state === 'purging');
      if (!group) break;
      purging = group.yy;
      confirming = null;
      reasons.delete(group.yy);
      render();
      try {
        const result = await purgeCohort({ repo: ctx.repo, files: ctx.files, cohort: group, allowUnknown: allowUnknownYear === group.yy,
          batch: CONFIG.graduate.trashBatch, signal: controller.signal,
          onProgress: (value) => { progress.set(group.yy, value); render(); } });
        if (!alive) return;
        toast(`${group.year} 年度入学の記録を、完全に消しました。${result.unknownFiles
          ? `確かめられなかったファイル ${result.unknownFiles} 個は、とばしました。` : ''}`);
        await load();
      } catch (error) {
        reasons.set(group.yy, error);
        if (alive) await load();
        break;
      }
    }
  }

  async function work(task) {
    if (!alive || busy) return;
    busy = true;
    message.replaceChildren();
    render();
    const promise = (async () => {
      try { await task(); }
      catch (error) {
        if (alive) message.replaceChildren(el('p', { class: 'error', role: 'alert', text: errorMessage(error) }),
          button('もう一度ためす', () => work(purge)));
      } finally {
        busy = false;
        purging = null;
        controller = null;
        if (alive) {
          for (const b of message.querySelectorAll('button')) b.disabled = false;
          render();
        }
      }
    })();
    running = promise;
    await promise;
    if (running === promise) running = null;
  }

  async function start() {
    while (running) { try { await running; } catch { /* 前の画面の通信が終わるのを待つ */ } }
    if (!alive) return;
    busy = false;
    await work(purge);
  }
  render();
  start();
  return () => {
    alive = false;
    controller?.abort();
    window.removeEventListener('beforeunload', beforeUnload);
  };
}
