import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOfflineNet } from '../js/offline-net.js';
import { createOfflineStore } from '../js/offline-store.js';
import { NetError } from '../js/errors.js';

function setup() {
  const h = { uid: 'u1', epoch: 0, error: null, value: { memo: '見本' }, calls: [] };
  const net = Object.fromEntries(['get', 'getPublic', 'set', 'update', 'remove'].map((method) => [method, async (...args) => {
    h.calls.push([method, ...args]);
    if (h.error) throw h.error;
    return h.value;
  }]));
  net.serverTimestamp = () => ({ '.sv': 'timestamp' });
  h.store = createOfflineStore({});
  h.raw = net;
  h.net = createOfflineNet({ net, store: h.store, scope: () => h.uid, generation: () => h.epoch });
  return h;
}

test('ネットで読んだ値と null を取り置き、network のときだけ返す', async () => {
  const h = setup();
  for (const value of [{ memo: '見本' }, null]) {
    h.error = null; h.value = value;
    assert.deepEqual(await h.net.get('p'), value);
    assert.deepEqual(await h.store.get('u1', 'p'), { value });
    assert.equal(h.net.stale, false);
    h.error = new NetError('network');
    assert.deepEqual(await h.net.get('p'), value);
    assert.equal(h.net.stale, true);
  }
  await assert.rejects(h.net.get('missing'), (e) => e === h.error);
});

test('先生など scope が null のときは取り置きを使わず、getPublic も常にそのまま', async () => {
  const h = setup(); h.uid = null;
  await h.net.get('p', { shallow: true });
  assert.equal(await h.store.get(null, 'p?shallow'), null);
  h.error = new NetError('network');
  await assert.rejects(h.net.get('p'), (e) => e === h.error);
  await assert.rejects(h.net.getPublic('p'), (e) => e === h.error);
  assert.deepEqual(h.calls[0], ['get', 'p', { shallow: true }]);
  assert.deepEqual(h.net.serverTimestamp(), { '.sv': 'timestamp' });
  h.error = null; await h.net.getPublic('public');
  assert.equal(await h.store.get('u1', 'public'), null);
});

test('権限・認証・不明な失敗と NetError でない失敗では、取り置きを返さない', async () => {
  const h = setup(); await h.net.get('p');
  for (const error of [new NetError('denied'), new NetError('auth'), new NetError('unknown'), Object.assign(new Error(), { code: 'network' })]) {
    h.error = error;
    await assert.rejects(h.net.get('p'), (e) => e === error);
    assert.equal(h.net.stale, false);
  }
});

test('shallow のキーは通常の読み取りと区別する', async () => {
  const h = setup(); h.value = '全体'; await h.net.get('p');
  h.value = 'キーだけ'; await h.net.get('p', { shallow: true });
  h.error = new NetError('network');
  assert.equal(await h.net.get('p'), '全体');
  assert.equal(await h.net.get('p', { shallow: true }), 'キーだけ');
});

test('stale が変わったときだけ通知し、解除・投げる相手にも対応する', async () => {
  const h = setup(); const seen = [];
  const off = h.net.onChange((value) => seen.push(value));
  h.net.onChange(() => { throw new Error('表示の失敗'); });
  await h.net.get('p'); h.error = new NetError('network');
  await h.net.get('p'); await h.net.get('p');
  h.error = null; await h.net.set('elsewhere', {}); await h.net.get('p');
  assert.deepEqual(seen, [true, false]);
  off(); h.error = new NetError('network'); await h.net.get('p');
  assert.deepEqual(seen, [true, false]);
  h.uid = null;
  assert.equal(h.net.stale, false, '前の生徒の印をログアウト後に出さない');
});

for (const method of ['set', 'remove', 'update']) {
  test(`${method} の成功で同じ場所・親・子を消し、l10 と別の生徒は残す`, async () => {
    const h = setup();
    const removed = ['', 'records/c1', 'records/c1?shallow', 'records/c1/l1/s1', 'records/c1/l1/s1/ink'];
    const kept = ['records/c1/l10/s1', 'records/c1/l1/s10', 'other'];
    for (const key of [...removed, ...kept]) await h.store.put('u1', key, 1);
    await h.store.put('u2', 'records/c1', 2);
    if (method === 'update') await h.net.update('records/c1/l1', { 's1/memo': '見本', 's1/ink': null });
    else await h.net[method]('records/c1/l1/s1', {});
    for (const key of removed) assert.equal(await h.store.get('u1', key), null, key);
    for (const key of kept) assert.deepEqual(await h.store.get('u1', key), { value: 1 }, key);
    assert.deepEqual(await h.store.get('u2', 'records/c1'), { value: 2 });
  });

  test(`${method} の失敗はそのまま返し、取り置きを消さない`, async () => {
    const h = setup(); await h.net.get('p'); h.error = new NetError('network'); await h.net.get('p');
    await assert.rejects(h.net[method]('p', { child: 1 }), (e) => e === h.error);
    assert.deepEqual(await h.store.get('u1', 'p'), { value: h.value });
    assert.equal(h.net.stale, true);
  });
}

