// ID・最初のパスワードの一覧（#/t/class/<classId>/sheet。設計書 5.4）
// クラス名、表（出席番号・名前を手で書く欄・生徒 ID・最初のパスワード）、ログインのしかた。
// 名前の欄は、紙に手で書くための空欄（入力欄にしない。名前をアプリに入れさせない）。
// 印刷の見た目は css/print.css（ボタンと上部の帯を消し、1 人分ずつ切りはなせる罫線にする）。
import { el } from '../ui.js';
import { sheetRows } from '../roster-logic.js';

export function mount(root, ctx) {
  let alive = true;
  const classId = ctx.params.classId;
  const appUrl = location.origin + location.pathname;

  const bar = el('header', { class: 'topbar topbar-teacher no-print' },
    el('div', { class: 'topbar-title' },
      el('span', { class: 'topbar-brand', text: '授業ログ' }),
      el('span', { class: 'topbar-sub', text: 'ID の一覧' })),
    el('nav', { class: 'topbar-menu', 'aria-label': 'メニュー' },
      el('button', { type: 'button', class: 'btn', text: '‹ 名簿へ', onclick: () => ctx.navigate('t-roster', { classId }) })));

  const body = el('div', { class: 'page-body' });
  root.replaceChildren(bar, el('main', { class: 'page-main sheet-page' }, body));

  function render(cls, rows) {
    const howTo = el('section', { class: 'sheet-howto' },
      el('h2', { text: 'ログインのしかた' }),
      el('ol', {},
        el('li', {}, 'iPad の Safari で、次のページを開きます。', el('br'), el('strong', { class: 'mono sheet-url', text: appUrl })),
        el('li', { text: '「ID またはメールアドレス」に 生徒 ID を、「パスワード」に パスワードを入れて、「ログイン」を押します。' }),
        el('li', { text: 'ログインしたら、メニューの「パスワードを変える」で、自分だけのパスワードに変えます（8 文字以上で、自分の ID を入れないもの）。' })));

    const table = rows.length === 0
      ? el('p', { class: 'home-empty', text: 'このクラスには、まだ生徒がいません。名簿で生徒を足してください。' })
      : el('div', { class: 'table-scroll' },
        el('table', { class: 'sheet-table' },
          el('thead', {}, el('tr', {},
            el('th', { scope: 'col', text: '出席番号' }),
            el('th', { scope: 'col', text: '名前' }),
            el('th', { scope: 'col', text: '生徒 ID' }),
            el('th', { scope: 'col', text: '最初のパスワード' }))),
          el('tbody', {}, rows.map((r) => el('tr', {},
            el('td', { class: 'num', text: String(r.number) }),
            el('td', { class: 'sheet-name', 'aria-label': '名前（手で書く欄）' }),
            el('td', { class: 'mono', text: r.studentId }),
            r.password === null
              ? el('td', { class: 'muted', text: '（変更済み）' })
              : el('td', { class: 'mono sheet-pw', text: r.password }))))));

    body.replaceChildren(
      el('div', { class: 'page-actions no-print' },
        el('button', { type: 'button', class: 'btn btn-primary', text: '印刷する', onclick: () => window.print() })),
      el('p', { class: 'notice no-print', text: 'この一覧には、生徒のパスワードが出ています。印刷したら、画面を閉じてください。紙は 1 人分ずつ切って配ります。' }),
      el('h1', { class: 'sheet-title', text: `${cls.year} 年度 ${cls.name}　ID と最初のパスワード` }),
      howTo,
      table);
  }

  async function load() {
    body.replaceChildren(el('p', { class: 'loading', role: 'status', text: '読みこんでいます…' }));
    let cls;
    let members;
    let passwords;
    try {
      const classes = await ctx.repo.listClasses();
      cls = classes.find((c) => c.id === classId) || null;
      if (cls) [members, passwords] = await Promise.all([ctx.repo.getMembers(classId), ctx.repo.getInitialPasswords()]);
    } catch (e) {
      if (!alive) return;
      body.replaceChildren(
        el('p', { class: 'error', role: 'alert', text: 'つながりません。電波を確かめて、もう一度ためしてください。' }),
        el('p', {}, el('button', { type: 'button', class: 'btn btn-primary', text: 'もう一度ためす', onclick: load })));
      return;
    }
    if (!alive) return;
    if (!cls) {
      body.replaceChildren(
        el('p', { class: 'error', role: 'alert', text: 'このクラスは見つかりません。' }),
        el('p', {}, el('button', { type: 'button', class: 'btn btn-primary', text: 'クラスの一覧へ', onclick: () => ctx.navigate('t-classes') })));
      return;
    }
    render(cls, sheetRows(members, passwords));
  }

  load();
  return () => { alive = false; };
}
