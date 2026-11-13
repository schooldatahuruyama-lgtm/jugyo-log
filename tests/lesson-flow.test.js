import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NetError } from '../js/errors.js';
import { deleteLessonFlow } from '../js/lesson-flow.js';

function setup(fileIds = ['file-a']) {
  const classId = 'class-a';
  const lesson = {
    id: 'lesson-a',
    materials: Object.fromEntries(fileIds.map((fileId, order) => [`material-${order}`, {
      kind: 'board', type: 'image', fileId, name: '板書', order, bytes: 3,
    }])),
  };
  const calls = [];
  const all = { [classId]: { [lesson.id]: lesson } };
  const repo = {
    async countRecords(...values) { calls.push(['countRecords', ...values]); return 0; },
    async deleteLesson(...values) {
      calls.push(['deleteLesson', ...values]);
      await Promise.resolve();
      delete all[classId][lesson.id];
    },
    async listAllLessons() { calls.push(['listAllLessons']); return all; },
  };
  const files = { async trash(id) { calls.push(['trash', id]); } };
  return { classId, lesson, repo, files, calls, all };
}

test('deleteLessonFlow: 記録が 1 件あれば授業もファイルも消さない', async () => {
  const args = setup();
  args.repo.countRecords = async (...values) => { args.calls.push(['countRecords', ...values]); return 1; };
  assert.deepEqual(await deleteLessonFlow(args), { deleted: false, reason: 'has-records' });
  assert.deepEqual(args.calls, [['countRecords', args.classId, args.lesson.id]]);
  assert.equal(args.all[args.classId][args.lesson.id], args.lesson);
});

test('deleteLessonFlow: 件数が 0 でも削除を規則が断ったらファイルを片付けない', async () => {
  const args = setup();
  args.repo.deleteLesson = async (...values) => {
    args.calls.push(['deleteLesson', ...values]);
    throw new NetError('denied');
  };
  assert.deepEqual(await deleteLessonFlow(args), { deleted: false, reason: 'has-records' });
  assert.deepEqual(args.calls, [
    ['countRecords', args.classId, args.lesson.id], ['deleteLesson', args.classId, args.lesson.id],
  ]);
  assert.equal(args.all[args.classId][args.lesson.id], args.lesson);
});

test('deleteLessonFlow: 授業の削除が通信に失敗したら同じ例外を投げ、ファイルを片付けない', async () => {
  const args = setup();
  const error = new NetError('network');
  args.repo.deleteLesson = async (...values) => {
    args.calls.push(['deleteLesson', ...values]);
    throw error;
  };
  await assert.rejects(deleteLessonFlow(args), (e) => e === error);
  assert.deepEqual(args.calls, [
    ['countRecords', args.classId, args.lesson.id], ['deleteLesson', args.classId, args.lesson.id],
  ]);
  assert.equal(args.all[args.classId][args.lesson.id], args.lesson);
});

test('deleteLessonFlow: NetError ではない denied は同じ例外を投げる', async () => {
  const args = setup();
  const error = Object.assign(new Error('消せません'), { code: 'denied' });
  args.repo.deleteLesson = async (...values) => {
    args.calls.push(['deleteLesson', ...values]);
    throw error;
  };
  await assert.rejects(deleteLessonFlow(args), (e) => e === error);
  assert.deepEqual(args.calls, [
    ['countRecords', args.classId, args.lesson.id], ['deleteLesson', args.classId, args.lesson.id],
  ]);
});

test('deleteLessonFlow: 記録の件数を読めなければ何も消さず、同じ例外を投げる', async () => {
  const args = setup();
  const error = new NetError('network');
  args.repo.countRecords = async (...values) => {
    args.calls.push(['countRecords', ...values]);
    throw error;
  };
  await assert.rejects(deleteLessonFlow(args), (e) => e === error);
  assert.deepEqual(args.calls, [['countRecords', args.classId, args.lesson.id]]);
});

test('deleteLessonFlow: 件数を確かめ、授業の削除を待ってから読み直し、ファイルを片付ける', async () => {
  const args = setup();
  assert.deepEqual(await deleteLessonFlow(args), { deleted: true, leftover: 0 });
  assert.deepEqual(args.calls, [
    ['countRecords', args.classId, args.lesson.id], ['deleteLesson', args.classId, args.lesson.id],
    ['listAllLessons'], ['trash', 'file-a'],
  ]);
  assert.equal(args.all[args.classId][args.lesson.id], undefined);
});

test('deleteLessonFlow: 重複を除き、削除後に別の授業が指すファイルは残す', async () => {
  const args = setup(['file-a', 'file-b', 'file-a']);
  const deleteLesson = args.repo.deleteLesson;
  args.repo.deleteLesson = async (...values) => {
    await deleteLesson(...values);
    args.all['class-b'] = { 'lesson-b': { materials: { other: { fileId: 'file-b' } } } };
  };
  assert.deepEqual(await deleteLessonFlow(args), { deleted: true, leftover: 0 });
  assert.deepEqual(args.calls, [
    ['countRecords', args.classId, args.lesson.id], ['deleteLesson', args.classId, args.lesson.id],
    ['listAllLessons'], ['trash', 'file-a'],
  ]);
});

test('deleteLessonFlow: 読み直しが失敗したら重複を除いた全ファイルを残す', async () => {
  const args = setup(['file-a', 'file-b', 'file-a']);
  args.repo.listAllLessons = async () => {
    args.calls.push(['listAllLessons']);
    throw new NetError('network');
  };
  assert.deepEqual(await deleteLessonFlow(args), { deleted: true, leftover: 2 });
  assert.deepEqual(args.calls, [
    ['countRecords', args.classId, args.lesson.id], ['deleteLesson', args.classId, args.lesson.id],
    ['listAllLessons'],
  ]);
  assert.equal(args.all[args.classId][args.lesson.id], undefined);
});

test('deleteLessonFlow: ゴミ箱への移動が 1 つ失敗しても残りを片付ける', async () => {
  const args = setup(['file-a', 'file-b', 'file-c']);
  args.files.trash = async (id) => {
    args.calls.push(['trash', id]);
    if (id === 'file-b') throw new NetError('network');
  };
  assert.deepEqual(await deleteLessonFlow(args), { deleted: true, leftover: 1 });
  assert.deepEqual(args.calls, [
    ['countRecords', args.classId, args.lesson.id], ['deleteLesson', args.classId, args.lesson.id],
    ['listAllLessons'], ['trash', 'file-a'], ['trash', 'file-b'], ['trash', 'file-c'],
  ]);
});

test('deleteLessonFlow: 資料が無ければ読み直しも片付けも行わない', async () => {
  const args = setup([]);
  delete args.lesson.materials;
  assert.deepEqual(await deleteLessonFlow(args), { deleted: true, leftover: 0 });
  assert.deepEqual(args.calls, [
    ['countRecords', args.classId, args.lesson.id], ['deleteLesson', args.classId, args.lesson.id],
  ]);
});
