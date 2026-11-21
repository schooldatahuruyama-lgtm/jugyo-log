import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOfflineStore } from '../js/offline-store.js';

function fakeCaches() {
  const stores = new Map();
  const h = {
    stores, broken: null,
    async open(name) {
      if (h.broken === 'open') throw new Error('使えない');
      if (!stores.has(name)) stores.set(name, new Map());
      const data = stores.get(name);
      const url = (key) => typeof key === 'string' ? key : key.url;
      return {
        async match(key) { if (h.broken === 'match') throw new Error(); return data.get(url(key))?.clone(); },
        async put(key, value) { if (h.broken === 'put') throw new Error(); data.set(url(key), value.clone()); },
        async keys() { if (h.broken === 'keys') throw new Error(); return [...data.keys()].map((key) => ({ url: key })); },
        async delete(key) { if (h.broken === 'remove') throw new Error(); return data.delete(url(key)); },
      };
    },
    async delete(name) { if (h.broken === 'clear') throw new Error(); return stores.delete(name); },
  };
  return h;
}

async function operations(caches) {
  const store = createOfflineStore({ caches });
  assert.equal(await store.get('u1', 'missing'), null);
  await store.put('u1', 'p', { memo: '見本' });
  await store.put('u1', 'empty', null);
  await store.put('u2', 'p', 2);
  assert.deepEqual(await store.get('u1', 'p'), { value: { memo: '見本' } });
  assert.deepEqual(await store.get('u1', 'empty'), { value: null });
  await store.removeWhere('u1', (key) => key === 'p');
  assert.equal(await store.get('u1', 'p'), null);
  assert.deepEqual(await store.get('u2', 'p'), { value: 2 });
  await store.clear();
  assert.equal(await store.get('u1', 'empty'), null);
  assert.equal(await store.get('u2', 'p'), null);
  await store.put('u1', 'again', 3);
  assert.deepEqual(await store.get('u1', 'again'), { value: 3 });
}

test('Cache API とメモリで、保存・null・削除・全 scope の消去ができる', async () => {
  await operations(fakeCaches()); await operations(undefined);
});

for (const broken of ['open', 'match', 'put', 'keys', 'remove', 'clear']) {
  test(`Cache API の ${broken} が投げても続け、消した値を返さない`, async () => {
    const caches = fakeCaches(); caches.broken = broken;
    await operations(caches);
  });
}

test('scope とキーを encode し、別のインスタンスから読み、削除できる', async () => {
  const caches = fakeCaches();
  await createOfflineStore({ caches, name: 'test-data' }).put('u/1', 'records/c1?shallow', null);
  const data = caches.stores.get('test-data');
  assert.deepEqual([...data.keys()], ['https://data.jugyolog.invalid/u%2F1/records%2Fc1%3Fshallow']);
  assert.equal(await [...data.values()][0].clone().text(), '{"v":null}');
  const store = createOfflineStore({ caches, name: 'test-data' });
  assert.deepEqual(await store.get('u/1', 'records/c1?shallow'), { value: null });
  await store.removeWhere('u/1', (key) => key === 'records/c1?shallow');
  assert.equal(data.size, 0);
});

test('JSON でない・v が無い・本文が読めない値は無いものとして扱う', async () => {
  for (const raw of ['not json', '{}', 'null', '[]', '1']) {
    const caches = fakeCaches(); const cache = await caches.open('jugyolog-data-v1');
    await cache.put('https://data.jugyolog.invalid/u1/p', new Response(raw));
    assert.equal(await createOfflineStore({ caches }).get('u1', 'p'), null);
  }
  const caches = { open: async () => ({ match: async () => ({ text: async () => { throw new Error(); } }) }) };
  assert.equal(await createOfflineStore({ caches }).get('u1', 'p'), null);
});

test('保存不能な値で投げず、メモリの値も呼び出し元の変更に影響されない', async () => {
  const store = createOfflineStore({}); const value = { n: 1 };
  await store.put('u1', 'p', value); value.n = 2;
  const found = await store.get('u1', 'p'); found.value.n = 3;
  assert.deepEqual(await store.get('u1', 'p'), { value: { n: 1 } });
  const circular = {}; circular.self = circular;
  await store.put('u1', 'bad', circular);
  assert.equal(await store.get('u1', 'bad'), null);
});

test('保存・消去を呼び出した順に終え、消去後に古い保存を戻さない', async () => {
  const store = createOfflineStore({ caches: fakeCaches() });
  const work = [store.put('u1', 'p', 1), store.put('u1', 'p', 2), store.clear(), store.get('u1', 'p')];
  assert.equal((await Promise.all(work))[3], null);
});
