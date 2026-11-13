// Firebase Authentication（REST）でのログイン・アカウント作成・パスワード変更・トークンの管理を、代役で確かめる
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAuth } from '../js/auth.js';
import { NetError } from '../js/errors.js';

const MIN = 60 * 1000;
const KEY = 'jugyolog:auth';
const isSignIn = (u) => u.includes('accounts:signInWithPassword');
const isSignUp = (u) => u.includes('accounts:signUp');
const isUpdate = (u) => u.includes('accounts:update');
const isToken = (u) => u.includes('securetoken.googleapis.com/v1/token');
const tick = () => new Promise((r) => setImmediate(r));

// ---- 代役（保存先・fetch・時計） ----

// localStorage と同じ形の保存先
function fakeStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
  };
}

// handler(url, init) が { status, body } を返す（Error を返すと通信失敗になる）。呼び出しは .calls に残る
function fakeFetch(handler) {
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    const r = await handler(String(url), init);
    if (r instanceof Error) throw r;
    const status = r.status ?? 200;
    return { ok: status >= 200 && status < 300, status, json: async () => r.body };
  };
  fn.calls = calls;
  return fn;
}

// 手で進められる時計
function fakeClock(start = 0) {
  let t = start;
  return { now: () => t, advance: (ms) => { t += ms; } };
}

// 応答を手で返せる fetch。open は返事を待っている通信の数、maxOpen はその最大
function deferredFetch() {
  const pending = [];
  const calls = [];
  const fn = (url, init = {}) => {
    calls.push({ url: String(url), init });
    fn.open += 1;
    fn.maxOpen = Math.max(fn.maxOpen, fn.open);
    return new Promise((resolve, reject) => pending.push({ url: String(url), resolve, reject }));
  };
  fn.calls = calls;
  fn.pending = pending;
  fn.open = 0;
  fn.maxOpen = 0;
  fn.respond = (i, status, body) => {
    fn.open -= 1;
    pending[i].resolve({ ok: status < 300, status, json: async () => body });
  };
  return fn;
}

function teacherHandler(url) {
  if (isSignIn(url)) {
    return { status: 200, body: { localId: 'T1', email: 't@example.com', idToken: 'tok1', refreshToken: 'r1', expiresIn: '3600' } };
  }
  if (isToken(url)) {
    return { status: 200, body: { user_id: 'T1', id_token: 'tok2', refresh_token: 'r2', expires_in: '3600' } };
  }
  if (isSignUp(url)) {
    return { status: 200, body: { localId: 'NEW1', email: 'a@jugyolog.invalid', idToken: 'tokNew', refreshToken: 'rNew', expiresIn: '3600' } };
  }
  if (isUpdate(url)) {
    return { status: 200, body: { localId: 'T1', email: 't@example.com', idToken: 'tok3', refreshToken: 'r3', expiresIn: '3600' } };
  }
  return { status: 404, body: {} };
}

function make(handler, storage = fakeStorage(), clock = fakeClock(1000), storageKey) {
  const fetch = fakeFetch(handler);
  const auth = createAuth({ apiKey: 'FAKE_KEY', fetch, storage, now: clock.now, ...(storageKey ? { storageKey } : {}) });
  return { auth, fetch, storage, clock };
}

// 特定の URL だけ失敗の応答を返し、ほかは teacherHandler にまかせる
const failing = (match, message, status = 400) => (url) => (match(url)
  ? { status, body: { error: { message } } }
  : teacherHandler(url));

// ---- ログイン ----

test('ログイン: 正しい本文を送り、uid とメールを返す。パスワードは保存しない', async () => {
  const { auth, fetch, storage } = make(teacherHandler);
  const user = await auth.signIn('t@example.com', 'fake-pass-xyz');
  assert.deepEqual(user, { uid: 'T1', email: 't@example.com' });
  assert.deepEqual(auth.user, { uid: 'T1', email: 't@example.com' });
  const call = fetch.calls[0];
  assert.ok(call.url.startsWith('https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=FAKE_KEY'));
  assert.deepEqual(JSON.parse(call.init.body), { email: 't@example.com', password: 'fake-pass-xyz', returnSecureToken: true });
  const saved = storage.getItem(KEY);
  assert.ok(!saved.includes('fake-pass-xyz'));
  assert.ok(!saved.includes('tok1'));
  assert.deepEqual(JSON.parse(saved), { uid: 'T1', email: 't@example.com', refreshToken: 'r1' });
  assert.equal(await auth.getToken(), 'tok1');
});

