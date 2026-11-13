// データベース（Firebase Realtime Database）の読み書きを、fetch とログインの代役で確かめる
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createNet } from '../js/net.js';
import { NetError } from '../js/errors.js';

const DB = 'https://db.example';

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

// 数えられるログインの代役
function stubAuth() {
  const auth = {
    refreshes: 0,
    tokenCalls: 0,
    token: 'tok',
    getToken: async () => { auth.tokenCalls += 1; return auth.token; },
    forceRefresh: async () => { auth.refreshes += 1; auth.token = 'tok2'; return auth.token; },
  };
  return auth;
}

function make(handler = () => ({ status: 200, body: null })) {
  const auth = stubAuth();
  const fetch = fakeFetch(handler);
  const net = createNet({ databaseURL: DB, auth, fetch });
  return { net, auth, fetch };
}

test('読む: GET <databaseURL>/パス.json?auth=トークン を呼び、本文の JSON を返す', async () => {
  const { net, fetch } = make(() => ({ status: 200, body: { x: 1 } }));
  assert.deepEqual(await net.get('a/b'), { x: 1 });
  assert.equal(fetch.calls[0].url, `${DB}/a/b.json?auth=tok`);
  assert.equal(fetch.calls[0].init.method, 'GET');
});

test('読む: 無ければ null を返す', async () => {
  const { net } = make(() => ({ status: 200, body: null }));
  assert.equal(await net.get('a/none'), null);
});

test('読む: shallow のときだけ URL に shallow=true を付ける', async () => {
  const { net, fetch } = make(() => ({ body: { s1: true, s2: true } }));
  assert.deepEqual(await net.get('records/c1/l1', { shallow: true }), { s1: true, s2: true });
  await net.get('records/c1/l1');
  await net.get('records/c1/l1', { shallow: false });
  assert.deepEqual(fetch.calls.map((c) => c.url), [
    `${DB}/records/c1/l1.json?auth=tok&shallow=true`,
    `${DB}/records/c1/l1.json?auth=tok`,
    `${DB}/records/c1/l1.json?auth=tok`,
  ]);
  assert.equal(fetch.calls[0].init.method, 'GET');
});

test('読む: トークンを取り直しても shallow を保つ', async () => {
  let n = 0;
  const { net, fetch } = make(() => (++n === 1 ? { status: 401, body: {} } : { body: { s1: true } }));
  assert.deepEqual(await net.get('records/c1/l1', { shallow: true }), { s1: true });
  assert.deepEqual(fetch.calls.map((c) => c.url), [
    `${DB}/records/c1/l1.json?auth=tok&shallow=true`,
    `${DB}/records/c1/l1.json?auth=tok2&shallow=true`,
  ]);
});

test('書く: set は PUT、update は PATCH、remove は DELETE', async () => {
  const { net, fetch } = make();
  await net.set('a/b', { n: 1 });
  await net.update('a', { 'b/c': 2, d: null });
  await net.remove('a/b');
  assert.deepEqual(fetch.calls.map((c) => c.init.method), ['PUT', 'PATCH', 'DELETE']);
  assert.equal(fetch.calls[0].url, `${DB}/a/b.json?auth=tok`);
  assert.equal(fetch.calls[0].init.body, JSON.stringify({ n: 1 }));
  assert.equal(fetch.calls[2].init.body, undefined);
});

test('一部を書く: 複数パスのキーと null がそのままの JSON で送られる', async () => {
  const { net, fetch } = make();
  const patch = { 'polls/s2/status': 'closed', current: { slideId: 's3', pollId: null } };
  await net.update('sessions/x/pub', patch);
  assert.equal(fetch.calls[0].url, `${DB}/sessions/x/pub.json?auth=tok`);
  assert.equal(fetch.calls[0].init.body, JSON.stringify(patch));
});

