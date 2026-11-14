// 自動保存の待ち時間と、保存中の追加入力を確かめる。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRecordSaver } from '../js/record-saver.js';
import { pickInitial } from '../js/record-logic.js';
import { NetError } from '../js/errors.js';

const record = (memo) => ({ memo, level: null, learned: '', question: '' });
const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function fakeTimers() {
  let time = 1000;
  let nextId = 0;
  const jobs = new Map();
  const callbacks = [];
  return {
    callbacks,
    now: () => time,
    setTimeout(fn, ms) {
      const id = nextId++;
      jobs.set(id, { fn, at: time + ms });
      callbacks.push(fn);
      return id;
    },
    clearTimeout(id) { jobs.delete(id); },
    get pending() { return jobs.size; },
    async advance(ms) {
      const end = time + ms;
      await settle();
      while (true) {
        const next = [...jobs].sort((a, b) => a[1].at - b[1].at)[0];
        if (!next || next[1].at > end) break;
        time = next[1].at;
        jobs.delete(next[0]);
        next[1].fn();
        await settle();
      }
      time = end;
      await settle();
    },
  };
}

function setup(options = {}) {
  const timers = fakeTimers();
  const calls = [];
  const times = [];
  const drafts = [];
  const states = [];
  let removed = 0;
  const saver = createRecordSaver({
    now: timers.now, setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout,
    delayMs: 2000, retryMs: [2000, 5000, 15000],
    save(value, editedAt) { calls.push(value); times.push(editedAt); return options.save?.(value, editedAt); },
    saveDraft(value, at) { drafts.push({ record: value, editedAt: at }); options.saveDraft?.(value, at); },
    removeDraft() { removed += 1; options.removeDraft?.(); },
    onState(state) { states.push(state); },
    ...(options.retryMs ? { retryMs: options.retryMs } : {}),
  });
  return { saver, timers, calls, times, drafts, states, get removed() { return removed; } };
}

test('edit: すぐ下書きを残し、2 秒後に保存。状態は dirty → saving → saved', async () => {
  const h = setup();
  assert.equal(h.saver.state, 'idle');
  assert.equal(h.saver.dirty, false);
  h.saver.edit(record('メモ'));
  assert.deepEqual(h.drafts, [{ record: record('メモ'), editedAt: 1000 }]);
  assert.equal(h.saver.state, 'dirty');
  assert.equal(h.saver.dirty, true);
  await h.timers.advance(1999);
  assert.equal(h.calls.length, 0);
  await h.timers.advance(1);
  assert.deepEqual(h.calls, [record('メモ')]);
  assert.equal(h.timers.now(), 3000);
  assert.deepEqual(h.times, [1000]);
  assert.equal(h.times[0], h.drafts[0].editedAt);
  assert.deepEqual(h.states, ['dirty', 'saving', 'saved']);
  assert.equal(h.saver.dirty, false);
  assert.equal(h.removed, 1);
});

test('edit: 下書きの時刻を引きついで送り、その後の入力は現在時刻で保存する', async () => {
  const h = setup();
  await h.timers.advance(2000);
  assert.equal(h.timers.now(), 3000);
  h.saver.edit(record('下書き'), { editedAt: 1000 });
  assert.deepEqual(h.drafts, [{ record: record('下書き'), editedAt: 1000 }]);
  await h.timers.advance(2000);
  assert.deepEqual(h.calls, [record('下書き')]);
  assert.deepEqual(h.times, [1000]);

  const editedAt = h.timers.now();
  h.saver.edit(record('書き足した内容'));
  assert.deepEqual(h.drafts[1], { record: record('書き足した内容'), editedAt });
  await h.timers.advance(2000);
  assert.deepEqual(h.calls, [record('下書き'), record('書き足した内容')]);
  assert.deepEqual(h.times, [1000, editedAt]);
});

for (const editedAt of ['1000', NaN, Infinity, -Infinity, null]) {
  test(`edit: 不正な editedAt（${String(editedAt)}）は現在時刻で保存する`, async () => {
    const h = setup();
    await h.timers.advance(2000);
    h.saver.edit(record('メモ'), { editedAt });
    assert.deepEqual(h.drafts, [{ record: record('メモ'), editedAt: 3000 }]);
    await h.timers.advance(2000);
    assert.deepEqual(h.times, [3000]);
  });
}

test('edit: 同じ下書きを 2 回開き直しても、編集時刻は変わらない', async () => {
  let draft = { record: record('下書き'), editedAt: 1000 };
  for (const openedAt of [3000, 5000]) {
    const h = setup();
    await h.timers.advance(openedAt - h.timers.now());
    h.saver.edit(draft.record, { editedAt: draft.editedAt });
    assert.deepEqual(h.drafts, [{ record: record('下書き'), editedAt: 1000 }]);
    assert.equal(await h.saver.flush(), true);
    assert.deepEqual(h.times, [1000]);
    draft = h.drafts[0];
    h.saver.dispose();
  }
});

