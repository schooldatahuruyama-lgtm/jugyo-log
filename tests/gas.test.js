// GAS への通信を、返事と時計の代役で確かめる
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGas } from '../js/gas.js';
import { NetError } from '../js/errors.js';

const URL = 'https://gas.example/exec';
const tick = () => new Promise((resolve) => setImmediate(resolve));
const json = (body) => ({ json: async () => body });
const fast = { timeoutMs: 1000, maxTries: 3, retryBaseMs: 0, random: () => 0.5 };
const rejectsCode = (p, code) => assert.rejects(p, (e) => e instanceof NetError && e.code === code);

function fakeAuth(token = 'test-token-1') {
  return {
    user: { uid: 'uA' }, token, reads: 0, refreshes: 0,
    async getToken() { this.reads += 1; return this.token; },
    async forceRefresh() { this.refreshes += 1; this.token = 'test-token-2'; return this.token; },
  };
}

function deferredFetch() {
  const calls = [];
  return {
    calls,
    fetch: (url, init) => new Promise((resolve) => { calls.push({ url, init, resolve }); }),
    resolve: (i, body) => calls[i].resolve(body),
  };
}

function fakeTimers() {
  const active = new Map();
  const started = [];
  return {
    active, started,
    setTimeout(fn, ms) { const id = started.push(ms); active.set(id, { fn, ms }); return id; },
    clearTimeout(id) { active.delete(id); },
    fire(ms) {
      const entry = [...active].find(([, timer]) => timer.ms === ms);
      assert.ok(entry, `${ms} ミリ秒のタイマーがある`);
      active.delete(entry[0]);
      entry[1].fn();
    },
  };
}

test('呼び出しは 1 つずつ。前のが終わるまで次を送らない', async () => {
  const f = deferredFetch();
  const gas = createGas({ url: URL, auth: fakeAuth(), fetch: f.fetch, ...fast });
  assert.equal(gas.busy, false);
  const a = gas.call('whoami');
  const b = gas.call('ping');
  assert.equal(gas.busy, true);
  await tick();
  assert.equal(f.calls.length, 1);
  f.resolve(0, json({ ok: true, role: 'teacher' }));
  await a;
  await tick();
  assert.equal(f.calls.length, 2);
  assert.equal(gas.busy, true);
  f.resolve(1, json({ ok: true, version: 'app-1' }));
  await b;
  assert.equal(gas.busy, false);
});

for (const nextUser of [null, { uid: 'uB' }]) {
  const change = nextUser ? '別の人でログイン' : 'ログアウト';

  test(`順番待ちの間に${change}すると送らない。そのあと新しい人の呼び出しは送れる`, async () => {
    const auth = fakeAuth();
    const f = deferredFetch();
    const bodies = [];
    const gas = createGas({ url: URL, auth, ...fast, fetch: async (url, init) => {
      bodies.push(JSON.parse(init.body));
      return bodies.length === 1 ? f.fetch(url, init) : json({ ok: true });
    } });
    const a = gas.call('whoami');
    await tick();
    assert.equal(bodies.length, 1);
    const b = gas.call('ping');
    auth.user = null;
    auth.user = nextUser;
    f.resolve(0, json({ ok: true }));
    await a;
    await rejectsCode(b, 'auth');
    assert.equal(bodies.length, 1);
    assert.equal(auth.reads, 1);
    assert.equal(gas.busy, false);

    auth.user = { uid: 'uB' };
    auth.token = 'test-token-b';
    assert.deepEqual(await gas.call('whoami'), { ok: true });
    assert.equal(bodies.length, 2);
    assert.deepEqual(bodies[1], { op: 'whoami', token: 'test-token-b' });
    assert.equal(gas.busy, false);
  });

  test(`やり直しの待ちの間に${change}すると送り直さない`, async () => {
    const auth = fakeAuth();
    const timers = fakeTimers();
    let calls = 0;
    const gas = createGas({ url: URL, auth, ...fast, ...timers, retryBaseMs: 100, fetch: async () => {
      calls += 1;
      return json(calls === 1 ? { ok: false, error: 'server' } : { ok: true });
    } });
    const result = gas.call('ping');
    await tick();
    assert.equal(calls, 1);
    assert.equal(gas.busy, true);
    auth.user = nextUser;
    timers.fire(100);
    await rejectsCode(result, 'auth');
    assert.equal(calls, 1);
    assert.equal(auth.reads, 1);
    assert.equal(timers.active.size, 0);
    assert.equal(gas.busy, false);
  });

  test(`auth の返事までに${change}すると forceRefresh を呼ばない`, async () => {
    const auth = fakeAuth();
    let calls = 0;
    const gas = createGas({ url: URL, auth, ...fast, fetch: async () => {
      calls += 1;
      auth.user = nextUser;
      return json(calls === 1 ? { ok: false, error: 'auth' } : { ok: true });
    } });
    await rejectsCode(gas.call('whoami'), 'auth');
    assert.equal(calls, 1);
    assert.equal(auth.refreshes, 0);
    assert.equal(auth.reads, 1);
    assert.equal(gas.busy, false);
  });

  test(`forceRefresh の間に${change}すると送り直さない`, async () => {
    const auth = fakeAuth();
    let release;
    auth.forceRefresh = function () {
      this.refreshes += 1;
      return new Promise((resolve) => { release = resolve; });
    };
    let calls = 0;
    const gas = createGas({ url: URL, auth, ...fast, fetch: async () => {
      calls += 1;
      return json(calls === 1 ? { ok: false, error: 'auth' } : { ok: true });
    } });
    const result = gas.call('whoami');
    await tick();
    assert.equal(auth.refreshes, 1);
    auth.user = nextUser;
    release('test-token-next');
    await rejectsCode(result, 'auth');
    assert.equal(calls, 1);
    assert.equal(auth.reads, 1);
    assert.equal(auth.refreshes, 1);
    assert.equal(gas.busy, false);
  });
}