test('ルートへの複数パスの書きこみ: update("", patch) は PATCH <databaseURL>/.json?auth=…', async () => {
  const { net, fetch } = make();
  await net.update('', { 'a/b': 1, c: null });
  assert.equal(fetch.calls[0].init.method, 'PATCH');
  assert.equal(fetch.calls[0].url, `${DB}/.json?auth=tok`);
  assert.equal(fetch.calls[0].init.body, '{"a/b":1,"c":null}');
});

test('サーバーの時刻: serverTimestamp は { ".sv": "timestamp" } を返す', () => {
  const { net } = make();
  assert.deepEqual(net.serverTimestamp(), { '.sv': 'timestamp' });
});

test('subscribe は作らない', () => {
  const { net } = make();
  assert.equal(net.subscribe, undefined);
});

test('拒否は denied: 403 で code が denied になる', async () => {
  const { net } = make(() => ({ status: 403, body: { error: 'Permission denied' } }));
  await assert.rejects(net.get('a'), (e) => e instanceof NetError && e.code === 'denied');
});

test('401 は更新して 1 回やり直す: 2 回目で成功し forceRefresh は 1 回、新しいトークンを使う', async () => {
  let n = 0;
  const { net, auth, fetch } = make(() => (++n === 1 ? { status: 401, body: {} } : { status: 200, body: { ok: 1 } }));
  assert.deepEqual(await net.get('a'), { ok: 1 });
  assert.equal(auth.refreshes, 1);
  assert.equal(fetch.calls.length, 2);
  assert.ok(fetch.calls[1].url.endsWith('?auth=tok2'));
});

test('401 が 2 回続くと auth になる（やり直しは 1 回だけ）', async () => {
  const { net, auth, fetch } = make(() => ({ status: 401, body: {} }));
  await assert.rejects(net.get('a'), (e) => e.code === 'auth');
  assert.equal(auth.refreshes, 1);
  assert.equal(fetch.calls.length, 2);
});

test('fetch の失敗は network、そのほかの HTTP エラーは unknown', async () => {
  const a = make(() => new Error('offline'));
  await assert.rejects(a.net.set('a', 1), (e) => e.code === 'network');
  const b = make(() => ({ status: 500, body: {} }));
  await assert.rejects(b.net.get('a'), (e) => e.code === 'unknown');
});

test('読む: 200 でも本文の受信に失敗したら network（null にしない）', async () => {
  const auth = stubAuth();
  const broken = async () => ({ ok: true, status: 200, json: async () => { throw new TypeError('terminated'); } });
  const n = createNet({ databaseURL: DB, auth, fetch: broken });
  await assert.rejects(n.get('a'), (e) => e.code === 'network');
});

test('読む: 本文が JSON として不正なら unknown、本物の JSON null は null', async () => {
  const auth = stubAuth();
  const bad = async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('Unexpected token'); } });
  const n = createNet({ databaseURL: DB, auth, fetch: bad });
  await assert.rejects(n.get('a'), (e) => e.code === 'unknown');
  const { net } = make(() => ({ status: 200, body: null }));
  assert.equal(await net.get('a'), null);
});

// ---- 実物の Firebase は、規則による拒否も 401 で返す（本文は {"error":"Permission denied"}） ----

test('401 で本文が Permission denied なら denied（トークンは取り直さない）', async () => {
  const { net, auth, fetch } = make(() => ({ status: 401, body: { error: 'Permission denied' } }));
  await assert.rejects(net.set('a', 1), (e) => e instanceof NetError && e.code === 'denied');
  assert.equal(auth.refreshes, 0);
  assert.equal(fetch.calls.length, 1);
});

test('401 でほかの本文（期限切れなど）なら、トークンを取り直して 1 回やり直す', async () => {
  let n = 0;
  const { net, auth, fetch } = make(() => (++n === 1 ? { status: 401, body: { error: 'Auth token is expired' } } : { status: 200, body: { ok: 1 } }));
  assert.deepEqual(await net.get('a'), { ok: 1 });
  assert.equal(auth.refreshes, 1);
  assert.equal(fetch.calls.length, 2);
});

