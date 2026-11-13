// 先生の名簿の画面（#/t/class/<classId>。設計書 7.5 の「名簿」）
// 表: 出席番号（入力欄）・生徒 ID・状態・「パスワードを出し直す」・「外す」。
// 「生徒を足す」「前のクラスから引きつぐ」で行を足し、「保存する」で members と memberOf を書く。
// 名簿に出すのは出席番号と生徒 ID だけ（名前は入れさせない）。
import { el, confirmDialog, toast, statusChip } from '../ui.js';
import { CONFIG } from '../config.js';
import { createIssuer } from '../issue.js';
import { checkRows, diffMembers, unassigned, carryOver, elsewhereOf } from '../roster-logic.js';

// まちがいの code ごとの文（elsewhere はクラス名を入れる）
function errorText(code, otherClass) {
  switch (code) {
    case 'bad-id': return '生徒 ID の形がちがいます。';
    case 'dup-id': return '同じ生徒 ID が 2 回あります。どちらかを外してください。';
    case 'no-number': return '出席番号を入れてください。';
    case 'bad-number': return `出席番号は 1〜${CONFIG.maxNumber} の数で入れてください。`;
    case 'dup-number': return '出席番号が重なっています。';
    case 'elsewhere': return `この生徒は、同じ年度の「${otherClass}」に入っています。そちらから外してから足してください。`;
    default: return 'この行にまちがいがあります。';
  }
}

// 表の行を比べるための文字（保存していない変更があるかを見る）
const snapshot = (rows) => JSON.stringify(rows.map((r) => [r.studentId, String(r.number).trim()]));