test('下書き A の復元・再送で時刻を変えず、別端末の新しい下書き B を選ぶ', async () => {
  const draftA = { record: record('下書き A'), editedAt: 1000 };
  const draftB = { record: record('下書き B'), editedAt: 2000 };
  let server = null;
  const h = setup({ save: (value, editedAt) => { server = { ...value, updatedAt: editedAt }; } });
  await h.timers.advance(2000);
  assert.equal(h.timers.now(), 3000);
  const initial = pickInitial(server, draftA, { max: 2000 });
  assert.equal(initial.fromDraft, true);
  h.saver.edit(initial.record, { editedAt: draftA.editedAt });
  assert.equal(await h.saver.flush(), true);
  assert.deepEqual(server, { ...draftA.record, updatedAt: 1000 });
  assert.deepEqual(pickInitial(server, draftB, { max: 2000 }), {
    record: draftB.record, fromDraft: true, updatedAt: 1000,
  });
});

for (const values of [['あ', 'あい', 'あいう'], ['同じ', '同じ', '同じ']]) {
  test(`edit: 3 回続いた入力は最後の内容だけを送る（${values.join('・')}）`, async () => {
    const h = setup();
    for (const value of values) {
      h.saver.edit(record(value));
      await h.timers.advance(500);
    }
    await h.timers.advance(1499);
    assert.equal(h.calls.length, 0);
    await h.timers.advance(1);
    assert.deepEqual(h.calls, [record(values[2])]);
    assert.deepEqual(h.times, [2000]);
    assert.equal(h.times[0], h.drafts[2].editedAt);
    assert.equal(h.drafts.length, 3);
    assert.equal(h.removed, 1);
    assert.deepEqual(h.states, ['dirty', 'saving', 'saved']);
  });
}

test('edit: 受け取った記録をあとから書きかえられても、下書きと送る内容は変わらない', async () => {
  const h = setup();
  const value = record('入力した内容');
  h.saver.edit(value);
  value.memo = 'あとから変更';
  await h.timers.advance(2000);
  assert.deepEqual(h.calls, [record('入力した内容')]);
  assert.equal(h.drafts[0].record.memo, '入力した内容');
});

test('保存中の edit: 二重に送らず、新しい保存が終わるまで下書きと未保存状態を残す', async () => {
  const first = deferred();
  const second = deferred();
  let count = 0;
  const h = setup({ save: () => (++count === 1 ? first.promise : second.promise) });
  h.saver.edit(record('最初'));
  await h.timers.advance(2000);
  h.saver.edit(record('追記'));
  await h.timers.advance(2000);
  assert.deepEqual(h.calls, [record('最初')]);
  first.resolve();
  await settle();
  assert.deepEqual(h.calls, [record('最初'), record('追記')]);
  assert.equal(h.timers.now(), 5000);
  assert.deepEqual(h.times, [1000, 3000]);
  assert.deepEqual(h.times, h.drafts.map((draft) => draft.editedAt));
  assert.equal(h.removed, 0);
  assert.equal(h.saver.dirty, true);
  assert.equal(h.states.includes('saved'), false);
  second.resolve();
  await settle();
  assert.equal(h.removed, 1);
  assert.equal(h.saver.state, 'saved');
  assert.equal(h.saver.dirty, false);
  assert.equal(h.timers.pending, 0);
});

for (const error of [new NetError('network'), new Error('送れません'), null]) {
  test(`保存失敗: ${error?.name ?? 'null'} でも 2・5・15 秒後に再試行し、4 回目で failed`, async () => {
    const h = setup({ save: () => { throw error; } });
    h.saver.edit(record('残す内容'));
    await h.timers.advance(2000);
    assert.equal(h.saver.state, 'retrying');
    let count = 1;
    for (const ms of [2000, 5000, 15000]) {
      await h.timers.advance(ms - 1);
      assert.equal(h.calls.length, count);
      await h.timers.advance(1);
      count += 1;
      assert.equal(h.calls.length, count);
      assert.equal(h.saver.state, count === 4 ? 'failed' : 'retrying');
    }
    assert.equal(h.saver.dirty, true);
    assert.equal(h.removed, 0);
    assert.equal(h.timers.pending, 0);
    assert.deepEqual(h.times, [1000, 1000, 1000, 1000]);
    assert.deepEqual(h.states, ['dirty', 'saving', 'retrying', 'saving', 'retrying', 'saving', 'retrying', 'saving', 'failed']);
  });
}