test('保存のキーは引数 storageKey で変えられる', async () => {
  const { auth, storage } = make(teacherHandler, fakeStorage(), fakeClock(1000), 'other:key');
  await auth.signIn('t@example.com', 'x');
  assert.equal(storage.getItem(KEY), null);
  assert.equal(JSON.parse(storage.getItem('other:key')).uid, 'T1');
});

for (const msg of ['INVALID_LOGIN_CREDENTIALS', 'EMAIL_NOT_FOUND', 'INVALID_PASSWORD']) {
  test(`まちがったパスワード: ${msg} は bad-credentials`, async () => {
    const { auth } = make(() => ({ status: 400, body: { error: { message: msg } } }));
    await assert.rejects(
      () => auth.signIn('t@example.com', 'wrong'),
      (e) => e instanceof NetError && e.code === 'bad-credentials',
    );
  });
}

test('ログインの失敗: TOO_MANY_ATTEMPTS_TRY_LATER（説明つき）は rate', async () => {
  const { auth } = make(() => ({ status: 400, body: { error: { message: 'TOO_MANY_ATTEMPTS_TRY_LATER : Access to this account has been temporarily disabled.' } } }));
  await assert.rejects(() => auth.signIn('t@example.com', 'x'), (e) => e instanceof NetError && e.code === 'rate');
});

test('つながらない: fetch が失敗すると network', async () => {
  const { auth } = make(() => new Error('offline'));
  await assert.rejects(
    () => auth.signIn('t@example.com', 'x'),
    (e) => e instanceof NetError && e.code === 'network',
  );
});

test('匿名ログインは作らない', () => {
  const { auth } = make(teacherHandler);
  assert.equal(auth.signInAnonymous, undefined);
  assert.equal(auth.signInTeacher, undefined);
});

// ---- トークン ----

test('期限が近づくと更新する: 56 分後は更新、54 分後は更新しない', async () => {
  const a = make(teacherHandler);
  await a.auth.signIn('t@example.com', 'x');
  a.clock.advance(56 * MIN);
  assert.equal(await a.auth.getToken(), 'tok2');
  assert.equal(a.fetch.calls.filter((c) => isToken(c.url)).length, 1);

  const b = make(teacherHandler);
  await b.auth.signIn('t@example.com', 'x');
  b.clock.advance(54 * MIN);
  assert.equal(await b.auth.getToken(), 'tok1');
  assert.equal(b.fetch.calls.filter((c) => isToken(c.url)).length, 0);
});

test('getToken を同時に 3 回呼んでも更新は 1 回', async () => {
  const a = make(teacherHandler);
  await a.auth.signIn('t@example.com', 'x');
  a.clock.advance(56 * MIN);
  const tokens = await Promise.all([a.auth.getToken(), a.auth.getToken(), a.auth.getToken()]);
  assert.deepEqual(tokens, ['tok2', 'tok2', 'tok2']);
  assert.equal(a.fetch.calls.filter((c) => isToken(c.url)).length, 1);
});

test('forceRefresh: 期限に関係なく更新する。本文は form-urlencoded', async () => {
  const a = make(teacherHandler);
  await a.auth.signIn('t@example.com', 'x');
  assert.equal(await a.auth.forceRefresh(), 'tok2');
  const call = a.fetch.calls.find((c) => isToken(c.url));
  assert.equal(call.init.headers['Content-Type'], 'application/x-www-form-urlencoded');
  assert.equal(call.init.body, 'grant_type=refresh_token&refresh_token=r1');
});

// ---- restore・signOut ----

test('restore: 保存したトークンで戻る。何も無ければ null', async () => {
  const storage = fakeStorage();
  const t = make(teacherHandler, storage);
  await t.auth.signIn('t@example.com', 'x');
  const t2 = make(teacherHandler, storage);
  assert.deepEqual(await t2.auth.restore(), { uid: 'T1', email: 't@example.com' });
  assert.equal(await t2.auth.getToken(), 'tok2');
  assert.equal(JSON.parse(storage.getItem(KEY)).refreshToken, 'r2');
  const empty = make(teacherHandler);
  assert.equal(await empty.auth.restore(), null);
});

test('restore: 保存したトークンが無効なら null を返し、保存を消す', async () => {
  const storage = fakeStorage();
  storage.setItem(KEY, JSON.stringify({ uid: 'T1', email: 't@example.com', refreshToken: 'old' }));
  const { auth } = make(failing(isToken, 'TOKEN_EXPIRED'), storage);
  assert.equal(await auth.restore(), null);
  assert.equal(storage.getItem(KEY), null);
  assert.equal(auth.user, null);
});

