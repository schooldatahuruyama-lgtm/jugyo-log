// 先生のクラスの画面（#/t。設計書 7.5 の「クラス」と、名簿の「生徒 ID をまとめて発行」）
// クラスの一覧（年度ごと。新しい年度が上）・作成・名前の変更と、生徒 ID の発行・続きの発行。
// 入力は画面の中の <form> で受け取る（window.prompt などは使わない）。
import { el, confirmDialog, toast, statusChip } from '../ui.js';
import { CONFIG } from '../config.js';
import { newId } from '../ids.js';
import { createIssuer } from '../issue.js';
import { schoolYear, entryYY, isProbeId } from '../roster-logic.js';

const NAME_MAX = 40;    // クラス名の長さの上限
const ISSUE_MAX = 200;  // 一度に発行できる人数の上限

// 入力の数を整数にする（全角も受けつける）。整数でなければ NaN
function toInt(v) {
  const s = String(v ?? '').normalize('NFKC').trim();
  return /^\d+$/.test(s) ? Number(s) : NaN;
}

// クラス名を確かめる。よければ null、だめなら文
function nameError(name) {
  if (name === '') return 'クラスの名前を入れてください。';
  if ([...name].length > NAME_MAX) return `クラスの名前は ${NAME_MAX} 文字までです。`;
  return null;
}

// 年度を確かめる（2000〜2099 年度）。よければ null、だめなら文
function yearError(year) {
  if (!Number.isInteger(year) || year < 2000 || year > 2099) return '年度は 2026 のように、4 けたの数で入れてください。';
  return null;
}

// 発行が止まった理由ごとの文
function stoppedMessage(reason) {
  if (reason === 'rate') return '一度に作れる数の上限に当たりました。1 時間ほどあとで『続きを発行する』を押してください。';
  if (reason === 'network') return 'つながりません。『続きを発行する』を押してください。';
  if (reason === 'stopped') return '発行を止めました。残りは『続きを発行する』で発行できます。';
  return 'うまく発行できませんでした。しばらくしてから『続きを発行する』を押してください。';
}

// 進行中の一括発行（{ promise, stop }）。画面を離れて戻ってきても 2 つの処理が同じ ID を発行しないよう、
// 画面（mount）の外側、モジュールの変数で持つ。画面を離れたら stop を true にして、次の人に進まずに止める
let running = null;

