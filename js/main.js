// アプリの入り口: 通信とログインを用意し、今だれなのかを決めて、ハッシュに合わせて画面を切りかえる
// ブラウザのもの（window・document・fetch・localStorage・crypto・Date.now）を直接使うのは、
// js/views/ の画面のほかでは、このファイルだけ。ほかのモジュールには引数で渡す。
import { FIREBASE } from './firebase-config.js';
import { createAuth } from './auth.js';
import { createNet } from './net.js';
import { createRepo } from './repo.js';
import { CONFIG } from './config.js';
import { createOfflineStore } from './offline-store.js';
import { createOfflineNet } from './offline-net.js';
import { createOfflineRefresh } from './offline-refresh.js';
import { createSessionMemo } from './session-memo.js';
import { shouldRegister, workerUrl } from './sw-register.js';
import { GAS } from './gas-config.js';
import { gasEndpoint } from './gas-endpoint.js';
import { createGas } from './gas.js';
import { requestAiSummary } from './ai-summary-flow.js';
import { createFileCache } from './file-cache.js';
import { createFiles } from './files.js';
import { createDrafts } from './drafts.js';
import { createInkDrafts } from './ink-drafts.js';
import { createRecordQueue } from './record-queue.js';
import { createThumbStore } from './thumb-store.js';
import { parseRoute, routeHash, viewFile, roleFor } from './router.js';
import { resolveSession } from './session.js';
import { isDemoAllowed, createDemoBackend } from './dev/demo.js';
import { el, confirmDialog, closeAllDialogs } from './ui.js';
import { createLeaveGuard, decideHashChange } from './leave-guard.js';
import { VERSION } from './version.js';
import { isNewVersion, shouldCheck } from './version-check.js';

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

function showMessage(text, { retry = null, retryLabel = 'もう一度ためす' } = {}) {
  appRoot.replaceChildren(el('main', { class: 'center-page' },
    el('h1', { text: '授業ログ' }),
    el('p', { class: 'notice', role: 'alert', text }),
    retry ? el('p', {}, el('button', { type: 'button', class: 'btn btn-primary', text: retryLabel, onclick: retry })) : null));
}