const SAVED = JSON.stringify({ uid: 'T1', email: 't@example.com', refreshToken: 'old' });

for (const status of [503, 429]) {
  test(`restore: 一時的な HTTP エラー ${status} では保存を残し、拒否する`, async () => {
    const storage = fakeStorage();
    storage.setItem(KEY, SAVED);
    const { auth } = make(failing(isToken, 'BUSY', status), storage);
    await assert.rejects(() => auth.restore(), (e) => e instanceof NetError && e.code === 'unknown');
    assert.equal(storage.getItem(KEY), SAVED);
  });
}

test('restore: 本文を読めない応答なら network で拒否し、保存を残す', async () => {
  const storage = fakeStorage();
  storage.setItem(KEY, SAVED);
  const broken = async () => ({ ok: true, status: 200, json: async () => { throw new Error('切断'); } });
  const auth = createAuth({ apiKey: 'FAKE_KEY', fetch: broken, storage, now: fakeClock(1000).now });
  await assert.rejects(() => auth.restore(), (e) => e instanceof NetError && e.code === 'network');
  assert.equal(storage.getItem(KEY), SAVED);
});

test('restore: 必須項目が足りない 200 応答なら unknown で拒否し、保存を残す', async () => {
  const storage = fakeStorage();
  storage.setItem(KEY, SAVED);
  const { auth } = make((url) => (isToken(url) ? { status: 200, body: { user_id: 'T1', id_token: 'tok2' } } : { status: 404, body: {} }), storage);
  await assert.rejects(() => auth.restore(), (e) => e instanceof NetError && e.code === 'unknown');
  assert.equal(storage.getItem(KEY), SAVED);
});

test('ログアウトで保存が消える', async () => {
  const { auth, storage } = make(teacherHandler);
  await auth.signIn('t@example.com', 'x');
  auth.signOut();
  assert.equal(storage.getItem(KEY), null);
  assert.equal(auth.user, null);
  await assert.rejects(() => auth.getToken(), (e) => e instanceof NetError && e.code === 'auth');
});

// ---- 世代（古い応答を捨てる） ----

test('更新中にログアウトすると、後から届いた応答で復活しない', async () => {
  const storage = fakeStorage();
  const fetch = deferredFetch();
  const auth = createAuth({ apiKey: 'FAKE_KEY', fetch, storage, now: fakeClock(1000).now });
  const p = auth.signIn('t@example.com', 'x');
  fetch.respond(0, 200, { localId: 'T1', email: 't@example.com', idToken: 'tok1', refreshToken: 'r1', expiresIn: '3600' });
  await p;
  const r = auth.forceRefresh();
  const rejected = assert.rejects(r, (e) => e instanceof NetError);
  await tick();
  auth.signOut();
  fetch.respond(1, 200, { user_id: 'T1', id_token: 'tok2', refresh_token: 'r2', expires_in: '3600' });
  await rejected;
  assert.equal(auth.user, null);
  assert.equal(storage.getItem(KEY), null);
});

test('更新中に別のアカウントでログインしても、古い応答で上書きされない', async () => {
  const storage = fakeStorage();
  const fetch = deferredFetch();
  const auth = createAuth({ apiKey: 'FAKE_KEY', fetch, storage, now: fakeClock(1000).now });
  const a = auth.signIn('a@example.com', 'x');
  fetch.respond(0, 200, { localId: 'A', email: 'a@example.com', idToken: 'tokA', refreshToken: 'rA', expiresIn: '3600' });
  await a;
  const r = auth.forceRefresh();
  const rejected = assert.rejects(r, (e) => e instanceof NetError);
  await tick();
  const b = auth.signIn('b@example.com', 'x');
  fetch.respond(2, 200, { localId: 'B', email: 'b@example.com', idToken: 'tokB', refreshToken: 'rB', expiresIn: '3600' });
  await b;
  fetch.respond(1, 200, { user_id: 'A', id_token: 'tokA2', refresh_token: 'rA2', expires_in: '3600' });
  await rejected;
  assert.deepEqual(auth.user, { uid: 'B', email: 'b@example.com' });
  assert.deepEqual(JSON.parse(storage.getItem(KEY)), { uid: 'B', email: 'b@example.com', refreshToken: 'rB' });
  assert.equal(await auth.getToken(), 'tokB');
});

