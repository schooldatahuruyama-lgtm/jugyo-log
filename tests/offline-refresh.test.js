import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOfflineRefresh } from '../js/offline-refresh.js';

function setup() {
  let time = 0;
  let serial = 0;
  const jobs = new Map();
  const calls = [];
  const repo = { getRecord: async (...args) => { calls.push(args); } };
  const h = { repo, calls, jobs,
    setTimeout(fn, ms) { jobs.set(++serial, { fn, at: time + ms }); return serial; },
    clearTimeout(id) { jobs.delete(id); },
    async advance(ms) {
      time += ms;
      for (const [id, job] of [...jobs]) if (job.at <= time) { jobs.delete(id); await job.fn(); }
    },
  };
  return { ...h, refresh: createOfflineRefresh({ ...h, delayMs: 3000 }) };
}

test('同じ授業・生徒の touch 3 回は、最後の呼び出しから 3000ms 後に 1 回だけ読む', async () => {
  const h = setup();
  h.refresh.touch('c1', 'l1', 's1'); await h.advance(1000);
  h.refresh.touch('c1', 'l1', 's1'); await h.advance(1000);
  h.refresh.touch('c1', 'l1', 's1'); await h.advance(2999);
  assert.equal(h.jobs.size, 1); assert.deepEqual(h.calls, []);
  await h.advance(1); await h.advance(3000);
  assert.deepEqual(h.calls, [['c1', 'l1', 's1']]);
});

test('授業・クラス・生徒が違えば、それぞれの待ち時間で読む', async () => {
  const h = setup();
  const keys = [['c1', 'l1', 's1'], ['c1', 'l2', 's1'], ['c2', 'l1', 's1'], ['c1', 'l1', 's2']];
  h.refresh.touch(...keys[0]); await h.advance(1000);
  keys.slice(1).forEach((args) => h.refresh.touch(...args));
  await h.advance(2000); assert.deepEqual(h.calls, keys.slice(0, 1));
  await h.advance(1000); assert.deepEqual(h.calls, keys);
});

test('clear は待っている全件を止め、取り消されたコールバックも読まない。その後は再利用できる', async () => {
  const h = setup();
  h.refresh.touch('c1', 'l1', 's1'); h.refresh.touch('c1', 'l2', 's1');
  const callbacks = [...h.jobs.values()].map((job) => job.fn);
  h.refresh.clear(); h.refresh.clear(); await h.advance(3000);
  for (const fn of callbacks) await fn();
  assert.deepEqual(h.calls, []);
  h.refresh.touch('c1', 'l1', 's1'); await h.advance(3000);
  assert.deepEqual(h.calls, [['c1', 'l1', 's1']]);
});

test('読み取りの同期・非同期の失敗を無視し、次の touch を受け付ける', async () => {
  for (const sync of [true, false]) {
    const h = setup();
    h.repo.getRecord = () => { if (sync) throw new Error('offline'); return Promise.reject(new Error('offline')); };
    h.refresh.touch('c1', 'l1', 's1'); await h.advance(3000);
    assert.equal(h.jobs.size, 0);
    h.repo.getRecord = async (...args) => h.calls.push(args);
    h.refresh.touch('c1', 'l1', 's1'); await h.advance(3000);
    assert.deepEqual(h.calls, [['c1', 'l1', 's1']]);
  }
});
