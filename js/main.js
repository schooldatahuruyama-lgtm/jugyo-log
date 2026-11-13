// アプリの入り口: 通信とログインを用意し、今だれなのかを決めて、ハッシュに合わせて画面を切りかえる
// ブラウザのもの（window・document・fetch・localStorage・crypto・Date.now）を直接使うのは、
// js/views/ の画面のほかでは、このファイルだけ。ほかのモジュールには引数で渡す。
import { FIREBASE } from './firebase-config.js';
import { createAuth } from './auth.js';
import { createNet } from './net.js';
import { createRepo } from './repo.js';
import { GAS } from './gas-config.js';
import { createGas } from './gas.js';
import { createFileCache } from './file-cache.js';
import { createFiles } from './files.js';
import { parseRoute, routeHash, viewFile, roleFor } from './router.js';
import { resolveSession } from './session.js';
import { isDemoAllowed, createDemoBackend } from './dev/demo.js';
import { el, confirmDialog, closeAllDialogs } from './ui.js';
import { createLeaveGuard, decideHashChange } from './leave-guard.js';

const appRoot = document.getElementById('app');
const bannerRoot = document.getElementById('banner');

const now = () => Date.now();

// 0 以上 1 未満の数（パスワードや ID を作るのに使うので、Math.random ではなく crypto.getRandomValues から作る）
function random() {
  const a = new Uint32Array(1);
  window.crypto.getRandomValues(a);
  return a[0] / 4294967296;
}

// 役割ごとの最初の画面
const HOME_OF = { teacher: 't-classes', student: 'home' };

function showMessage(text, { retry = null } = {}) {
  appRoot.replaceChildren(el('main', { class: 'center-page' },
    el('h1', { text: '授業ログ' }),
    el('p', { class: 'notice', role: 'alert', text }),
    retry ? el('p', {}, el('button', { type: 'button', class: 'btn btn-primary', text: 'もう一度ためす', onclick: retry })) : null));
}

// メモリだけの storage（規則の確認用の生徒のログインを、端末に残さない）
function memoryStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
  };
}

// 練習モードか、本物の Firebase か、設定が空か（空なら null）
function createBackend() {
  if (isDemoAllowed(location.hostname, location.search)) {
    const demo = createDemoBackend({ storage: window.localStorage, now, random });
    return { demo, net: demo.net, auth: demo.auth, gas: demo.gas, makeProbeStudent: null };
  }
  if (!FIREBASE.databaseURL || !FIREBASE.apiKey) return null;
  const fetchFn = window.fetch.bind(window);
  const auth = createAuth({ apiKey: FIREBASE.apiKey, fetch: fetchFn, storage: window.localStorage, now });
  const net = createNet({ databaseURL: FIREBASE.databaseURL, auth, fetch: fetchFn });
  const gas = createGas({
    url: GAS.appUrl, auth, fetch: fetchFn, random,
    setTimeout: window.setTimeout.bind(window), clearTimeout: window.clearTimeout.bind(window),
  });
  // 規則の確認（js/rules-probe.js）用: 確認用の生徒として、2 つ目のログインを作る。
  // 先生のログイン（localStorage の 'jugyolog:auth'）には触れない
  const makeProbeStudent = async (email, password) => {
    const probeAuth = createAuth({
      apiKey: FIREBASE.apiKey, fetch: fetchFn, storage: memoryStorage(), now, storageKey: 'jugyolog:probe',
    });
    const user = await probeAuth.signIn(email, password);
    const probeNet = createNet({ databaseURL: FIREBASE.databaseURL, auth: probeAuth, fetch: fetchFn });
    return { net: probeNet, uid: user.uid };
  };
  return { demo: null, net, auth, gas, makeProbeStudent };
}

function showDemoBanner(demo) {
  bannerRoot.replaceChildren(el('div', { class: 'demo-banner' },
    el('span', { text: '練習モード（データはこのパソコンの中だけ）' }),
    el('button', {
      type: 'button', class: 'btn', text: '練習モードのデータを消す',
      onclick: async () => {
        const ok = await confirmDialog({
          title: '練習モードのデータを消しますか？',
          body: 'このパソコンの中の練習用のデータ（クラス・名簿・アカウント・ログイン）が、すべて消えます。',
          okLabel: '消す',
          danger: true,
        });
        if (!ok) return;
        try {
          await demo.reset();
        } catch (e) {
          console.error(e);
        }
        history.replaceState(null, '', routeHash('login'));
        location.reload();
      },
    })));
}