for (const nextUser of [null, { uid: 'uB' }, { uid: 'uA' }]) {
  const same = nextUser?.uid === 'uA';
  const change = same ? '同じ UID の別オブジェクトになっても送る' : 'ログアウト・別の人になったら送らない';
  test(`トークンを取っている間に${change}（${nextUser?.uid ?? 'null'}）`, async () => {
    const auth = fakeAuth();
    let release;
    auth.getToken = function () {
      this.reads += 1;
      return new Promise((resolve) => { release = resolve; });
    };
    let calls = 0;
    const gas = createGas({ url: URL, auth, ...fast, fetch: async () => {
      calls += 1;
      return json({ ok: true });
    } });
    const result = gas.call('ping');
    await tick();
    assert.equal(auth.reads, 1);
    assert.equal(calls, 0);
    auth.user = nextUser;
    release('test-token-next');
    if (same) assert.deepEqual(await result, { ok: true });
    else await rejectsCode(result, 'auth');
    assert.equal(calls, same ? 1 : 0);
    assert.equal(auth.reads, 1);
    assert.equal(gas.busy, false);
  });
}

for (const loginAfterCall of [false, true]) {
  test(`未ログインで呼ぶと送らない（呼んだ直後のログイン${loginAfterCall ? 'あり' : 'なし'}）`, async () => {
    const auth = fakeAuth();
    auth.user = null;
    let calls = 0;
    const gas = createGas({ url: URL, auth, ...fast, fetch: async () => {
      calls += 1;
      return json({ ok: true });
    } });
    const result = gas.call('ping');
    if (loginAfterCall) auth.user = { uid: 'uB' };
    await rejectsCode(result, 'auth');
    assert.equal(calls, 0);
    assert.equal(auth.reads, 0);
    assert.equal(auth.refreshes, 0);
    assert.equal(gas.busy, false);
  });
}

test('text/plain の POST で本文にトークンを入れ、HTTP の状態によらず JSON の ok を見る', async () => {
  let sent;
  const gas = createGas({ url: URL, auth: fakeAuth(), ...fast, fetch: async (url, init) => {
    sent = { url, init };
    return { ...json({ ok: true, id: 'file1' }), status: 500, ok: false };
  } });
  assert.deepEqual(await gas.call('putMaterial', { key: 'test-key', dataB64: 'AQID' }), { ok: true, id: 'file1' });
  assert.equal(sent.url, URL);
  assert.equal(sent.init.method, 'POST');
  assert.deepEqual(sent.init.headers, { 'Content-Type': 'text/plain;charset=utf-8' });
  assert.deepEqual(JSON.parse(sent.init.body), { op: 'putMaterial', token: 'test-token-1', key: 'test-key', dataB64: 'AQID' });
});

test('HTML の返事は間をあけて 3 回目までやり直す。待つ間も次を送らず、トークンを毎回取る', async () => {
  const timers = fakeTimers();
  const auth = fakeAuth();
  const calls = [];
  const randoms = [0, 1];
  const gas = createGas({ url: URL, auth, ...fast, ...timers, retryBaseMs: 100, random: () => randoms.shift(),
    fetch: async (_, init) => {
      calls.push(JSON.parse(init.body));
      if (calls.length < 3) return { json: async () => { throw new SyntaxError('<html>'); } };
      return json({ ok: true });
    },
  });
  const a = gas.call('whoami');
  const b = gas.call('ping');
  await tick();
  assert.equal(calls.length, 1);
  assert.equal(gas.busy, true);
  auth.token = 'test-token-next';
  timers.fire(50);
  await tick();
  assert.equal(calls.length, 2);
  timers.fire(300);
  assert.deepEqual(await a, { ok: true });
  await b;
  assert.deepEqual(calls.map((c) => c.op), ['whoami', 'whoami', 'whoami', 'ping']);
  assert.equal(calls[1].token, 'test-token-next');
  assert.equal(auth.reads, 4);
  assert.deepEqual(timers.started, [1000, 50, 1000, 300, 1000, 1000]);
  assert.equal(timers.active.size, 0);
});

