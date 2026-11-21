// 資料の取得・保存と取り置きの組み合わせを確かめる
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFiles } from '../js/files.js';
import { createFileCache } from '../js/file-cache.js';
import { NetError } from '../js/errors.js';

const image = (id) => ({ id, type: 'image', fileId: `file-${id}` });
const encoded = { mime: 'image/jpeg', dataB64: 'AP+A' };

test('卒業のファイル削除は空なら通信せず、件数を返して取り置きを消す', async () => {
  const h = make(() => ({ ok: true, trashed: 1, missing: 1, skipped: 1, unknown: 0 }));
  assert.deepEqual(await h.files.trashStudents([], []), { trashed: 0, missing: 0, skipped: 0, unknown: 0 });
  assert.equal(h.calls.length, 0);
  for (const id of ['f1', 'f2', 'f3', 'keep']) await h.cache.put(id, new Blob(['見本']));
  assert.deepEqual(await h.files.trashStudents(['f1', 'f2', 'f3'], ['s26-001']), { trashed: 1, missing: 1, skipped: 1, unknown: 0 });
  assert.deepEqual(h.calls, [{ op: 'trashStudentFiles', payload: { fileIds: ['f1', 'f2', 'f3'], studentIds: ['s26-001'] } }]);
  for (const id of ['f1', 'f2', 'f3']) assert.equal(await h.cache.get(id), null);
  assert.ok(await h.cache.get('keep'));
});

test('卒業のファイル削除は失敗・不正な返事でも消した可能性のある取り置きを残さない', async () => {
  for (const response of [null, { trashed: '1', missing: 0, skipped: 0 }, { trashed: 0, missing: 0, skipped: 0, unknown: 0 }]) {
    const h = make(() => { if (response === null) throw new NetError('network'); return response; });
    await h.cache.put('f1', new Blob(['見本']));
    await assert.rejects(h.files.trashStudents(['f1'], ['s26-001']));
    assert.equal(await h.cache.get('f1'), null);
  }
});
function make(handler) {
  const calls = [];
  const cache = createFileCache({ caches: undefined });
  const gas = { call: async (op, payload) => { calls.push({ op, payload }); return handler(op, payload); } };
  return { calls, cache, files: createFiles({ gas, cache }) };
}

test('卒業のファイル削除: unknown の数を返し、古い GAS や数でない値は 0 として扱う', async () => {
  for (const unknown of [undefined, null, '1', false, {}, [], NaN, Infinity, -1, 0.5]) {
    const h = make(() => ({ trashed: 1, missing: 0, skipped: 0, unknown }));
    assert.deepEqual(await h.files.trashStudents(['f1'], ['s26-001']), { trashed: 1, missing: 0, skipped: 0, unknown: 0 });
  }
  const h = make(() => ({ trashed: 1, missing: 0, skipped: 0, unknown: 2 }));
  assert.deepEqual(await h.files.trashStudents(['f1', 'f2', 'f3'], ['s26-001']), { trashed: 1, missing: 0, skipped: 0, unknown: 2 });
  await assert.rejects(h.files.trashStudents(['f1'], ['s26-001']), { code: 'unknown' });
});

function useFileReader(t, FileReader) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'FileReader');
  Object.defineProperty(globalThis, 'FileReader', { configurable: true, writable: true, value: FileReader });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'FileReader', previous);
    else delete globalThis.FileReader;
  });
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

test('uploadStudent: 指定した項目だけを送り、元の名前と生徒 ID は送らない', async () => {
  const { files, calls } = make(() => ({ ok: true, id: 'student-file', bytes: 3, existed: true }));
  const payload = { key: 'student-key', classId: 'c1', lessonId: 'l1', mime: 'image/jpeg', dataB64: 'AQID' };
  for (let i = 0; i < 2; i++) {
    assert.deepEqual(await files.uploadStudent({ ...payload, name: '保存しない名前', studentId: 's26-002' }), { fileId: 'student-file', bytes: 3 });
  }
  assert.deepEqual(calls, [0, 1].map(() => ({ op: 'putStudentFile', payload })));
});

test('loadStudentFile: ファイル ID で取得し、取り置きがあれば GAS を呼ばない', async () => {
  const { files, calls, cache } = make(() => ({ ok: true, ...encoded }));
  const blob = await files.loadStudentFile('student-file');
  assert.equal(blob.type, 'image/jpeg');
  assert.deepEqual([...new Uint8Array(await blob.arrayBuffer())], [0, 255, 128]);
  assert.equal(await cache.get('student-file'), blob);
  assert.equal(await files.loadStudentFile('student-file'), blob);
  assert.deepEqual(calls, [{ op: 'getStudentFile', payload: { fileId: 'student-file' } }]);
});

test('trashStudent: 応答のあと取り置きを消し、trashed が false でも消す', async () => {
  for (const trashed of [true, false]) {
    const { files, calls, cache } = make(async () => {
      assert.ok(await cache.get('student-file'));
      return { ok: true, trashed };
    });
    await cache.put('student-file', new Blob(['写真']));
    assert.equal(await files.trashStudent('student-file'), trashed);
    assert.equal(await cache.get('student-file'), null);
    assert.deepEqual(calls, [{ op: 'trashStudentFile', payload: { fileId: 'student-file' } }]);
  }
});

