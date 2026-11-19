// 行き先への通信は代役で確かめる。実際の行き先には送らない。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkReach, runReach, reachText } from '../js/reach-check.js';
import { createReachTargets, validateReachTargets } from '../js/reach-targets.js';

const target = { name: '確認先', url: 'https://example.test/' };
const tick = () => new Promise((resolve) => setImmediate(resolve));

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function makeDeps(handler = () => Promise.resolve({ type: 'opaque' })) {
  const calls = [];
  const timers = new Map();
  let now = 0;
  let nextTimer = 1;
  const deps = {
    fetch: (url, init) => {
      calls.push({ url, init });
      if (init.mode === 'no-cors' && init.redirect !== 'follow') {
        throw new TypeError('no-cors では redirect: follow が必要です');
      }
      return handler(url, init);
    },
    setTimeout: (fn, ms) => {
      const id = nextTimer++;
      timers.set(id, { fn, at: now + ms, ms });
      return id;
    },
    clearTimeout: (id) => timers.delete(id),
    AbortController,
  };
  function advance(ms) {
    now += ms;
    for (const [id, timer] of [...timers]) {
      if (timer.at <= now) { timers.delete(id); timer.fn(); }
    }
  }
  return { deps, calls, timers, advance };
}

test('代役の fetch も no-cors で follow 以外なら通信前に TypeError にする', async () => {
  let handled = 0;
  const { deps } = makeDeps(() => { handled++; return Promise.resolve({ type: 'opaque' }); });
  for (const redirect of ['manual', 'error']) {
    assert.throws(() => deps.fetch(target.url, { mode: 'no-cors', redirect }), TypeError);
  }
  assert.equal(handled, 0);
  await deps.fetch(target.url, { mode: 'no-cors', redirect: 'follow' });
  assert.equal(handled, 1);
});

test('返事の中身・状態を読まず、opaque・リダイレクト・HTTP エラーも ok にする', async () => {
  for (const type of ['opaque', 'opaqueredirect', 'basic']) {
    const response = {
      type,
      get ok() { assert.fail('ok を読んではいけません'); },
      get status() { assert.fail('status を読んではいけません'); },
      get body() { assert.fail('本文を読んではいけません'); },
      text() { assert.fail('本文を読んではいけません'); },
      json() { assert.fail('本文を読んではいけません'); },
    };
    const { deps, timers } = makeDeps(() => Promise.resolve(response));
    assert.equal(await checkReach(target, deps), 'ok');
    assert.equal(timers.size, 0);
  }
});

test('fetch の reject と同期例外は blocked にし、タイマーを片付ける', async () => {
  for (const handler of [
    () => Promise.reject(new TypeError('test failure')),
    () => { throw new Error('test failure'); },
  ]) {
    const { deps, timers } = makeDeps(handler);
    assert.equal(await checkReach(target, deps), 'blocked');
    assert.equal(timers.size, 0);
  }
});

test('fetch は 1 回だけ、指定の GET と通信設定を使い、クエリや本文を付けない', async () => {
  const { deps, calls } = makeDeps();
  assert.equal(await checkReach(target, deps), 'ok');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, target.url);
  const { signal, ...options } = calls[0].init;
  assert.deepEqual(options, {
    method: 'GET', mode: 'no-cors', redirect: 'follow', cache: 'no-store',
    credentials: 'omit', referrerPolicy: 'no-referrer',
  });
  assert.ok(signal instanceof AbortSignal);
  assert.equal(signal.aborted, false);
  assert.equal(new URL(calls[0].url).search, '');
});

test('決まらない通信は 9999 ms では待ち、10000 ms で timeout にして止める', async () => {
  const { deps, calls, timers, advance } = makeDeps(() => new Promise(() => {}));
  let settled = false;
  const result = checkReach(target, deps).then((status) => { settled = true; return status; });
  assert.deepEqual([...timers.values()].map((t) => t.ms), [10000]);
  advance(9999);
  await tick();
  assert.equal(settled, false);
  assert.equal(calls[0].init.signal.aborted, false);
  advance(1);
  assert.equal(await result, 'timeout');
  assert.equal(calls[0].init.signal.aborted, true);
  assert.equal(timers.size, 0);
});

