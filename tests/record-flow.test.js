// 残った下書きとサーバーを比べ、送れない授業があっても次へ進むことを確かめる。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resendDrafts, pendingLessons } from '../js/record-flow.js';
import { createDrafts } from '../js/drafts.js';
import { createRecordQueue } from '../js/record-queue.js';
import { createRecordSaver } from '../js/record-saver.js';
import { pickInitial } from '../js/record-logic.js';
import { NetError } from '../js/errors.js';

const record = (memo) => ({ memo, level: null, learned: '', question: '' });

function deferred() {
  let resolve;
  const promise = new Promise((yes) => { resolve = yes; });
  return { promise, resolve };
}

function fakeStorage() {
  const values = new Map();
  return {
    get length() { return values.size; },
    key(index) { return [...values.keys()][index] ?? null; },
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
  };
}

function setup() {
  const storage = fakeStorage();
  const drafts = createDrafts({ storage });
  const sent = [];
  const reads = [];
  const servers = new Map();
  const failures = new Map();
  const repo = {
    async getRecord(classId, lessonId, studentId) {
      reads.push([classId, lessonId, studentId]);
      const value = servers.get(lessonId);
      if (value instanceof Error) throw value;
      return value ?? null;
    },
    async saveRecord(...args) {
      if (failures.has(args[1])) throw failures.get(args[1]);
      sent.push(args);
    },
  };
  return { storage, drafts, repo, reads, sent, servers, failures, queue: createRecordQueue(), studentId: 'student1', max: 2000 };
}

test('resendDrafts: 新しい下書きだけを送って消す。古い・同時刻の下書きは送らず消す', async () => {
  const h = setup();
  for (const [id, at] of [['new', 3000], ['old', 1000], ['equal', 2000], ['missing', 1000]]) {
    h.drafts.put(h.studentId, 'class1', id, record(id), at);
    if (id !== 'missing') h.servers.set(id, { ...record('サーバー'), updatedAt: 2000 });
  }
  assert.deepEqual(await resendDrafts(h), { sent: 2, kept: 0, dropped: 2 });
  assert.deepEqual(h.sent, [
    ['class1', 'new', h.studentId, record('new'), 3000],
    ['class1', 'missing', h.studentId, record('missing'), 1000],
  ]);
  assert.equal(h.reads.length, 4);
  assert.deepEqual(h.drafts.list(h.studentId), []);
});

test('resendDrafts: 読み取り中に下書きが新しくなったら、送らず消さずに残す', async () => {
  const h = setup();
  const response = deferred();
  h.drafts.put(h.studentId, 'class1', 'lesson1', record('元の内容'), 3000);
  h.repo.getRecord = () => response.promise;
  const resending = resendDrafts(h);
  h.drafts.put(h.studentId, 'class1', 'lesson1', record('書き足した内容'), 4000);
  response.resolve(null);
  assert.deepEqual(await resending, { sent: 0, kept: 1, dropped: 0 });
  assert.deepEqual(h.sent, []);
  assert.deepEqual(h.drafts.get(h.studentId, 'class1', 'lesson1'), { record: record('書き足した内容'), editedAt: 4000 });
});

test('resendDrafts: 送信中に下書きが新しくなったら、送信済みに数えて新しい下書きを残す', async () => {
  const h = setup();
  const saving = deferred();
  const response = deferred();
  h.drafts.put(h.studentId, 'class1', 'lesson1', record('元の内容'), 3000);
  h.repo.saveRecord = (...args) => { h.sent.push(args); saving.resolve(); return response.promise; };
  const resending = resendDrafts(h);
  await saving.promise;
  h.drafts.put(h.studentId, 'class1', 'lesson1', record('書き足した内容'), 4000);
  response.resolve();
  assert.deepEqual(await resending, { sent: 1, kept: 0, dropped: 0 });
  assert.deepEqual(h.sent, [['class1', 'lesson1', h.studentId, record('元の内容'), 3000]]);
  assert.deepEqual(h.drafts.get(h.studentId, 'class1', 'lesson1'), { record: record('書き足した内容'), editedAt: 4000 });
});