test('生徒のファイル: 通信の例外を変えず、削除に失敗した取り置きは残す', async () => {
  for (const code of ['toobig', 'denied', 'notfound', 'network']) {
    const error = new NetError(code);
    const { files, cache } = make(() => { throw error; });
    await assert.rejects(files.uploadStudent({}), (e) => e === error);
    await assert.rejects(files.loadStudentFile('student-file'), (e) => e === error);
    await cache.put('student-file', new Blob(['写真']));
    await assert.rejects(files.trashStudent('student-file'), (e) => e === error);
    assert.ok(await cache.get('student-file'));
  }
});

test('生徒のファイル: 全消去前の取得が遅れて終わっても取り置きを戻さない', async () => {
  let reply;
  const pending = new Promise((resolve) => { reply = resolve; });
  const { files, cache } = make(() => pending);
  const loading = files.loadStudentFile('student-file');
  await new Promise((resolve) => setImmediate(resolve));
  await files.clearCache();
  reply({ ok: true, ...encoded });
  await loading;
  assert.equal(await cache.get('student-file'), null);
});


test('手書き: ASCII JSON を base64 で保存し、読み取り・取り置き・片付けを共用する', async () => {
  const text = '{"v":1,"h":400,"s":[{"c":0,"w":0,"p":[0,0,1,1]}]}';
  const dataB64 = Buffer.from(text).toString('base64');
  const { files, calls, cache } = make((op) => op === 'putStudentFile'
    ? { id: 'ink-file', bytes: text.length }
    : op === 'getStudentFile' ? { mime: 'application/json', dataB64 } : { trashed: true });
  assert.deepEqual(await files.uploadInk({ key: 'ink-test-1', classId: 'c1', lessonId: 'l1', text }), { fileId: 'ink-file', bytes: text.length });
  assert.deepEqual(calls[0], { op: 'putStudentFile', payload: { key: 'ink-test-1', classId: 'c1', lessonId: 'l1', mime: 'application/json', dataB64 } });
  assert.equal(await files.loadInk('ink-file'), text);
  assert.equal(await files.loadInk('ink-file'), text);
  assert.equal((await files.loadStudentFile('ink-file')).type, 'application/json');
  assert.equal(calls.length, 2);
  await files.trashStudent('ink-file');
  assert.equal(await cache.get('ink-file'), null);
});

test('手書き: text が関数でない Blob でも FileReader から読める', async (t) => {
  const text = '{"v":1,"h":400,"s":[]}';
  const blobs = [];
  useFileReader(t, class {
    readAsText(blob) {
      blobs.push(blob);
      queueMicrotask(() => { this.result = Buffer.from(blob.parts[0]).toString('utf8'); this.onload(); });
    }
  });
  for (const value of [undefined, null, 'not-a-function']) {
    const calls = [];
    const files = createFiles({
      gas: { call: async (op, payload) => { calls.push({ op, payload });
        return { mime: 'application/json', dataB64: Buffer.from(text).toString('base64') }; } },
      cache: createFileCache({ caches: undefined }),
      Blob: class { constructor(parts, { type }) { this.parts = parts; this.type = type; this.text = value; } },
    });
    assert.equal(await files.loadInk('test-ink'), text);
    assert.equal(await files.loadInk('test-ink'), text);
    assert.deepEqual(calls, [{ op: 'getStudentFile', payload: { fileId: 'test-ink' } }]);
    assert.equal(blobs.at(-1), blobs.at(-2));
  }
  assert.equal(blobs.length, 6);
});

test('手書き: text が関数なら FileReader を使わず、その結果と例外を返す', async (t) => {
  useFileReader(t, class { constructor() { assert.fail('FileReader は使わない'); } });
  const { files, cache } = make(() => assert.fail('通信はしない'));
  const error = new TypeError('test read error');
  const blob = { text: async () => '{"v":1,"h":400,"s":[]}' };
  await cache.put('test-ink', blob);
  assert.equal(await files.loadInk('test-ink'), '{"v":1,"h":400,"s":[]}');
  blob.text = async () => { throw error; };
  await assert.rejects(files.loadInk('test-ink'), (e) => e === error);
});

test('手書き: FileReader の失敗・中止・未対応も例外を返す', async (t) => {
  const error = new Error('test read error');
  let outcome = 'error';
  useFileReader(t, class {
    readAsText() {
      if (outcome === 'throw') throw error;
      queueMicrotask(() => {
        if (outcome === 'abort') this.onabort();
        else { this.error = error; this.onerror(); }
      });
    }
  });
  const { files, cache } = make(() => assert.fail('通信はしない'));
  await cache.put('test-ink', {});
  await assert.rejects(files.loadInk('test-ink'), (e) => e === error);
  outcome = 'throw';
  await assert.rejects(files.loadInk('test-ink'), (e) => e === error);
  outcome = 'abort';
  await assert.rejects(files.loadInk('test-ink'), Error);
  delete globalThis.FileReader;
  await assert.rejects(files.loadInk('test-ink'), ReferenceError);
});

test('手書き: 保存・読み取りの通信失敗を返す', async () => {
  const error = new NetError('network');
  const { files } = make(() => { throw error; });
  await assert.rejects(files.uploadInk({ key: 'ink-test-1', classId: 'c1', lessonId: 'l1', text: '{}' }), (e) => e === error);
  await assert.rejects(files.loadInk('file'), (e) => e === error);
});
