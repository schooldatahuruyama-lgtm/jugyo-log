// Cache API が使えるときと、使えないときの取り置きを確かめる
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFileCache } from '../js/file-cache.js';

function fakeCaches() {
  const stores = new Map();
  const keys = [];
  const names = [];
  return {
    stores, keys, names, broken: null,
    async open(name) {
      if (this.broken === 'open') throw new Error('使えない');
      names.push(name);
      if (!stores.has(name)) stores.set(name, new Map());
      const store = stores.get(name);
      return {
        match: async (key) => {
          if (this.broken === 'match') throw new Error('使えない');
          return store.get(key)?.clone();
        },
        put: async (key, response) => {
          if (this.broken === 'put') throw new Error('容量不足');
          keys.push(key);
          store.set(key, response.clone());
        },
        delete: async (key) => {
          if (this.broken === 'remove') throw new Error('消せない');
          return store.delete(key);
        },
      };
    },
    async delete(name) {
      if (this.broken === 'clear') throw new Error('消せない');
      return stores.delete(name);
    },
  };
}

async function checkOperations(caches) {
  const cache = createFileCache({ caches });
  const blob = new Blob(['資料'], { type: 'image/jpeg' });
  assert.equal(await cache.get('none'), null);
  await cache.put('file1', blob);
  const found = await cache.get('file1');
  assert.ok(found instanceof Blob);
  assert.equal(found.type, 'image/jpeg');
  assert.equal(await found.text(), '資料');
  await cache.remove('file1');
  assert.equal(await cache.get('file1'), null);
  await cache.put('file2', blob);
  await cache.clear();
  assert.equal(await cache.get('file2'), null);
  await cache.put('file3', blob);
  assert.equal(await (await cache.get('file3')).text(), '資料');
}

test('Cache API で取り置き・削除・全消去でき、キーはファイル ID だけ', async () => {
  const caches = fakeCaches();
  await checkOperations(caches);
  assert.ok(caches.names.every((name) => name === 'jugyolog-files-v1'));
  assert.deepEqual(caches.keys, ['https://files.jugyolog.invalid/file1', 'https://files.jugyolog.invalid/file2', 'https://files.jugyolog.invalid/file3']);
});

test('作り直しても指定した名前の Cache API から読める', async () => {
  const caches = fakeCaches();
  await createFileCache({ caches, name: 'test-files' }).put('file1', new Blob(['保存済み']));
  const cache = createFileCache({ caches, name: 'test-files' });
  assert.equal(await (await cache.get('file1')).text(), '保存済み');
  await cache.clear();
  assert.equal(caches.stores.has('test-files'), false);
});

test('caches が無くてもメモリで同じように動く', async () => {
  await checkOperations(undefined);
});

for (const broken of ['open', 'match', 'put', 'remove', 'clear']) {
  test(`${broken} が例外でも落ちず、消した資料を再び返さない`, async () => {
    const caches = fakeCaches();
    caches.broken = broken;
    await checkOperations(caches);
  });
}

test('保存後に Cache API が使えなくなっても、メモリの資料は読める', async () => {
  const caches = fakeCaches();
  const cache = createFileCache({ caches });
  await cache.put('file1', new Blob(['資料']));
  caches.broken = 'open';
  assert.equal(await (await cache.get('file1')).text(), '資料');
  await cache.remove('file1');
  caches.broken = null;
  assert.equal(await cache.get('file1'), null);
});
