// check.html のスクリプトを画面・通信の代役で動かす。ブラウザでの見た目は別に確かめる。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { reportText, PARALLEL_COUNT } from '../js/check-logic.js';
import { createReachTargets } from '../js/reach-targets.js';
import { runReach, reachText } from '../js/reach-check.js';
import { gasEndpoint } from '../js/gas-endpoint.js';

const html = readFileSync(new URL('../check.html', import.meta.url), 'utf8');
const script = html.match(/<script type="module">([\s\S]*?)<\/script>/)[1].replace(/^import .*;\r?\n/gm, '');
const tick = () => new Promise((resolve) => setImmediate(resolve));

function deferred() {
  let resolve;
  const promise = new Promise((yes) => { resolve = yes; });
  return { promise, resolve };
}

class Element {
  constructor() {
    this.children = [];
    this.events = new Map();
    this.textContent = '';
    this.value = '';
    this.hidden = false;
    this.disabled = false;
  }
  append(...elements) { this.children.push(...elements); }
  removeAttribute(name) { delete this[name]; }
  focus() { this.focused = true; }
  select() { this.selected = true; }
  addEventListener(name, fn) { this.events.set(name, fn); }
  // disabled でも直接イベントを呼び、実行中のガードも確かめる。
  emit(name) { return this.events.get(name)?.(); }
}

function setup({ fetch = () => Promise.resolve({}), copyFails = false, origin = 'https://app.example.test', firebase, targets, readPing, relayUrl = '', checkTest } = {}) {
  const elements = new Map();
  for (const match of html.matchAll(/<[^>]*\bid="([^"]+)"[^>]*>/g)) {
    const element = new Element();
    element.hidden = /\bhidden\b/.test(match[0]);
    elements.set(match[1], element);
  }
  const get = (id) => elements.get(id);
  get('place').value = '学校';
  const timers = new Map();
  let nextTimer = 1;
  const window = new Element();
  window.AbortController = AbortController;
  window.devicePixelRatio = 2;
  window.__CHECK_TEST__ = checkTest;
  window.setTimeout = (fn, ms) => { const id = nextTimer++; timers.set(id, { fn, ms }); return id; };
  window.clearTimeout = (id) => timers.delete(id);
  const calls = [];
  const copies = [];
  const checkOptions = [];
  const steps = {
    readPing: readPing || (async () => ''),
    signUp: async () => '', signIn: async () => '', writeAndRead: async () => '', refresh: async () => '',
    gasPing: async () => '', gasGet: async () => { throw new Error('test photo unavailable'); },
    gasParallel: async () => '', gasQuota: async () => '', cleanup: async () => '', state: () => ({ hasToken: false }),
  };
  vm.runInNewContext(script, {
    document: { getElementById: get, createElement: () => new Element() },
    window, location: { origin, hostname: new URL(origin).hostname },
    navigator: {
      userAgent: 'テストブラウザ', maxTouchPoints: 5,
      clipboard: { writeText: async (text) => { if (copyFails) throw new Error('test copy failure'); copies.push(text); } },
    },
    screen: { width: 1024, height: 768 }, performance: { now: () => 0 },
    URL, setTimeout: window.setTimeout, clearTimeout: window.clearTimeout,
    fetch: (url, init) => { calls.push({ url, init }); return fetch(url, init); },
    FIREBASE: firebase === undefined ? { databaseURL: 'https://db.example.test/', projectId: 'example-project', apiKey: 'test-only-key' } : firebase,
    GAS: { url: 'https://gas.example.test/', relayUrl }, gasEndpoint,
    createCheckSteps: (options) => { checkOptions.push(options); return steps; }, reportText, PARALLEL_COUNT,
    createReachTargets: targets === undefined ? createReachTargets : () => targets,
    runReach, reachText,
  });
  function fireTimers() {
    for (const [id, timer] of [...timers]) { timers.delete(id); timer.fn(); }
  }
  return { get, calls, copies, checkOptions, window, timers, fireTimers, rows: get('reach-list').children.map((row) => row.children[2]) };
}