test('ログインの直後に signOut すると、後から届くログインの応答で復活しない', async () => {
  const storage = fakeStorage();
  const fetch = deferredFetch();
  const auth = createAuth({ apiKey: 'FAKE_KEY', fetch, storage, now: fakeClock(1000).now });
  const p = auth.signIn('t@example.com', 'x');
  const rejected = assert.rejects(p, (e) => e instanceof NetError && e.code === 'auth');
  auth.signOut();
  await tick();
  fetch.respond(0, 200, { localId: 'T1', email: 't@example.com', idToken: 'tok1', refreshToken: 'r1', expiresIn: '3600' });
  await rejected;
  assert.equal(auth.user, null);
  assert.equal(storage.getItem(KEY), null);
});

test('A の更新が保留中でも、B でログインすれば forceRefresh は B の新しい更新を送る', async () => {
  const storage = fakeStorage();
  const fetch = deferredFetch();
  const auth = createAuth({ apiKey: 'FAKE_KEY', fetch, storage, now: fakeClock(1000).now });
  const a = auth.signIn('a@example.com', 'x');
  fetch.respond(0, 200, { localId: 'A', email: 'a@example.com', idToken: 'tokA', refreshToken: 'rA', expiresIn: '3600' });
  await a;
  const aRefresh = auth.forceRefresh(); // pending[1]
  const aRejected = assert.rejects(aRefresh, (e) => e instanceof NetError);
  await tick();
  const b = auth.signIn('b@example.com', 'x'); // pending[2]
  fetch.respond(2, 200, { localId: 'B', email: 'b@example.com', idToken: 'tokB', refreshToken: 'rB', expiresIn: '3600' });
  await b;
  const bRefresh = auth.forceRefresh(); // pending[3]（A の保留を使い回さない）
  await tick();
  assert.equal(fetch.pending.length, 4);
  assert.equal(fetch.calls[3].init.body, 'grant_type=refresh_token&refresh_token=rB');
  fetch.respond(3, 200, { user_id: 'B', id_token: 'tokB2', refresh_token: 'rB2', expires_in: '3600' });
  assert.equal(await bRefresh, 'tokB2');
  // 古い A の応答が後から届いても何も変わらない
  fetch.respond(1, 200, { user_id: 'A', id_token: 'tokA2', refresh_token: 'rA2', expires_in: '3600' });
  await aRejected;
  assert.deepEqual(auth.user, { uid: 'B', email: 'b@example.com' });
  assert.deepEqual(JSON.parse(storage.getItem(KEY)), { uid: 'B', email: 'b@example.com', refreshToken: 'rB2' });
});

// ---- アカウントを作る（先生が生徒のアカウントを発行する） ----

test('createAccount: accounts:signUp に { email, password, returnSecureToken: true } を送り、{ uid } を返す。今のログインは変わらない', async () => {
  const { auth, fetch, storage } = make(teacherHandler);
  await auth.signIn('t@example.com', 'x');
  const savedBefore = storage.getItem(KEY);
  const r = await auth.createAccount('a@jugyolog.invalid', 'pw');
  assert.deepEqual(r, { uid: 'NEW1' });
  const call = fetch.calls.find((c) => isSignUp(c.url));
  assert.ok(call.url.startsWith('https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=FAKE_KEY'));
  assert.deepEqual(JSON.parse(call.init.body), { email: 'a@jugyolog.invalid', password: 'pw', returnSecureToken: true });
  assert.deepEqual(auth.user, { uid: 'T1', email: 't@example.com' });
  assert.equal(storage.getItem(KEY), savedBefore);
  assert.equal(await auth.getToken(), 'tok1');
});

test('createAccount: ログインしていなくても作れ、ログイン状態にはならない', async () => {
  const { auth, storage } = make(teacherHandler);
  assert.deepEqual(await auth.createAccount('a@jugyolog.invalid', 'pw'), { uid: 'NEW1' });
  assert.equal(auth.user, null);
  assert.equal(storage.getItem(KEY), null);
});

const CREATE_ERRORS = [
  ['EMAIL_EXISTS', 'email-exists'],
  ['TOO_MANY_ATTEMPTS_TRY_LATER', 'rate'],
  ['TOO_MANY_ATTEMPTS_TRY_LATER : We have blocked all requests from this device due to unusual activity. Try again later.', 'rate'],
  ['WEAK_PASSWORD : Password should be at least 6 characters', 'weak-password'],
];
for (const [msg, code] of CREATE_ERRORS) {
  test(`createAccount の失敗: ${msg.slice(0, 30)} は ${code}。今のログインは変わらない`, async () => {
    const { auth, storage } = make(failing(isSignUp, msg));
    await auth.signIn('t@example.com', 'x');
    const savedBefore = storage.getItem(KEY);
    await assert.rejects(() => auth.createAccount('a@jugyolog.invalid', 'pw'), (e) => e instanceof NetError && e.code === code);
    assert.deepEqual(auth.user, { uid: 'T1', email: 't@example.com' });
    assert.equal(storage.getItem(KEY), savedBefore);
  });
}

