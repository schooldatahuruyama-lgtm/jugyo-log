// 規則の確認の画面（#/t/rules）
// 本物の Firebase の規則が、生徒に読ませてはいけないものを読ませていないかを、確認用の生徒 s00-999 で確かめる。
// 試すことと片付けは js/rules-probe.js が行う。この画面は、始める・表を出す・結果をコピーするだけ。
// 練習モード（ctx.makeProbeStudent が null）では確かめられないので、始められないようにする。
import { el, statusChip } from '../ui.js';
import { CONFIG } from '../config.js';
import { createIssuer } from '../issue.js';
import { runRulesProbe, PREPARE_LABEL, CLEANUP_LABEL } from '../rules-probe.js';

const EXPECT_TEXT = { ok: 'できる', denied: 'できない' };
const GOT_TEXT = { ok: 'できた', denied: 'できなかった', error: 'エラー（つながらないなど）' };

// 結果を、貼り付けて送れる文字にする
function reportText(rows) {
  const lines = ['授業ログ 規則の確認の結果'];
  for (const r of rows) {
    lines.push(`${r.pass ? '○' : '×'} ${r.label}｜期待: ${EXPECT_TEXT[r.expect] || r.expect}｜結果: ${GOT_TEXT[r.got] || r.got}`);
  }
  const bad = rows.filter((r) => !r.pass).length;
  lines.push(bad === 0 ? 'すべて ○' : `× が ${bad} 件`);
  return lines.join('\n');
}

export function mount(root, ctx) {
  let alive = true;
  let running = false;

  const bar = el('header', { class: 'topbar topbar-teacher' },
    el('div', { class: 'topbar-title' },
      el('span', { class: 'topbar-brand', text: '授業ログ' }),
      el('span', { class: 'topbar-sub', text: '規則の確認' })),
    el('nav', { class: 'topbar-menu', 'aria-label': 'メニュー' },
      el('button', {
        type: 'button', class: 'btn', text: '‹ クラスへ',
        onclick: () => { if (!running) ctx.navigate('t-classes'); },
      })));

  const startBtn = el('button', { type: 'button', class: 'btn btn-primary', text: '規則の確認を始める', onclick: () => start() });
  const status = el('div', { class: 'rules-status', role: 'status', 'aria-live': 'polite' });
  const resultArea = el('div', { class: 'rules-result' });

  const canRun = typeof ctx.makeProbeStudent === 'function';

  root.replaceChildren(bar, el('main', { class: 'page-main' },
    el('h1', { text: '規則の確認' }),
    el('p', { text: 'データベースの規則が、生徒に見せてはいけないものを見せていないかを確かめます。確認用の生徒 ID（s00-999）を使い、終わったら確認用のクラスなどを消します。1 分ほどかかります。' }),
    canRun
      ? el('div', { class: 'page-actions' }, startBtn)
      : el('p', { class: 'notice', role: 'alert', text: '練習モードでは確かめられません（規則は本物の Firebase にあります）。' }),
    status,
    resultArea));

  if (!canRun) startBtn.disabled = true;

  function showCopy(rows) {
    const note = el('p', { class: 'small', role: 'status', 'aria-live': 'polite' });
    const area = el('textarea', { class: 'rules-copy-text', rows: '10', readonly: true, hidden: true, 'aria-label': '結果の文字' });
    const copyBtn = el('button', {
      type: 'button', class: 'btn', text: '結果をコピー',
      onclick: async () => {
        const text = reportText(rows);
        try {
          if (!navigator.clipboard || !navigator.clipboard.writeText) throw new Error('clipboard なし');
          await navigator.clipboard.writeText(text);
          if (!alive) return;
          note.textContent = '○ コピーしました。Claude Code に貼り付けてください。';
          area.hidden = true;
        } catch {
          if (!alive) return;
          note.textContent = '× 自動ではコピーできませんでした。下の欄の文字をすべて選んでコピーしてください。';
          area.value = text;
          area.hidden = false;
          area.focus();
          area.select();
        }
      },
    });
    return [el('div', { class: 'page-actions' }, copyBtn), note, area];
  }

  // 準備の失敗の文
  const prepareFailed = () => el('div', { class: 'error', role: 'alert' },
    el('p', { text: '× 確認の準備ができませんでした（確認用の生徒を作れない・つながらないなど）。' }),
    el('p', { text: 'しばらくしてから「規則の確認を始める」を押してください。続くときは、Claude Code に知らせてください。' }));

  function renderRows(rows) {
    const bad = rows.filter((r) => !r.pass).length;
    const prepFail = rows.some((r) => r.label === PREPARE_LABEL && !r.pass);
    const cleanFail = rows.some((r) => r.label === CLEANUP_LABEL && !r.pass);
    let summary;
    if (prepFail) summary = prepareFailed();
    else if (bad === 0) summary = el('p', { class: 'notice notice-ok' }, statusChip('ok', 'すべて ○'), ' すべて ○ でした。');
    else summary = el('p', { class: 'error', role: 'alert' }, statusChip('danger', `× が ${bad} 件`), ' × があります。公開する前に、Claude Code に知らせてください。');
    const cleanNote = cleanFail
      ? el('p', { class: 'error', role: 'alert', text: '確認用のデータが残っているかもしれません。もう一度『規則の確認を始める』を押すと、片付けをやり直します。' })
      : null;
    const table = el('div', { class: 'table-scroll' },
      el('table', { class: 'roster-table rules-table' },
        el('thead', {}, el('tr', {},
          el('th', { scope: 'col', text: '試したこと（確認用の生徒として）' }),
          el('th', { scope: 'col', text: '期待' }),
          el('th', { scope: 'col', text: '結果' }),
          el('th', { scope: 'col', text: '○×' }))),
        el('tbody', {}, rows.map((r) => el('tr', { class: r.pass ? '' : 'row-has-error' },
          el('td', { text: r.label }),
          el('td', { text: EXPECT_TEXT[r.expect] || r.expect }),
          el('td', { text: GOT_TEXT[r.got] || r.got }),
          el('td', { class: 'rules-mark', text: r.pass ? '○ 合っている' : '× ちがう' }))))));
    resultArea.replaceChildren(...[summary, cleanNote, table, ...showCopy(rows)].filter(Boolean));
  }

  async function start() {
    if (running || !canRun) return;
    running = true;
    startBtn.disabled = true;
    resultArea.replaceChildren();
    status.replaceChildren(el('p', { class: 'notice', text: '確かめています…（終わるまで、この画面のままにしてください）' }));
    const issuer = createIssuer({
      auth: ctx.auth, repo: ctx.repo, random: ctx.random,
      domain: CONFIG.emailDomain, firstGeneration: CONFIG.firstGeneration, maxTries: CONFIG.maxGenerationTries,
    });
    const teacherUid = ctx.auth.user ? ctx.auth.user.uid : '';
    let rows = null;
    let failed = false;
    try {
      rows = await runRulesProbe({
        teacherRepo: ctx.repo, teacherNet: ctx.net, issuer,
        makeStudent: ctx.makeProbeStudent, random: ctx.random, now: ctx.now, teacherUid,
      });
    } catch {
      // runRulesProbe は例外を投げないが、念のため。文にパスワードが入らないよう、例外の中身は出さない
      failed = true;
    } finally {
      running = false;
    }
    if (!alive) return;
    startBtn.disabled = false;
    if (failed) {
      status.replaceChildren(prepareFailed());
      return;
    }
    status.replaceChildren();
    renderRows(rows);
  }

  return () => { alive = false; };
}
