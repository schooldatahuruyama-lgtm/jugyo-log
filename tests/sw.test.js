// Service Worker を VM と通信・タイマーの代役で確かめる。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
const base = 'https://school.example/app/';
const reply = (body, status = 200, type = 'basic') => ({ body, status, type,
  async json() { return JSON.parse(body); }, clone() { return reply(body, status, type); } });
const request = (file, options = {}) => ({ url: new URL(file, base).href, method: 'GET', cache: 'default', mode: 'cors', ...options });

function setup({ search = '?v=v1', storage = new Map() } = {}) {
  const name = `jugyolog-app-${(new URLSearchParams(search).get('v') || 'dev').replace(/[^a-zA-Z0-9._-]/g, '-')}`;
  if (!storage.has(name)) storage.set(name, new Map());
  const handlers = {}; const data = storage.get(name); const timers = new Map(); const calls = [];
  const url = (key) => typeof key === 'string' ? key : key.url;
  const clean = (key) => { const parsed = new URL(url(key)); parsed.search = ''; return parsed.href; };
  const h = { data, storage, timers, calls, opened: [], deleted: [], skipped: 0, claimed: 0, broken: false,
    fetch: async () => { throw new Error('offline'); } };
  const cache = (data) => ({
    async match(key, options) {
      for (const [saved, value] of data) {
        if (options?.ignoreSearch ? clean(saved) === clean(key) : saved === url(key)) return value.clone();
      }
      return undefined;
    },
    async put(key, value) { if (h.broken) throw new Error('容量不足'); data.set(url(key), value.clone()); },
    async keys() { return [...data.keys()].map((key) => ({ url: key })); },
    async delete(key) { return data.delete(url(key)); },
  });
  runInNewContext(source, {
    URL, URLSearchParams,
    self: { location: { search }, registration: { scope: base }, addEventListener: (name, fn) => { handlers[name] = fn; },
      skipWaiting: async () => { h.skipped++; }, clients: { claim: async () => { h.claimed++; } } },
    caches: {
      open: async (key) => {
        h.opened.push(key);
        if (!storage.has(key)) storage.set(key, new Map());
        return cache(storage.get(key));
      },
      keys: async () => [...storage.keys()],
      delete: async (key) => { h.deleted.push(key); return storage.delete(key); },
    },
    fetch: async (...args) => { calls.push(args); return h.fetch(...args); },
    setTimeout: (fn, ms) => { const id = {}; timers.set(id, { fn, ms }); return id; },
    clearTimeout: (id) => timers.delete(id),
  });
  h.lifecycle = async (name) => {
    let work; handlers[name]({ waitUntil: (promise) => { work = promise; } }); await work;
  };
  h.request = (req) => {
    const event = { request: req, response: null, work: null,
      respondWith(promise) { this.response = promise; }, waitUntil(promise) { this.work = promise; } };
    handlers.fetch(event); return event;
  };
  h.timeout = async () => {
    for (const [id, timer] of timers) { timers.delete(id); assert.equal(timer.ms, 5000); await timer.fn(); }
  };
  return h;
}

test('install: 一覧が無い・JSON や形が不正でも成功して skipWaiting', async () => {
  for (const result of [reply('', 404), reply('', 500), reply('broken'), reply('null'), reply('[]'), reply('{"files":[]}'), reply('{"version":"abc1234","files":{}}')]) {
    const h = setup(); h.fetch = async () => result;
    await h.lifecycle('install'); assert.equal(h.skipped, 1); assert.equal(h.data.size, 0);
    assert.equal(h.calls[0][1].cache, 'no-store');
  }
});