test('createAccount: 応答に uid が無ければ unknown', async () => {
  const { auth } = make((url) => (isSignUp(url) ? { status: 200, body: {} } : teacherHandler(url)));
  await assert.rejects(() => auth.createAccount('a@jugyolog.invalid', 'pw'), (e) => e instanceof NetError && e.code === 'unknown');
});

// ---- パスワードを変える ----

test('changePassword: accounts:update に今のトークンと新しいパスワードを送り、新しいトークンに入れかえる', async () => {
  const { auth, fetch, storage } = make(teacherHandler);
  await auth.signIn('t@example.com', 'x');
  const r = await auth.changePassword('newpass12');
  assert.equal(r, undefined);
  const call = fetch.calls.find((c) => isUpdate(c.url));
  assert.ok(call.url.startsWith('https://identitytoolkit.googleapis.com/v1/accounts:update?key=FAKE_KEY'));
  assert.deepEqual(JSON.parse(call.init.body), { idToken: 'tok1', password: 'newpass12', returnSecureToken: true });
  assert.equal(await auth.getToken(), 'tok3');
  assert.deepEqual(auth.user, { uid: 'T1', email: 't@example.com' });
  assert.deepEqual(JSON.parse(storage.getItem(KEY)), { uid: 'T1', email: 't@example.com', refreshToken: 'r3' });
});

test('changePassword: CREDENTIAL_TOO_OLD_LOGIN_AGAIN は reauth。今のログインは変わらない', async () => {
  const { auth, storage } = make(failing(isUpdate, 'CREDENTIAL_TOO_OLD_LOGIN_AGAIN'));
  await auth.signIn('t@example.com', 'x');
  const savedBefore = storage.getItem(KEY);
  await assert.rejects(() => auth.changePassword('newpass12'), (e) => e instanceof NetError && e.code === 'reauth');
  assert.equal(storage.getItem(KEY), savedBefore);
  assert.equal(await auth.getToken(), 'tok1');
});

test('changePassword: WEAK_PASSWORD は weak-password', async () => {
  const { auth } = make(failing(isUpdate, 'WEAK_PASSWORD : Password should be at least 6 characters'));
  await auth.signIn('t@example.com', 'x');
  await assert.rejects(() => auth.changePassword('abc'), (e) => e instanceof NetError && e.code === 'weak-password');
});

test('changePassword: ログインしていなければ auth で、通信しない', async () => {
  const { auth, fetch } = make(teacherHandler);
  await assert.rejects(() => auth.changePassword('newpass12'), (e) => e instanceof NetError && e.code === 'auth');
  assert.equal(fetch.calls.length, 0);
});

test('changePassword の途中で signOut すると、後から届いた応答で復活しない', async () => {
  const storage = fakeStorage();
  const fetch = deferredFetch();
  const auth = createAuth({ apiKey: 'FAKE_KEY', fetch, storage, now: fakeClock(1000).now });
  const p = auth.signIn('t@example.com', 'x');
  fetch.respond(0, 200, { localId: 'T1', email: 't@example.com', idToken: 'tok1', refreshToken: 'r1', expiresIn: '3600' });
  await p;
  const c = auth.changePassword('newpass12');
  const rejected = assert.rejects(c, (e) => e instanceof NetError && e.code === 'auth');
  await tick();
  auth.signOut();
  fetch.respond(1, 200, { localId: 'T1', email: 't@example.com', idToken: 'tok3', refreshToken: 'r3', expiresIn: '3600' });
  await rejected;
  assert.equal(auth.user, null);
  assert.equal(storage.getItem(KEY), null);
});

// ---- パスワードの変更とトークンの更新を重ねない（直列にする） ----

