import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker, { handleRelay, TARGETS } from '../relay/worker.js';
import { GAS } from '../js/gas-config.js';

const ORIGIN = 'https://schooldatahuruyama-lgtm.github.io';
const MAX_BODY = 40 * 1024 * 1024;
const CORS = {
  'Access-Control-Allow-Origin': ORIGIN,
  Vary: 'Origin',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

function request(path = '/gas/app', { method = 'POST', origin = ORIGIN, body = '', headers = {} } = {}) {
  return new Request('https://relay.example.test' + path, {
    method,
    headers: { ...(origin === null ? {} : { Origin: origin }), ...headers },
    ...(method === 'POST' ? { body } : {}),
  });
}

function setup(reply = () => new Response('{"ok":true}')) {
  const calls = [];
  return {
    calls,
    run: (req) => handleRelay(req, { fetch: async (url, init) => {
      calls.push({ url, init });
      return reply(url, init);
    } }),
  };
}

function checkHeaders(response, origin = ORIGIN) {
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(response.headers.get('Content-Type'), 'application/json; charset=utf-8');
  for (const [name, value] of Object.entries(CORS)) {
    assert.equal(response.headers.get(name), origin === null ? null : name === 'Access-Control-Allow-Origin' ? origin : value);
  }
}

async function checkError(response, status, error, origin = ORIGIN) {
  assert.equal(response.status, status);
  assert.deepEqual(await response.json(), { ok: false, error });
  checkHeaders(response, origin);
}

test('送り先は app と check の 2 つだけで、今の GAS の設定と同じ', () => {
  assert.deepEqual(TARGETS, { app: GAS.appUrl, check: GAS.url });
});

test('/ping は Origin が許可・不許可・無しのどれでも答え、通信しない', async () => {
  const h = setup();
  for (const origin of [ORIGIN, 'http://127.0.0.1:8791', 'http://localhost:8791', 'https://other.example.test', null]) {
    const response = await h.run(request('/ping', { method: 'GET', origin }));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, version: 'relay-1' });
    checkHeaders(response, origin === 'https://other.example.test' ? null : origin);
  }
  assert.equal(h.calls.length, 0);
});

test('Worker の入口からも /ping に答える', async () => {
  const response = await worker.fetch(request('/ping', { method: 'GET', origin: null }));
  assert.deepEqual(await response.json(), { ok: true, version: 'relay-1' });
  checkHeaders(response, null);
});

test('app・check は本文のバイト列と、返事の本文・状態をそのまま渡す', async () => {
  const body = new Uint8Array([0, 10, 13, 34, 128, 255, ...new TextEncoder().encode('確認用の文')]);
  for (const target of ['app', 'check']) {
    for (const [status, reply] of [[201, '{ "ok": true }\n'], [400, '{"ok":false,"error":"bad"}'], [503, '<html>test failure</html>']]) {
      const h = setup(() => new Response(reply, { status, headers: { 'Set-Cookie': 'test=value', 'Access-Control-Allow-Origin': '*' } }));
      const response = await h.run(request('/gas/' + target, { body, headers: { 'Content-Type': 'application/octet-stream', 'X-Test': 'test-only' } }));
      assert.equal(response.status, status);
      assert.equal(await response.text(), reply);
      checkHeaders(response);
      assert.equal(response.headers.get('Set-Cookie'), null);
      assert.equal(h.calls.length, 1);
      const { url, init } = h.calls[0];
      assert.equal(url, TARGETS[target]);
      assert.equal(init.method, 'POST');
      assert.equal(init.redirect, 'follow');
      assert.deepEqual(init.headers, { 'Content-Type': 'text/plain;charset=utf-8' });
      assert.deepEqual(new Uint8Array(await new Response(init.body).arrayBuffer()), body);
    }
  }
});

test('空の POST もそのまま送り、本文のない返事も返せる', async () => {
  const h = setup(() => new Response(null, { status: 204 }));
  const response = await h.run(request());
  assert.equal(await new Response(h.calls[0].init.body).text(), '');
  assert.equal(response.status, 204);
  assert.equal(await response.text(), '');
  checkHeaders(response);
});

test('許可した 3 つの Origin の POST だけ通す', async () => {
  const h = setup();
  for (const origin of [ORIGIN, 'http://127.0.0.1:8791', 'http://localhost:8791']) {
    const response = await h.run(request('/gas/app', { origin }));
    assert.equal(response.status, 200);
    checkHeaders(response, origin);
  }
  assert.equal(h.calls.length, 3);
});