function start() {
  let backend;
  try {
    backend = createBackend();
  } catch (e) {
    console.error(e);
    showMessage('このブラウザでは、授業ログを始められませんでした。');
    return;
  }
  if (!backend) { showMessage('Firebase の設定がまだ入っていません。'); return; }
  if (backend.demo) showDemoBanner(backend.demo);

  const { auth } = backend;
  const repo = createRepo(backend.net);
  let cacheStorage;
  // 練習用ファイルは読み直すと消えるため、取り置きもメモリだけにする
  if (!backend.demo) {
    try { cacheStorage = window.caches; } catch { /* 使えないときはメモリで続ける */ }
  }
  const files = createFiles({ gas: backend.gas, cache: createFileCache({ caches: cacheStorage }) });
  async function signOutAll() {
    try { await files.clearCache(); } catch { /* 片付けに失敗してもログアウトする */ }
    await auth.signOut();
  }
  let session = null; // resolveSession の結果。まだ決めていなければ null
  let cleanup = null;
  let renderId = 0;
  // 画面を離れてよいかをたずねる仕組み（js/leave-guard.js）。画面は ctx.setLeaveGuard(fn) で置く
  const leave = createLeaveGuard();
  let shownHash = location.hash; // 今の画面のハッシュ（「戻る」を取り消したときに戻す先）

  const teardown = () => {
    leave.clear(); // 画面を替えるときは guard を外す
    closeAllDialogs();
    if (cleanup) {
      try { cleanup(); } catch (e) { console.error(e); }
      cleanup = null;
    }
  };

  // 画面を移して、その描き直しが終わるのを待てるようにする（結果は 'offline' などを返す）。
  // 今の画面の guard に離れてよいかをたずね、だめなら移らずに 'stayed' を返す。
  // 画面の中で自分で確かめたあと（ログアウトなど）は { confirmed: true } で、もう一度たずねない
  async function navigate(name, params = {}, { confirmed = false } = {}) {
    if (!confirmed && !(await leave.ask())) return 'stayed';
    const next = routeHash(name, params);
    if (location.hash !== next) history.pushState(null, '', next); // hashchange は起きないので、ここで描き直す
    return render();
  }

  async function loadView(name) {
    const file = viewFile(name);
    if (!file) return null;
    try {
      return await import(`./views/${file}.js`);
    } catch (e) {
      console.error(e);
      return null;
    }
  }

  // 次の画面の読みこみを待つ間、前の画面のボタンが残らないよう中身を置きかえる
  function showLoading() {
    appRoot.replaceChildren(el('p', { class: 'loading', role: 'status', text: '読みこんでいます…' }));
  }

  // 画面のファイルが無い・読みこめないとき（Task 4〜6 で作る画面など）。落ちずに文を出す
  function placeholder(role) {
    appRoot.replaceChildren(el('main', { class: 'page-pad' },
      el('h2', { text: 'この画面は、まだありません。' }),
      el('p', {}, el('a', { class: 'btn btn-primary', href: routeHash(HOME_OF[role] || 'login'), text: '最初の画面へ' }))));
  }

  // 今のログインと、決めてある session が食い違っていれば（ログイン・ログアウトのあとなど）決め直す
  async function ensureSession() {
    const uid = auth.user ? auth.user.uid : null;
    const known = session && session.role !== 'offline' ? (session.uid ?? null) : undefined;
    if (session && known === uid) return session;
    return resolveSession({ auth, repo });
  }

  async function render() {
    const id = ++renderId;
    const stale = () => id !== renderId;
    shownHash = location.hash;
    const route = parseRoute(location.hash);

    if (route.name === 'not-found') {
      teardown();
      appRoot.replaceChildren(el('main', { class: 'page-pad' },
        el('h2', { text: 'ページが見つかりません' }),
        el('p', {}, el('a', { class: 'btn btn-primary', href: routeHash('home'), text: '最初の画面へ' }))));
      return;
    }

    if (!session) showLoading();
    const s = await ensureSession();
    if (stale()) return;
    session = s;

    // 確かめられなかった: ログイン画面に戻さず、やり直せるようにする
    if (session.role === 'offline') {
      teardown();
      showMessage('つながりません。電波を確かめてください。', { retry: () => render() });
      return 'offline';
    }

    // 画面と役割が合わないときは、合う画面へ（履歴を増やさない）
    const role = session.role; // 'none' | 'teacher' | 'student'
    const need = roleFor(route.name);
    let redirect = null;
    if (route.name === 'login') redirect = HOME_OF[role] || null;
    else if (need !== 'public' && need !== role) redirect = HOME_OF[role] || 'login';
    if (redirect) {
      history.replaceState(null, '', routeHash(redirect));
      return render();
    }

    teardown();
    showLoading();
    const view = await loadView(route.name);
    if (stale()) return;
    if (!view || typeof view.mount !== 'function') {
      placeholder(role);
      return;
    }
    const ctx = {
      auth, repo, files, signOutAll, session, navigate, now, random, demo: Boolean(backend.demo), params: route.params,
      net: backend.net, makeProbeStudent: backend.makeProbeStudent,
      // 離れてよいかをたずねる関数を置く（null で外す）。古くなった画面からの呼び出しは無視する
      setLeaveGuard: (fn) => { if (!stale()) leave.set(fn); },
    };
    try {
      const c = view.mount(appRoot, ctx);
      cleanup = typeof c === 'function' ? c : null;
    } catch (e) {
      console.error(e);
      showMessage('画面を出せませんでした。もう一度ためしてください。', { retry: () => render() });
    }
  }

  // ブラウザの「戻る」やハッシュの書きかえ: 今の画面の guard にたずね、だめならハッシュを元に戻す
  // （pushState では hashchange が起きないので、もう一度たずねない）。画面はそのまま
  window.addEventListener('hashchange', async () => {
    const to = location.hash;
    const d = await decideHashChange({ guard: leave, shown: shownHash, to });
    if (d === 'restore') {
      if (location.hash !== shownHash) history.pushState(null, '', shownHash);
      return;
    }
    if (d === 'render') {
      // たずねている間に、ほかの移動でハッシュが変わっていたら、答えた先に合わせる
      if (location.hash !== to) history.pushState(null, '', to);
      render();
    }
  });
  render();
}

start();
