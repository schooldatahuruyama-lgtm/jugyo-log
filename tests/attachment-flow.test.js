// 添付の登録・削除の順番と、応答が失われたときのやり直しを確かめる。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addAttachmentFlow, removeAttachmentFlow } from '../js/attachment-flow.js';
import { NetError } from '../js/errors.js';

function addition() {
  return { classId: 'c1', lessonId: 'l1', studentId: 's26-001', slot: 'a1', key: 'student-key',
    type: 'image', mime: 'image/jpeg', dataB64: 'AQID', thumb: 'data:image/jpeg;base64,AQID', now: 100 };
}

test('addAttachmentFlow: 保存が終わってから、返された ID と大きさで目録を登録する', async () => {
  const args = addition();
  const calls = [];
  const files = { async uploadStudent(value) {
    calls.push(['upload', value]);
    await Promise.resolve();
    calls.push(['uploaded']);
    return { fileId: 'file-a', bytes: 3 };
  } };
  const repo = { async addAttachment(...values) { calls.push(['add', ...values]); } };
  assert.deepEqual(await addAttachmentFlow({ ...args, files, repo }), { fileId: 'file-a' });
  assert.deepEqual(calls, [
    ['upload', { key: args.key, classId: args.classId, lessonId: args.lessonId, mime: args.mime, dataB64: args.dataB64 }],
    ['uploaded'], ['add', 'c1', 'l1', 's26-001', 'a1', { type: 'image', fileId: 'file-a', bytes: 3 }, args.thumb, 100],
  ]);
});

test('addAttachmentFlow: 保存に失敗したら登録せず、NetError をそのまま返す', async () => {
  for (const code of ['toobig', 'denied', 'notfound', 'network']) {
    const error = new NetError(code);
    const files = { async uploadStudent() { throw error; } };
    const repo = { async addAttachment() { assert.fail('登録してはいけない'); } };
    await assert.rejects(addAttachmentFlow({ ...addition(), files, repo }), (e) => e === error);
  }
});

test('addAttachmentFlow: 登録の応答を失っても同じキーと置き場所でやり直し、1 個だけ残る', async () => {
  const args = addition();
  const error = new NetError('network');
  const keys = [];
  const slots = [];
  const stored = new Map();
  const files = { async uploadStudent({ key }) { keys.push(key); return { fileId: 'file-a', bytes: 3 }; } };
  const repo = { async addAttachment(c, l, s, slot, item) {
    slots.push(slot);
    stored.set(slot, item);
    if (slots.length === 1) throw error;
  } };
  await assert.rejects(addAttachmentFlow({ ...args, repo, files }), (e) => e === error);
  assert.deepEqual(await addAttachmentFlow({ ...args, repo, files }), { fileId: 'file-a' });
  assert.deepEqual(keys, [args.key, args.key]);
  assert.deepEqual(slots, [args.slot, args.slot]);
  assert.equal(stored.size, 1);
});

test('addAttachmentFlow: 小さい画像がない PDF も登録できる', async () => {
  const files = { async uploadStudent() { return { fileId: 'file-pdf', bytes: 100 }; } };
  const repo = { async addAttachment(c, l, s, slot, item, thumb) {
    assert.deepEqual(item, { type: 'pdf', fileId: 'file-pdf', bytes: 100 });
    assert.equal(thumb, null);
  } };
  await addAttachmentFlow({ ...addition(), type: 'pdf', mime: 'application/pdf', thumb: null, files, repo });
});

const removal = () => ({ classId: 'c1', lessonId: 'l1', studentId: 's26-001', attachment: { slot: 'a1', fileId: 'file-a' } });

test('removeAttachmentFlow: 目録から外し終わってから、ファイルをゴミ箱に入れる', async () => {
  const calls = [];
  const repo = { async removeAttachment(...values) {
    calls.push(['remove', ...values]);
    await Promise.resolve();
    calls.push(['removed']);
  } };
  const files = { async trashStudent(id) { calls.push(['trash', id]); return true; } };
  assert.deepEqual(await removeAttachmentFlow({ ...removal(), repo, files }), { trashed: true });
  assert.deepEqual(calls, [['remove', 'c1', 'l1', 's26-001', 'a1'], ['removed'], ['trash', 'file-a']]);
});

test('removeAttachmentFlow: ゴミ箱への移動の失敗と false は、例外にせず false を返す', async () => {
  const repo = { async removeAttachment() {} };
  for (const trashStudent of [async () => false, async () => { throw new NetError('network'); }]) {
    assert.deepEqual(await removeAttachmentFlow({ ...removal(), repo, files: { trashStudent } }), { trashed: false });
  }
});

test('removeAttachmentFlow: 目録から外せなければ例外をそのまま返し、ファイルを消さない', async () => {
  const error = new NetError('denied');
  const repo = { async removeAttachment() { throw error; } };
  const files = { async trashStudent() { assert.fail('消してはいけない'); } };
  await assert.rejects(removeAttachmentFlow({ ...removal(), repo, files }), (e) => e === error);
});