test('更新が進行中に changePassword を呼ぶと、更新が終わってから、その新しいトークンで変更を送る', async () => {
  const storage = fakeStorage();
  const fetch = deferredFetch();
  const auth = createAuth({ apiKey: 'FAKE_KEY', fetch, storage, now: fakeClock(1000).now });
  const s = auth.signIn('t@example.com', 'x');
  fetch.respond(0, 200, { localId: 'T1', email: 't@example.com', idToken: 'tok1', refreshToken: 'r1', expiresIn: '3600' });
  await s;
  const r = auth.forceRefresh(); // pending[1]
  const c = auth.changePassword('newpass12');
  await tick();
  assert.equal(fetch.calls.length, 2); // 更新が終わるまで変更は送らない
  fetch.respond(1, 200, { user_id: 'T1', id_token: 'tok2', refresh_token: 'r2', expires_in: '3600' });
  assert.equal(await r, 'tok2');
  await tick();
  assert.equal(fetch.calls.length, 3);
  assert.ok(isUpdate(fetch.calls[2].url));
  assert.equal(JSON.parse(fetch.calls[2].init.body).idToken, 'tok2');
  fetch.respond(2, 200, { localId: 'T1', email: 't@example.com', idToken: 'tok3', refreshToken: 'r3', expiresIn: '3600' });
  await c;
  assert.equal(await auth.getToken(), 'tok3');
  assert.deepEqual(JSON.parse(storage.getItem(KEY)), { uid: 'T1', email: 't@example.com', refreshToken: 'r3' });
});

test('changePassword の進行中に forceRefresh を呼ぶと、変更が終わってから新しい更新用トークンで更新する', async () => {
  const storage = fakeStorage();
  const fetch = deferredFetch();
  const auth = createAuth({ apiKey: 'FAKE_KEY', fetch, storage, now: fakeClock(1000).now });
  const s = auth.signIn('t@example.com', 'x');
  fetch.respond(0, 200, { localId: 'T1', email: 't@example.com', idToken: 'tok1', refreshToken: 'r1', expiresIn: '3600' });
  await s;
  const c = auth.changePassword('newpass12'); // pending[1]
  await tick();
  assert.ok(isUpdate(fetch.calls[1].url));
  const r = auth.forceRefresh();
  const t = auth.getToken();
  await tick();
  assert.equal(fetch.calls.length, 2); // 変更が終わるまで更新は送らない（古い r1 を使わない）
  fetch.respond(1, 200, { localId: 'T1', email: 't@example.com', idToken: 'tok3', refreshToken: 'r3', expiresIn: '3600' });
  await c;
  assert.equal(await t, 'tok3'); // getToken は変更で得た新しいトークンを返す
  await tick();
  assert.equal(fetch.calls.length, 3);
  assert.ok(isToken(fetch.calls[2].url));
  assert.equal(fetch.calls[2].init.body, 'grant_type=refresh_token&refresh_token=r3');
  fetch.respond(2, 200, { user_id: 'T1', id_token: 'tok4', refresh_token: 'r4', expires_in: '3600' });
  assert.equal(await r, 'tok4');
  assert.deepEqual(auth.user, { uid: 'T1', email: 't@example.com' });
  assert.equal(JSON.parse(storage.getItem(KEY)).refreshToken, 'r4');
});

test('changePassword が失敗しても、待っていた forceRefresh は今のトークンで続けられる', async () => {
  const storage = fakeStorage();
  const fetch = deferredFetch();
  const auth = createAuth({ apiKey: 'FAKE_KEY', fetch, storage, now: fakeClock(1000).now });
  const s = auth.signIn('t@example.com', 'x');
  fetch.respond(0, 200, { localId: 'T1', email: 't@example.com', idToken: 'tok1', refreshToken: 'r1', expiresIn: '3600' });
  await s;
  const c = auth.changePassword('newpass12');
  const rejected = assert.rejects(c, (e) => e instanceof NetError && e.code === 'reauth');
  await tick();
  const r = auth.forceRefresh();
  fetch.respond(1, 400, { error: { message: 'CREDENTIAL_TOO_OLD_LOGIN_AGAIN' } });
  await rejected;
  await tick();
  assert.equal(fetch.calls[2].init.body, 'grant_type=refresh_token&refresh_token=r1');
  fetch.respond(2, 200, { user_id: 'T1', id_token: 'tok2', refresh_token: 'r2', expires_in: '3600' });
  assert.equal(await r, 'tok2');
});