test('確認ページは中つぎの有無で送信先・案内・両方のコピー文を切りかえる', async () => {
  for (const relayUrl of ['', null, 42, 'https://relay.example.test///', 'http://localhost:8792/', 'http://127.0.0.1:8792']) {
    for (const copyFails of [false, true]) {
      const enabled = typeof relayUrl === 'string' && relayUrl !== '';
      const base = enabled ? relayUrl.replace(/\/+$/, '') : '';
      const h = setup({ relayUrl, copyFails });
      assert.equal(h.get('relay-note').hidden, !enabled);
      await h.get('start').emit('click');
      assert.equal(h.checkOptions.length, 1);
      assert.equal(h.checkOptions[0].gasUrl, enabled ? base + '/gas/check' : 'https://gas.example.test/');
      await h.get('copy').emit('click');
      const report = copyFails ? h.get('report-text').value : h.copies.at(-1);
      assert.ok(report.endsWith('中つぎ: ' + (enabled ? '使っている' : '使っていない')));
      assert.equal(report.includes('test-only-key'), false);

      const names = h.get('reach-list').children.map((row) => row.children[0].textContent);
      assert.equal(names.includes('先生が置いた中つぎ'), enabled);
      if (enabled) assert.equal(names.indexOf('先生が置いた中つぎ') + 1, names.indexOf('今の保存の仕組み（script.google.com）'));
      await h.get('reach-start').emit('click');
      assert.equal(h.calls.some((c) => c.url === base + '/ping'), enabled);
      assert.equal(h.calls.length, enabled ? 16 : 15);
      await h.get('reach-copy').emit('click');
      const reachReport = copyFails ? h.get('reach-report-text').value : h.copies.at(-1);
      assert.ok(reachReport.endsWith('中つぎ: ' + (enabled ? '使っている' : '使っていない')));
      assert.equal(h.timers.size, 0);
    }
  }
});

test('手元だけの既存の送信先差しかえは保ち、中つぎを通すと表示しない', async () => {
  const checkTest = { gasUrl: 'https://override.example.test' };
  for (const origin of ['http://localhost:8791', 'https://app.example.test']) {
    const local = origin.startsWith('http://localhost:');
    const h = setup({ origin, relayUrl: 'https://relay.example.test', checkTest });
    await h.get('start').emit('click');
    assert.equal(h.checkOptions[0].gasUrl, local ? checkTest.gasUrl : 'https://relay.example.test/gas/check');
    assert.equal(h.get('relay-note').hidden, local);
    await h.get('copy').emit('click');
    assert.ok(h.copies[0].endsWith('中つぎ: ' + (local ? '使っていない' : '使っている')));
  }
});

test('中つぎの行だけを追加し、ほかの到達先と順序は変えない', () => {
  const options = { firebase: { databaseURL: 'https://abc-default-rtdb.example.test' }, origin: 'https://app.example.test' };
  const direct = createReachTargets(options);
  for (const relayUrl of ['https://relay.example.test', 'https://relay.example.test/nested///', 'http://localhost:8792', 'http://127.0.0.1:8792/']) {
    const targets = createReachTargets({ ...options, relayUrl });
    assert.deepEqual(targets[2], { name: '先生が置いた中つぎ', url: relayUrl.replace(/\/+$/, '') + '/ping' });
    assert.deepEqual(targets.filter((t) => t.name !== '先生が置いた中つぎ'), direct);
  }
  for (const relayUrl of ['', null, 42]) assert.deepEqual(createReachTargets({ ...options, relayUrl }), direct);
  for (const relayUrl of ['http://example.test', 'http://localhost.example.test', 'http://localhost@other.example.test', 'https://relay.example.test?test=value', 'https://relay.example.test/#test']) {
    assert.throws(() => createReachTargets({ ...options, relayUrl }), TypeError);
  }
});

