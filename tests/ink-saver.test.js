// 手書きの保存間隔、下書き、再試行を、時計とタイマーの代役で確かめる。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createInkSaver } from '../js/ink-saver.js';
import { NetError } from '../js/errors.js';

const ink = (x) => ({ v: 1, h: 400, s: [{ c: 0, w: 0, p: [0, 0, x, 20] }] });
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
  const drafts = [];
  const states = [];
  let removed = 0;
  let keys = 0;
  const saver = createInkSaver({
    now: timers.now, setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout,
    delayMs: 3000, intervalMs: 30000, retryMs: options.retryMs ?? [2000, 5000, 15000],
    newKey: () => `key-${++keys}`,
    save(value, editedAt, key) {
      calls.push({ ink: value, editedAt, key, startedAt: timers.now() });
      return options.save?.(value, editedAt, key);
    },
    saveDraft(value, editedAt, key) {
      drafts.push({ ink: value, editedAt, key });
      return options.saveDraft?.(value, editedAt, key);
    },
    removeDraft() { removed += 1; options.removeDraft?.(); },
    onState(state) { states.push(state); options.onState?.(state); },
  });
  return { saver, timers, calls, drafts, states, get removed() { return removed; } };
}

test('edit: 下書きをすぐ残し、初回は delayMs 後に保存する', async () => {
  const h = setup();
  assert.equal(h.saver.state, 'idle');
  assert.equal(h.saver.dirty, false);
  h.saver.edit(ink(10));
  assert.deepEqual(h.drafts, [{ ink: ink(10), editedAt: 1000, key: 'key-1' }]);
  assert.equal(h.saver.dirty, true);
  await h.timers.advance(2999);
  assert.equal(h.calls.length, 0);
  await h.timers.advance(1);
  assert.deepEqual(h.calls, [{ ...h.drafts[0], startedAt: 4000 }]);
  assert.deepEqual(h.states, ['dirty', 'saving', 'saved']);
  assert.equal(h.saver.dirty, false);
  assert.equal(h.removed, 1);
});

test('続けて書くと、最後の edit から delayMs 待ち、最後の内容を送る', async () => {
  const h = setup();
  h.saver.edit(ink(10));
  await h.timers.advance(1000);
  h.saver.edit(ink(20));
  await h.timers.advance(1000);
  h.saver.edit(ink(30));
  await h.timers.advance(2999);
  assert.equal(h.calls.length, 0);
  await h.timers.advance(1);
  assert.deepEqual(h.calls, [{ ink: ink(30), editedAt: 3000, key: 'key-3', startedAt: 6000 }]);
});

test('前の保存開始から intervalMs と最後の edit から delayMs の、おそい方を待つ', async () => {
  const h = setup();
  h.saver.edit(ink(10));
  await h.timers.advance(3000);
  h.saver.edit(ink(20));
  await h.timers.advance(29999);
  assert.equal(h.calls.length, 1);
  await h.timers.advance(1);
  assert.equal(h.calls[1].startedAt, 34000);
  await h.timers.advance(29000);
  h.saver.edit(ink(30));
  await h.timers.advance(2999);
  assert.equal(h.calls.length, 2);
  await h.timers.advance(1);
  assert.equal(h.calls[2].startedAt, 66000);
});

test('下書きの時刻とキーを引きついでも、開いた時から delayMs 待つ', async () => {
  const h = setup();
  await h.timers.advance(100000);
  h.saver.edit(ink(10), { editedAt: 100, key: 'restored' });
  await h.timers.advance(2999);
  assert.equal(h.calls.length, 0);
  await h.timers.advance(1);
  assert.deepEqual(h.calls, [{ ink: ink(10), editedAt: 100, key: 'restored', startedAt: 104000 }]);
  h.saver.edit(ink(20));
  assert.deepEqual(h.drafts[1], { ink: ink(20), editedAt: 104000, key: 'key-1' });
});

test('edit のあと元の配列を書きかえても、下書きと送る線は変わらない', async () => {
  const h = setup();
  const value = ink(10);
  h.saver.edit(value);
  value.s[0].p[2] = 50;
  await h.saver.flush();
  assert.deepEqual(h.calls[0].ink, ink(10));
  assert.deepEqual(h.drafts[0].ink, ink(10));
});

test('flush: 変更なしは true。delayMs と intervalMs を待たずに保存する', async () => {
  const h = setup();
  assert.equal(await h.saver.flush(), true);
  assert.equal(h.calls.length, 0);
  h.saver.edit(ink(10));
  assert.equal(await h.saver.flush(), true);
  h.saver.edit(ink(20));
  assert.equal(await h.saver.flush(), true);
  assert.deepEqual(h.calls.map((call) => call.startedAt), [1000, 1000]);
  await h.timers.advance(60000);
  assert.equal(h.calls.length, 2);
});