test('中止で fetch が reject しても時間切れの結果は timeout のまま', async () => {
  const { deps, advance } = makeDeps((url, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('test abort')));
  }));
  const result = checkReach(target, { ...deps, timeoutMs: 25 });
  advance(25);
  assert.equal(await result, 'timeout');
});

test('10 秒の境界では先に決まった結果を使い、遅い返事で上書きしない', async () => {
  for (const first of ['response', 'timeout']) {
    const reply = deferred();
    const { deps, timers, advance } = makeDeps(() => reply.promise);
    const result = checkReach(target, deps);
    // 同じ期限のコールバックが、先の結果のあとに来ても変わらない。
    const timeout = [...timers.values()][0].fn;
    if (first === 'response') {
      reply.resolve({});
      await tick();
      advance(10000);
      timeout();
      assert.equal(await result, 'ok');
    } else {
      advance(10000);
      reply.resolve({});
      await tick();
      assert.equal(await result, 'timeout');
    }
    assert.equal(timers.size, 0);
  }
});

test('最大 4 件ずつ動き、onResult は決まった順、戻り値は行き先の順になる', async () => {
  const targets = Array.from({ length: 7 }, (_, i) => ({ name: `確認先 ${i}`, url: `https://host${i}.test/` }));
  const replies = targets.map(() => deferred());
  let active = 0;
  let maxActive = 0;
  const { deps, calls, timers } = makeDeps((url) => {
    const i = targets.findIndex((t) => t.url === url);
    active++;
    maxActive = Math.max(maxActive, active);
    return replies[i].promise.finally(() => active--);
  });
  const order = [];
  const work = runReach(targets, { ...deps, onResult: (result, i) => order.push(i) });
  assert.equal(calls.length, 4);
  const completionOrder = [2, 0, 3, 1, 6, 4, 5];
  for (const i of completionOrder) {
    replies[i].resolve({});
    await tick();
    assert.ok(active <= 4);
  }
  const results = await work;
  assert.equal(maxActive, 4);
  assert.equal(calls.length, 7);
  assert.deepEqual(order, completionOrder);
  assert.deepEqual(results, targets.map((t) => ({ ...t, status: 'ok' })));
  assert.equal(timers.size, 0);
});

test('1 件の同期例外・reject・表示の例外があっても、残りを調べる', async () => {
  let n = 0;
  const { deps, calls, timers } = makeDeps(() => {
    if (++n === 1) throw new Error('test failure');
    if (n === 2) return Promise.reject(new TypeError('test failure'));
    return Promise.resolve({});
  });
  const results = await runReach(Array(6).fill(target), {
    ...deps, onResult: () => { throw new Error('test display failure'); },
  });
  assert.equal(calls.length, 6);
  assert.deepEqual(results.map((r) => r.status), ['blocked', 'blocked', 'ok', 'ok', 'ok', 'ok']);
  assert.equal(timers.size, 0);
});

test('AbortController を作れない行があっても、残りを調べる', async () => {
  const { deps } = makeDeps();
  let n = 0;
  class Controller {
    constructor() {
      if (++n === 1) throw new Error('test controller failure');
      return new AbortController();
    }
  }
  const results = await runReach(Array(5).fill(target), { ...deps, AbortController: Controller });
  assert.deepEqual(results.map((r) => r.status), ['blocked', 'ok', 'ok', 'ok', 'ok']);
});

test('limit の指定で同時実行数を変えられる', async () => {
  const { deps, calls, advance } = makeDeps(() => new Promise(() => {}));
  const work = runReach(Array(3).fill(target), { ...deps, limit: 2 });
  assert.equal(calls.length, 2);
  advance(10000);
  await tick();
  assert.equal(calls.length, 3);
  advance(10000);
  assert.deepEqual((await work).map((r) => r.status), ['timeout', 'timeout', 'timeout']);
});