test('Origin が無い・不許可・大文字まじり・末尾 / の POST は送らない', async () => {
  const h = setup();
  for (const origin of [null, '', 'null', 'https://other.example.test', ORIGIN.toUpperCase(), ORIGIN + '/', 'http://localhost:8792', ORIGIN + '.example.test']) {
    await checkError(await h.run(request('/gas/app', { origin })), 403, 'denied', null);
  }
  assert.equal(h.calls.length, 0);
});

test('OPTIONS はどの道・Origin でも 204。許可した Origin にだけ CORS を付ける', async () => {
  const h = setup();
  for (const path of ['/ping', '/gas/app', '/gas/check', '/gas/other']) {
    for (const origin of [ORIGIN, 'https://other.example.test', null]) {
      const response = await h.run(request(path, { method: 'OPTIONS', origin }));
      assert.equal(response.status, 204);
      assert.equal(await response.text(), '');
      checkHeaders(response, origin === ORIGIN ? origin : null);
    }
  }
  assert.equal(h.calls.length, 0);
});

test('知らない道やメソッドは 404。本文やクエリで送り先を増やせない', async () => {
  const h = setup();
  for (const path of ['/gas/other', '/gas/toString', '/gas/__proto__', '/gas/constructor', '/gas/app/', '/gas/https://other.example.test', '/ping', '/']) {
    await checkError(await h.run(request(path, { body: '{"url":"https://other.example.test"}' })), 404, 'notfound');
  }
  for (const method of ['GET', 'PUT', 'DELETE', 'PATCH', 'HEAD']) {
    await checkError(await h.run(request('/gas/app', { method })), 404, 'notfound');
  }
  await checkError(await h.run(request('/unknown', { method: 'GET', origin: null })), 404, 'notfound', null);
  assert.equal(h.calls.length, 0);
  await h.run(request('/gas/app?url=https://other.example.test', { body: '{"target":"https://other.example.test"}' }));
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].url, TARGETS.app);
});

test('Content-Length で上限超過が分かれば、本文を読まずに 413', async () => {
  const h = setup();
  const req = request('/gas/app', { body: 'test', headers: { 'Content-Length': String(MAX_BODY + 1) } });
  await checkError(await h.run(req), 413, 'toobig');
  assert.equal(req.bodyUsed, false);
  assert.equal(h.calls.length, 0);
});

test('Content-Length がなくても、ちょうど 40 MiB は通し 1 バイト超過は送らない', async () => {
  for (const extra of [0, 1]) {
    const h = setup();
    const body = new Uint8Array(MAX_BODY + extra);
    body[body.length - 1] = 123;
    const response = await h.run(request('/gas/app', { body }));
    if (extra === 0) {
      assert.equal(response.status, 200);
      checkHeaders(response);
      assert.equal(h.calls[0].init.body.size, MAX_BODY);
      const last = new Uint8Array(await h.calls[0].init.body.slice(-1).arrayBuffer());
      assert.equal(last[0], 123);
    } else {
      await checkError(response, 413, 'toobig');
      assert.equal(h.calls.length, 0);
    }
  }
});

test('Content-Length が小さくても実際の UTF-8 バイト数で超過を見つける', async () => {
  const h = setup();
  const body = 'あ'.repeat(Math.floor(MAX_BODY / 3) + 1);
  assert.ok(body.length < MAX_BODY);
  await checkError(await h.run(request('/gas/check', { body, headers: { 'Content-Length': '1' } })), 413, 'toobig');
  assert.equal(h.calls.length, 0);
});

test('分割された本文も合計し、上限を超えたら読み取りを止める', async () => {
  let cancelled = false;
  let n = 0;
  const chunk = new Uint8Array(1024 * 1024);
  const body = new ReadableStream({
    pull(controller) { n++; controller.enqueue(chunk); },
    cancel() { cancelled = true; },
  }, { highWaterMark: 0 });
  const req = new Request('https://relay.example.test/gas/app', { method: 'POST', headers: { Origin: ORIGIN }, body, duplex: 'half' });
  const h = setup();
  await checkError(await h.run(req), 413, 'toobig');
  assert.equal(n, 41);
  assert.equal(cancelled, true);
  assert.equal(h.calls.length, 0);
});

test('通信の例外は内容を出さず 502。同じ要求が続いても毎回送る', async () => {
  const h = setup(() => { throw new Error('test-only upstream detail'); });
  for (let n = 0; n < 2; n++) await checkError(await h.run(request()), 502, 'server');
  assert.equal(h.calls.length, 2);
  const ok = setup();
  for (let n = 0; n < 2; n++) assert.equal((await ok.run(request())).status, 200);
  assert.equal(ok.calls.length, 2);
});