test('401 のやり直しが Permission denied なら denied、それ以外の 401 なら auth', async () => {
  let n = 0;
  const a = make(() => (++n === 1 ? { status: 401, body: { error: 'Auth token is expired' } } : { status: 401, body: { error: 'Permission denied' } }));
  await assert.rejects(a.net.get('a'), (e) => e.code === 'denied');
  assert.equal(a.auth.refreshes, 1);
  const b = make(() => ({ status: 401, body: { error: 'Invalid token' } }));
  await assert.rejects(b.net.get('a'), (e) => e.code === 'auth');
  assert.equal(b.fetch.calls.length, 2);
});

test('401 の本文が読めない・JSON でないときは、認証の失敗として扱う（取り直して 1 回やり直す）', async () => {
  const auth = stubAuth();
  let n = 0;
  const fetch = async () => {
    n += 1;
    return { ok: false, status: 401, json: async () => { throw new SyntaxError('bad'); } };
  };
  const net = createNet({ databaseURL: DB, auth, fetch });
  await assert.rejects(net.get('a'), (e) => e.code === 'auth');
  assert.equal(n, 2);
  assert.equal(auth.refreshes, 1);
});

// ---- トークンを付けずに読む（getPublic） ----

test('getPublic: トークンを付けずに GET <databaseURL>/パス.json を呼び、getToken を呼ばない', async () => {
  const { net, auth, fetch } = make(() => ({ status: 200, body: { uid: 'U1' } }));
  assert.deepEqual(await net.getPublic('gen/s26-017'), { uid: 'U1' });
  assert.equal(fetch.calls[0].url, 'https://db.example/gen/s26-017.json');
  assert.equal(fetch.calls[0].init.method, 'GET');
  assert.equal(auth.tokenCalls, 0);
  assert.equal(auth.refreshes, 0);
});

test('getPublic: 無ければ null を返す', async () => {
  const { net } = make(() => ({ status: 200, body: null }));
  assert.equal(await net.getPublic('gen/s26-999'), null);
});

test('getPublic: 401（Permission denied）なら denied。トークンは取り直さない', async () => {
  const { net, auth, fetch } = make(() => ({ status: 401, body: { error: 'Permission denied' } }));
  await assert.rejects(net.getPublic('gen/s26-017'), (e) => e instanceof NetError && e.code === 'denied');
  assert.equal(auth.refreshes, 0);
  assert.equal(fetch.calls.length, 1);
});

test('getPublic: fetch の失敗は network', async () => {
  const { net } = make(() => new Error('offline'));
  await assert.rejects(net.getPublic('gen/s26-017'), (e) => e instanceof NetError && e.code === 'network');
});

// ---- 時間切れ ----

// 解決しない fetch（signal を受け取って記録するだけ）
function hangingFetch() {
  const signals = [];
  const fn = (url, init = {}) => {
    signals.push(init.signal);
    return new Promise(() => {});
  };
  fn.signals = signals;
  return fn;
}

test('時間切れ: fetch が timeoutMs をすぎても返らないとき network になり、signal を止める', async () => {
  const auth = stubAuth();
  const fetch = hangingFetch();
  const net = createNet({ databaseURL: DB, auth, fetch, timeoutMs: 20 });
  await assert.rejects(net.get('a'), (e) => e instanceof NetError && e.code === 'network');
  assert.ok(fetch.signals[0], 'fetch に signal を渡す');
  assert.equal(fetch.signals[0].aborted, true);
});

test('時間切れ: getPublic も network になる', async () => {
  const auth = stubAuth();
  const fetch = hangingFetch();
  const net = createNet({ databaseURL: DB, auth, fetch, timeoutMs: 20 });
  await assert.rejects(net.getPublic('gen/s26-017'), (e) => e instanceof NetError && e.code === 'network');
  assert.equal(fetch.signals[0].aborted, true);
});

