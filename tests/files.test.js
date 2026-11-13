// 資料の取得・保存と取り置きの組み合わせを確かめる
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFiles } from '../js/files.js';
import { createFileCache } from '../js/file-cache.js';
import { NetError } from '../js/errors.js';

const image = (id) => ({ id, type: 'image', fileId: `file-${id}` });
const encoded = { mime: 'image/jpeg', dataB64: 'AP+A' };
function make(handler) {
  const calls = [];
  const cache = createFileCache({ caches: undefined });
  const gas = { call: async (op, payload) => { calls.push({ op, payload }); return handler(op, payload); } };
  return { calls, cache, files: createFiles({ gas, cache }) };
}

test('画像は取り置きにない 3 個だけ頼み、missing と PDF を結果に入れない', async () => {
  const { files, calls, cache } = make(() => ({ ok: true, files: { m3: encoded, m4: encoded }, missing: ['m5'] }));
  const cached = new Blob(['保存済み'], { type: 'image/jpeg' });
  await cache.put('file-m1', cached);
  await cache.put('file-m2', cached);
  const result = await files.loadImages('c1', 'l1', [1, 2, 3, 4, 5].map((n) => image(`m${n}`)).concat({ id: 'pdf1', type: 'pdf', fileId: 'pdf-file' }));
  assert.deepEqual(calls, [{ op: 'getMaterials', payload: { classId: 'c1', lessonId: 'l1', ids: ['m3', 'm4', 'm5'] } }]);
  assert.deepEqual(Object.keys(result).sort(), ['m1', 'm2', 'm3', 'm4']);
  assert.equal(await result.m1.text(), '保存済み');
  assert.equal(result.m3.type, 'image/jpeg');
  assert.deepEqual([...new Uint8Array(await result.m3.arrayBuffer())], [0, 255, 128]);
  assert.equal((await cache.get('file-m4')).type, 'image/jpeg');
  assert.equal(await cache.get('file-m5'), null);
});

test('画像が 13 個なら 12 個と 1 個に分け、全部取り置きにあれば通信しない', async () => {
  const { files, calls } = make((_, { ids }) => ({ ok: true, files: Object.fromEntries(ids.map((id) => [id, encoded])), missing: [] }));
  const materials = Array.from({ length: 13 }, (_, i) => image(`m${i}`));
  assert.equal(Object.keys(await files.loadImages('c1', 'l1', materials)).length, 13);
  assert.deepEqual(calls.map((c) => c.payload.ids.length), [12, 1]);
  assert.equal(Object.keys(await files.loadImages('c1', 'l1', materials)).length, 13);
  assert.equal(calls.length, 2);
  assert.deepEqual(await files.loadImages('c1', 'l1', []), {});
});

test('loadFile は資料 ID で頼んで Blob を取り置きし、2 回目は通信しない', async () => {
  const { files, calls, cache } = make(() => ({ ok: true, mime: 'application/pdf', name: '資料', dataB64: 'AQID' }));
  const material = { id: 'm1', type: 'pdf', fileId: 'file1' };
  const blob = await files.loadFile('c1', 'l1', material);
  assert.equal(blob.type, 'application/pdf');
  assert.deepEqual([...new Uint8Array(await blob.arrayBuffer())], [1, 2, 3]);
  assert.deepEqual(calls, [{ op: 'getFile', payload: { classId: 'c1', lessonId: 'l1', materialId: 'm1' } }]);
  assert.equal((await cache.get('file1')).size, 3);
  assert.equal((await files.loadFile('c1', 'l1', material)).size, 3);
  assert.equal(calls.length, 1);
});

test('upload は指定した 4 項目だけ渡し、同じ key の再送でも返る fileId は同じ', async () => {
  const { files, calls } = make(() => ({ ok: true, id: 'file1', bytes: 3, existed: true }));
  const payload = { key: 'test-key', mime: 'image/jpeg', name: '板書', dataB64: 'AQID' };
  for (let i = 0; i < 2; i++) assert.deepEqual(await files.upload(payload), { fileId: 'file1', bytes: 3 });
  assert.deepEqual(calls, [0, 1].map(() => ({ op: 'putMaterial', payload })));
});

test('trashFile が終わったあと取り置きを消し、失敗したら残す', async () => {
  let fail = false;
  const { files, cache, calls } = make(async () => {
    assert.ok(await cache.get('file1'));
    if (fail) throw new NetError('network');
    return { ok: true, trashed: true };
  });
  const blob = new Blob(['資料']);
  await cache.put('file1', blob);
  await files.trash('file1');
  assert.equal(await cache.get('file1'), null);
  assert.deepEqual(calls[0], { op: 'trashFile', payload: { fileId: 'file1' } });
  await cache.put('file1', blob);
  fail = true;
  await assert.rejects(files.trash('file1'), (e) => e.code === 'network');
  assert.ok(await cache.get('file1'));
  await files.clearCache();
  assert.equal(await cache.get('file1'), null);
});

test('変換には渡された atob と Blob を使う', async () => {
  const decoded = [];
  const blobs = [];
  const files = createFiles({
    gas: { call: async () => ({ ok: true, ...encoded }) }, cache: createFileCache({}),
    atob: (text) => { decoded.push(text); return '\x00\xff\x80'; },
    Blob: class extends Blob { constructor(parts, options) { super(parts, options); blobs.push(options); } },
  });
  await files.loadFile('c1', 'l1', image('m1'));
  assert.deepEqual(decoded, ['AP+A']);
  assert.deepEqual(blobs, [{ type: 'image/jpeg' }]);
});

test('全消去の前に始めた取得が遅れて終わっても、取り置きを復活させない', async () => {
  let reply;
  const pending = new Promise((resolve) => { reply = resolve; });
  const { files, cache } = make(() => pending);
  const loading = files.loadFile('c1', 'l1', image('m1'));
  await new Promise((resolve) => setImmediate(resolve));
  await files.clearCache();
  reply({ ok: true, ...encoded });
  await loading;
  assert.equal(await cache.get('file-m1'), null);
});