export function mount(root, ctx) {
  let alive = true;
  const classId = ctx.params.classId;

  let cls = null;            // { id, year, name }
  let allClasses = [];       // listClasses の結果
  let students = new Map();  // 生徒 ID → { uid, gen }（gen は出し直しで分かった回数。読んだだけなら null）
  let passwords = {};        // 生徒 ID → 最初のパスワード（印刷用。ここでは「最初のまま」かを見るだけ）
  let elsewhere = {};        // 同じ年度のほかのクラスにいる生徒 ID → そのクラス名
  let saved = [];            // 保存してある名簿 [{ studentId, number }]
  let rows = [];             // 表の名簿 [{ studentId, number: 入力のままの文字 }]
  let baseline = '[]';       // 保存してある名簿の snapshot
  let errors = new Map();    // 行の番号 → code
  const fresh = new Map();   // 出し直したパスワード（この画面にいる間だけ、1 回だけ出す）
  let busy = false;          // 保存・出し直し・引きつぎの通信中（表の編集とボタンを止める）

  const issuer = createIssuer({
    auth: ctx.auth, repo: ctx.repo, random: ctx.random,
    domain: CONFIG.emailDomain, firstGeneration: CONFIG.firstGeneration, maxTries: CONFIG.maxGenerationTries,
  });

  const dirty = () => cls !== null && snapshot(rows) !== baseline;

  // 保存していない変更があるまま、ページを閉じる・読みこみ直すときは、ブラウザに確かめさせる
  const onBeforeUnload = (ev) => {
    if (!dirty() && !busy) return;
    ev.preventDefault();
    ev.returnValue = '';
  };
  window.addEventListener('beforeunload', onBeforeUnload);

  // 画面を離れてよいか（保存していない変更があれば確かめる）
  async function okToLeave() {
    if (!dirty()) return true;
    return confirmDialog({
      title: '保存していない変更があります',
      body: '名簿の変更が、まだ保存されていません。保存しないで画面を移ると、変更は消えます。移りますか？',
      okLabel: '保存しないで移る',
      cancelLabel: 'この画面に残る',
    });
  }

  // ブラウザの「戻る」や ctx.navigate のときに、main.js がこれでたずねる
  if (ctx.setLeaveGuard) ctx.setLeaveGuard(okToLeave);

  // 移る前の確かめは、main.js が guard（okToLeave）で行う
  const go = (name, params) => ctx.navigate(name, params);

  const title = el('span', { class: 'topbar-sub', text: '名簿' });
  const bar = el('header', { class: 'topbar topbar-teacher' },
    el('div', { class: 'topbar-title' },
      el('span', { class: 'topbar-brand', text: '授業ログ' }),
      title),
    el('nav', { class: 'topbar-menu', 'aria-label': 'メニュー' },
      el('button', { type: 'button', class: 'btn', text: '‹ クラスの一覧へ', onclick: () => go('t-classes') })));

  const body = el('div', { class: 'page-body' });
  root.replaceChildren(bar, el('main', { class: 'page-main' }, body));

  // ---- 部品 ----
  const heading = el('h1');
  const message = el('div', { class: 'page-message', role: 'status', 'aria-live': 'polite' });
  const panel = el('div', { class: 'form-area' }); // 「生徒を足す」「前のクラスから引きつぐ」
  const tableArea = el('div');
  const saveBtn = el('button', { type: 'button', class: 'btn btn-primary', text: '保存する', onclick: () => save() });
  const addBtn = el('button', { type: 'button', class: 'btn', text: '生徒を足す', onclick: () => showAddPanel() });
  const carryBtn = el('button', { type: 'button', class: 'btn', text: '前のクラスから引きつぐ', onclick: () => showCarryPanel() });
  const sheetBtn = el('button', {
    type: 'button', class: 'btn', text: 'ID の一覧を印刷する',
    onclick: () => go('t-sheet', { classId }),
  });

  // 通信中は、表の番号の欄・「外す」・「出し直す」・「生徒を足す」・「引きつぐ」・「保存する」を押せなくする
  function setBusy(v) {
    busy = v;
    for (const b of [saveBtn, addBtn, carryBtn]) b.disabled = v;
    if (v) panel.replaceChildren(); // 開いている「生徒を足す」などは閉じる
    renderTable();
  }

  function say(kind, text) {
    if (!text) { message.replaceChildren(); return; }
    message.replaceChildren(el('p', { class: kind === 'error' ? 'error' : 'notice', text }));
  }

  // ---- 表 ----

  function stateCell(id) {
    if (fresh.has(id)) {
      return el('td', { class: 'state' },
        statusChip('info', '出し直しました'),
        el('div', { class: 'fresh-pw' },
          el('span', { class: 'small', text: '新しいパスワード: ' }),
          el('strong', { class: 'mono', text: fresh.get(id) })));
    }
    const s = students.get(id);
    if (!s || s.uid === null) return el('td', { class: 'state' }, statusChip('warn', 'まだ発行が済んでいません'));
    if (Object.prototype.hasOwnProperty.call(passwords, id)) return el('td', { class: 'state' }, statusChip('info', '最初のパスワードのまま'));
    return el('td', { class: 'state' }, statusChip('ok', '変更済み'));
  }

  function renderTable() {
    if (rows.length === 0) {
      tableArea.replaceChildren(el('p', { class: 'home-empty', text: 'まだ生徒がいません。「生徒を足す」か「前のクラスから引きつぐ」で足してください。' }));
      return;
    }
    const trs = [];
    rows.forEach((r, i) => {
      const code = errors.get(i);
      const input = el('input', {
        type: 'text', inputmode: 'numeric', class: 'num-input', value: String(r.number),
        autocomplete: 'off', 'aria-label': `${r.studentId} の出席番号`,
        'aria-invalid': code ? 'true' : null,
        disabled: busy,
        oninput: (ev) => { r.number = ev.target.value; },
      });
      const s = students.get(r.studentId);
      const canReissue = !!(s && s.uid);
      trs.push(el('tr', { class: code ? 'row-has-error' : null },
        el('td', { class: 'num' }, input),
        el('td', { class: 'mono sid', text: r.studentId }),
        stateCell(r.studentId),
        el('td', {}, el('button', {
          type: 'button', class: 'btn', text: 'パスワードを出し直す',
          disabled: busy || !canReissue,
          'aria-label': `${r.studentId} のパスワードを出し直す`,
          onclick: () => reissue(r.studentId),
        })),
        el('td', {}, el('button', {
          type: 'button', class: 'btn', text: '外す',
          disabled: busy,
          'aria-label': `${r.studentId} を名簿から外す`,
          onclick: () => removeRow(i),
        }))));
      if (code) {
        trs.push(el('tr', { class: 'row-error' },
          el('td', { colspan: '5' },
            el('span', { class: 'row-error-text', role: 'alert' }, statusChip('danger', 'まちがい'), ` ${r.studentId}: ${errorText(code, elsewhere[r.studentId])}`))));
      }
    });
    tableArea.replaceChildren(el('div', { class: 'table-scroll' },
      el('table', { class: 'roster-table' },
        el('thead', {}, el('tr', {},
          el('th', { scope: 'col', text: '出席番号' }),
          el('th', { scope: 'col', text: '生徒 ID' }),
          el('th', { scope: 'col', text: '状態' }),
          el('th', { scope: 'col', text: 'パスワード' }),
          el('th', { scope: 'col', text: '名簿から' }))),
        el('tbody', {}, trs))));
  }

  function removeRow(i) {
    if (busy) return;
    rows.splice(i, 1);
    errors = new Map();
    renderTable();
  }

  // 生徒 ID を、出席番号の空いた行として足す（すでに表にある ID は足さない）
  function addRows(list) {
    if (busy) return 0;
    const have = new Set(rows.map((r) => r.studentId));
    let n = 0;
    for (const r of list) {
      if (have.has(r.studentId)) continue;
      rows.push({ studentId: r.studentId, number: '' });
      have.add(r.studentId);
      n += 1;
    }
    errors = new Map();
    renderTable();
    return n;
  }

  // ---- 生徒を足す ----

  function showAddPanel() {
    if (busy) return;
    const inTable = new Set(rows.map((r) => r.studentId));
    const ids = unassigned([...students.keys()], elsewhere).filter((id) => !inTable.has(id));
    const close = () => panel.replaceChildren();
    if (ids.length === 0) {
      panel.replaceChildren(el('div', { class: 'card inline-form' },
        el('h2', { text: '生徒を足す' }),
        el('p', { text: 'この年度のどのクラスにも入っていない生徒 ID はありません。足りないときは、クラスの一覧の「生徒 ID を発行する」で発行してください。' }),
        el('div', { class: 'dialog-actions' }, el('button', { type: 'button', class: 'btn', text: '閉じる', onclick: close }))));
      return;
    }
    const boxes = ids.map((id) => el('input', { type: 'checkbox', value: id }));
    const all = el('input', {
      type: 'checkbox',
      onchange: (ev) => { for (const b of boxes) b.checked = ev.target.checked; },
    });
    const form = el('form', { class: 'card inline-form', novalidate: true, 'aria-label': '生徒を足す' },
      el('h2', { text: '生徒を足す' }),
      el('p', { class: 'small muted', text: 'この年度のどのクラスにも入っていない生徒 ID です。足す ID を選んでください。' }),
      el('label', { class: 'check-row check-all' }, all, el('span', { text: 'すべて選ぶ' })),
      el('div', { class: 'check-list' }, ids.map((id, k) => el('label', { class: 'check-row' },
        boxes[k], el('span', { class: 'mono', text: id })))),
      el('div', { class: 'dialog-actions' },
        el('button', { type: 'button', class: 'btn', text: 'やめる', onclick: close }),
        el('button', { type: 'submit', class: 'btn btn-primary', text: '表に足す' })));
    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const picked = boxes.filter((b) => b.checked).map((b) => ({ studentId: b.value }));
      if (picked.length === 0) { close(); return; }
      const n = addRows(picked);
      close();
      say('notice', `${n} 人を表に足しました。出席番号を入れて「保存する」を押してください。`);
    });
    panel.replaceChildren(form);
  }

  // ---- 前のクラスから引きつぐ ----

  function showCarryPanel() {
    if (busy) return;
    const close = () => panel.replaceChildren();
    const earlier = allClasses.filter((c) => c.year < cls.year); // 年度の新しい順
    if (earlier.length === 0) {
      panel.replaceChildren(el('div', { class: 'card inline-form' },
        el('h2', { text: '前のクラスから引きつぐ' }),
        el('p', { text: '前の年度のクラスがありません。' }),
        el('div', { class: 'dialog-actions' }, el('button', { type: 'button', class: 'btn', text: '閉じる', onclick: close }))));
      return;
    }
    const select = el('select', { id: 'carry-from' },
      earlier.map((c) => el('option', { value: c.id, text: `${c.year} 年度 ${c.name}` })));
    const error = el('div', { class: 'error', role: 'alert', hidden: true });
    const ok = el('button', { type: 'submit', class: 'btn btn-primary', text: '引きつぐ' });
    const form = el('form', { class: 'card inline-form', novalidate: true, 'aria-label': '前のクラスから引きつぐ' },
      el('h2', { text: '前のクラスから引きつぐ' }),
      el('div', { class: 'field' },
        el('label', { class: 'label', for: 'carry-from', text: '前の年度のクラス' }),
        el('p', { class: 'small muted field-hint', text: 'そのクラスの生徒 ID を、出席番号の空いた行として表に足します。' }),
        select),
      error,
      el('div', { class: 'dialog-actions' },
        el('button', { type: 'button', class: 'btn', text: 'やめる', onclick: close }),
        ok));
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      if (busy) return;
      error.hidden = true;
      ok.disabled = true;
      // 読む間は、保存などを始められないようにする（setBusy は panel を閉じるので、busy だけ立てる）
      busy = true;
      for (const b of [saveBtn, addBtn, carryBtn]) b.disabled = true;
      let prev;
      try {
        prev = await ctx.repo.getMembers(select.value);
      } catch (e) {
        if (!alive) return;
        busy = false;
        for (const b of [saveBtn, addBtn, carryBtn]) b.disabled = false;
        ok.disabled = false;
        error.textContent = 'つながりません。もう一度ためしてください。';
        error.hidden = false;
        return;
      }
      if (!alive) return;
      busy = false;
      for (const b of [saveBtn, addBtn, carryBtn]) b.disabled = false;
      const n = addRows(carryOver(prev));
      close();
      say('notice', n > 0
        ? `${n} 人を表に足しました。出席番号を入れて「保存する」を押してください。`
        : '足す生徒 ID はありませんでした（すでに表にあるか、生徒がいません）。');
    });
    panel.replaceChildren(form);
    select.focus();
  }

  // ---- 保存 ----

  // まちがいを表に出す。まちがいがあれば true
  function showErrors(errs) {
    errors = new Map(errs.map((e) => [e.index, e.code]));
    renderTable();
    if (errs.length === 0) return false;
    say('error', `まちがいがある行が ${errs.length} 行あります。直してから「保存する」を押してください。`);
    return true;
  }

  async function save() {
    if (busy) return;
    // 送る時点の名簿をコピーする（保存の応答を待つ間の変更が「保存済み」にならないように）。
    // 保存中は表を編集できないようにもする
    const sending = rows.map((r) => ({ studentId: r.studentId, number: String(r.number) }));
    // まず ID と出席番号だけを確かめる（ほかのクラスとの重なりは、下で読み直した最新の値で確かめる。
    // 画面を開いたときの古い値で止めると、ほかのクラスから外したあとに保存をやり直せないため）
    if (showErrors(checkRows(sending, { maxNumber: CONFIG.maxNumber, elsewhere: {} }))) return;
    const diff = diffMembers(saved, sending);
    if (Object.keys(diff.set).length === 0 && diff.remove.length === 0) {
      say('notice', '変わったところはありません。');
      baseline = snapshot(sending);
      return;
    }
    // 画面が持つ elsewhere（行の文にも使う）は、下で読み直した値に置きかわる
    setBusy(true);
    say('notice', '保存しています…');
    try {
      // 同じ年度のほかのクラス（画面を開いたあとに、ほかの画面で変えたかもしれない）を、保存の直前に読み直して、
      // もう一度確かめる。2 つの画面で同じ瞬間に保存した場合までは防がない（先生は 1 人のため）
      const [ofYear, classes] = await Promise.all([ctx.repo.getMembersOfYear(cls.year), ctx.repo.listClasses()]);
      if (!alive) return;
      allClasses = classes;
      elsewhere = elsewhereOf(ofYear, classes, classId);
      const errs = checkRows(sending, { maxNumber: CONFIG.maxNumber, elsewhere });
      if (errs.length > 0) {
        setBusy(false);
        showErrors(errs);
        return;
      }
      await ctx.repo.saveMembers(classId, diff);
    } catch (e) {
      if (!alive) return;
      setBusy(false);
      say('error', 'つながりません。保存できませんでした。もう一度「保存する」を押してください。');
      return;
    }
    if (!alive) return;
    // 送ったコピーを保存済みにする（出席番号の順にならべ直す）
    saved = sending.map((r) => ({ studentId: r.studentId, number: Number(r.number.normalize('NFKC').trim()) }))
      .sort((a, b) => (a.number - b.number) || (a.studentId < b.studentId ? -1 : 1));
    rows = saved.map((m) => ({ studentId: m.studentId, number: String(m.number) }));
    baseline = snapshot(rows);
    errors = new Map();
    setBusy(false);
    say('notice', '保存しました。');
    toast('名簿を保存しました。');
  }

  // ---- パスワードの出し直し ----

  async function reissue(id) {
    if (busy) return;
    const s = students.get(id);
    if (!s || !s.uid) return; // ボタンを出すかどうかだけに使う（出し直しには、覚えている uid・回数を渡さない）
    const ok = await confirmDialog({
      title: 'パスワードを出し直しますか？',
      body: `${id} のパスワードを出し直します。今のパスワードでは入れなくなります。記録は残ります。`,
      okLabel: '出し直す',
      danger: true,
    });
    if (!ok || !alive || busy) return;
    // 前に出し直したパスワードの表示を消す（これから無効になる。応答だけ失われた場合に、
    // 入れなくなった古い値を「新しいパスワード」として出し続けないため）
    fresh.delete(id);
    setBusy(true);
    say('notice', `${id} のパスワードを出し直しています…`);
    let result;
    try {
      // reissueOne が、台帳の今の uid と回数を自分で読み直し、同じ ID の出し直しを 1 つずつ行う
      result = await issuer.reissueOne(id);
    } catch (e) {
      if (!alive) return;
      const text = e && e.code === 'rate'
        ? '一度に作れる数の上限に当たりました。1 時間ほどあとで、もう一度ためしてください。'
        : 'つながりません。出し直せませんでした。もう一度ためしてください。';
      // 途中まで進んだかもしれないので、表の状態を読み直す
      // （読み直せなくても、次の出し直しは reissueOne が自分で読み直すので安全）
      let reloaded = true;
      try {
        await loadAccounts();
      } catch {
        reloaded = false;
      }
      if (!alive) return;
      setBusy(false);
      say('error', reloaded ? text : `${text}表の状態を読み直せませんでした。画面を読み直してください。`);
      return;
    }
    if (!alive) return;
    // 表示のために、その行の uid を新しいアカウントのものに書きかえる
    students.set(id, { uid: result.uid, gen: result.generation });
    passwords = { ...passwords, [id]: result.password };
    fresh.set(id, result.password);
    setBusy(false);
    say('notice', `${id} のパスワードを出し直しました。新しいパスワードは表に出ています（この画面を離れると、ここには出ません。ID の一覧の印刷にも出ます）。`);
  }

  // ---- 読みこみ ----

  async function loadAccounts() {
    const [list, pw] = await Promise.all([ctx.repo.listStudents(), ctx.repo.getInitialPasswords()]);
    students = new Map(list.map((s) => [s.id, { uid: s.uid, gen: null }]));
    passwords = pw;
  }

  async function load() {
    body.replaceChildren(el('p', { class: 'loading', role: 'status', text: '読みこんでいます…' }));
    try {
      allClasses = await ctx.repo.listClasses();
      cls = allClasses.find((c) => c.id === classId) || null;
      if (!cls) {
        if (!alive) return;
        body.replaceChildren(
          el('p', { class: 'error', role: 'alert', text: 'このクラスは見つかりません。' }),
          el('p', {}, el('button', { type: 'button', class: 'btn btn-primary', text: 'クラスの一覧へ', onclick: () => ctx.navigate('t-classes') })));
        return;
      }
      const [members, ofYear] = await Promise.all([
        ctx.repo.getMembers(classId),
        ctx.repo.getMembersOfYear(cls.year),
        loadAccounts(),
      ]);
      elsewhere = elsewhereOf(ofYear, allClasses, classId);
      saved = members;
      rows = members.map((m) => ({ studentId: m.studentId, number: String(m.number) }));
      baseline = snapshot(rows);
    } catch (e) {
      cls = null;
      if (!alive) return;
      body.replaceChildren(
        el('p', { class: 'error', role: 'alert', text: 'つながりません。電波を確かめて、もう一度ためしてください。' }),
        el('p', {}, el('button', { type: 'button', class: 'btn btn-primary', text: 'もう一度ためす', onclick: load })));
      return;
    }
    if (!alive) return;
    title.textContent = `名簿　${cls.year} 年度 ${cls.name}`;
    heading.textContent = `${cls.year} 年度 ${cls.name} の名簿`;
    body.replaceChildren(
      heading,
      el('div', { class: 'page-actions' }, addBtn, carryBtn, sheetBtn),
      panel,
      message,
      tableArea,
      el('div', { class: 'page-actions page-actions-end' }, saveBtn));
    renderTable();
  }

  load();
  return () => {
    alive = false;
    window.removeEventListener('beforeunload', onBeforeUnload);
  };
}