test('空・配列でない一覧は何も調べず、空の報告に理由を出す', async () => {
  const { deps, calls, timers } = makeDeps();
  let notified = 0;
  for (const targets of [[], null, undefined, {}, 'test']) {
    const results = await runReach(targets, { ...deps, onResult: () => notified++ });
    assert.deepEqual(results, []);
    assert.match(reachText({ results, when: 'テスト日時', place: '学校', browser: 'テストブラウザ' }), /調べる行き先がありません。/);
  }
  assert.equal(calls.length, 0);
  assert.equal(timers.size, 0);
  assert.equal(notified, 0);
});

test('不正な limit は通信前に TypeError にする', async () => {
  const { deps, calls } = makeDeps();
  for (const limit of [0, -1, 1.5, NaN, Infinity, '4']) {
    await assert.rejects(runReach([target], { ...deps, limit }), TypeError);
  }
  assert.equal(calls.length, 0);
});

test('ページを離れたら実行中の通信を中止し、残りを始めず、結果を通知しない', async () => {
  const controller = new AbortController();
  const { deps, calls, timers } = makeDeps(() => new Promise(() => {}));
  let notified = 0;
  const work = runReach(Array(9).fill(target), {
    ...deps, signal: controller.signal, onResult: () => notified++,
  });
  assert.equal(calls.length, 4);
  controller.abort();
  assert.deepEqual(await work, []);
  assert.ok(calls.every((c) => c.init.signal.aborted));
  assert.equal(calls.length, 4);
  assert.equal(timers.size, 0);
  assert.equal(notified, 0);
});

test('中止済みなら通信せず、途中の中止なら確定した結果だけ返す', async () => {
  const controller = new AbortController();
  const { deps, calls, timers } = makeDeps();
  const results = await runReach(Array(6).fill(target), {
    ...deps, limit: 1, signal: controller.signal, onResult: () => controller.abort(),
  });
  assert.equal(results.length, 1);
  assert.equal(calls.length, 1);
  assert.deepEqual(await runReach([target], { ...deps, signal: controller.signal }), []);
  assert.equal(await checkReach(target, { ...deps, signal: controller.signal }), 'blocked');
  assert.equal(calls.length, 1);
  assert.equal(timers.size, 0);
});

test('一覧は指定の 16 件の順で、データベースのホストからプロジェクト ID を取る', () => {
  const targets = createReachTargets({
    firebase: { databaseURL: 'https://abc-default-rtdb.asia-southeast1.firebasedatabase.app/private-path?auth=test-only#test' },
    origin: 'https://app.example.test',
  });
  assert.deepEqual(targets.map((t) => t.url), [
    'https://abc-default-rtdb.asia-southeast1.firebasedatabase.app/check/ping.json', 'https://app.example.test/version.txt',
    'https://script.google.com/robots.txt', 'https://script.googleusercontent.com/robots.txt',
    'https://www.youtube-nocookie.com/robots.txt', 'https://www.youtube.com/robots.txt',
    'https://drive.google.com/robots.txt', 'https://drive.usercontent.google.com/',
    'https://www.googleapis.com/', 'https://firebasestorage.googleapis.com/',
    'https://storage.googleapis.com/', 'https://abc.web.app/',
    'https://workers.dev/', 'https://pages.dev/', 'https://vercel.app/',
    'https://netlify.app/robots.txt',
  ]);
  assert.equal(targets[4].name, '動画: YouTube の再生の枠（www.youtube-nocookie.com）');
  assert.equal(targets[5].name, '動画: YouTube（www.youtube.com）');
  assert.equal(targets[11].name, 'Firebase のホスティング（web.app）');
  assert.equal(targets.some((t) => new URL(t.url).hostname === 'deno.dev'), false);
  assert.ok(targets.every((t) => typeof t.name === 'string' && t.name.length > 0));
  assert.ok(targets.every((t) => Object.keys(t).join(',') === (t.note ? 'name,url,note' : 'name,url')));
  assert.deepEqual(targets.filter((t) => t.note).map((t) => [t.name, t.note]), [
    ['中つぎの候補: Cloudflare Workers（workers.dev）', 'workers.cloudflare.com へ転送されます'],
    ['中つぎの候補: Cloudflare Pages（pages.dev）', 'pages.cloudflare.com へ転送されます'],
    ['中つぎの候補: Vercel（vercel.app）', 'vercel.com へ転送されます'],
  ]);
  assert.ok(targets.every((t) => new URL(t.url).search === '' && new URL(t.url).hash === ''));
});