test('ホスティングを指定の位置に表示し、取れないホスティングと Deno は表に出さない', () => {
  for (const [databaseURL, hosting] of [
    ['https://abc-default-rtdb.asia-southeast1.firebasedatabase.app', true],
    ['https://db.example.test/', false],
  ]) {
    const h = setup({ firebase: { databaseURL } });
    const rows = h.get('reach-list').children;
    const hosts = rows.map((row) => row.children[1].textContent);
    assert.equal(hosts.includes('deno.dev'), false);
    assert.equal(hosts.includes('abc.web.app'), hosting);
    if (hosting) {
      assert.equal(hosts[10], 'storage.googleapis.com');
      assert.equal(hosts[11], 'abc.web.app');
      assert.equal(rows[11].children[0].textContent, 'Firebase のホスティング（web.app）');
    }
  }
});

test('行き先の表を作り、二重実行を防ぎ、再実行時はすべて未実施に戻す', async () => {
  let reply = deferred();
  const h = setup({ fetch: () => reply.promise });
  assert.equal(h.rows.length, 15);
  assert.ok(h.rows.every((r) => r.textContent === '－ まだ調べていません'));
  const first = h.get('reach-start').emit('click');
  assert.equal(h.calls.length, 4);
  assert.equal(h.get('reach-start').disabled, true);
  await h.get('reach-start').emit('click');
  assert.equal(h.calls.length, 4);
  reply.resolve({});
  await first;
  assert.equal(h.calls.length, 15);
  assert.equal(h.get('reach-summary').textContent, '○ 15 個・× 0 個・△ 0 個でした。');
  assert.equal(h.get('reach-start').disabled, false);
  assert.equal(h.get('reach-start').textContent, 'もう一度調べる');
  assert.equal(h.get('reach-report-area').hidden, false);
  reply = deferred();
  const second = h.get('reach-start').emit('click');
  assert.ok(h.rows.every((r) => r.textContent === '－ まだ調べていません'));
  assert.equal(h.get('reach-report-area').hidden, true);
  assert.equal(h.get('reach-summary').textContent, '');
  reply.resolve({});
  await second;
  assert.equal(h.calls.length, 30);
  assert.equal(h.timers.size, 0);
});

test('決まった行から表示し、○・×・△ と集計を出す', async () => {
  let n = 0;
  const h = setup({ fetch: () => {
    n++;
    if (n === 1) return new Promise(() => {});
    if (n === 2) return Promise.reject(new TypeError('test network failure'));
    return Promise.resolve({});
  } });
  const work = h.get('reach-start').emit('click');
  await tick();
  assert.equal(h.rows[0].textContent, '－ まだ調べていません');
  assert.equal(h.rows[1].textContent, '× 届きませんでした');
  assert.equal(h.rows[2].textContent, '○ 届きました');
  assert.equal(h.get('reach-report-area').hidden, true);
  h.fireTimers();
  await work;
  assert.equal(h.rows[0].textContent, '△ 返事がありませんでした（10 秒）');
  assert.equal(h.get('reach-summary').textContent, '○ 13 個・× 1 個・△ 1 個でした。');
});

test('コピーは開始時の場所とブラウザを含み、失敗時は選択済みの欄を出す', async () => {
  for (const copyFails of [false, true]) {
    const h = setup({ copyFails });
    await h.get('reach-start').emit('click');
    h.get('place').value = '家';
    await h.get('reach-copy').emit('click');
    const area = h.get('reach-report-text');
    const text = copyFails ? area.value : h.copies[0];
    assert.match(text, /^確認した日時: .+/);
    assert.ok(text.includes('（db.example.test）'));
    assert.ok(text.includes('ブラウザ: テストブラウザ'));
    assert.ok(text.includes('\n場所: 学校\n'));
    assert.ok(text.endsWith('中つぎ: 使っていない'));
    assert.equal(text.includes('test-only-key'), false);
    if (copyFails) {
      assert.equal(h.get('reach-copy-note').textContent, '× 自動ではコピーできませんでした。下の欄の文章をすべて選んでコピーしてください。');
      assert.equal(area.hidden, false);
      assert.equal(area.focused, true);
      assert.equal(area.selected, true);
    } else {
      assert.equal(h.get('reach-copy-note').textContent, '○ コピーしました。Claude Code に貼り付けてください。');
      assert.equal(area.hidden, true);
    }
  }
});