test('時間切れ: signal で止まる fetch（ブラウザと同じ）でも network になる', async () => {
  const auth = stubAuth();
  const fetch = (url, init) => new Promise((resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
  });
  const net = createNet({ databaseURL: DB, auth, fetch, timeoutMs: 20 });
  await assert.rejects(net.set('a', 1), (e) => e instanceof NetError && e.code === 'network');
});

// fetch は返るが、本文の読みこみ（json()）が返らない
function hangingBodyFetch(status) {
  const signals = [];
  const fn = async (url, init = {}) => {
    signals.push(init.signal);
    return { ok: status >= 200 && status < 300, status, json: () => new Promise(() => {}) };
  };
  fn.signals = signals;
  return fn;
}

test('時間切れ: 200 の本文の読みこみが返らないときも network になる', async () => {
  const auth = stubAuth();
  const fetch = hangingBodyFetch(200);
  const net = createNet({ databaseURL: DB, auth, fetch, timeoutMs: 20 });
  await assert.rejects(net.get('a'), (e) => e instanceof NetError && e.code === 'network');
  assert.equal(fetch.signals[0].aborted, true);
  const p = createNet({ databaseURL: DB, auth, fetch: hangingBodyFetch(200), timeoutMs: 20 });
  await assert.rejects(p.getPublic('gen/s26-017'), (e) => e instanceof NetError && e.code === 'network');
});

test('時間切れ: 401 の本文（拒否かどうかの判定）が返らないときも network になり、やり直さない', async () => {
  const auth = stubAuth();
  const fetch = hangingBodyFetch(401);
  const net = createNet({ databaseURL: DB, auth, fetch, timeoutMs: 20 });
  await assert.rejects(net.set('a', 1), (e) => e instanceof NetError && e.code === 'network');
  assert.equal(fetch.signals.length, 1);
  assert.equal(auth.refreshes, 0);
});

test('時間切れ: 1 回の要求（送信〜本文を読み終わるまで）でタイマーは 1 つ', async () => {
  const auth = stubAuth();
  const started = [];
  const cleared = [];
  const setTimeout = (fn, ms) => { started.push(ms); return started.length; };
  const clearTimeout = (id) => { cleared.push(id); };
  let n = 0;
  const fetch = fakeFetch(() => (++n === 1 ? { status: 401, body: { error: 'Auth token is expired' } } : { status: 200, body: { ok: 1 } }));
  const net = createNet({ databaseURL: DB, auth, fetch, timeoutMs: 50, setTimeout, clearTimeout });
  assert.deepEqual(await net.get('a'), { ok: 1 });
  assert.deepEqual(started, [50, 50]); // 1 回目（401）と、やり直しの 2 回
  assert.deepEqual(cleared, [1, 2]);
});

test('時間切れ: 間に合った通信ではタイマーを止める', async () => {
  const auth = stubAuth();
  const started = [];
  const cleared = [];
  const setTimeout = (fn, ms) => { started.push(ms); return started.length; };
  const clearTimeout = (id) => { cleared.push(id); };
  const fetch = fakeFetch(() => ({ status: 200, body: 1 }));
  const net = createNet({ databaseURL: DB, auth, fetch, timeoutMs: 1234, setTimeout, clearTimeout });
  assert.equal(await net.get('a'), 1);
  assert.deepEqual(started, [1234]);
  assert.deepEqual(cleared, [1]);
});

test('時間切れ: timeoutMs を渡さなければ CONFIG.requestTimeoutMs（10 秒）', async () => {
  const auth = stubAuth();
  const started = [];
  const setTimeout = (fn, ms) => { started.push(ms); return 1; };
  const clearTimeout = () => {};
  const fetch = fakeFetch(() => ({ status: 200, body: null }));
  const net = createNet({ databaseURL: DB, auth, fetch, setTimeout, clearTimeout });
  await net.getPublic('a');
  assert.deepEqual(started, [10000]);
});