test('再試行の途中で成功したら、待ちを残さず saved', async () => {
  let count = 0;
  const h = setup({ save: () => { if (++count < 3) throw new NetError('network'); } });
  h.saver.edit(record('メモ'));
  await h.timers.advance(9000);
  assert.equal(h.calls.length, 3);
  assert.deepEqual(h.times, [1000, 1000, 1000]);
  assert.equal(h.saver.state, 'saved');
  assert.equal(h.removed, 1);
  await h.timers.advance(30000);
  assert.equal(h.calls.length, 3);
});

test('denied と空の retryMs は、1 回の失敗ですぐ failed', async () => {
  for (const options of [
    { save: () => { throw new NetError('denied'); } },
    { retryMs: [], save: () => { throw new Error('送れません'); } },
  ]) {
    const h = setup(options);
    h.saver.edit(record('メモ'));
    await h.timers.advance(60000);
    assert.equal(h.calls.length, 1);
    assert.equal(h.saver.state, 'failed');
    assert.equal(h.removed, 0);
    assert.equal(h.timers.pending, 0);
  }
});

test('failed のあと edit すると、待ち時間と再試行の回数を最初から使う', async () => {
  const h = setup({ save: () => { throw new NetError('network'); } });
  h.saver.edit(record('最初'));
  await h.timers.advance(24000);
  assert.equal(h.saver.state, 'failed');
  h.saver.edit(record('書き直し'));
  assert.equal(h.saver.state, 'dirty');
  await h.timers.advance(1999);
  assert.equal(h.calls.length, 4);
  await h.timers.advance(1);
  assert.equal(h.saver.state, 'retrying');
  await h.timers.advance(22000);
  assert.equal(h.calls.length, 8);
  assert.ok(h.calls.slice(4).every((value) => value.memo === '書き直し'));
  assert.equal(h.saver.state, 'failed');
});

for (const initial of ['failed', 'retrying']) {
  test(`retry: ${initial} から今すぐ送り直し、成功すれば true`, async () => {
    let fail = true;
    const h = setup({ save: () => { if (fail) throw new NetError('network'); } });
    h.saver.edit(record('メモ'));
    await h.timers.advance(initial === 'failed' ? 24000 : 2000);
    assert.equal(h.saver.state, initial);
    fail = false;
    const before = h.calls.length;
    assert.equal(await h.saver.retry(), true);
    assert.equal(h.saver.state, 'saved');
    assert.equal(h.removed, 1);
    await h.timers.advance(30000);
    assert.equal(h.calls.length, before + 1);
    assert.deepEqual(h.times, Array(before + 1).fill(h.drafts[0].editedAt));
  });
}

test('flush: 変更なしなら通信せず true。待っている変更は即時保存し、続けて呼んでも増えない', async () => {
  const h = setup();
  assert.equal(await h.saver.flush(), true);
  assert.equal(h.calls.length, 0);
  assert.equal(h.saver.state, 'idle');
  h.saver.edit(record('メモ'));
  assert.deepEqual(await Promise.all([h.saver.flush(), h.saver.flush()]), [true, true]);
  assert.equal(await h.saver.flush(), true);
  await h.timers.advance(30000);
  assert.equal(h.calls.length, 1);
  assert.equal(h.removed, 1);
});

test('flush と retry: 失敗なら false と failed。自動再試行せず下書きを残す', async () => {
  const h = setup({ save: () => { throw new Error('送れません'); } });
  h.saver.edit(record('メモ'));
  assert.equal(await h.saver.flush(), false);
  await h.timers.advance(60000);
  assert.equal(h.calls.length, 1);
  assert.equal(await h.saver.retry(), false);
  await h.timers.advance(60000);
  assert.equal(h.calls.length, 2);
  assert.equal(h.saver.state, 'failed');
  assert.equal(h.saver.dirty, true);
  assert.equal(h.removed, 0);
});

test('保存中の flush・retry・edit: 通信を共有し、残った変更の保存が終わるまで待つ', async () => {
  const first = deferred();
  const second = deferred();
  let count = 0;
  const h = setup({ save: () => (++count === 1 ? first.promise : second.promise) });
  h.saver.edit(record('最初'));
  await h.timers.advance(2000);
  let finished = false;
  const flushed = h.saver.flush().then((value) => { finished = true; return value; });
  const retried = h.saver.retry();
  h.saver.edit(record('途中の入力'));
  const again = h.saver.flush();
  await h.timers.advance(3000);
  assert.equal(finished, false);
  assert.equal(h.calls.length, 1);
  first.resolve();
  await settle();
  assert.equal(finished, false);
  assert.deepEqual(h.calls, [record('最初'), record('途中の入力')]);
  assert.equal(h.removed, 0);
  second.resolve();
  assert.deepEqual(await Promise.all([flushed, retried, again]), [true, true, true]);
  assert.equal(h.removed, 1);
});