test('pickInitial: A だけが遅れて保存されても、開き直したら新しい下書き B を選ぶ', async () => {
  const h = setup();
  const started = deferred();
  const response = deferred();
  let time = 1000;
  h.repo.saveRecord = async (...args) => {
    h.sent.push(args);
    if (args[3].memo === 'B') throw new NetError('network');
    started.resolve();
    await response.promise;
    h.servers.set(args[1], { ...args[3], updatedAt: args[4] });
  };
  const saver = createRecordSaver({
    save: (value, editedAt) => h.queue.run('class1/lesson1', () =>
      h.repo.saveRecord('class1', 'lesson1', h.studentId, value, editedAt)),
    saveDraft: (value, editedAt) => h.drafts.put(h.studentId, 'class1', 'lesson1', value, editedAt),
    removeDraft: () => h.drafts.remove(h.studentId, 'class1', 'lesson1'),
    now: () => time, setTimeout: () => 0, clearTimeout: () => {},
  });
  saver.edit(record('A'));
  time = 2000;
  const saving = saver.flush();
  await started.promise;
  time = 3000;
  saver.edit(record('B'));
  time = 5000;
  response.resolve();
  assert.equal(await saving, false);
  saver.dispose();
  const server = await h.repo.getRecord('class1', 'lesson1', h.studentId);
  const draft = createDrafts({ storage: h.storage }).get(h.studentId, 'class1', 'lesson1');
  assert.deepEqual(server, { ...record('A'), updatedAt: 1000 });
  assert.deepEqual(draft, { record: record('B'), editedAt: 3000 });
  assert.deepEqual(pickInitial(server, draft, { max: h.max }), {
    record: record('B'), fromDraft: true, updatedAt: 1000,
  });
});

test('resendDrafts: サーバーが元の下書きより新しくても、読み取り中に変わった下書きは消さない', async () => {
  const h = setup();
  const response = deferred();
  h.drafts.put(h.studentId, 'class1', 'lesson1', record('元の内容'), 3000);
  h.repo.getRecord = () => response.promise;
  const resending = resendDrafts(h);
  h.drafts.put(h.studentId, 'class1', 'lesson1', record('書き足した内容'), 6000);
  response.resolve({ ...record('サーバー'), updatedAt: 5000 });
  assert.deepEqual(await resending, { sent: 0, kept: 1, dropped: 0 });
  assert.deepEqual(h.sent, []);
  assert.deepEqual(h.drafts.get(h.studentId, 'class1', 'lesson1'), { record: record('書き足した内容'), editedAt: 6000 });
});

test('resendDrafts: 遅れている再送のあとに自動保存を送り、サーバーには新しい内容を残す', async () => {
  const h = setup();
  const started = deferred();
  const response = deferred();
  h.drafts.put(h.studentId, 'class1', 'lesson1', record('元の内容'), 3000);
  h.repo.saveRecord = async (...args) => {
    h.sent.push(args);
    if (args[3].memo === '元の内容') {
      started.resolve();
      await response.promise;
    }
    h.servers.set(args[1], { ...args[3], updatedAt: args[4] });
  };
  const resending = resendDrafts(h);
  await started.promise;
  h.drafts.put(h.studentId, 'class1', 'lesson1', record('書き足した内容'), 11000);
  const saving = h.queue.run('class1/lesson1', () =>
    h.repo.saveRecord('class1', 'lesson1', h.studentId, record('書き足した内容'), 11000))
    .then(() => h.drafts.remove(h.studentId, 'class1', 'lesson1'));
  await Promise.resolve();
  assert.equal(h.sent.length, 1);
  assert.equal(h.servers.has('lesson1'), false);
  response.resolve();
  const [result] = await Promise.all([resending, saving]);
  assert.deepEqual(result, { sent: 1, kept: 0, dropped: 0 });
  assert.deepEqual(h.sent, [
    ['class1', 'lesson1', h.studentId, record('元の内容'), 3000],
    ['class1', 'lesson1', h.studentId, record('書き足した内容'), 11000],
  ]);
  assert.deepEqual(h.servers.get('lesson1'), { ...record('書き足した内容'), updatedAt: 11000 });
  assert.equal(h.drafts.get(h.studentId, 'class1', 'lesson1'), null);
});

