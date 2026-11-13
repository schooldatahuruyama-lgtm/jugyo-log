import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addMaterialFlow, removeMaterialFlow } from '../js/material-flow.js';

function addition() {
  return {
    key: 'upload-key', materialId: 'material-a', kind: 'board', type: 'image',
    name: '板書', mime: 'image/jpeg', dataB64: 'AAAA', thumb: 'data:image/jpeg;base64,AAAA',
    targets: [{ classId: 'class-a', lessonId: 'lesson-a', order: 2 },
      { classId: 'class-b', lessonId: 'lesson-b', order: 4 }], now: 123,
  };
}

test('addMaterialFlow: アップロードを待ってから、返された ID と大きさで資料を登録する', async () => {
  const args = addition();
  const calls = [];
  const files = { async upload(value) {
    calls.push(['upload', value]);
    await Promise.resolve();
    calls.push(['uploaded']);
    return { fileId: 'file-a', bytes: 3 };
  } };
  const repo = { async addMaterial(...values) { calls.push(['add', ...values]); } };
  assert.deepEqual(await addMaterialFlow({ ...args, files, repo }), { fileId: 'file-a' });
  assert.deepEqual(calls, [
    ['upload', { key: args.key, mime: args.mime, name: args.name, dataB64: args.dataB64 }],
    ['uploaded'],
    ['add', args.targets, args.materialId,
      { kind: 'board', type: 'image', fileId: 'file-a', name: '板書', bytes: 3 }, args.thumb, args.now],
  ]);
  assert.equal(calls[2][1], args.targets);
});

test('addMaterialFlow: アップロードに失敗したら資料を登録せず、同じ例外を返す', async () => {
  const error = new Error('送れませんでした');
  const files = { async upload() { throw error; } };
  const repo = { async addMaterial() { assert.fail('登録してはいけない'); } };
  await assert.rejects(addMaterialFlow({ ...addition(), files, repo }), (e) => e === error);
});

test('addMaterialFlow: 登録の応答が失われても、同じキーと資料 ID でやり直す', async () => {
  const args = addition();
  const error = new Error('応答がありません');
  const keys = [];
  const ids = [];
  const stored = new Map();
  const files = { async upload({ key }) { keys.push(key); return { fileId: 'file-a', bytes: 3 }; } };
  const repo = { async addMaterial(targets, id, material) {
    ids.push(id);
    stored.set(id, material);
    if (ids.length === 1) throw error;
  } };
  await assert.rejects(addMaterialFlow({ ...args, files, repo }), (e) => e === error);
  assert.deepEqual(await addMaterialFlow({ ...args, files, repo }), { fileId: 'file-a' });
  assert.deepEqual(keys, [args.key, args.key]);
  assert.deepEqual(ids, [args.materialId, args.materialId]);
  assert.equal(stored.size, 1);
});

test('addMaterialFlow: サムネイルのない PDF もそのまま登録する', async () => {
  const args = { ...addition(), kind: 'handout', type: 'pdf', name: '資料', mime: 'application/pdf', thumb: null };
  const files = { async upload() { return { fileId: 'file-pdf', bytes: 100 }; } };
  const repo = { async addMaterial(targets, id, material, thumb) {
    assert.equal(thumb, null);
    assert.deepEqual(material, { kind: 'handout', type: 'pdf', name: '資料', fileId: 'file-pdf', bytes: 100 });
  } };
  await addMaterialFlow({ ...args, files, repo });
});

function removal() {
  return { classId: 'class-a', lessonId: 'lesson-a', material: { id: 'material-a', fileId: 'file-a' }, now: 456 };
}

test('removeMaterialFlow: この授業から外してから参照を数え、最後ならファイルを消す', async () => {
  const args = removal();
  const calls = [];
  const all = { 'class-a': { 'lesson-a': { materials: { 'material-a': args.material } } } };
  const repo = {
    async removeMaterial(...values) {
      calls.push(['remove', ...values]);
      await Promise.resolve();
      delete all['class-a']['lesson-a'].materials['material-a'];
    },
    async listAllLessons() { calls.push(['list']); return all; },
  };
  const files = { async trash(id) { calls.push(['trash', id]); } };
  assert.deepEqual(await removeMaterialFlow({ ...args, repo, files }), { trashed: true });
  assert.deepEqual(calls, [['remove', args.classId, args.lessonId, args.material.id, args.now], ['list'], ['trash', 'file-a']]);
});

test('removeMaterialFlow: 別の授業から参照されているファイルは消さない', async () => {
  const trashIds = [];
  const repo = {
    async removeMaterial() {},
    async listAllLessons() { return { 'class-b': { 'lesson-b': { materials: { other: { fileId: 'file-a' } } } } }; },
  };
  const files = { async trash(id) { trashIds.push(id); } };
  assert.deepEqual(await removeMaterialFlow({ ...removal(), repo, files }), { trashed: false });
  assert.equal(trashIds.length, 0);
});

test('removeMaterialFlow: 別のファイルの参照だけなら、対象ファイルを消す', async () => {
  const trashIds = [];
  const repo = {
    async removeMaterial() {},
    async listAllLessons() { return { 'class-b': { 'lesson-b': { materials: { other: { fileId: 'file-b' } } } } }; },
  };
  const files = { async trash(id) { trashIds.push(id); } };
  assert.deepEqual(await removeMaterialFlow({ ...removal(), repo, files }), { trashed: true });
  assert.equal(trashIds.length, 1);
  assert.equal(trashIds[0], 'file-a');
});

test('removeMaterialFlow: 参照を読めなければファイルを消さず、例外にもならない', async () => {
  const trashIds = [];
  const repo = { async removeMaterial() {}, async listAllLessons() { throw new Error('読めません'); } };
  const files = { async trash(id) { trashIds.push(id); } };
  assert.deepEqual(await removeMaterialFlow({ ...removal(), repo, files }), { trashed: false });
  assert.equal(trashIds.length, 0);
});

test('removeMaterialFlow: ゴミ箱への移動に失敗しても例外にならない', async () => {
  const repo = { async removeMaterial() {}, async listAllLessons() { return {}; } };
  const files = { async trash() { throw new Error('消せません'); } };
  assert.deepEqual(await removeMaterialFlow({ ...removal(), repo, files }), { trashed: false });
});

test('removeMaterialFlow: 授業から外せなければ例外を返し、その後の処理をしない', async () => {
  const error = new Error('外せません');
  const calls = [];
  const repo = {
    async removeMaterial() { throw error; },
    async listAllLessons() { calls.push(['list']); return {}; },
  };
  const files = { async trash(id) { calls.push(['trash', id]); } };
  await assert.rejects(removeMaterialFlow({ ...removal(), repo, files }), (e) => e === error);
  assert.equal(calls.length, 0);
});