test('データベースの末尾の / の有無にかかわらず check/ping.json に 1 つの / でつなぐ', () => {
  for (const suffix of ['', '/', '///']) {
    const targets = createReachTargets({ firebase: { databaseURL: `https://database.example.test${suffix}` }, origin: target.url });
    assert.equal(targets[0].url, 'https://database.example.test/check/ping.json');
  }
});

test('アプリはページと同じフォルダの version.txt を使い、クエリ・フラグメントを付けない', () => {
  for (const href of ['https://app.example.test/check.html', 'https://app.example.test/nested/app/check.html?test=value#test']) {
    const targets = createReachTargets({ firebase: {}, origin: 'https://app.example.test', href });
    assert.equal(targets[0].url, new URL('version.txt', href).href);
    assert.equal(new URL(targets[0].url).search, '');
    assert.equal(new URL(targets[0].url).hash, '');
  }
  for (const href of ['http://app.example.test/check.html', 'file:///test/check.html']) {
    const targets = createReachTargets({ firebase: {}, origin: 'https://app.example.test', href });
    assert.equal(targets.some((t) => t.name.startsWith('このアプリの置き場所')), false);
  }
});

test('ホスティングは先頭のラベルから取り、設定の projectId は使わない', () => {
  const targets = createReachTargets({
    firebase: { databaseURL: 'https://abc-123-default-rtdb.example.test/', projectId: 'invalid/path' },
    origin: target.url,
  });
  assert.equal(targets[11].url, 'https://abc-123.web.app/');
});

test('データベースのホストが指定の形でなければホスティングだけ省く', () => {
  const expected = createReachTargets({ firebase: {}, origin: target.url });
  for (const databaseURL of [
    'https://database.example.test/', 'https://abc.firebaseio.com/',
    'https://abc-default-rtdb-extra.example.test/', 'https://db.abc-default-rtdb.example.test/',
    'https://-default-rtdb.example.test/', 'https://abc_def-default-rtdb.example.test/',
    'https://ABC-default-rtdb.example.test/', 'https://ａｂｃ-default-rtdb.example.test/',
    'https://%61bc-default-rtdb.example.test/',
  ]) {
    const targets = createReachTargets({ firebase: { databaseURL, projectId: 'example-project' }, origin: target.url });
    assert.equal(targets[0].url, new URL(databaseURL).origin + '/check/ping.json');
    assert.deepEqual(targets.slice(1), expected);
    assert.equal(targets.some((t) => t.url.includes('.web.app')), false);
  }
});

test('設定がなければその行だけ省き、ほかの行き先の順を変えない', () => {
  for (const firebase of [undefined, null, {}, { databaseURL: '', projectId: '' }]) {
    const targets = createReachTargets({ firebase, origin: 'https://app.example.test' });
    assert.equal(targets.length, 14);
    assert.equal(targets[0].url, 'https://app.example.test/version.txt');
    assert.equal(targets.some((t) => t.url.includes('.web.app')), false);
  }
  assert.equal(createReachTargets({ firebase: { databaseURL: target.url }, origin: target.url }).length, 15);
  assert.equal(createReachTargets({ firebase: { projectId: 'example-project' }, origin: target.url }).length, 14);
});

test('置き場所が https:// で始まらなければ、その行だけ省く', () => {
  const firebase = { databaseURL: 'https://database.example.test/', projectId: 'example-project' };
  const expected = createReachTargets({ firebase, origin: target.url }).filter((t) => t.url !== new URL('version.txt', target.url).href);
  for (const origin of ['http://127.0.0.1:8791', 'http://', 'null', null, '', undefined, '//example.test/', 'file:///test', 42, {}]) {
    assert.deepEqual(createReachTargets({ firebase, origin }), expected);
  }
});