test('ルートの update は patch の各キーにかかる取り置きだけ消す', async () => {
  const h = setup();
  for (const key of ['a', 'a/b', 'c/d', 'c/d/e', 'c/keep', 'keep']) await h.store.put('u1', key, key);
  await h.net.update('', { 'a/b': 1, 'c/d': 2 });
  for (const key of ['a', 'a/b', 'c/d', 'c/d/e']) assert.equal(await h.store.get('u1', key), null);
  for (const key of ['c/keep', 'keep']) assert.deepEqual(await h.store.get('u1', key), { value: key });
});

test('待つ間に scope が変わると、取り置きに書かず、取り置きからも返さない', async () => {
  for (const fail of [false, true]) {
    const h = setup(); await h.store.put('u1', 'p', '古い値');
    let release;
    const error = new NetError('network');
    h.raw.get = () => new Promise((resolve, reject) => { release = () => fail ? reject(error) : resolve('新しい値'); });
    const result = h.net.get('p');
    h.uid = 'u2'; await h.store.clear(); release();
    if (fail) await assert.rejects(result, (e) => e === error);
    else assert.equal(await result, '新しい値');
    assert.equal(await h.store.get('u1', 'p'), null);
    assert.equal(await h.store.get('u2', 'p'), null);
  }
});

test('取り置きの読み取りを待つ間に scope が変わっても返さない', async () => {
  const h = setup(); let release;
  h.error = new NetError('network');
  h.store.get = () => new Promise((resolve) => { release = resolve; });
  const result = h.net.get('p'); await Promise.resolve();
  h.uid = null; release({ value: '古い値' });
  await assert.rejects(result, (e) => e === h.error);
});

test('同じ場所の同時読み取りは両方返し、あとで届いた値を取り置く', async () => {
  const h = setup(); const releases = [];
  h.raw.get = () => new Promise((resolve) => releases.push(resolve));
  const first = h.net.get('p'); const second = h.net.get('p');
  releases[1](2); assert.equal(await second, 2);
  releases[0](1); assert.equal(await first, 1);
  assert.deepEqual(await h.store.get('u1', 'p'), { value: 1 });
});

for (const method of ['set', 'update', 'remove']) {
  test(`${method}: 別授業への書きこみ開始・成功で、読み取り中の授業の取り置きを妨げない`, async () => {
    for (const beforeWrite of [true, false]) {
      const h = setup(); let readDone, writeDone;
      const path = 'records/c1/l1/s1';
      h.raw.get = () => new Promise((resolve) => { readDone = resolve; });
      h.raw[method] = () => new Promise((resolve) => { writeDone = resolve; });
      let reading;
      if (beforeWrite) reading = h.net.get(path);
      const writing = h.net[method]('records/c1/l10/s1', { memo: '別授業の記録' });
      if (!beforeWrite) reading = h.net.get(path);
      writeDone(); await writing; readDone('読み直した記録');
      assert.equal(await reading, '読み直した記録');
      assert.deepEqual(await h.store.get('u1', path), { value: '読み直した記録' });
      h.raw.get = async () => { throw new NetError('network'); };
      assert.equal(await h.net.get(path), '読み直した記録');
    }
  });

  test(`${method}: 同じ場所・親・子の読み取りだけ取り置かず、shallow でも同じ判定にする`, async () => {
    for (const path of ['', 'records/c1/l1', 'records/c1/l1/s1', 'records/c1/l1/s1/ink', 'records/c1/l1/s1/ink/memo']) {
      for (const shallow of [false, true]) {
        const h = setup(); let readDone;
        h.raw.get = () => new Promise((resolve) => { readDone = resolve; });
        const reading = h.net.get(path, { shallow });
        await h.net[method]('records/c1/l1/s1', { ink: null });
        readDone('書く前の値'); assert.equal(await reading, '書く前の値');
        assert.equal(await h.store.get('u1', shallow ? `${path}?shallow` : path), null);
      }
    }
  });

  test(`${method}: 書きこみが失敗しても、その開始前の関連する読み取りは取り置かない`, async () => {
    const h = setup(); let readDone;
    await h.store.put('u1', 'p', '前の取り置き');
    h.raw.get = () => new Promise((resolve) => { readDone = resolve; });
    const reading = h.net.get('p');
    h.error = new NetError('network');
    await assert.rejects(h.net[method]('p', { child: 1 }), (e) => e === h.error);
    readDone('書く前の値'); await reading;
    assert.deepEqual(await h.store.get('u1', 'p'), { value: '前の取り置き' });
  });

  test(`${method}: 書きこみ開始前の読み取りは、書きこみの完了前・成功後とも取り置かない`, async () => {
    for (const afterSuccess of [false, true]) {
      const h = setup(); await h.store.put('u1', 'p', '前の値');
      let readDone, writeDone;
      h.raw.get = () => new Promise((resolve) => { readDone = resolve; });
      h.raw[method] = () => new Promise((resolve) => { writeDone = resolve; });
      const reading = h.net.get('p'); const writing = h.net[method]('p', { child: 1 });
      if (afterSuccess) { writeDone(); await writing; }
      readDone('遅い値'); assert.equal(await reading, '遅い値');
      assert.deepEqual(await h.store.get('u1', 'p'), afterSuccess ? null : { value: '前の値' });
      if (!afterSuccess) { writeDone(); await writing; }
      assert.equal(await h.store.get('u1', 'p'), null);
    }
  });

  test(`${method}: 書きこみ中に始めた読み取りも、成功後に届いたら取り置かない`, async () => {
    const h = setup(); let readDone, writeDone;
    h.raw.get = () => new Promise((resolve) => { readDone = resolve; });
    h.raw[method] = () => new Promise((resolve) => { writeDone = resolve; });
    const writing = h.net[method]('p', { child: 1 }); const reading = h.net.get('p');
    writeDone(); await writing; readDone('遅い値'); await reading;
    assert.equal(await h.store.get('u1', 'p'), null);
  });

  test(`${method}: 同じ uid で再ログイン後の取り置きは、前の書きこみの成功で消さない`, async () => {
    const h = setup(); let release;
    h.raw[method] = () => new Promise((resolve) => { release = resolve; });
    const writing = h.net[method]('p', { child: 1 });
    h.uid = null; h.epoch++; h.uid = 'u1';
    await h.store.put('u1', 'p', '再ログイン後');
    release(); await writing;
    assert.deepEqual(await h.store.get('u1', 'p'), { value: '再ログイン後' });
  });
}