test('更新を待っている間に別のアカウントへ signIn すると、changePassword は auth で、変更の通信を送らない', async () => {
  const storage = fakeStorage();
  const fetch = deferredFetch();
  const auth = createAuth({ apiKey: 'FAKE_KEY', fetch, storage, now: fakeClock(1000).now });
  const a = auth.signIn('a@example.com', 'x');
  fetch.respond(0, 200, { localId: 'A', email: 'a@example.com', idToken: 'tokA', refreshToken: 'rA', expiresIn: '3600' });
  await a;
  const r = auth.forceRefresh(); // pending[1]（A の更新）
  const rRejected = assert.rejects(r, (e) => e instanceof NetError);
  const c = auth.changePassword('newpass12'); // A のパスワードを変えるつもり
  const cRejected = assert.rejects(c, (e) => e instanceof NetError && e.code === 'auth');
  await tick();
  const b = auth.signIn('b@example.com', 'y'); // pending[2]
  fetch.respond(2, 200, { localId: 'B', email: 'b@example.com', idToken: 'tokB', refreshToken: 'rB', expiresIn: '3600' });
  await b;
  // A の更新は失敗（パスワードの変更などで無効になった形）
  fetch.respond(1, 400, { error: { message: 'TOKEN_EXPIRED' } });
  await rRejected;
  await cRejected;
  await tick();
  assert.equal(fetch.calls.filter((x) => isUpdate(x.url)).length, 0);
  assert.deepEqual(auth.user, { uid: 'B', email: 'b@example.com' });
  assert.deepEqual(JSON.parse(storage.getItem(KEY)), { uid: 'B', email: 'b@example.com', refreshToken: 'rB' });
  assert.equal(await auth.getToken(), 'tokB');
});

test('変更 1 → その間に forceRefresh → 変更 1 の直後に変更 2: 通信は 1 本ずつで、どの成功応答も捨てない', async () => {
  const storage = fakeStorage();
  const fetch = deferredFetch();
  const auth = createAuth({ apiKey: 'FAKE_KEY', fetch, storage, now: fakeClock(1000).now });
  const s = auth.signIn('t@example.com', 'x');
  fetch.respond(0, 200, { localId: 'T1', email: 't@example.com', idToken: 'tok1', refreshToken: 'r1', expiresIn: '3600' });
  await s;
  const c1 = auth.changePassword('newpass12'); // pending[1]
  await tick();
  const r = auth.forceRefresh();
  await tick();
  assert.equal(fetch.calls.length, 2);
  fetch.respond(1, 200, { localId: 'T1', email: 't@example.com', idToken: 'tok3', refreshToken: 'r3', expiresIn: '3600' });
  await c1;
  const c2 = auth.changePassword('newpass34'); // 変更 1 の完了直後
  await tick();
  await tick();
  assert.equal(fetch.open, 1); // 更新と変更 2 が同時に走らない
  assert.equal(fetch.calls.length, 3);
  assert.ok(isToken(fetch.calls[2].url));
  assert.equal(fetch.calls[2].init.body, 'grant_type=refresh_token&refresh_token=r3');
  fetch.respond(2, 200, { user_id: 'T1', id_token: 'tok4', refresh_token: 'r4', expires_in: '3600' });
  assert.equal(await r, 'tok4');
  await tick();
  assert.equal(fetch.calls.length, 4);
  assert.ok(isUpdate(fetch.calls[3].url));
  assert.equal(JSON.parse(fetch.calls[3].init.body).idToken, 'tok4');
  fetch.respond(3, 200, { localId: 'T1', email: 't@example.com', idToken: 'tok5', refreshToken: 'r5', expiresIn: '3600' });
  await c2;
  assert.equal(fetch.maxOpen, 1);
  assert.equal(await auth.getToken(), 'tok5');
  assert.deepEqual(JSON.parse(storage.getItem(KEY)), { uid: 'T1', email: 't@example.com', refreshToken: 'r5' });
});

test('順番待ち: 変更が失敗しても、次に並んだ変更は進める', async () => {
  const storage = fakeStorage();
  const fetch = deferredFetch();
  const auth = createAuth({ apiKey: 'FAKE_KEY', fetch, storage, now: fakeClock(1000).now });
  const s = auth.signIn('t@example.com', 'x');
  fetch.respond(0, 200, { localId: 'T1', email: 't@example.com', idToken: 'tok1', refreshToken: 'r1', expiresIn: '3600' });
  await s;
  const c1 = auth.changePassword('a'); // pending[1]
  const c1Rejected = assert.rejects(c1, (e) => e instanceof NetError && e.code === 'weak-password');
  const c2 = auth.changePassword('newpass12');
  await tick();
  assert.equal(fetch.calls.length, 2);
  fetch.respond(1, 400, { error: { message: 'WEAK_PASSWORD : Password should be at least 6 characters' } });
  await c1Rejected;
  await tick();
  assert.equal(fetch.calls.length, 3);
  fetch.respond(2, 200, { localId: 'T1', email: 't@example.com', idToken: 'tok3', refreshToken: 'r3', expiresIn: '3600' });
  await c2;
  assert.equal(fetch.maxOpen, 1);
  assert.equal(await auth.getToken(), 'tok3');
});

// ---- 時間切れ ----

const hang = () => new Promise(() => {});

