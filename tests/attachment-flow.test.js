// 添付の登録・削除の順番と、応答が失われたときのやり直しを確かめる。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addAttachmentFlow, settleAttachmentFlow, removeAttachmentFlow } from '../js/attachment-flow.js';
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
  assert.deepEqual(await addAttachmentFlow({ ...args, files, repo }), { fileId: 'file-a', cancelled: false });
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
  assert.deepEqual(await addAttachmentFlow({ ...args, repo, files }), { fileId: 'file-a', cancelled: false });
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

test('addAttachmentFlow: 保存中に取りやめたら登録せず、片付けの失敗も例外にしない', async () => {
  for (const failTrash of [false, true]) {
    let cancelled = false;
    const calls = [];
    const files = {
      async uploadStudent() { calls.push('upload'); cancelled = true; return { fileId: 'file-a', bytes: 3 }; },
      async trashStudent(id) { calls.push(['trash', id]); if (failTrash) throw new NetError('network'); },
    };
    const repo = { async addAttachment() { assert.fail('取りやめたので登録してはいけない'); } };
    assert.deepEqual(await addAttachmentFlow({ ...addition(), repo, files, isCancelled: () => cancelled }),
      { fileId: 'file-a', cancelled: true });
    assert.deepEqual(calls, ['upload', ['trash', 'file-a']]);
  }
});

test('addAttachmentFlow: 登録が denied ならファイルを片付け、slot-taken を返す', async () => {
  for (const failTrash of [false, true]) {
    const calls = [];
    const files = {
      async uploadStudent() { return { fileId: 'file-a', bytes: 3 }; },
      async trashStudent(id) { calls.push(id); if (failTrash) throw new NetError('network'); },
    };
    const repo = { async addAttachment() { throw new NetError('denied'); } };
    await assert.rejects(addAttachmentFlow({ ...addition(), repo, files }),
      (error) => error instanceof NetError && error.code === 'slot-taken');
    assert.deepEqual(calls, ['file-a']);
  }
});

test('addAttachmentFlow: 登録の通信失敗はそのまま返し、ファイルを片付けない', async () => {
  const error = new NetError('network');
  let trashed = false;
  const files = {
    async uploadStudent() { return { fileId: 'file-a', bytes: 3 }; },
    async trashStudent() { trashed = true; },
  };
  const repo = { async addAttachment() { throw error; } };
  await assert.rejects(addAttachmentFlow({ ...addition(), repo, files }), (e) => e === error);
  assert.equal(trashed, false);
});

test('settleAttachmentFlow: fileId がない・文字でないときも目録だけを読む', async () => {
  const calls = [];
  const attachments = [{ slot: 'a1', fileId: 'file-a' }];
  const repo = {
    async getRecord(...args) { calls.push(['get', ...args]); return { attachments }; },
    async removeAttachment() { calls.push('remove'); assert.fail('目録を消してはいけない'); },
  };
  const files = { async trashStudent() { calls.push('trash'); } };
  for (const fileId of [undefined, null, '', 12, false, {}, []]) {
    calls.length = 0;
    assert.deepEqual(await settleAttachmentFlow({ ...addition(), repo, files, fileId }), { saved: false, attachments });
    assert.deepEqual(calls, [['get', 'c1', 'l1', 's26-001']]);
  }
});

test('settleAttachmentFlow: 同じ fileId があれば、置き場所によらず何も消さず saved: true', async () => {
  for (const slot of ['a1', 'a2']) {
    const calls = [];
    const attachments = [{ slot, fileId: 'file-a' }, { slot: 'a3', fileId: 'other' }];
    const repo = {
      async getRecord(...args) { calls.push(['get', ...args]); return { attachments }; },
      async removeAttachment() { calls.push('remove'); assert.fail('目録を消してはいけない'); },
    };
    const files = { async trashStudent(id) { calls.push(['trash', id]); } };
    assert.deepEqual(await settleAttachmentFlow({ ...addition(), repo, files, fileId: 'file-a' }), { saved: true, attachments });
    assert.deepEqual(calls, [['get', 'c1', 'l1', 's26-001']]);
  }
});

test('settleAttachmentFlow: 目録にない fileId は、読み終えてからファイルだけ片付ける', async () => {
  for (const attachments of [[{ slot: 'a1', fileId: 'other' }], []]) {
    const calls = [];
    const repo = {
      async getRecord() { calls.push('get'); await Promise.resolve(); calls.push('got'); return { attachments }; },
      async removeAttachment() { calls.push('remove'); assert.fail('目録を消してはいけない'); },
    };
    const files = { async trashStudent(id) { calls.push(['trash', id]); } };
    assert.deepEqual(await settleAttachmentFlow({ ...addition(), repo, files, fileId: 'file-a' }), { saved: false, attachments });
    assert.deepEqual(calls, ['get', 'got', ['trash', 'file-a']]);
  }
});

test('settleAttachmentFlow: 読み取りに失敗したら例外をそのまま返し、ファイルを消さない', async () => {
  for (const fileId of ['file-a', undefined, 12]) {
    const error = new NetError('network');
    const calls = [];
    const repo = {
      async getRecord() { calls.push('get'); throw error; },
      async removeAttachment() { calls.push('remove'); assert.fail('目録を消してはいけない'); },
    };
    const files = { async trashStudent() { calls.push('trash'); } };
    await assert.rejects(settleAttachmentFlow({ ...addition(), repo, files, fileId }), (e) => e === error);
    assert.deepEqual(calls, ['get']);
  }
});

test('settleAttachmentFlow: ファイルの片付けだけの失敗は例外にせず saved: false', async () => {
  for (const failTrash of [false, true]) {
    const calls = [];
    const attachments = [{ slot: 'a1', fileId: 'other' }];
    const repo = {
      async getRecord() { calls.push('get'); return { attachments }; },
      async removeAttachment() { calls.push('remove'); assert.fail('目録を消してはいけない'); },
    };
    const files = { async trashStudent() { calls.push('trash'); if (failTrash) throw new NetError('network'); return false; } };
    assert.deepEqual(await settleAttachmentFlow({ ...addition(), repo, files, fileId: 'file-a' }), { saved: false, attachments });
    assert.deepEqual(calls, ['get', 'trash']);
  }
});

test('settleAttachmentFlow: 記録が null なら空の目録を返す', async () => {
  const calls = [];
  const repo = {
    async getRecord() { calls.push('get'); return null; },
    async removeAttachment() { calls.push('remove'); assert.fail('目録を消してはいけない'); },
  };
  const files = { async trashStudent(id) { calls.push(['trash', id]); } };
  assert.deepEqual(await settleAttachmentFlow({ ...addition(), repo, files, fileId: 'file-a' }), { saved: false, attachments: [] });
  assert.deepEqual(calls, ['get', ['trash', 'file-a']]);
});

test('settleAttachmentFlow: 目録なし・配列でない目録は空の配列として返す', async () => {
  for (const attachments of [undefined, null, {}]) {
    const calls = [];
    const repo = {
      async getRecord() { calls.push('get'); return { attachments }; },
      async removeAttachment() { calls.push('remove'); assert.fail('目録を消してはいけない'); },
    };
    const files = { async trashStudent(id) { calls.push(['trash', id]); } };
    assert.deepEqual(await settleAttachmentFlow({ ...addition(), repo, files, fileId: 'file-a' }), { saved: false, attachments: [] });
    assert.deepEqual(calls, ['get', ['trash', 'file-a']]);
  }
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
