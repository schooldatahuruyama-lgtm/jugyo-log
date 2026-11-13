// 画面を離れてよいかをたずねる仕組み（ブラウザのものは使わない）
// 画面は ctx.setLeaveGuard(fn) で fn を置く。fn は離れてよければ true、だめなら false を返す（Promise でもよい）。
// js/main.js が、ハッシュが変わったときと ctx.navigate のときに ask() でたずね、画面を替えるときに clear() する。

export function createLeaveGuard() {
  let guard = null;
  let asking = false;
  return {
    set(fn) {
      guard = typeof fn === 'function' ? fn : null;
    },
    clear() {
      guard = null;
    },
    get active() {
      return guard !== null;
    },
    // 離れてよいか。guard が無ければ true。
    // たずねている途中（確かめのダイアログが出ている間）にまた呼ばれたら、2 回目はたずねずに false。
    // guard が例外を投げたら、画面に閉じこめないよう true とする
    async ask() {
      if (!guard) return true;
      if (asking) return false;
      const fn = guard;
      asking = true;
      try {
        return (await fn()) !== false;
      } catch {
        return true;
      } finally {
        asking = false;
      }
    },
  };
}

// ハッシュが変わったとき（ブラウザの「戻る」など）にどうするか。
// shown は今の画面のハッシュ、to は新しいハッシュ。
// 'none'（同じハッシュ。何もしない）| 'render'（画面を替える）| 'restore'（ハッシュを shown に戻し、画面はそのまま）。
// 戻すときは history.pushState を使う（hashchange が起きないので、もう一度たずねない）
export async function decideHashChange({ guard, shown, to }) {
  if (to === shown) return 'none';
  return (await guard.ask()) ? 'render' : 'restore';
}