test('保存中の flush: その通信が失敗したら自動再試行せず false', async () => {
  const request = deferred();
  const h = setup({ save: () => request.promise });
  h.saver.edit(record('メモ'));
  await h.timers.advance(2000);
  const flushed = h.saver.flush();
  request.reject(new NetError('network'));
  assert.equal(await flushed, false);
  await h.timers.advance(60000);
  assert.equal(h.calls.length, 1);
  assert.equal(h.saver.state, 'failed');
  assert.equal(h.removed, 0);
});

test('flush: 続けて送った新しい内容が失敗しても false を返し、下書きと failed を残す', async () => {
  const request = deferred();
  let count = 0;
  const h = setup({ save: () => {
    if (++count === 1) return request.promise;
    throw new NetError('network');
  } });
  h.saver.edit(record('最初'));
  const flushed = h.saver.flush();
  await settle();
  h.saver.edit(record('追記'));
  request.resolve();
  assert.equal(await flushed, false);
  await h.timers.advance(60000);
  assert.equal(h.calls.length, 2);
  assert.equal(h.saver.state, 'failed');
  assert.equal(h.saver.dirty, true);
  assert.equal(h.removed, 0);
});

test('通信の完了直後の edit も、待ち時間を過ぎれば必ず送る', async () => {
  const request = deferred();
  const h = setup({ save: () => request.promise });
  h.saver.edit(record('最初'));
  await h.timers.advance(2000);
  request.resolve();
  await request.promise;
  h.saver.edit(record('完了直後の入力'));
  await h.timers.advance(2000);
  assert.deepEqual(h.calls, [record('最初'), record('完了直後の入力')]);
  assert.equal(h.saver.state, 'saved');
});

test('再試行待ちの edit: 古い待ちをやめ、新しい内容を 2 秒後に送る', async () => {
  let fail = true;
  const h = setup({ save: () => { if (fail) throw new NetError('network'); } });
  h.saver.edit(record('最初'));
  await h.timers.advance(4000);
  assert.equal(h.calls.length, 2);
  h.saver.edit(record('新しい内容'));
  fail = false;
  await h.timers.advance(1999);
  assert.equal(h.calls.length, 2);
  await h.timers.advance(1);
  assert.equal(h.calls[2].memo, '新しい内容');
  await h.timers.advance(30000);
  assert.equal(h.calls.length, 3);
});

test('saveDraft・removeDraft の例外や保存不可の戻り値があっても保存を続ける', async () => {
  for (const options of [
    { saveDraft: () => { throw new Error('端末に保存できません'); } },
    { saveDraft: () => false },
    { removeDraft: () => { throw new Error('下書きを消せません'); } },
  ]) {
    const h = setup(options);
    assert.doesNotThrow(() => h.saver.edit(record('メモ')));
    assert.equal(await h.saver.flush(), true);
    assert.equal(h.calls.length, 1);
    assert.equal(h.saver.state, 'saved');
    assert.equal(h.saver.dirty, false);
  }
});

test('dispose: 二度呼んでも安全で、停止したタイマーが呼ばれても何もしない', async () => {
  const h = setup();
  h.saver.edit(record('メモ'));
  const callback = h.timers.callbacks[0];
  h.saver.dispose();
  assert.doesNotThrow(() => h.saver.dispose());
  callback();
  h.saver.edit(record('片付け後'));
  assert.equal(await h.saver.flush(), false);
  assert.equal(await h.saver.retry(), false);
  await h.timers.advance(60000);
  assert.equal(h.calls.length, 0);
  assert.equal(h.drafts.length, 1);
  assert.equal(h.removed, 0);
  assert.deepEqual(h.states, ['dirty']);
  assert.equal(h.timers.pending, 0);
});

test('再試行待ちの dispose も、タイマーと通知を止める', async () => {
  const h = setup({ save: () => { throw new NetError('network'); } });
  h.saver.edit(record('メモ'));
  await h.timers.advance(2000);
  assert.equal(h.saver.state, 'retrying');
  const states = [...h.states];
  h.saver.dispose();
  await h.timers.advance(60000);
  assert.equal(h.calls.length, 1);
  assert.equal(h.removed, 0);
  assert.deepEqual(h.states, states);
});

for (const success of [true, false]) {
  test(`保存中の dispose: ${success ? '成功' : '失敗'}後も通知と追加の保存をせず、下書きを残す`, async () => {
    const request = deferred();
    const h = setup({ save: () => request.promise });
    h.saver.edit(record('最初'));
    await h.timers.advance(2000);
    h.saver.edit(record('追記'));
    const states = [...h.states];
    h.saver.dispose();
    if (success) request.resolve();
    else request.reject(new NetError('network'));
    await settle();
    await h.timers.advance(60000);
    assert.equal(h.calls.length, 1);
    assert.equal(h.removed, 0);
    assert.equal(h.saver.dirty, true);
    assert.deepEqual(h.states, states);
  });
}
