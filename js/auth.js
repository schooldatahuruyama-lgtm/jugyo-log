// Firebase Authentication（REST）でのログイン・アカウント作成・パスワード変更とトークンの管理
// fetch・storage・now は引数で受け取る（環境に依存しない）。
// 保存するのは { uid, email, refreshToken } だけ。ID トークンと期限はメモリにだけ持つ。パスワードはどこにも残さない。
import { CONFIG } from './config.js';
import { NetError } from './errors.js';

const IDT = 'https://identitytoolkit.googleapis.com/v1';
const SECURETOKEN = 'https://securetoken.googleapis.com/v1/token';
const INVALID_TOKEN = ['TOKEN_EXPIRED', 'INVALID_REFRESH_TOKEN', 'USER_DISABLED', 'USER_NOT_FOUND', 'INVALID_GRANT_TYPE', 'MISSING_REFRESH_TOKEN'];

// Firebase のエラー文の先頭の名前（英大文字と _ の並び）を取り出す。
// 'TOO_MANY_ATTEMPTS_TRY_LATER : 説明' のように説明が続く形があるため、先頭一致で見分ける
function errorName(message) {
  const m = String(message || '').match(/^[A-Z_]+/);
  return m ? m[0] : '';
}

// Firebase のエラー文を NetError の code に直す
function codeFor(status, message) {
  const name = errorName(message);
  if (['INVALID_LOGIN_CREDENTIALS', 'EMAIL_NOT_FOUND', 'INVALID_PASSWORD'].includes(name)) return 'bad-credentials';
  if (name === 'EMAIL_EXISTS') return 'email-exists';
  if (name === 'TOO_MANY_ATTEMPTS_TRY_LATER') return 'rate';
  if (name === 'WEAK_PASSWORD') return 'weak-password';
  if (name === 'CREDENTIAL_TOO_OLD_LOGIN_AGAIN') return 'reauth';
  if (INVALID_TOKEN.includes(name) || name === 'INVALID_ID_TOKEN') return 'auth';
  if (status === 401) return 'auth';
  if (status === 403) return 'denied';
  return 'unknown';
}