test('ルートの update でも、patch の場所と関係のない授業の読み取りは取り置く', async () => {
  const h = setup(); const reads = new Map();
  h.raw.get = (path) => new Promise((resolve) => reads.set(path, resolve));
  const paths = ['records/c1/l1/s1', 'records/c1/l10/s1', 'records/c1/l1/s10', 'records/c1'];
  const pending = paths.map((path) => h.net.get(path));
  await h.net.update('', { 'records/c1/l1/s1/memo': '新しい値', 'other/value': 1 });
  for (const [path, resolve] of reads) resolve(path);
  await Promise.all(pending);
  for (const path of [paths[0], paths[3]]) assert.equal(await h.store.get('u1', path), null);
  for (const path of [paths[1], paths[2]]) assert.deepEqual(await h.store.get('u1', path), { value: path });
});

test('同じ uid で再ログイン後の読み取りは、前の書きこみが成功しても取り置く', async () => {
  const h = setup(); let readDone, writeDone;
  h.raw.set = () => new Promise((resolve) => { writeDone = resolve; });
  h.raw.get = () => new Promise((resolve) => { readDone = resolve; });
  const writing = h.net.set('p', {});
  h.epoch++;
  const reading = h.net.get('p');
  writeDone(); await writing; readDone('再ログイン後'); await reading;
  assert.deepEqual(await h.store.get('u1', 'p'), { value: '再ログイン後' });
});

test('同じ uid で再ログイン後は、前の読み取りを取り置かず、失敗しても取り置きを返さない', async () => {
  for (const fail of [false, true]) {
    const h = setup(); let release;
    const error = new NetError('network');
    h.raw.get = () => new Promise((resolve, reject) => { release = () => fail ? reject(error) : resolve('古い値'); });
    const reading = h.net.get('p');
    h.uid = null; h.epoch++; await h.store.clear(); h.uid = 'u1';
    await h.store.put('u1', 'p', '再ログイン後'); release();
    if (fail) await assert.rejects(reading, (e) => e === error); else assert.equal(await reading, '古い値');
    assert.deepEqual(await h.store.get('u1', 'p'), { value: '再ログイン後' });
  }
});

test('取り置きの読み取り中に同じ uid で再ログインしても、前の結果を返さない', async () => {
  const h = setup(); let release;
  h.error = new NetError('network');
  h.store.get = () => new Promise((resolve) => { release = resolve; });
  const reading = h.net.get('p'); await Promise.resolve();
  h.epoch++; release({ value: '前の結果' });
  await assert.rejects(reading, (e) => e === h.error);
});

test('generation を省略しても取り置け、世代が変わったら前の stale を出さない', async () => {
  const h = setup();
  const net = createOfflineNet({ net: h.raw, store: h.store, scope: () => h.uid });
  await net.get('p'); h.error = new NetError('network');
  assert.deepEqual(await net.get('p'), h.value);
  await h.net.get('p'); assert.equal(h.net.stale, true);
  h.epoch++; assert.equal(h.net.stale, false);
});