test('install: 文字列でない要素をとばし、全ファイルを no-cache で取れたら skipWaiting', async () => {
  const h = setup();
  h.fetch = async (url) => {
    if (url.endsWith('app-files.json')) return reply(JSON.stringify({ version: 'abc1234', files: ['index.html', 123, null, {}, 'css/app.css'] }));
    return reply(url);
  };
  h.storage.set('jugyolog-app-old', new Map());
  await h.lifecycle('install');
  assert.equal(h.skipped, 1);
  assert.deepEqual([...h.data.keys()], [base + 'index.html', base + 'css/app.css']);
  assert.deepEqual(h.calls.slice(1).map(([url]) => url), ['index.html', 'css/app.css'].map((p) => base + p));
  assert.ok(h.calls.slice(1).every(([, options]) => options.cache === 'no-cache'));
  await h.lifecycle('activate');
  assert.deepEqual(h.deleted, ['jugyolog-app-old']);
});

test('install: 一覧の通信が失敗したら install を失敗させ、skipWaiting しない', async () => {
  const h = setup({ search: '?v=new' }); const error = new Error('offline');
  const old = new Map([[base + 'index.html', reply('old')]]);
  h.storage.set('jugyolog-app-old', old);
  h.fetch = async () => { throw error; };
  await assert.rejects(h.lifecycle('install'), (e) => e === error);
  assert.equal(h.skipped, 0); assert.equal(h.claimed, 0); assert.equal(h.data.size, 0);
  assert.deepEqual(h.deleted, []); assert.equal(h.storage.get('jugyolog-app-old'), old);
  assert.equal(h.calls[0][1].cache, 'no-store');
});

test('install: 新版のファイルが 1 つでも取得できなければ失敗し、そろった旧版を残す', async () => {
  for (const status of [null, 404, 500]) {
    const storage = new Map(); const old = setup({ search: '?v=old', storage });
    const manifest = JSON.stringify({ version: 'manifest', files: ['index.html', 'app.js'] });
    old.fetch = async (url) => url.endsWith('app-files.json') ? reply(manifest) : reply('old');
    await old.lifecycle('install'); await old.lifecycle('activate');
    const fresh = setup({ search: '?v=new', storage }); const error = new Error('offline');
    fresh.fetch = async (url) => {
      if (url.endsWith('app-files.json')) return reply(manifest);
      if (url.endsWith('app.js')) { if (status === null) throw error; return reply('failed', status); }
      return reply('new');
    };
    await assert.rejects(fresh.lifecycle('install'), (e) => status === null ? e === error : e.message.includes(String(status)));
    assert.equal(fresh.skipped, 0); assert.equal(fresh.claimed, 0); assert.deepEqual(fresh.deleted, []);
    assert.equal(storage.get('jugyolog-app-old'), old.data);
    assert.deepEqual([...old.data.keys()], [base + 'index.html', base + 'app.js']);
    old.fetch = async () => { throw error; };
    for (const path of ['index.html', 'app.js']) assert.equal((await old.request(request(path)).response).body, 'old');
  }
});

test('activate: 一覧を取れたときだけ一覧に無いものを消し、claim する', async () => {
  for (const valid of [true, false]) {
    const h = setup(); h.data.set(base + 'old.js', reply('old')); h.data.set(base + 'index.html?v=old', reply('index'));
    h.fetch = async () => valid ? reply('{"version":"abc1234","files":["index.html"]}') : reply('bad');
    await h.lifecycle('install'); await h.lifecycle('activate');
    assert.equal(h.claimed, 1); assert.equal(h.data.has(base + 'old.js'), !valid);
    assert.equal(h.data.has(base + 'index.html?v=old'), true);
  }
});

test('fetch: GET 以外・別 origin・scope 外・no-store・管理ファイルは扱わない', () => {
  const h = setup();
  for (const req of [request('x', { method: 'POST' }), request('https://firebase.example/x'), request('../x'),
    request('https://school.example/app-other/x'), request('x', { cache: 'no-store' }),
    ...['app-files.json', 'version.txt', 'sw.js'].map((file) => request(file + '?v=1'))]) {
    const event = h.request(req); assert.equal(event.response, null); assert.equal(event.work, null);
  }
  assert.equal(h.calls.length, 0);
});