test('失敗 → retryMs 後に同じキー・時刻で再試行 → 成功', async () => {
  let attempts = 0;
  const h = setup({ save() { if (++attempts < 3) throw new NetError('network'); } });
  h.saver.edit(ink(10));
  await h.timers.advance(3000);
  assert.equal(h.saver.state, 'retrying');
  await h.timers.advance(1999);
  assert.equal(h.calls.length, 1);
  await h.timers.advance(1);
  await h.timers.advance(4999);
  assert.equal(h.calls.length, 2);
  await h.timers.advance(1);
  assert.equal(h.saver.state, 'saved');
  assert.equal(h.removed, 1);
  assert.deepEqual(h.calls.map(({ key, editedAt }) => [key, editedAt]), Array(3).fill(['key-1', 1000]));
  assert.deepEqual(h.calls.map((call) => call.startedAt), [4000, 6000, 11000]);
  assert.equal(h.timers.pending, 0);
});

test('再試行を使い切ったら failed。retry で今すぐ同じキーを送り直せる', async () => {
  let fail = true;
  const h = setup({ save() { if (fail) throw new Error('送れません'); } });
  h.saver.edit(ink(10));
  await h.timers.advance(25000);
  assert.equal(h.calls.length, 4);
  assert.equal(h.saver.state, 'failed');
  assert.equal(h.saver.dirty, true);
  assert.equal(h.removed, 0);
  assert.equal(h.timers.pending, 0);
  fail = false;
  assert.equal(await h.saver.retry(), true);
  assert.equal(h.calls[4].key, 'key-1');
  assert.equal(h.saver.state, 'saved');
});

test('retrying の retry は残ったタイマーを取り消して今すぐ送る', async () => {
  let fail = true;
  const h = setup({ save() { if (fail) throw new NetError('network'); } });
  h.saver.edit(ink(10));
  await h.timers.advance(3000);
  fail = false;
  assert.equal(await h.saver.retry(), true);
  assert.equal(h.calls[1].startedAt, 4000);
  await h.timers.advance(60000);
  assert.equal(h.calls.length, 2);
});

for (const error of [new NetError('denied'), { code: 'denied' }]) {
  test('denied は再試行せず failed にして下書きを残す', async () => {
    const h = setup({ save() { throw error; } });
    h.saver.edit(ink(10));
    await h.timers.advance(60000);
    assert.equal(h.calls.length, 1);
    assert.equal(h.saver.state, 'failed');
    assert.equal(h.removed, 0);
    assert.equal(h.timers.pending, 0);
  });
}

test('保存中の edit: 前の保存の完了で下書きを消さず、間隔を空けて次を送る', async () => {
  const first = deferred();
  const h = setup({ save: () => h.calls.length === 1 ? first.promise : undefined });
  h.saver.edit(ink(10));
  await h.timers.advance(3000);
  h.saver.edit(ink(20));
  await h.timers.advance(5000);
  first.resolve();
  await settle();
  assert.equal(h.removed, 0);
  assert.equal(h.saver.dirty, true);
  assert.equal(h.saver.state, 'dirty');
  await h.timers.advance(24999);
  assert.equal(h.calls.length, 1);
  await h.timers.advance(1);
  assert.equal(h.calls[1].startedAt, 34000);
  assert.equal(h.calls[1].key, 'key-2');
  assert.equal(h.removed, 1);
});

test('長い保存の直前に書き足した場合も、最後の edit から delayMs 待つ', async () => {
  const first = deferred();
  const h = setup({ save: () => h.calls.length === 1 ? first.promise : undefined });
  h.saver.edit(ink(10));
  await h.timers.advance(33000);
  h.saver.edit(ink(20));
  first.resolve();
  await settle();
  await h.timers.advance(2999);
  assert.equal(h.calls.length, 1);
  await h.timers.advance(1);
  assert.equal(h.calls[1].startedAt, 37000);
});

test('保存中の flush は同じ通信を待ち、残りを間隔なしで続けて保存する', async () => {
  const first = deferred();
  const second = deferred();
  const h = setup({ save: () => h.calls.length === 1 ? first.promise : second.promise });
  h.saver.edit(ink(10));
  await h.timers.advance(3000);
  h.saver.edit(ink(20));
  let done = false;
  const flushed = h.saver.flush();
  assert.equal(h.saver.flush(), flushed);
  flushed.then(() => { done = true; });
  first.resolve();
  await settle();
  assert.equal(h.calls.length, 2);
  assert.equal(h.removed, 0);
  assert.equal(done, false);
  second.resolve();
  assert.equal(await flushed, true);
  assert.equal(h.removed, 1);
  assert.equal(h.timers.pending, 0);
});