test('時間切れ: ログインの fetch が返らないと network。保存しない', async () => {
  const storage = fakeStorage();
  const signals = [];
  const fetch = (url, init) => { signals.push(init.signal); return hang(); };
  const auth = createAuth({ apiKey: 'FAKE_KEY', fetch, storage, now: fakeClock(1000).now, timeoutMs: 20 });
  await assert.rejects(() => auth.signIn('t@example.com', 'x'), (e) => e instanceof NetError && e.code === 'network');
  assert.equal(signals[0].aborted, true);
  assert.equal(auth.user, null);
  assert.equal(storage.getItem(KEY), null);
});

test('時間切れ: fetch は返るが本文の読みこみが返らないときも network', async () => {
  const fetch = async () => ({ ok: true, status: 200, json: hang });
  const auth = createAuth({ apiKey: 'FAKE_KEY', fetch, storage: fakeStorage(), now: fakeClock(1000).now, timeoutMs: 20 });
  await assert.rejects(() => auth.signIn('t@example.com', 'x'), (e) => e instanceof NetError && e.code === 'network');
  await assert.rejects(() => auth.createAccount('a@jugyolog.invalid', 'pw'), (e) => e instanceof NetError && e.code === 'network');
});

test('時間切れ: 更新が時間切れでも保存したログインは消えず、次の更新をやり直せる', async () => {
  const storage = fakeStorage();
  const inner = fakeFetch(teacherHandler);
  let tokenCalls = 0;
  const fetch = (url, init) => {
    if (isToken(url) && ++tokenCalls === 1) return hang(); // 1 回目の更新だけ返らない
    return inner(url, init);
  };
  const auth = createAuth({ apiKey: 'FAKE_KEY', fetch, storage, now: fakeClock(1000).now, timeoutMs: 20 });
  await auth.signIn('t@example.com', 'x');
  const saved = storage.getItem(KEY);
  await assert.rejects(() => auth.forceRefresh(), (e) => e instanceof NetError && e.code === 'network');
  assert.equal(storage.getItem(KEY), saved);
  assert.deepEqual(auth.user, { uid: 'T1', email: 't@example.com' });
  assert.equal(await auth.forceRefresh(), 'tok2'); // refreshing が残っていない
  assert.equal(tokenCalls, 2);
});

test('時間切れ: restore の更新が時間切れでも保存は消えない', async () => {
  const storage = fakeStorage();
  storage.setItem(KEY, SAVED);
  const auth = createAuth({ apiKey: 'FAKE_KEY', fetch: hang, storage, now: fakeClock(1000).now, timeoutMs: 20 });
  await assert.rejects(() => auth.restore(), (e) => e instanceof NetError && e.code === 'network');
  assert.equal(storage.getItem(KEY), SAVED);
});

test('時間切れ: timeoutMs を渡さなければ CONFIG.requestTimeoutMs（10 秒）。終わったらタイマーを止める', async () => {
  const started = [];
  const cleared = [];
  const setTimeout = (fn, ms) => { started.push(ms); return started.length; };
  const clearTimeout = (id) => { cleared.push(id); };
  const auth = createAuth({ apiKey: 'FAKE_KEY', fetch: fakeFetch(teacherHandler), storage: fakeStorage(), now: fakeClock(1000).now, setTimeout, clearTimeout });
  await auth.signIn('t@example.com', 'x');
  assert.deepEqual(started, [10000]);
  assert.deepEqual(cleared, [1]);
});

// ---- 保存の中身 ----

test('storage に入るのは { uid, email, refreshToken } だけ（パスワードと ID トークンが入っていない）', async () => {
  const { auth, storage } = make(teacherHandler);
  await auth.signIn('t@example.com', 'secret-pass-1');
  let saved = storage.getItem(KEY);
  assert.deepEqual(Object.keys(JSON.parse(saved)).sort(), ['email', 'refreshToken', 'uid']);
  assert.ok(!saved.includes('secret-pass-1'));
  assert.ok(!saved.includes('tok1'));
  await auth.changePassword('secret-pass-2');
  saved = storage.getItem(KEY);
  assert.deepEqual(Object.keys(JSON.parse(saved)).sort(), ['email', 'refreshToken', 'uid']);
  assert.ok(!saved.includes('secret-pass-2'));
  assert.ok(!saved.includes('tok3'));
  await auth.createAccount('a@jugyolog.invalid', 'secret-pass-3');
  saved = storage.getItem(KEY);
  assert.ok(!saved.includes('secret-pass-3'));
  assert.ok(!saved.includes('NEW1'));
  assert.ok(!saved.includes('tokNew'));
});