test('fetch: 200 basic の写しを入れ、200 以外や basic 以外はそのまま返す', async () => {
  for (const [status, type] of [[200, 'basic'], [404, 'basic'], [500, 'basic'], [200, 'opaque']]) {
    const h = setup(); const value = reply('network', status, type); h.fetch = async () => value;
    const event = h.request(request('x.js'));
    assert.equal(await event.response, value); await event.work;
    assert.equal(h.data.has(base + 'x.js'), status === 200 && type === 'basic');
    assert.equal(h.timers.size, 0);
  }
});

test('fetch: キャッシュの容量不足でもネットの結果を返す', async () => {
  const h = setup(); h.broken = true; h.fetch = async () => reply('network');
  assert.equal((await h.request(request('x.js')).response).body, 'network');
});

test('fetch: クエリを変えて読んだ成功も、同じファイルの取り置きを更新する', async () => {
  const h = setup(); h.data.set(base + 'x.js', reply('old'));
  h.fetch = async () => reply('new');
  await h.request(request('x.js?v=new')).response;
  assert.equal(h.data.size, 1);
  h.fetch = async () => { throw new Error('offline'); };
  assert.equal((await h.request(request('x.js?v=other')).response).body, 'new');
});

test('fetch: ネット失敗はクエリを無視して取り置きを返し、両方無ければ元の失敗', async () => {
  const h = setup(); h.data.set(base + 'x.js', reply('cached'));
  assert.equal((await h.request(request('x.js?v=1')).response).body, 'cached');
  const error = new Error('network'); h.fetch = async () => { throw error; };
  await assert.rejects(h.request(request('missing.js')).response, (e) => e === error);
});

test('fetch: navigate で見つからなければ index.html、通常の要求では代用しない', async () => {
  const h = setup(); h.data.set(base + 'index.html', reply('index'));
  assert.equal((await h.request(request('other?demo=1', { mode: 'navigate' })).response).body, 'index');
  await assert.rejects(h.request(request('other')).response);
});

test('fetch: 一覧が 404 の新版でも、ネット失敗時には旧版の取り置きを返す', async () => {
  const h = setup({ search: '?v=new' });
  const old = new Map([[base + 'x.js?v=old', reply('old')], [base + 'index.html', reply('old index')]]);
  h.storage.set('jugyolog-app-old', old);
  for (const name of ['jugyolog-data', 'other']) h.storage.set(name, new Map([[base + 'data.js', reply('data')]]));
  h.fetch = async () => reply('', 404);
  await h.lifecycle('install'); await h.lifecycle('activate');
  h.fetch = async () => { throw new Error('offline'); };
  assert.equal((await h.request(request('x.js?v=new')).response).body, 'old');
  assert.equal((await h.request(request('other', { mode: 'navigate' })).response).body, 'old index');
  await assert.rejects(h.request(request('other')).response);
  await assert.rejects(h.request(request('data.js')).response);
  assert.equal(h.data.size, 0, '旧版から読んでも自分の版には書かない');
  assert.deepEqual(h.deleted, []);
  h.fetch = async () => reply('new');
  await h.request(request('x.js')).response;
  assert.equal(old.get(base + 'x.js?v=old').body, 'old', 'ネットの成功で旧版を書き換えない');
  h.fetch = async () => { throw new Error('offline'); };
  assert.equal((await h.request(request('x.js?v=next')).response).body, 'new', '自分の版を先に探す');
});

test('fetch: 5000ms の時間切れでも旧版を返し、遅いネットの成功は自分の版に書く', async () => {
  const h = setup({ search: '?v=new' });
  const old = new Map([[base + 'x.js', reply('old')]]); h.storage.set('jugyolog-app-old', old);
  let release; h.fetch = () => new Promise((resolve) => { release = resolve; });
  const event = h.request(request('x.js')); await h.timeout();
  assert.equal((await event.response).body, 'old');
  release(reply('new')); await event.work;
  assert.equal(h.data.get(base + 'x.js').body, 'new');
  assert.equal(old.get(base + 'x.js').body, 'old');
});