test('resendDrafts: 列を待つ間に自動保存が成功して下書きが消えたら、再送しない', async () => {
  const h = setup();
  const response = deferred();
  const queued = deferred();
  h.drafts.put(h.studentId, 'class1', 'lesson1', record('元の内容'), 3000);
  const saving = h.queue.run('class1/lesson1', async () => {
    await response.promise;
    await h.repo.saveRecord('class1', 'lesson1', h.studentId, record('自動保存した内容'), 11000);
  }).then(() => h.drafts.remove(h.studentId, 'class1', 'lesson1'));
  const { run } = h.queue;
  h.queue.run = (...args) => { const pending = run(...args); queued.resolve(); return pending; };
  const resending = resendDrafts(h);
  await queued.promise;
  assert.deepEqual(h.sent, []);
  response.resolve();
  const [result] = await Promise.all([resending, saving]);
  assert.deepEqual(result, { sent: 0, kept: 1, dropped: 0 });
  assert.deepEqual(h.sent, [['class1', 'lesson1', h.studentId, record('自動保存した内容'), 11000]]);
  assert.equal(h.drafts.get(h.studentId, 'class1', 'lesson1'), null);
});

test('resendDrafts: 列を待つ間に変わった下書きは、サーバーの新旧にかかわらず送らず消さない', async () => {
  for (const server of [null, { ...record('サーバー'), updatedAt: 5000 }]) {
    const h = setup();
    const response = deferred();
    const queued = deferred();
    h.drafts.put(h.studentId, 'class1', 'lesson1', record('元の内容'), 3000);
    h.servers.set('lesson1', server);
    const saving = h.queue.run('class1/lesson1', () => response.promise);
    const { run } = h.queue;
    h.queue.run = (...args) => { const pending = run(...args); queued.resolve(); return pending; };
    const resending = resendDrafts(h);
    await queued.promise;
    assert.deepEqual(h.drafts.get(h.studentId, 'class1', 'lesson1'), { record: record('元の内容'), editedAt: 3000 });
    h.drafts.put(h.studentId, 'class1', 'lesson1', record('書き足した内容'), 6000);
    response.resolve();
    const [result] = await Promise.all([resending, saving]);
    assert.deepEqual(result, { sent: 0, kept: 1, dropped: 0 });
    assert.deepEqual(h.sent, []);
    assert.deepEqual(h.drafts.get(h.studentId, 'class1', 'lesson1'), { record: record('書き足した内容'), editedAt: 6000 });
  }
});

test('resendDrafts: 読み取り中に下書きが消えた・こわれたときは、送信も削除もしない', async () => {
  for (const server of [null, { ...record('サーバー'), updatedAt: 5000 }]) {
    for (const missing of [true, false]) {
      const h = setup();
      const response = deferred();
      const removed = [];
      h.drafts.put(h.studentId, 'class1', 'lesson1', record('元の内容'), 3000);
      h.drafts.remove = (...args) => removed.push(args);
      h.repo.getRecord = () => response.promise;
      const resending = resendDrafts(h);
      const key = h.storage.key(0);
      if (missing) h.storage.removeItem(key);
      else h.storage.setItem(key, '{');
      response.resolve(server);
      assert.deepEqual(await resending, { sent: 0, kept: 1, dropped: 0 });
      assert.deepEqual(h.sent, []);
      assert.deepEqual(removed, []);
      assert.equal(h.storage.getItem(key), missing ? null : '{');
    }
  }
});