export function createAuth({
  apiKey,
  fetch,
  storage,
  now,
  storageKey = 'jugyolog:auth',
  timeoutMs = CONFIG.requestTimeoutMs,
  setTimeout: setTimer = globalThis.setTimeout,
  clearTimeout: clearTimer = globalThis.clearTimeout,
}) {
  let user = null; // { uid, email? }
  let refreshToken = null;
  let idToken = null;
  let expiresAt = 0;
  let refreshing = null; // 更新中の Promise（同時に呼ばれても 1 回にまとめる）
  let gen = 0; // 認証状態の世代。ログアウトや別のログインで進み、古い応答を捨てるのに使う
  // 更新とパスワードの変更の順番待ち（Promise の鎖）。必ず 1 つずつ行う。世代が進むと新しい鎖にする
  let queue = Promise.resolve();
  // いちばん新しいパスワードの変更 { gen, done, settled }（getToken などが終わるのを待つため）
  let lastChange = null;

  // 1 回の要求（送信〜本文を読み終わるまで）。timeoutMs をすぎたら fetch を止めて network にする
  async function post(url, init) {
    const controller = new AbortController();
    async function work() {
      let res;
      try {
        res = await fetch(url, { ...init, signal: controller.signal });
      } catch (e) {
        throw new NetError('network', 'ネットワークにつながりません');
      }
      let body = null;
      let readFailed = false;
      try { body = await res.json(); } catch { readFailed = true; }
      if (!res.ok) {
        const message = !readFailed && body && body.error && body.error.message;
        const err = new NetError(codeFor(res.status, message), message || `HTTP ${res.status}`);
        err.status = res.status;
        err.firebaseMessage = errorName(message);
        throw err;
      }
      // 成功なのに本文を読めない（途中で切れた）ときは通信失敗として扱う
      if (readFailed) throw new NetError('network', '応答を読み取れませんでした');
      return body;
    }
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimer(() => {
        controller.abort();
        reject(new NetError('network', '時間内に返事がありませんでした'));
      }, timeoutMs);
    });
    try {
      return await Promise.race([work(), timeout]);
    } finally {
      clearTimer(timer);
    }
  }

  // task を順番待ちの最後に並べる。前の人が失敗・時間切れでも、次の人は進める
  function exclusive(task) {
    const p = queue.then(task);
    queue = p.then(() => {}, () => {});
    return p;
  }

  // 今の世代のパスワードの変更が終わる（成功でも失敗でも）まで待つ
  function changePending() {
    return !!lastChange && lastChange.gen === gen && !lastChange.done;
  }
  async function waitChanges() {
    while (changePending()) await lastChange.settled;
  }

  function postJson(path, payload) {
    return post(`${IDT}/${path}?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  }

  // 応答の必須項目を検べる。足りなければ unknown（状態は変えない）
  function parseBody(body) {
    const b = body && typeof body === 'object' ? body : {};
    const uid = b.localId ?? b.user_id;
    const tok = b.idToken ?? b.id_token;
    const rt = b.refreshToken ?? b.refresh_token;
    const seconds = Number(b.expiresIn ?? b.expires_in);
    if (typeof uid !== 'string' || !uid || typeof tok !== 'string' || !tok
      || typeof rt !== 'string' || !rt || !Number.isFinite(seconds) || seconds <= 0) {
      throw new NetError('unknown', '応答の形が正しくありません');
    }
    return { uid, idToken: tok, refreshToken: rt, seconds };
  }

  // 開始時の世代と今が違えば、その処理の結果は捨てる
  function assertCurrent(g) {
    if (g !== gen) throw new NetError('auth', 'ログイン状態が変わったため、古い応答を捨てました');
  }

  function persist() {
    const saved = { uid: user.uid, refreshToken };
    if (user.email) saved.email = user.email;
    storage.setItem(storageKey, JSON.stringify(saved));
  }

  // 世代を進める。進行中の更新は古いものとして切り離し、次の更新は新しい順番待ちで始める
  // （古い世代の処理は、順番が来たときや応答が届いたときに世代の確認で捨てられる）
  function bumpGen() {
    gen += 1;
    refreshing = null;
    queue = Promise.resolve();
  }

  function clearState() {
    bumpGen();
    user = null;
    refreshToken = null;
    idToken = null;
    expiresAt = 0;
    storage.removeItem(storageKey);
  }

  // ログイン・更新の応答を取り込む（camelCase と snake_case の両方に対応）
  function adopt(body, email) {
    const f = parseBody(body);
    const uid = f.uid;
    idToken = f.idToken;
    refreshToken = f.refreshToken;
    expiresAt = now() + f.seconds * 1000;
    const mail = email ?? (user && user.uid === uid ? user.email : undefined);
    user = mail ? { uid, email: mail } : { uid };
    persist();
  }

  function readSaved() {
    try {
      const raw = storage.getItem(storageKey);
      if (!raw) return null;
      const s = JSON.parse(raw);
      return s && s.uid && s.refreshToken ? s : null;
    } catch {
      return null;
    }
  }

  // 更新用トークンで ID トークンを取り直す。
  // 保存を消すのは「トークンの無効が確定したとき」（securetoken が 400 で無効の理由を返したとき）だけ。
  async function doRefresh() {
    if (!refreshToken) throw new NetError('auth', 'ログインしていません');
    const g = gen;
    const rt = refreshToken;
    let body;
    try {
      body = await post(`${SECURETOKEN}?key=${encodeURIComponent(apiKey)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(rt)}`,
      });
    } catch (e) {
      if (e instanceof NetError && e.status === 400 && INVALID_TOKEN.includes(e.firebaseMessage) && g === gen) {
        clearState();
        e.invalid = true;
      }
      throw e;
    }
    assertCurrent(g);
    parseBody(body);
    adopt(body);
    return idToken;
  }

  // 更新を順番待ちに並べる（同時に呼ばれても 1 回にまとめる）。順番が来たとき世代が古ければ auth
  function refresh() {
    if (!refreshing) {
      const g = gen;
      const p = exclusive(() => {
        assertCurrent(g);
        return doRefresh();
      }).finally(() => { if (refreshing === p) refreshing = null; });
      refreshing = p;
    }
    return refreshing;
  }

  const needsRefresh = () => !idToken || expiresAt - now() < CONFIG.tokenRefreshMarginMs;

  // パスワードの変更中なら、変更が終わってから（新しいトークンで）返す
  async function getToken() {
    if (changePending()) await waitChanges();
    if (!user) throw new NetError('auth', 'ログインしていません');
    if (needsRefresh()) return refresh();
    return idToken;
  }

  // 保存したトークンで戻る。無い・無効が確定したなら null（通信失敗・古い応答は例外のまま）
  async function restore() {
    if (changePending()) await waitChanges();
    const saved = readSaved();
    if (!saved) return null;
    user = saved.email ? { uid: saved.uid, email: saved.email } : { uid: saved.uid };
    refreshToken = saved.refreshToken;
    try {
      await refresh();
    } catch (e) {
      if (e && e.invalid) return null; // 無効が確定したときだけ null（保存は消えている）
      throw e; // 一時的な失敗・古い応答は保存を残して伝える
    }
    return { ...user };
  }

  return {
    // メールアドレスとパスワードでログインする（先生も生徒も）
    async signIn(email, password) {
      const g = gen;
      const body = await postJson('accounts:signInWithPassword', { email, password, returnSecureToken: true });
      assertCurrent(g);
      parseBody(body);
      bumpGen();
      adopt(body, body.email ?? email);
      return { ...user };
    },

    // 新しいアカウントを作る（先生が生徒のアカウントを発行する）。
    // 応答のトークンは使わずに捨てる。今のログイン（user・保存・トークン）は変えない
    async createAccount(email, password) {
      const body = await postJson('accounts:signUp', { email, password, returnSecureToken: true });
      const uid = body && typeof body === 'object' ? body.localId : undefined;
      if (typeof uid !== 'string' || !uid) throw new NetError('unknown', '応答の形が正しくありません');
      return { uid };
    },

    // 今ログインしているアカウントのパスワードを変える。
    // Firebase は古い更新用トークンを無効にするので、返ってきた新しいトークンに入れかえる。
    // 更新と重なると、進行中の更新が「無効」で失敗してログアウトしてしまうため、
    // 更新と同じ順番待ちに並べて 1 つずつ行う。呼んだ時点の世代と uid を持っておき、
    // 順番が来たとき・送る前に同じかを確かめる（違えば auth で、変更の通信は送らない）
    changePassword(newPassword) {
      if (!user) return Promise.reject(new NetError('auth', 'ログインしていません'));
      const g = gen;
      const uid = user.uid;
      const sameAccount = () => g === gen && !!user && user.uid === uid;
      const p = exclusive(async () => {
        if (!sameAccount()) throw new NetError('auth', 'ログイン状態が変わったため、パスワードを変えませんでした');
        if (needsRefresh()) await doRefresh(); // 順番を持ったまま更新する（refresh() だと自分の後ろに並んでしまう）
        if (!sameAccount()) throw new NetError('auth', 'ログイン状態が変わったため、パスワードを変えませんでした');
        const body = await postJson('accounts:update', { idToken, password: newPassword, returnSecureToken: true });
        assertCurrent(g);
        parseBody(body);
        adopt(body);
      });
      const entry = { gen: g, done: false, settled: null };
      entry.settled = p.then(() => { entry.done = true; }, () => { entry.done = true; });
      lastChange = entry;
      refreshing = null; // 変更より前に並んだ更新を、これからの呼び出しで使い回さない
      return p;
    },

    restore,

    getToken,

    // 変更中なら、順番待ちで変更のあとに（新しい更新用トークンで）行われる
    forceRefresh() {
      return refresh();
    },

    signOut() {
      clearState();
    },

    get user() {
      return user ? { ...user } : null;
    },
  };
}
