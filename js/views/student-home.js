// 生徒のホーム（授業の一覧。1a-1 では、まだ授業が無い）
// 上部: クラス名と出席番号（1 番新しい年度）、メニュー（パスワードを変える・ログアウト）
import { el, confirmDialog } from '../ui.js';

export function mount(root, ctx) {
  let alive = true;
  const sub = el('span', { class: 'topbar-sub' });
  const body = el('div', { class: 'page-body' });

  const logout = async () => {
    const ok = await confirmDialog({
      title: 'ログアウトしますか？',
      body: 'もう一度使うときは、ID とパスワードを入れます。',
      okLabel: 'ログアウト',
    });
    if (!ok || !alive) return;
    ctx.auth.signOut();
    ctx.navigate('login');
  };

  const bar = el('header', { class: 'topbar' },
    el('div', { class: 'topbar-title' },
      el('span', { class: 'topbar-brand', text: '授業ログ' }),
      sub),
    el('nav', { class: 'topbar-menu', 'aria-label': 'メニュー' },
      el('button', { type: 'button', class: 'btn', text: 'パスワードを変える', onclick: () => ctx.navigate('password') }),
      el('button', { type: 'button', class: 'btn', text: 'ログアウト', onclick: logout })));

  root.replaceChildren(bar, el('main', { class: 'page-main' }, body));

  async function load() {
    body.replaceChildren(el('p', { class: 'loading', role: 'status', text: '読みこんでいます…' }));
    let classes;
    try {
      classes = await ctx.repo.myClasses(ctx.session.studentId);
    } catch (e) {
      if (!alive) return;
      body.replaceChildren(
        el('p', { class: 'error', role: 'alert', text: 'つながりません。電波を確かめて、もう一度ためしてください。' }),
        el('p', {}, el('button', { type: 'button', class: 'btn btn-primary', text: 'もう一度ためす', onclick: load })));
      return;
    }
    if (!alive) return;
    // myClasses は年度の新しい順。1 番新しい年度のクラスを出す
    const current = classes[0];
    if (!current) {
      sub.textContent = '';
      body.replaceChildren(el('p', { class: 'home-empty notice', text: 'まだクラスに入っていません。先生に聞いてください。' }));
      return;
    }
    sub.textContent = current.number === null ? current.name : `${current.name}　出席番号 ${current.number}`;
    body.replaceChildren(el('p', { class: 'home-empty', text: 'まだ授業がありません。' }));
  }

  load();
  return () => { alive = false; };
}