test('resendDrafts: 下書きの内容だけが変わっても editedAt が同じなら、元の内容を送って消す', async () => {
  const h = setup();
  const response = deferred();
  h.drafts.put(h.studentId, 'class1', 'lesson1', record('元の内容'), 3000);
  h.repo.getRecord = () => response.promise;
  const resending = resendDrafts(h);
  h.drafts.put(h.studentId, 'class1', 'lesson1', record('同じ時刻の内容'), 3000);
  response.resolve(null);
  assert.deepEqual(await resending, { sent: 1, kept: 0, dropped: 0 });
  assert.deepEqual(h.sent, [['class1', 'lesson1', h.studentId, record('元の内容'), 3000]]);
  assert.equal(h.drafts.get(h.studentId, 'class1', 'lesson1'), null);
});

test('resendDrafts: 読み取り・送信の失敗と denied は残し、後の下書きも処理する', async () => {
  const h = setup();
  const ids = ['readFail', 'success', 'readDenied', 'saveFail', 'saveDenied', 'last'];
  for (const id of ids) h.drafts.put(h.studentId, 'class1', id, record(id), 3000);
  h.servers.set('readFail', new NetError('network'));
  h.servers.set('readDenied', new NetError('denied'));
  h.failures.set('saveFail', new Error('送れません'));
  h.failures.set('saveDenied', new NetError('denied'));
  assert.deepEqual(await resendDrafts(h), { sent: 2, kept: 4, dropped: 0 });
  assert.deepEqual(h.sent.map((args) => args[1]), ['success', 'last']);
  assert.deepEqual(h.drafts.list(h.studentId).map((draft) => draft.lessonId), ['readFail', 'readDenied', 'saveFail', 'saveDenied']);
  assert.deepEqual(h.reads.map((args) => args[1]), ids);
});

test('resendDrafts: 空の一覧・使えない端末の保存先では通信しない', async () => {
  for (const drafts of [createDrafts({ storage: fakeStorage() }), createDrafts({ storage: null })]) {
    const h = { ...setup(), drafts };
    assert.deepEqual(await resendDrafts(h), { sent: 0, kept: 0, dropped: 0 });
    assert.deepEqual(h.reads, []);
    assert.deepEqual(h.sent, []);
  }
});

test('resendDrafts: 開き直しても残る下書きを送り、別の生徒の下書きには触れない', async () => {
  const h = setup();
  h.drafts.put(h.studentId, 'class1', 'lesson1', record('前に送れなかった内容'), 3000);
  h.drafts.put('student2', 'class1', 'lesson1', record('別の生徒'), 3000);
  h.drafts = createDrafts({ storage: h.storage });
  assert.deepEqual(await resendDrafts(h), { sent: 1, kept: 0, dropped: 0 });
  assert.equal(h.sent[0][3].memo, '前に送れなかった内容');
  assert.equal(h.drafts.list('student2').length, 1);
});

test('resendDrafts: max を使って記録を整え、理解度がなくても送る', async () => {
  const h = setup();
  h.max = 2;
  h.drafts.put(h.studentId, 'class1', 'lesson1', record('あいう'), 3000);
  assert.deepEqual(await resendDrafts(h), { sent: 1, kept: 0, dropped: 0 });
  assert.deepEqual(h.sent[0][3], record('あい'));
});

test('pendingLessons: 指定した生徒・クラスの授業だけを Set で返す', () => {
  const h = setup();
  for (const [student, cls, lesson] of [
    ['student1', 'class1', 'lesson1'], ['student1', 'class1', 'lesson2'],
    ['student1', 'class2', 'lesson3'], ['student2', 'class1', 'lesson4'],
  ]) h.drafts.put(student, cls, lesson, record('メモ'), 3000);
  assert.deepEqual(pendingLessons(h.drafts, 'student1', 'class1'), new Set(['lesson1', 'lesson2']));
  assert.deepEqual(pendingLessons(h.drafts, 'student1', 'class3'), new Set());
});