// このアプリの画面のファイルだけを取り直す。本文の取得も含め、全体で 10 秒まで待つ。
async function refreshAppFiles() {
  const base = new URL('.', location.href);
  const urls = new Set([new URL('index.html', base).href]);
  for (const entry of performance.getEntriesByType('resource')) {
    const url = new URL(entry.name, base);
    if (url.href.startsWith(base.href) && /\.(js|mjs|css)$/.test(url.pathname)) urls.add(url.href);
  }
  let timer;
  try {
    await Promise.race([
      Promise.allSettled([...urls].map(async (url) => {
        const response = await fetch(url, { cache: 'reload' });
        await response.arrayBuffer();
      })),
      new Promise((resolve) => { timer = setTimeout(resolve, 10000); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

// メモリだけの storage（端末の保存が使えないときと、規則の確認用のログインに使う）
function memoryStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
  };
}

// 練習モードか、本物の Firebase か、設定が空か（空なら null）
function createBackend(storage) {
  const backendStorage = storage || memoryStorage();
  if (isDemoAllowed(location.hostname, location.search)) {
    const demo = createDemoBackend({ storage: backendStorage, now, random });
    return { demo, net: demo.net, auth: demo.auth, gas: demo.gas, makeProbeStudent: null };
  }
  if (!FIREBASE.databaseURL || !FIREBASE.apiKey) return null;
  const fetchFn = window.fetch.bind(window);
  const auth = createAuth({ apiKey: FIREBASE.apiKey, fetch: fetchFn, storage: backendStorage, now });
  const net = createNet({ databaseURL: FIREBASE.databaseURL, auth, fetch: fetchFn });
  const gas = createGas({
    url: gasEndpoint({ relayUrl: GAS.relayUrl, target: 'app', directUrl: GAS.appUrl }), auth, fetch: fetchFn, random,
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
  bannerRoot.append(el('div', { class: 'demo-banner' },
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
  if (window.__jugyologBoot) window.__jugyologBoot.started = true;
  let lastVersionCheck = now();
  let versionChecking = false;
  let versionNoticeShown = false;
  let storage = null;
  try { storage = window.localStorage; } catch { /* 端末の保存が使えないときも続ける */ }
  let backend;
  try {
    backend = createBackend(storage);
  } catch (e) {
    console.error(e);
    showMessage('このブラウザでは、授業ログを始められませんでした。');
    return;
  }
  if (!backend) { showMessage('Firebase の設定がまだ入っていません。'); return; }
  if (backend.demo) showDemoBanner(backend.demo);

  const { auth } = backend;
  let session = null; // resolveSession の結果。まだ決めていなければ null
  let sessionEpoch = 0;
  let sessionChecking = null;
  let signingOut = false;
  let lastSessionCheck = 0;
  let cacheStorage;
  // 練習用ファイルは読み直すと消えるため、取り置きもメモリだけにする
  if (!backend.demo) {
    try { cacheStorage = window.caches; } catch { /* 使えないときはメモリで続ける */ }
  }
  const store = createOfflineStore({ caches: cacheStorage });
  const memo = createSessionMemo({ storage });
  const scope = () => session?.role === 'student' ? session.uid : null;
  const offlineNet = createOfflineNet({ net: backend.net, store, scope, generation: () => sessionEpoch });
  const liveRepo = createRepo({
    get: (...args) => backend.net.get(...args),
    getPublic: (...args) => backend.net.getPublic(...args),
    set: (...args) => offlineNet.set(...args),
    update: (...args) => offlineNet.update(...args),
    remove: (...args) => offlineNet.remove(...args),
    serverTimestamp: () => backend.net.serverTimestamp(),
  });
  const repo = createRepo(offlineNet);
  const timers = { setTimeout: window.setTimeout.bind(window), clearTimeout: window.clearTimeout.bind(window) };
  const refresh = createOfflineRefresh({ repo, ...timers, delayMs: CONFIG.offline.rereadMs });
  const offline = { touch: refresh.touch, get down() { return offlineNet.stale || session?.offline === true; } };
  let offlineBanner = null;
  function showOfflineBanner() {
    if (offline.down) {
      if (!offlineBanner) {
        offlineBanner = el('div', { class: 'offline-banner', role: 'status',
          text: '電波がありません。前に読みこんだ内容を出しています。メモと振り返りは、この iPad に残り、つながったら送ります。' });
        bannerRoot.append(offlineBanner);
      }
    } else {
      offlineBanner?.remove();
      offlineBanner = null;
    }
  }
  offlineNet.onChange(showOfflineBanner);
  const cache = createFileCache({ caches: cacheStorage });
  const files = createFiles({ gas: backend.gas, cache });
  // GAS の順番待ちを共用するため、AI の作成中は同じ先生のファイル読込が 30 秒ほど待つことがある。
  const ai = { summarize: (request) => requestAiSummary({ gas: backend.gas, request }) };
  const drafts = createDrafts({ storage });
  const inkDrafts = createInkDrafts({ storage });
  const recordQueue = createRecordQueue();
  const thumbs = createThumbStore({ repo, cache });
  async function signOutAll() {
    // 片付けを待つ前に scope を外し、古い通信で取り置きが戻るのを防ぐ。
    sessionEpoch += 1;
    refresh.clear();
    signingOut = true;
    sessionChecking = null;
    renderId += 1;
    session = null;
    showOfflineBanner();
    try { await store.clear(); } catch { /* 取り置きの片付けに失敗してもログアウトする */ }
    try { memo.clear(); } catch { /* ログインの控えを消せなくてもログアウトする */ }
    try { thumbs.clear(); } catch { /* 小さい画像の片付けに失敗してもログアウトする */ }
    try { await files.clearCache(); } catch { /* 片付けに失敗してもログアウトする */ }
    try { drafts.clear(); } catch { /* 下書きの片付けに失敗してもログアウトする */ }
    try { inkDrafts.clear(); } catch { /* 下書きの片付けに失敗してもログアウトする */ }
    try { await auth.signOut(); } finally { signingOut = false; }
  }
  let cleanup = null;
  let renderId = 0;
  let appReloading = false;
  // 画面を離れてよいかをたずねる仕組み（js/leave-guard.js）。画面は ctx.setLeaveGuard(fn) で置く
  const leave = createLeaveGuard();
  let shownHash = location.hash; // 今の画面のハッシュ（「戻る」を取り消したときに戻す先）

  function showVersionBanner() {
    if (versionNoticeShown) return;
    versionNoticeShown = true;
    let reloading = false;
    const message = el('p', { role: 'status', text: '新しい版があります。「読みこみ直す」を押してください。' });
    const button = el('button', {
      type: 'button', class: 'btn', text: '読みこみ直す',
      onclick: async () => {
        if (reloading) return;
        reloading = true;
        if (!(await leave.ask())) { reloading = false; return; }
        appReloading = true;
        renderId += 1;
        try { teardown(); } catch { /* 片付けに失敗しても、ページは読みこみ直す */ }
        appRoot.replaceChildren(el('p', { class: 'loading', role: 'status', text: '読みこみ直しています…' }));
        button.disabled = true;
        message.textContent = '読みこみ直しています…';
        try { await refreshAppFiles(); } catch { /* 取り直せなくても、ページは読みこみ直す */ }
        location.reload();
      },
    });
    bannerRoot.append(el('div', { class: 'version-banner' }, message, button));
  }

  async function checkVersion() {
    if (backend.demo || VERSION === 'dev' || versionNoticeShown || versionChecking) return;
    const checkedAt = now();
    if (!shouldCheck(checkedAt, lastVersionCheck, 5 * 60 * 1000)) return;
    lastVersionCheck = checkedAt;
    versionChecking = true;
    try {
      const response = await fetch('version.txt', { cache: 'no-store' });
      if (response.ok && isNewVersion(VERSION, await response.text())) showVersionBanner();
    } catch { /* 版を確かめられなくても、画面はそのまま使える */ }
    finally { versionChecking = false; }
  }

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
    if (appReloading) return 'stayed';
    if (!confirmed && !(await leave.ask())) return 'stayed';
    if (appReloading) return 'stayed';
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

  // 画面のファイルが決まっていないとき。落ちずに文を出す
  function placeholder(role) {
    appRoot.replaceChildren(el('main', { class: 'page-pad' },
      el('h2', { text: 'この画面は、まだありません。' }),
      el('p', {}, el('a', { class: 'btn btn-primary', href: routeHash(HOME_OF[role] || 'login'), text: '最初の画面へ' }))));
  }

  // 今のログインと、決めてある session が食い違っていれば（ログイン・ログアウトのあとなど）決め直す
  async function ensureSession() {
    const uid = auth.user ? auth.user.uid : null;
    const known = session && session.role !== 'offline' ? (session.uid ?? null) : undefined;
    if (session && known === uid && (!session.offline || now() - lastSessionCheck < CONFIG.offline.recheckMs)) return session;
    return checkSession();
  }

  function checkSession() {
    if (signingOut) return Promise.resolve({ role: 'none' });
    if (sessionChecking) return sessionChecking;
    const epoch = sessionEpoch;
    // 再確認中にログアウトしても、控えをあとから復活させない。
    const currentMemo = {
      get: () => epoch === sessionEpoch ? memo.get() : null,
      put: (value) => { if (epoch === sessionEpoch) memo.put(value); },
      clear: () => { if (epoch === sessionEpoch) memo.clear(); },
    };
    sessionChecking = resolveSession({ auth, repo: liveRepo, memo: currentMemo }).then(async (value) => {
      if (epoch !== sessionEpoch) return session || { role: 'none' };
      session = value;
      if (value.role === 'none') {
        refresh.clear();
        try { await store.clear(); } catch { /* 取り置きを消せなくても、ログインの確認結果を使う */ }
        if (epoch !== sessionEpoch) return session || { role: 'none' };
      }
      lastSessionCheck = now();
      showOfflineBanner();
      return session;
    }).finally(() => { if (epoch === sessionEpoch) sessionChecking = null; });
    return sessionChecking;
  }

  async function render() {
    if (appReloading) return;
    try {
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
      showOfflineBanner();

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
      if (!viewFile(route.name)) {
        placeholder(role);
        return;
      }
      if (!view || typeof view.mount !== 'function') {
        showMessage('画面を読みこめませんでした。電波を確かめて、もう一度ためしてください。', {
          retry: () => location.reload(), retryLabel: 'もう一度',
        });
        return;
      }
      const ctx = {
        auth, repo, liveRepo, offline, files, ai, drafts, inkDrafts, recordQueue, thumbs, timers, signOutAll, session, navigate, now, random, demo: Boolean(backend.demo), params: route.params,
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
    } finally {
      checkVersion(); // 通信を待たずに、画面の描き直しを終える
    }
  }

  // ブラウザの「戻る」やハッシュの書きかえ: 今の画面の guard にたずね、だめならハッシュを元に戻す
  // （pushState では hashchange が起きないので、もう一度たずねない）。画面はそのまま
  window.addEventListener('hashchange', async () => {
    if (appReloading) return;
    const to = location.hash;
    const d = await decideHashChange({ guard: leave, shown: shownHash, to });
    if (appReloading) return;
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
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') checkVersion();
  });
  window.addEventListener('online', async () => {
    if (appReloading || signingOut) return;
    const previous = session;
    const epoch = sessionEpoch;
    const next = await checkSession();
    if (epoch !== sessionEpoch || appReloading) return;
    if (previous?.role === 'student' && next.role === 'student' && previous.uid === next.uid) return;
    render();
  });
  render();
  if (shouldRegister({ hostname: location.hostname, search: location.search, hasWorker: 'serviceWorker' in navigator })) {
    try { navigator.serviceWorker.register(workerUrl(VERSION)).catch(() => {}); } catch { /* 登録できなくても続ける */ }
  }
}

start();