test('flush で失敗したら false を返し、次の画面で送り直せるよう下書きを残す', async () => {
  const h = setup({ save() { throw new NetError('network'); } });
  h.saver.edit(ink(10));
  assert.equal(await h.saver.flush(), false);
  assert.equal(h.saver.state, 'failed');
  assert.equal(h.saver.dirty, true);
  assert.equal(h.timers.pending, 0);
  assert.equal(h.removed, 0);
});

test('古い内容の保存失敗後も、新しい edit は専用のキーと待ち時間で送る', async () => {
  const first = deferred();
  const h = setup({ save: () => h.calls.length === 1 ? first.promise : undefined });
  h.saver.edit(ink(10));
  await h.timers.advance(3000);
  h.saver.edit(ink(20));
  first.reject(new NetError('network'));
  await settle();
  assert.equal(h.saver.state, 'dirty');
  await h.timers.advance(29999);
  assert.equal(h.calls.length, 1);
  await h.timers.advance(1);
  assert.equal(h.calls[1].key, 'key-2');
  assert.equal(h.saver.state, 'saved');
});

test('flush の途中で古い内容が失敗しても、残った新しい内容を保存する', async () => {
  const first = deferred();
  const h = setup({ save: () => h.calls.length === 1 ? first.promise : undefined });
  h.saver.edit(ink(10));
  await h.timers.advance(3000);
  h.saver.edit(ink(20));
  const flushed = h.saver.flush();
  first.reject(new NetError('network'));
  assert.equal(await flushed, true);
  assert.equal(h.calls[1].key, 'key-2');
  assert.equal(h.removed, 1);
});

test('新しい edit で再試行の回数を最初から使う', async () => {
  const h = setup({ retryMs: [2000], save() { throw new NetError('network'); } });
  h.saver.edit(ink(10));
  await h.timers.advance(5000);
  assert.equal(h.saver.state, 'failed');
  h.saver.edit(ink(20));
  await h.timers.advance(30000);
  assert.equal(h.saver.state, 'retrying');
  await h.timers.advance(2000);
  assert.equal(h.saver.state, 'failed');
  assert.deepEqual(h.calls.map((call) => call.key), ['key-1', 'key-1', 'key-2', 'key-2']);
});

test('下書きの保存・削除で例外が出ても、通信の保存は成功する', async () => {
  const h = setup({ saveDraft() { throw new Error('残せません'); }, removeDraft() { throw new Error('消せません'); } });
  h.saver.edit(ink(10));
  assert.equal(await h.saver.flush(), true);
  assert.equal(h.saver.state, 'saved');
});

test('古いタイマーは無視し、dispose 後は edit・flush・retry も何もしない', async () => {
  const h = setup();
  h.saver.edit(ink(10));
  const old = h.timers.callbacks[0];
  h.saver.edit(ink(20));
  old();
  await settle();
  assert.equal(h.calls.length, 0);
  h.saver.dispose();
  const states = [...h.states];
  for (const fn of h.timers.callbacks) fn();
  h.saver.edit(ink(30));
  assert.equal(await h.saver.flush(), false);
  await h.saver.retry();
  await h.timers.advance(60000);
  assert.equal(h.calls.length, 0);
  assert.equal(h.drafts.length, 2);
  assert.deepEqual(h.states, states);
  assert.equal(h.timers.pending, 0);
});

for (const fail of [false, true]) {
  test(`保存中の dispose: 遅れて${fail ? '失敗' : '成功'}しても下書き・状態を変えない`, async () => {
    const wait = deferred();
    const h = setup({ save: () => wait.promise });
    h.saver.edit(ink(10));
    const flushed = h.saver.flush();
    await settle();
    h.saver.dispose();
    const states = [...h.states];
    if (fail) wait.reject(new Error('送れません'));
    else wait.resolve();
    assert.equal(await flushed, false);
    assert.equal(h.removed, 0);
    assert.equal(h.timers.pending, 0);
    assert.deepEqual(h.states, states);
  });
}

test('saving の通知で dispose されても、通信を始めない', async () => {
  const h = setup({ onState(state) { if (state === 'saving') h.saver.dispose(); } });
  h.saver.edit(ink(10));
  assert.equal(await h.saver.flush(), false);
  assert.equal(h.calls.length, 0);
});
