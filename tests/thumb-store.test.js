// 小さい画像の取り置き、更新時刻の照合、同時読み取りを確かめる。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createThumbStore } from '../js/thumb-store.js';
import { createFileCache } from '../js/file-cache.js';

const lesson = { classId: 'class1', id: 'lesson1', updatedAt: 1000, materials: { material1: { type: 'image' } } };
const thumbs = { material1: 'data:image/jpeg;base64,AAAA' };
const key = 'thumbs-class1-lesson1';

function deferred() {
  let resolve;
  const promise = new Promise((yes) => { resolve = yes; });
  return { promise, resolve };
}

function setup() {
  const entries = new Map();
  const reads = [];
  const writes = [];
  const calls = [];
  const cache = {
    async get(id) { reads.push(id); return entries.get(id) ?? null; },
    async put(id, blob) { writes.push([id, blob]); entries.set(id, blob); },
  };
  const repo = { async getThumbs(...args) { calls.push(args); return thumbs; } };
  return { entries, reads, writes, calls, cache, repo };
}

test('thumb-store: 資料なし・null・配列などなら、通信も取り置きの読み取りもしない', async () => {
  const h = setup();
  const store = createThumbStore(h);
  for (const materials of [undefined, null, {}, [], [{ type: 'image' }], '不正', 3]) {
    assert.deepEqual(await store.load({ ...lesson, materials }), {});
  }
  assert.deepEqual(h.calls, []);
  assert.deepEqual(h.reads, []);
});

test('thumb-store: 最初に Blob を取り置き、同じ updatedAt なら通信せず、変われば読み直す', async () => {
  const h = setup();
  const store = createThumbStore(h);
  assert.deepEqual(await store.load(lesson), thumbs);
  assert.deepEqual(h.calls, [['class1', 'lesson1']]);
  assert.equal(h.writes[0][0], key);
  assert.ok(h.writes[0][1] instanceof Blob);
  assert.deepEqual(JSON.parse(await h.writes[0][1].text()), { updatedAt: 1000, thumbs });
  assert.deepEqual(await store.load({ ...lesson }), thumbs);
  assert.equal(h.calls.length, 1);
  assert.deepEqual(await store.load({ ...lesson, updatedAt: 2000 }), thumbs);
  assert.equal(h.calls.length, 2);
  assert.equal(h.writes.length, 2);
  assert.equal(JSON.parse(await h.writes[1][1].text()).updatedAt, 2000);
});

test('thumb-store: 同じ授業の同時読み取りは同じ Promise で、通信も取り置きも 1 回', async () => {
  const h = setup();
  let release;
  const response = new Promise((resolve) => { release = resolve; });
  h.repo.getThumbs = async (...args) => { h.calls.push(args); return response; };
  const store = createThumbStore(h);
  const first = store.load(lesson);
  const second = store.load({ ...lesson });
  assert.equal(first, second);
  release(thumbs);
  assert.deepEqual(await Promise.all([first, second]), [thumbs, thumbs]);
  assert.equal(h.calls.length, 1);
  assert.equal(h.writes.length, 1);
});

test('thumb-store: 読み取り中に clear したら、届いた画像を返しても取り置かない', async () => {
  const h = setup();
  const reading = deferred();
  const response = deferred();
  h.repo.getThumbs = (...args) => { h.calls.push(args); reading.resolve(); return response.promise; };
  const store = createThumbStore(h);
  const request = store.load(lesson);
  await reading.promise;
  assert.equal(store.clear(), undefined);
  response.resolve(thumbs);
  assert.deepEqual(await request, thumbs);
  assert.deepEqual(h.calls, [['class1', 'lesson1']]);
  assert.deepEqual(h.writes, []);
  assert.equal(h.entries.size, 0);
});

test('thumb-store: clear を続けて呼んだあとも、同じ授業を新しく読み取り取り置く', async () => {
  const h = setup();
  const readings = [deferred(), deferred()];
  const responses = [deferred(), deferred()];
  const newer = { material1: 'data:image/jpeg;base64,BBBB' };
  h.repo.getThumbs = (...args) => {
    const index = h.calls.length;
    h.calls.push(args);
    readings[index].resolve();
    return responses[index].promise;
  };
  const store = createThumbStore(h);
  const first = store.load(lesson);
  await readings[0].promise;
  store.clear();
  store.clear();
  const second = store.load(lesson);
  assert.notEqual(first, second);
  await readings[1].promise;
  responses[0].resolve(thumbs);
  assert.deepEqual(await first, thumbs);
  assert.deepEqual(h.writes, []);
  assert.equal(store.load(lesson), second);
  responses[1].resolve(newer);
  assert.deepEqual(await second, newer);
  assert.deepEqual(h.calls, [['class1', 'lesson1'], ['class1', 'lesson1']]);
  assert.equal(h.writes.length, 1);
  assert.deepEqual(JSON.parse(await h.entries.get(key).text()), { updatedAt: 1000, thumbs: newer });
});

