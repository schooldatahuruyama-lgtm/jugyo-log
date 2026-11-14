// 先生のクラス・単元・授業・記録で使う上部の帯。
import { el, confirmDialog, toast } from '../../ui.js';

export function teacherNav(ctx, current) {
  let signingOut = false;
  const menu = [['classes', 'クラス'], ['units', '単元'], ['lessons', '授業'], ['review', '記録']];
  const bar = el('header', { class: 'topbar topbar-teacher' },
    el('div', { class: 'topbar-title' },
      el('span', { class: 'topbar-brand', text: '授業ログ' }),
      el('span', { class: 'topbar-sub', text: '先生' })),
    el('nav', { class: 'topbar-menu teacher-menu', 'aria-label': 'メニュー' },
      menu.map(([key, label]) => el('button', {
        type: 'button', class: 'btn', text: label,
        'aria-current': current === key ? 'page' : null,
        onclick: () => ctx.navigate(`t-${key}`),
      }))),
    el('button', { type: 'button', class: 'btn teacher-logout', text: 'ログアウト', onclick: logout }));

  async function logout() {
    if (signingOut) return;
    signingOut = true;
    try {
      // ログアウトは guard を通らずに移るので、画面の確かめを先に行う。
      if (ctx.okToLeave && !(await ctx.okToLeave())) return;
      if (!bar.isConnected) return;
      const ok = await confirmDialog({
        title: 'ログアウトしますか？',
        body: 'もう一度使うときは、メールアドレスとパスワードを入れます。',
        okLabel: 'ログアウト',
      });
      if (!ok || !bar.isConnected) return;
      for (const button of bar.querySelectorAll('button')) button.disabled = true;
      await ctx.signOutAll();
      if (bar.isConnected) await ctx.navigate('login', {}, { confirmed: true });
    } catch {
      if (bar.isConnected) toast('ログアウトできませんでした。もう一度ためしてください。');
    } finally {
      signingOut = false;
      if (bar.isConnected) {
        for (const button of bar.querySelectorAll('button')) button.disabled = false;
      }
    }
  }

  return bar;
}