test('データベースの URL が https:// で始まる文字列でなければ、その行だけ省く', () => {
  const expected = createReachTargets({ firebase: { projectId: 'example-project' }, origin: target.url });
  for (const databaseURL of ['http://database.example.test/', 'http://abc-default-rtdb.example.test/', 'http://', '', null, undefined, 42, true, {}, []]) {
    assert.deepEqual(createReachTargets({ firebase: { databaseURL, projectId: 'example-project' }, origin: target.url }), expected);
  }
});

test('データベースと置き場所を両方省いても、残りの行き先を調べる', async () => {
  const firebase = { databaseURL: 'https://database.example.test/', projectId: 'example-project' };
  const expected = createReachTargets({ firebase, origin: target.url }).slice(2);
  const targets = createReachTargets({
    firebase: { ...firebase, databaseURL: 'http://database.example.test/' },
    origin: 'http://127.0.0.1:8791',
  });
  assert.deepEqual(targets, expected);
  const { deps, calls, timers } = makeDeps();
  const results = await runReach(targets, deps);
  assert.deepEqual(calls.map((c) => c.url), expected.map((t) => t.url));
  assert.deepEqual(results, expected.map((t) => ({ ...t, status: 'ok' })));
  assert.equal(timers.size, 0);
});

test('決め打ちの行き先は https:// 以外・壊れたアドレスを TypeError にする', async () => {
  const { deps, calls } = makeDeps();
  for (const url of ['http://script.google.com/', 'http://example.test/', '//example.test/', 'file:///test', 'javascript:void(0)', 'https://', '', null]) {
    const bad = { name: '不正な確認先', url };
    assert.throws(() => validateReachTargets([target, bad]), TypeError);
    await assert.rejects(runReach([target, bad], deps), TypeError);
    await assert.rejects(checkReach(bad, deps), TypeError);
  }
  assert.throws(() => createReachTargets({ origin: 'https://' }), TypeError);
  assert.throws(() => createReachTargets({ firebase: { databaseURL: 'https://' }, origin: target.url }), TypeError);
  assert.equal(calls.length, 0);
});

test('一覧に認証情報・クエリ・フラグメントを持ちこまない', () => {
  for (const url of ['https://test-user:test-value@example.test/', 'https://example.test/?test=value', 'https://example.test/#test']) {
    assert.throws(() => validateReachTargets([{ name: '確認先', url }]), TypeError);
  }
  const [clean] = validateReachTargets([{ ...target, token: 'test-only-token', studentId: 'test-only-id' }]);
  assert.deepEqual(clean, target);
});

test('コピーする文は日時・結果と名前とホスト・ブラウザ・場所だけ', () => {
  const text = reachText({
    when: '2026/11/17 15:00:00', place: '学校', browser: 'テストブラウザ',
    results: ['ok', 'blocked', 'timeout'].map((status, i) => ({
      name: `確認先 ${i}`, url: `https://host${i}.test/test-only-id?auth=test-only-token`, status,
      token: 'test-only-token', studentId: 'test-only-id', email: 'test-only-email', detail: 'test-only-detail',
    })),
  });
  assert.equal(text, [
    '確認した日時: 2026/11/17 15:00:00',
    '○ 確認先 0（host0.test）', '× 確認先 1（host1.test）', '△ 確認先 2（host2.test）',
    'ブラウザ: テストブラウザ', '場所: 学校',
  ].join('\n'));
  for (const value of ['test-only-token', 'test-only-id', 'test-only-email', 'test-only-detail', 'auth=']) {
    assert.equal(text.includes(value), false);
  }
});

test('転送の注は確認後も残り、コピーする文のホスト名に続けて出す', async () => {
  const targets = createReachTargets({ firebase: {}, origin: target.url });
  const { deps } = makeDeps();
  const results = await runReach(targets, deps);
  const text = reachText({ results, when: 'テスト日時', place: '学校', browser: 'テストブラウザ' });
  for (const [host, note] of [
    ['workers.dev', 'workers.cloudflare.com へ転送されます'],
    ['pages.dev', 'pages.cloudflare.com へ転送されます'],
    ['vercel.app', 'vercel.com へ転送されます'],
  ]) {
    assert.ok(text.includes(`（${host}）（${note}）`));
  }
  assert.equal(text.includes('/robots.txt'), false);
  assert.equal(text.includes('/version.txt'), false);
});