export function mount(root, ctx) {
  let alive = true;
  let issuing = false;  // この画面で発行を始めた・始めようとしている途中か
  let busy = false;     // 作成・名前の変更の送信中か
  let classes = [];
  let myRun = null;     // この画面が始めた発行（画面を離れたら止める）

  const issuer = createIssuer({
    auth: ctx.auth, repo: ctx.repo, random: ctx.random,
    domain: CONFIG.emailDomain, firstGeneration: CONFIG.firstGeneration, maxTries: CONFIG.maxGenerationTries,
  });

  // 発行の途中で、ページを閉じる・読みこみ直すときは、ブラウザに確かめさせる
  const onBeforeUnload = (ev) => {
    if (!issuing) return;
    ev.preventDefault();
    ev.returnValue = '';
  };
  window.addEventListener('beforeunload', onBeforeUnload);

  // 発行の途中で画面を離れようとしたら確かめる。離れてよければ true（離れると、今の人のあとで発行が止まる）
  async function okToLeave() {
    if (!issuing) return true;
    return confirmDialog({
      title: '発行の途中です',
      body: 'まだ発行が終わっていません。画面を離れると、発行はそこで止まります。残りは「続きを発行する」で発行します。離れますか？',
      okLabel: '離れる',
      cancelLabel: 'この画面に残る',
    });
  }
  // ブラウザの「戻る」や ctx.navigate のときも、main.js がこれでたずねる
  if (ctx.setLeaveGuard) ctx.setLeaveGuard(okToLeave);

  const logout = async () => {
    if (!(await okToLeave()) || !alive) return;
    const ok = await confirmDialog({
      title: 'ログアウトしますか？',
      body: 'もう一度使うときは、メールアドレスとパスワードを入れます。',
      okLabel: 'ログアウト',
    });
    if (!ok || !alive) return;
    if (myRun) myRun.stop = true; // ログアウトの前に、発行を止める
    ctx.auth.signOut();
    ctx.navigate('login', {}, { confirmed: true }); // もう確かめたので、guard にたずねない
  };

  // 移る前の確かめは、main.js が guard（okToLeave）で行う
  const openRoster = (cls) => ctx.navigate('t-roster', { classId: cls.id });

  const bar = el('header', { class: 'topbar topbar-teacher' },
    el('div', { class: 'topbar-title' },
      el('span', { class: 'topbar-brand', text: '授業ログ' }),
      el('span', { class: 'topbar-sub', text: '先生' })),
    el('nav', { class: 'topbar-menu', 'aria-label': 'メニュー' },
      el('button', { type: 'button', class: 'btn', text: 'ログアウト', onclick: logout })));

  const createBtn = el('button', { type: 'button', class: 'btn btn-primary', text: 'クラスを作る', onclick: () => showCreateForm() });
  const issueBtn = el('button', { type: 'button', class: 'btn', text: '生徒 ID を発行する', onclick: () => showIssueForm() });
  const formArea = el('div', { class: 'form-area' });       // 入力の form を出す場所（1 つずつ）
  const pendingArea = el('div', { class: 'pending-area' }); // 「続きを発行する」
  const progress = el('div', { class: 'issue-progress', role: 'status', 'aria-live': 'polite' });
  const listArea = el('div', { class: 'class-list' });

  const openRules = () => ctx.navigate('t-rules');

  root.replaceChildren(bar, el('main', { class: 'page-main' },
    el('h1', { text: 'クラス' }),
    el('div', { class: 'page-actions' }, createBtn, issueBtn),
    formArea,
    progress,
    pendingArea,
    listArea,
    el('section', { class: 'rules-link' },
      el('h2', { text: '規則の確認' }),
      el('p', { class: 'small muted', text: 'データベースの規則が、生徒に見せてはいけないものを見せていないかを確かめます。規則を貼りかえたあとに行います。' }),
      el('button', { type: 'button', class: 'btn', text: '規則の確認へ', onclick: openRules }))));

  function setActionsDisabled(v) {
    createBtn.disabled = v;
    issueBtn.disabled = v;
    for (const b of pendingArea.querySelectorAll('button')) b.disabled = v;
  }

  // ---- 入力の form（作成・名前の変更・発行） ----

  function closeForm() {
    formArea.replaceChildren();
  }

  // 入力の form を作って formArea に出す。onSubmit(values, showError) が true を返したら閉じる
  function openForm({ title, fields, okLabel, onSubmit }) {
    const error = el('div', { class: 'error', role: 'alert', hidden: true });
    const showError = (text) => { error.textContent = text; error.hidden = false; };
    const ok = el('button', { type: 'submit', class: 'btn btn-primary', text: okLabel });
    const cancel = el('button', { type: 'button', class: 'btn', text: 'やめる', onclick: closeForm });
    const inputs = {};
    const rows = fields.map((f) => {
      const id = `f-${f.key}`;
      const input = el('input', {
        id, type: 'text', value: f.value ?? '',
        inputmode: f.numeric ? 'numeric' : null,
        autocomplete: 'off',
      });
      inputs[f.key] = input;
      return el('div', { class: 'field' },
        el('label', { class: 'label', for: id, text: f.label }),
        f.hint ? el('p', { class: 'small muted field-hint', text: f.hint }) : null,
        input);
    });
    const form = el('form', { class: 'card inline-form', novalidate: true, 'aria-label': title },
      el('h2', { text: title }),
      rows,
      error,
      el('div', { class: 'dialog-actions' }, cancel, ok));
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      if (busy || issuing) return;
      error.hidden = true;
      const values = {};
      for (const [k, input] of Object.entries(inputs)) values[k] = input.value;
      ok.disabled = true;
      let done = false;
      try {
        done = await onSubmit(values, showError);
      } finally {
        if (alive) ok.disabled = false;
      }
      if (done && alive && formArea.contains(form)) closeForm();
    });
    formArea.replaceChildren(form);
    const first = Object.values(inputs)[0];
    if (first) first.focus();
  }

  function showCreateForm() {
    openForm({
      title: 'クラスを作る',
      okLabel: '作る',
      fields: [
        { key: 'year', label: '年度', value: String(schoolYear(ctx.now())), numeric: true, hint: '4 月はじまりの年度です（例: 2026）。' },
        { key: 'name', label: 'クラスの名前', value: '', hint: `例: 2年A組（${NAME_MAX} 文字まで）` },
      ],
      onSubmit: async (v, showError) => {
        const year = toInt(v.year);
        const name = v.name.trim();
        const msg = yearError(year) || nameError(name);
        if (msg) { showError(msg); return false; }
        busy = true;
        try {
          await ctx.repo.createClass(newId(ctx.random, CONFIG.idLength), { year, name }, ctx.now());
        } catch (e) {
          if (alive) showError('つながりません。もう一度ためしてください。');
          return false;
        } finally {
          busy = false;
        }
        if (!alive) return false;
        toast(`「${name}」を作りました。`);
        await loadClasses();
        return true;
      },
    });
  }

  function showRenameForm(cls) {
    openForm({
      title: `「${cls.name}」の名前を変える`,
      okLabel: '変える',
      fields: [{ key: 'name', label: '新しい名前', value: cls.name, hint: `${NAME_MAX} 文字まで` }],
      onSubmit: async (v, showError) => {
        const name = v.name.trim();
        const msg = nameError(name);
        if (msg) { showError(msg); return false; }
        busy = true;
        try {
          await ctx.repo.renameClass(cls.id, name);
        } catch (e) {
          if (alive) showError('つながりません。もう一度ためしてください。');
          return false;
        } finally {
          busy = false;
        }
        if (!alive) return false;
        toast('名前を変えました。');
        await loadClasses();
        return true;
      },
    });
  }

  function showIssueForm() {
    openForm({
      title: '生徒 ID を発行する',
      okLabel: '発行する',
      fields: [
        { key: 'year', label: '入学年度', value: String(schoolYear(ctx.now())), numeric: true, hint: '生徒 ID の頭の数になります（2026 年度なら s26-…）。' },
        { key: 'count', label: '人数', value: '', numeric: true, hint: `1〜${ISSUE_MAX} 人` },
      ],
      onSubmit: async (v, showError) => {
        const year = toInt(v.year);
        const count = toInt(v.count);
        const msg = yearError(year)
          || (!Number.isInteger(count) || count < 1 || count > ISSUE_MAX ? `人数は 1〜${ISSUE_MAX} の数で入れてください。` : null);
        if (msg) { showError(msg); return false; }
        let ids;
        busy = true;
        try {
          await waitIdle(); // 前の発行が残っていれば、止まるのを待ってから
          if (!alive) return false;
          ids = await ctx.repo.reserveIds(entryYY(year), count, ctx.now());
        } catch (e) {
          if (alive) {
            showError(e instanceof RangeError
              ? 'この入学年度では、これ以上 ID を作れません（1 つの年度で 999 人まで）。'
              : 'つながりません。もう一度ためしてください。');
          }
          return false;
        } finally {
          busy = false;
        }
        if (!alive) return false;
        closeForm();
        await runIssue(async () => ids);
        return false; // closeForm はもう済んでいる
      },
    });
  }

  // ---- 発行 ----

  // 前の画面で始めた発行が残っていれば、止まる（終わる）のを待つ
  async function waitIdle() {
    while (running) {
      if (alive) {
        progress.replaceChildren(el('p', { class: 'notice', text: '前の発行が止まるのを待っています…' }));
      }
      try { await running.promise; } catch { /* 失敗しても、終わったことには変わりない */ }
    }
  }

  // 発行する。getIds() は、前の発行が終わってから呼ぶ（続きの発行では、そこで台帳を読み直す）
  async function runIssue(getIds) {
    if (issuing) return;
    issuing = true;
    setActionsDisabled(true);
    let result;
    let ids;
    let run = null;
    try {
      await waitIdle();
      if (!alive) return;
      try {
        ids = await getIds();
      } catch (e) {
        if (alive) {
          progress.replaceChildren(el('p', { class: 'error', role: 'alert', text: 'つながりません。もう一度ためしてください。' }));
        }
        return;
      }
      if (!alive) return;
      if (ids.length === 0) {
        progress.replaceChildren(el('p', { class: 'notice', text: 'まだ発行が済んでいない ID はありません。' }));
        return;
      }
      progress.replaceChildren(
        el('p', { class: 'notice', text: `発行しています… 0 / ${ids.length} 人（終わるまで、この画面のままにしてください）` }));
      const line = progress.firstChild;
      run = { stop: false, promise: null };
      run.promise = issuer.issueMany(ids, {
        onProgress: (n, total) => {
          if (alive) line.textContent = `発行しています… ${n} / ${total} 人（終わるまで、この画面のままにしてください）`;
        },
        shouldStop: () => run.stop,
      });
      running = run;
      myRun = run;
      result = await run.promise;
    } finally {
      if (run && running === run) running = null;
      if (run && myRun === run) myRun = null;
      issuing = false;
      if (alive) setActionsDisabled(false);
    }
    if (!alive) return;
    if (result.reason === null) {
      progress.replaceChildren(el('p', { class: 'notice notice-ok' },
        statusChip('ok', '発行が済みました'),
        ` ${result.done.length} 人分の ID を発行しました。クラスの名簿で、生徒に割り当ててください。`));
    } else {
      progress.replaceChildren(el('div', { class: 'error', role: 'alert' },
        el('p', { text: `${result.done.length} / ${ids.length} 人まで発行しました。` }),
        el('p', { text: stoppedMessage(result.reason) })));
    }
    await loadPending();
  }

  // ---- 続きを発行する ----

  // 台帳から、まだ発行が済んでいない ID を読む（規則の確認用の ID（s00-…）は数えない）
  async function readLeft() {
    const students = await ctx.repo.listStudents();
    return students.filter((s) => s.uid === null && !isProbeId(s.id)).map((s) => s.id);
  }

  async function loadPending() {
    let left;
    try {
      left = await readLeft();
    } catch (e) {
      if (alive) pendingArea.replaceChildren();
      return;
    }
    if (!alive) return;
    if (left.length === 0) { pendingArea.replaceChildren(); return; }
    pendingArea.replaceChildren(el('div', { class: 'notice pending-box' },
      el('p', {}, statusChip('warn', '発行が途中です'), ` まだ発行が済んでいない ID が ${left.length} 件あります。`),
      el('button', {
        type: 'button', class: 'btn btn-primary', text: '続きを発行する', disabled: issuing || running !== null,
        // 押したときに、前の発行が終わるのを待ってから台帳を読み直して、未発行の ID を決め直す
        onclick: () => runIssue(readLeft),
      })));
  }

  // ---- クラスの一覧 ----

  function renderClasses() {
    if (classes.length === 0) {
      listArea.replaceChildren(el('p', { class: 'home-empty', text: 'まだクラスがありません。「クラスを作る」で作ってください。' }));
      return;
    }
    // listClasses は年度の新しい順。年度ごとに区切る
    const groups = new Map();
    for (const c of classes) {
      if (!groups.has(c.year)) groups.set(c.year, []);
      groups.get(c.year).push(c);
    }
    const sections = [];
    for (const [year, list] of groups) {
      sections.push(el('section', { class: 'class-year' },
        el('h2', { text: `${year} 年度` }),
        el('ul', { class: 'class-rows' }, list.map((c) => el('li', { class: 'class-row' },
          el('button', {
            type: 'button', class: 'class-open',
            'aria-label': `${c.name} の名簿を開く`,
            onclick: () => openRoster(c),
          },
          el('span', { class: 'class-name', text: c.name || '（名前なし）' }),
          el('span', { class: 'class-go', 'aria-hidden': 'true', text: '名簿 ›' })),
          el('button', { type: 'button', class: 'btn', text: '名前を変える', onclick: () => showRenameForm(c) }))))));
    }
    listArea.replaceChildren(...sections);
  }

  async function loadClasses() {
    try {
      classes = await ctx.repo.listClasses();
    } catch (e) {
      if (!alive) return;
      listArea.replaceChildren(
        el('p', { class: 'error', role: 'alert', text: 'つながりません。電波を確かめて、もう一度ためしてください。' }),
        el('p', {}, el('button', { type: 'button', class: 'btn btn-primary', text: 'もう一度ためす', onclick: () => loadClasses() })));
      return;
    }
    if (alive) renderClasses();
  }

  listArea.replaceChildren(el('p', { class: 'loading', role: 'status', text: '読みこんでいます…' }));
  loadClasses();

  // 前の画面で始めた発行が、まだ止まりきっていなければ、終わるまで発行のボタンを押せなくする
  async function start() {
    if (running) {
      setActionsDisabled(true);
      await waitIdle();
      if (!alive) return;
      progress.replaceChildren();
      setActionsDisabled(false);
    }
    await loadPending();
  }
  start();

  return () => {
    alive = false;
    if (myRun) myRun.stop = true; // 画面を離れたら、今の人のあとで発行を止める
    window.removeEventListener('beforeunload', onBeforeUnload);
  };
}