test('thumb-store: clear 前に頼んで順番を待っていた読み取りも、画像を取り置かない', async () => {
  const h = setup();
  const reading = deferred();
  const response = deferred();
  h.repo.getThumbs = (...args) => { h.calls.push(args); reading.resolve(); return response.promise; };
  const store = createThumbStore(h);
  const first = store.load(lesson);
  const second = store.load({ ...lesson, updatedAt: 2000 });
  await reading.promise;
  store.clear();
  response.resolve(thumbs);
  assert.deepEqual(await Promise.all([first, second]), [thumbs, thumbs]);
  assert.equal(h.calls.length, 2);
  assert.deepEqual(h.writes, []);
});

test('thumb-store: 別のクラス・授業の同時読み取りは、それぞれを取得する', async () => {
  const h = setup();
  const store = createThumbStore(h);
  await Promise.all([store.load(lesson), store.load({ ...lesson, classId: 'class2' }), store.load({ ...lesson, id: 'lesson2' })]);
  assert.equal(h.calls.length, 3);
  assert.deepEqual([...h.entries.keys()].sort(), ['thumbs-class1-lesson1', 'thumbs-class1-lesson2', 'thumbs-class2-lesson1']);
});

test('thumb-store: 取得中に更新時刻が変わったら、更新後を読み直して取り置く', async () => {
  const h = setup();
  let release;
  const response = new Promise((resolve) => { release = resolve; });
  const newer = { material1: 'data:image/jpeg;base64,BBBB' };
  h.repo.getThumbs = async (...args) => {
    h.calls.push(args);
    return h.calls.length === 1 ? response : newer;
  };
  const store = createThumbStore(h);
  const first = store.load(lesson);
  const second = store.load({ ...lesson, updatedAt: 2000 });
  assert.notEqual(first, second);
  assert.equal(second, store.load({ ...lesson, updatedAt: 2000 }));
  release(thumbs);
  assert.deepEqual(await first, thumbs);
  assert.deepEqual(await second, newer);
  assert.equal(h.calls.length, 2);
  assert.deepEqual(JSON.parse(await h.entries.get(key).text()), { updatedAt: 2000, thumbs: newer });
});

test('thumb-store: 更新時刻がない授業でも、初回の画像取得を止めない', async () => {
  const h = setup();
  assert.deepEqual(await createThumbStore(h).load({ ...lesson, updatedAt: undefined }), thumbs);
  assert.equal(h.calls.length, 1);
});

test('thumb-store: JSON や thumbs の形が不正な取り置きは無視して読み直す', async () => {
  const invalid = ['{', 'null', '[]', '1', ...[undefined, null, [], '文字', 3, { material1: 3 }]
    .map((value) => JSON.stringify({ updatedAt: 1000, thumbs: value }))];
  for (const text of invalid) {
    const h = setup();
    h.entries.set(key, new Blob([text]));
    assert.deepEqual(await createThumbStore(h).load(lesson), thumbs);
    assert.equal(h.calls.length, 1);
    assert.equal(h.writes.length, 1);
  }
});

test('thumb-store: 空の thumbs は有効な取り置きとして返す', async () => {
  const h = setup();
  h.entries.set(key, new Blob([JSON.stringify({ updatedAt: 1000, thumbs: {} })]));
  assert.deepEqual(await createThumbStore(h).load(lesson), {});
  assert.equal(h.calls.length, 0);
});

for (const failing of ['get', 'put', 'text', 'Blob']) {
  test(`thumb-store: ${failing} が例外でも通信の結果を返す`, async () => {
    const h = setup();
    const fail = () => { throw new Error('取り置きを使えません'); };
    if (failing === 'get' || failing === 'put') h.cache[failing] = fail;
    if (failing === 'text') h.entries.set(key, { text: fail });
    if (failing === 'Blob') h.Blob = class { constructor() { fail(); } };
    assert.deepEqual(await createThumbStore(h).load(lesson), thumbs);
    assert.equal(h.calls.length, 1);
  });
}

test('thumb-store: 通信の例外はそのまま返し、次に頼まれたら読み直す', async () => {
  const h = setup();
  const error = new Error('読めません');
  let count = 0;
  h.repo.getThumbs = async () => { if (++count === 1) throw error; return thumbs; };
  const store = createThumbStore(h);
  const first = store.load(lesson);
  assert.equal(first, store.load(lesson));
  await assert.rejects(first, (value) => value === error);
  assert.equal(h.writes.length, 0);
  assert.deepEqual(await store.load(lesson), thumbs);
  assert.equal(count, 2);
});

test('thumb-store: createFileCache と組み合わせ、作り直した store でも取り置きを使う', async () => {
  const h = setup();
  h.cache = createFileCache({ caches: undefined });
  await createThumbStore(h).load(lesson);
  assert.deepEqual(await createThumbStore(h).load(lesson), thumbs);
  assert.equal(h.calls.length, 1);
});