test('fetch: 5000ms で取り置きを返し、遅いネットの成功で更新する', async () => {
  const h = setup(); h.data.set(base + 'x.js', reply('old'));
  let release; h.fetch = () => new Promise((resolve) => { release = resolve; });
  const event = h.request(request('x.js')); await h.timeout();
  assert.equal((await event.response).body, 'old');
  release(reply('new')); await event.work;
  assert.equal(h.data.get(base + 'x.js').body, 'new');
});

test('fetch: 時間切れでも取り置きが無ければネットの成功・失敗まで待つ', async () => {
  for (const fail of [false, true]) {
    const h = setup(); let release;
    h.fetch = () => new Promise((resolve, reject) => { release = () => fail ? reject(new Error('offline')) : resolve(reply('new')); });
    const event = h.request(request('x.js')); let finished = false;
    event.response.then(() => { finished = true; }, () => { finished = true; });
    await h.timeout(); assert.equal(finished, false); release();
    if (fail) await assert.rejects(event.response); else assert.equal((await event.response).body, 'new');
    await event.work;
  }
});

test('版は自分の v を使い、無い・空は dev、不正な文字だけを - にする', async () => {
  for (const [search, version] of [['', 'dev'], ['?v=', 'dev'], ['?v=Abc.1_2-3', 'Abc.1_2-3'],
    ['?v=../x%3F%23%20', '..-x---'], ['?v=%E6%97%A5%E6%9C%AC', '--']]) {
    const h = setup({ search });
    h.fetch = async (url) => typeof url === 'string' && url.endsWith('app-files.json')
      ? reply('{"version":"別の版","files":["index.html"]}') : reply('file');
    await h.lifecycle('install'); await h.request(request('x.js')).response;
    assert.ok(h.opened.length >= 2);
    assert.ok(h.opened.every((key) => key === `jugyolog-app-${version}`));
  }
});

test('activate は全ファイルがそろったときだけ片付け、一覧が 404 や不正なら何も消さない', async () => {
  for (const [valid, response] of [[true, reply('{"version":"manifest","files":[]}')], [false, reply('', 404)], [false, reply('bad')]]) {
    const h = setup({ search: '?v=new' });
    for (const key of ['jugyolog-app-v1', 'jugyolog-app-old', 'jugyolog-data', 'other']) h.storage.set(key, new Map());
    h.data.set(base + 'extra.js', reply('extra'));
    h.fetch = async () => response;
    await h.lifecycle('install'); await h.lifecycle('activate');
    assert.deepEqual(h.deleted, valid ? ['jugyolog-app-v1', 'jugyolog-app-old'] : []);
    assert.deepEqual([...h.storage.keys()], valid ? ['jugyolog-app-new', 'jugyolog-data', 'other']
      : ['jugyolog-app-new', 'jugyolog-app-v1', 'jugyolog-app-old', 'jugyolog-data', 'other']);
    assert.equal(h.data.has(base + 'extra.js'), !valid);
    assert.equal(h.skipped, 1); assert.equal(h.claimed, 1);
  }
});

test('新しい版の install 後、古い版の遅い fetch が終わっても新しいキャッシュは変わらない', async () => {
  const storage = new Map();
  const old = setup({ search: '?v=old', storage });
  let release;
  old.fetch = () => new Promise((resolve) => { release = resolve; });
  const pending = old.request(request('index.html'));
  const fresh = setup({ search: '?v=new', storage });
  fresh.fetch = async (url) => typeof url === 'string' && url.endsWith('app-files.json')
    ? reply('{"version":"new","files":["index.html"]}') : reply('new');
  await fresh.lifecycle('install');
  release(reply('old')); await pending.response; await pending.work;
  assert.equal(storage.get('jugyolog-app-new').get(base + 'index.html').body, 'new');
  assert.equal(storage.get('jugyolog-app-old').get(base + 'index.html').body, 'old');
  fresh.fetch = async () => { throw new Error('offline'); };
  assert.equal((await fresh.request(request('index.html')).response).body, 'new');
});
