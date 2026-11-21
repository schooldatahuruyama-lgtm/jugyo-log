import { test } from 'node:test';
import assert from 'node:assert/strict';
import { warmLessons } from '../js/offline-warm.js';

function setup() {
  const calls = [];
  return { calls, classId: 'c1', studentId: 's26-001', lessons: [{ id: 'new' }, { id: 'old' }], max: 5,
    isStopped: () => false, repo: {
      getLesson: async (...args) => calls.push(['lesson', ...args]),
      getRecord: async (...args) => calls.push(['record', ...args]),
    } };
}

test('先頭から授業・記録の順に、max またはある数だけ読む', async () => {
  const h = setup(); assert.equal(await warmLessons(h), 2);
  assert.deepEqual(h.calls, [['lesson', 'c1', 'new'], ['record', 'c1', 'new', 's26-001'],
    ['lesson', 'c1', 'old'], ['record', 'c1', 'old', 's26-001']]);
  const limited = setup(); limited.max = 1;
  assert.equal(await warmLessons(limited), 1); assert.equal(limited.calls.length, 2);
});

test('授業 0 個・不正な max・開始前の中断では読まない', async () => {
  for (const max of [0, -1, NaN, Infinity, '5', undefined]) {
    const h = setup(); h.max = max; assert.equal(await warmLessons(h), 0); assert.equal(h.calls.length, 0);
  }
  const h = setup(); h.lessons = []; assert.equal(await warmLessons(h), 0);
  const stopped = setup(); stopped.isStopped = () => true; assert.equal(await warmLessons(stopped), 0);
  assert.equal(stopped.calls.length, 0);
});

test('授業と記録の各失敗でやめ、読めた組の数だけ返す', async () => {
  for (const method of ['getLesson', 'getRecord']) {
    const h = setup(); const original = h.repo[method];
    h.repo[method] = async (...args) => { if (args[1] === 'old') throw new Error(); return original(...args); };
    assert.equal(await warmLessons(h), 1);
  }
});

test('授業の待ち時間に中断したら記録を読まず、記録の後なら次の授業を読まない', async () => {
  for (const method of ['getLesson', 'getRecord']) {
    const h = setup(); let stopped = false; h.isStopped = () => stopped;
    const original = h.repo[method];
    h.repo[method] = async (...args) => { stopped = true; return original(...args); };
    assert.equal(await warmLessons(h), method === 'getLesson' ? 0 : 1);
    assert.equal(h.calls.length, method === 'getLesson' ? 1 : 2);
  }
});

test('授業・記録・用語・先生の返事を 1 つずつ順に読む', async () => {
  const h = setup(); const releases = [];
  const methods = ['getLesson', 'getRecord', 'getMyLessonTerms', 'getReply'];
  for (const method of methods) h.repo[method] = (...args) => {
    h.calls.push([method, ...args]); return new Promise((resolve) => releases.push(resolve));
  };
  const warming = warmLessons(h);
  for (let i = 0; i < 8; i++) {
    assert.equal(h.calls.length, i + 1);
    releases[i](); await Promise.resolve();
  }
  assert.equal(await warming, 2);
  assert.deepEqual(h.calls, ['new', 'old'].flatMap((id) => [
    ['getLesson', 'c1', id], ['getRecord', 'c1', id, 's26-001'],
    ['getMyLessonTerms', 's26-001', 'c1', id], ['getReply', 'c1', id, 's26-001'],
  ]));
});

test('用語・返事の失敗または途中の中断で、残りを読まずにやめる', async () => {
  for (const stopped of [false, true]) {
    for (const method of ['getMyLessonTerms', 'getReply']) {
      const h = setup(); let stop = false; h.isStopped = () => stop;
      h.repo.getMyLessonTerms = async () => { h.calls.push(['terms']); };
      h.repo.getReply = async () => { h.calls.push(['reply']); };
      const original = h.repo[method];
      h.repo[method] = async (...args) => {
        await original(...args);
        if (stopped) stop = true; else throw new Error('offline');
      };
      assert.equal(await warmLessons(h), stopped && method === 'getReply' ? 1 : 0);
      assert.equal(h.calls.length, method === 'getMyLessonTerms' ? 3 : 4);
    }
  }
});

test('用語か返事の関数が無ければ、その関数だけを飛ばす', async () => {
  for (const method of ['getMyLessonTerms', 'getReply']) {
    const h = setup(); h.max = 1;
    h.repo[method] = async (...args) => { h.calls.push([method, ...args]); };
    assert.equal(await warmLessons(h), 1);
    assert.deepEqual(h.calls.at(-1), method === 'getMyLessonTerms'
      ? [method, 's26-001', 'c1', 'new'] : [method, 'c1', 'new', 's26-001']);
  }
});