test('既存の確認と、どちらから始めても同時に実行できる', async () => {
  for (const reachFirst of [false, true]) {
    const oldReply = deferred();
    const newReply = deferred();
    const h = setup({ fetch: () => newReply.promise, readPing: () => oldReply.promise });
    let oldWork, newWork;
    if (reachFirst) {
      newWork = h.get('reach-start').emit('click');
      oldWork = h.get('start').emit('click');
    } else {
      oldWork = h.get('start').emit('click');
      newWork = h.get('reach-start').emit('click');
    }
    assert.equal(h.get('start').disabled, true);
    assert.equal(h.get('reach-start').disabled, true);
    newReply.resolve({});
    await newWork;
    assert.equal(h.get('start').disabled, true);
    assert.equal(h.get('reach-start').disabled, false);
    oldReply.resolve('');
    await oldWork;
    assert.equal(h.get('start').disabled, false);
    assert.equal(h.get('report-area').hidden, false);
    assert.equal(h.get('reach-report-area').hidden, false);
    assert.equal(h.get('reach-summary').textContent, '○ 15 個・× 0 個・△ 0 個でした。');
    assert.equal(h.timers.size, 0);
  }
});

test('pagehide で通信を止め、戻ってから再実行できる', async () => {
  let hang = true;
  const h = setup({ fetch: () => hang ? new Promise(() => {}) : Promise.resolve({}) });
  const work = h.get('reach-start').emit('click');
  h.window.emit('pagehide');
  await work;
  assert.equal(h.calls.length, 4);
  assert.ok(h.calls.every((c) => c.init.signal.aborted));
  assert.equal(h.timers.size, 0);
  assert.equal(h.get('reach-report-area').hidden, true);
  assert.equal(h.get('reach-start').disabled, false);
  hang = false;
  await h.get('reach-start').emit('click');
  assert.equal(h.calls.length, 19);
  assert.equal(h.get('reach-summary').textContent, '○ 15 個・× 0 個・△ 0 個でした。');
});

test('空の一覧は通信せず、理由を出す', async () => {
  const h = setup({ targets: [] });
  assert.equal(h.get('reach-summary').textContent, '調べる行き先がありません。');
  await h.get('reach-start').emit('click');
  assert.equal(h.get('reach-summary').textContent, '調べる行き先がありません。');
  assert.equal(h.calls.length, 0);
  assert.equal(h.get('reach-report-area').hidden, true);
});

test('HTTPS でないページは置き場所だけ省き、ほかの行き先と既存の確認は止めない', async () => {
  const h = setup({ origin: 'http://127.0.0.1:8791' });
  assert.equal(h.get('reach-start').disabled, false);
  assert.equal(h.get('start').disabled, false);
  assert.equal(h.calls.length, 0);
  assert.equal(h.get('reach-summary').textContent, '');
  assert.equal(h.rows.length, 14);
  assert.equal(h.get('reach-list').children.some((row) => row.children[0].textContent.includes('このアプリの置き場所')), false);
  await h.get('reach-start').emit('click');
  assert.equal(h.calls.length, 14);
  assert.ok(h.calls.every((c) => c.url.startsWith('https://')));
  assert.equal(h.get('reach-summary').textContent, '○ 14 個・× 0 個・△ 0 個でした。');
});

test('Firebase の設定がないときも、それ以外の行き先は調べられる', async () => {
  const h = setup({ firebase: {} });
  assert.equal(h.get('start').disabled, true);
  assert.equal(h.get('reach-start').disabled, false);
  await h.get('reach-start').emit('click');
  assert.equal(h.rows.length, 14);
  assert.equal(h.calls.length, 14);
  assert.equal(h.get('reach-summary').textContent, '○ 14 個・× 0 個・△ 0 個でした。');
});
