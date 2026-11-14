// 授業ごとの書きこみの順番と、失敗したあとの継続を確かめる。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRecordQueue } from '../js/record-queue.js';

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test('run: 同じ key の 3 件は 1 本ずつ順番に実行し、途中の追加も追い越さない', async () => {
  const queue = createRecordQueue();
  const first = deferred();
  const second = deferred();
  const firstStarted = deferred();
  const secondStarted = deferred();
  const calls = [];
  const one = queue.run('class1/lesson1', async () => {
    calls.push('1 開始');
    firstStarted.resolve();
    await first.promise;
    calls.push('1 終了');
    return 1;
  });
  const two = queue.run('class1/lesson1', async () => {
    calls.push('2 開始');
    secondStarted.resolve();
    await second.promise;
    calls.push('2 終了');
    return 2;
  });
  const three = queue.run('class1/lesson1', () => { calls.push('3'); return 3; });
  await firstStarted.promise;
  assert.deepEqual(calls, ['1 開始']);
  first.resolve();
  await secondStarted.promise;
  assert.deepEqual(calls, ['1 開始', '1 終了', '2 開始']);
  const four = queue.run('class1/lesson1', () => { calls.push('4'); return 4; });
  await Promise.resolve();
  assert.deepEqual(calls, ['1 開始', '1 終了', '2 開始']);
  second.resolve();
  assert.deepEqual(await Promise.all([one, two, three, four]), [1, 2, 3, 4]);
  assert.deepEqual(calls, ['1 開始', '1 終了', '2 開始', '2 終了', '3', '4']);
});

test('run: クラスや授業が違う key は、通信中の key を待たない', async () => {
  const queue = createRecordQueue();
  const response = deferred();
  const started = deferred();
  const first = queue.run('class1/lesson1', () => { started.resolve(); return response.promise; });
  await started.promise;
  assert.deepEqual(await Promise.all([
    queue.run('class1/lesson2', () => '別の授業'),
    queue.run('class2/lesson1', () => '別のクラス'),
  ]), ['別の授業', '別のクラス']);
  response.resolve('最初の授業');
  assert.equal(await first, '最初の授業');
});

test('run: 通信が失敗しても次を実行し、例外は呼び出し元にそのまま返す', async () => {
  const queue = createRecordQueue();
  const response = deferred();
  const error = new Error('送れません');
  const calls = [];
  const first = queue.run('class1/lesson1', () => { calls.push(1); return response.promise; });
  const rejected = assert.rejects(first, (actual) => actual === error);
  const second = queue.run('class1/lesson1', () => { calls.push(2); return '次の保存'; });
  await Promise.resolve();
  assert.deepEqual(calls, [1]);
  response.reject(error);
  await rejected;
  assert.equal(await second, '次の保存');
  assert.deepEqual(calls, [1, 2]);
});

test('run: 同期の例外でも止まらず、例外をそのまま返す', async () => {
  const queue = createRecordQueue();
  const error = new Error('同期の失敗');
  const first = queue.run('class1/lesson1', () => { throw error; });
  const second = queue.run('class1/lesson1', () => '続き');
  await assert.rejects(first, (actual) => actual === error);
  assert.equal(await second, '続き');
});

test('run: 同期・非同期の結果をそのまま返す', async () => {
  const queue = createRecordQueue();
  for (const value of [undefined, null, false, 0, '保存済み', { saved: true }]) {
    assert.strictEqual(await queue.run('class1/lesson1', () => value), value);
    assert.strictEqual(await queue.run('class1/lesson1', async () => value), value);
  }
});

test('run: 成功・失敗のあと列が空になっても、同じ key ですぐ再開できる', async () => {
  const queue = createRecordQueue();
  for (const fail of [false, true]) {
    const first = queue.run('class1/lesson1', () => {
      if (fail) throw new Error('失敗');
      return '完了';
    });
    if (fail) await assert.rejects(first, /失敗/);
    else assert.equal(await first, '完了');
    let called = false;
    const next = queue.run('class1/lesson1', () => { called = true; });
    await Promise.resolve();
    assert.equal(called, true);
    await next;
  }
});

test('run: fn が関数でなければ、実行中の列を待たず TypeError で断る', async () => {
  const queue = createRecordQueue();
  const response = deferred();
  const first = queue.run('class1/lesson1', () => response.promise);
  for (const fn of [undefined, null, 1, '関数', {}, []]) {
    await assert.rejects(queue.run('class1/lesson1', fn), TypeError);
  }
  const next = queue.run('class1/lesson1', () => '続き');
  response.resolve();
  await first;
  assert.equal(await next, '続き');
});

test('run: key が文字列でなければ TypeError で断り、fn を呼ばない', async () => {
  const queue = createRecordQueue();
  let calls = 0;
  for (const key of [undefined, null, 1, {}, [], Symbol('key'), new String('class1/lesson1')]) {
    await assert.rejects(queue.run(key, () => { calls += 1; }), TypeError);
  }
  assert.equal(calls, 0);
  assert.equal(await queue.run('class1/lesson1', () => '保存済み'), '保存済み');
});