for (const failure of ['fetch', 'server', 'json']) {
  test(`${failure} が 3 回続くと network。そのあとの順番待ちは止まらない`, async () => {
    let calls = 0;
    const gas = createGas({ url: URL, auth: fakeAuth(), ...fast, fetch: async () => {
      calls += 1;
      if (calls > 3) return json({ ok: true });
      if (failure === 'fetch') throw new Error('通信の失敗');
      if (failure === 'json') return { json: async () => { throw new SyntaxError('HTML'); } };
      return json({ ok: false, error: 'server' });
    } });
    const failed = rejectsCode(gas.call('whoami'), 'network');
    const next = gas.call('ping');
    await failed;
    assert.deepEqual(await next, { ok: true });
    assert.equal(calls, 4);
    assert.equal(gas.busy, false);
  });
}

for (const hanging of ['fetch', 'body']) {
  test(`${hanging} が返らないと時間切れで止め、決めた回数で終わる`, async () => {
    const timers = fakeTimers();
    const signals = [];
    const gas = createGas({ url: URL, auth: fakeAuth(), ...fast, ...timers, timeoutMs: 20, retryBaseMs: 10,
      fetch: async (_, init) => {
        signals.push(init.signal);
        const pending = () => new Promise(() => {});
        return hanging === 'fetch' ? pending() : { json: pending };
      },
    });
    const failed = rejectsCode(gas.call('ping'), 'network');
    for (let i = 0; i < 3; i++) {
      await tick();
      assert.equal(signals.length, i + 1);
      timers.fire(20);
      await tick();
      assert.equal(signals[i].aborted, true);
      if (i < 2) timers.fire(10 * 2 ** i);
    }
    await failed;
    assert.equal(gas.busy, false);
    assert.equal(timers.active.size, 0);
  });
}

for (const again of [false, true]) {
  test(`auth は 1 回だけ取り直す（2 回目${again ? 'も auth' : 'で成功'}）`, async () => {
    const auth = fakeAuth();
    const tokens = [];
    const gas = createGas({ url: URL, auth, ...fast, fetch: async (_, init) => {
      tokens.push(JSON.parse(init.body).token);
      return json(tokens.length === 1 || again ? { ok: false, error: 'auth' } : { ok: true });
    } });
    if (again) await rejectsCode(gas.call('whoami'), 'auth');
    else assert.deepEqual(await gas.call('whoami'), { ok: true });
    assert.equal(auth.refreshes, 1);
    assert.deepEqual(tokens, ['test-token-1', 'test-token-2']);
  });
}

for (const [error, code] of Object.entries({ denied: 'denied', notfound: 'notfound', toobig: 'toobig', bad: 'unknown', config: 'unknown', other: 'unknown' })) {
  test(`${error} は ${code} になり、やり直さない`, async () => {
    let calls = 0;
    const gas = createGas({ url: URL, auth: fakeAuth(), ...fast, fetch: async () => {
      calls += 1;
      return json({ ok: false, error });
    } });
    await rejectsCode(gas.call('whoami'), code);
    assert.equal(calls, 1);
  });
}

test('URL が空なら通信もトークン取得もせず unknown', async () => {
  const auth = fakeAuth();
  const gas = createGas({ url: '', auth, fetch: () => assert.fail('通信しない'), ...fast });
  await rejectsCode(gas.call('ping'), 'unknown');
  assert.equal(auth.reads, 0);
});

test('例外の文や cause に、トークン・本文・元のエラーを残さない', async () => {
  const token = 'test-token-private';
  const dataB64 = 'dGVzdC1vbmx5';
  for (const source of ['fetch', 'getToken', 'forceRefresh', 'response']) {
    const auth = fakeAuth(token);
    const fail = async () => { throw new Error(`${token} ${dataB64}`); };
    if (source === 'getToken') auth.getToken = fail;
    if (source === 'forceRefresh') auth.forceRefresh = fail;
    const gas = createGas({ url: URL, auth, ...fast, fetch: source === 'fetch' ? fail : async () => json({
      ok: false, error: source === 'forceRefresh' ? 'auth' : `${token} ${dataB64}`,
    }) });
    await assert.rejects(gas.call('putMaterial', { dataB64 }), (e) => {
      assert.ok(e instanceof NetError);
      assert.equal(`${e.stack}`.includes(token), false);
      assert.equal(`${e.stack}`.includes(dataB64), false);
      assert.equal(e.cause, undefined);
      return true;
    });
  }
});

test('保存の応答だけ失われても、同じ key と本文で送り直す', async () => {
  const saved = new Map();
  const bodies = [];
  const gas = createGas({ url: URL, auth: fakeAuth(), ...fast, fetch: async (_, init) => {
    const body = JSON.parse(init.body);
    bodies.push(body);
    if (!saved.has(body.key)) saved.set(body.key, 'file1');
    if (bodies.length === 1) throw new Error('応答だけ失われた');
    return json({ ok: true, id: saved.get(body.key), bytes: 3, existed: true });
  } });
  assert.equal((await gas.call('putMaterial', { key: 'test-key', mime: 'image/jpeg', name: '板書', dataB64: 'AQID' })).id, 'file1');
  assert.equal(saved.size, 1);
  assert.deepEqual(bodies[0], bodies[1]);
});
