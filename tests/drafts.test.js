// 端末の下書きと、保存先が使えない場合を確かめる
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDrafts } from '../js/drafts.js';

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

const record = { memo: 'メモ', level: null, learned: '', question: '' };
const key = 'jugyolog:draft:s26-001:c1:l1';

test('drafts: 保存・取得・上書き・remove。別のインスタンスからも読める', () => {
  const storage = fakeStorage();
  const drafts = createDrafts({ storage });
  assert.equal(drafts.get('s26-001', 'c1', 'l1'), null);
  assert.equal(drafts.put('s26-001', 'c1', 'l1', record, 1000), true);
  assert.deepEqual(JSON.parse(storage.getItem(key)), { record, editedAt: 1000 });
  assert.deepEqual(createDrafts({ storage }).get('s26-001', 'c1', 'l1'), { record, editedAt: 1000 });
  assert.equal(drafts.put('s26-001', 'c1', 'l1', { ...record, memo: '新しいメモ' }, 2000), true);
  assert.equal(storage.length, 1);
  assert.deepEqual(drafts.get('s26-001', 'c1', 'l1'), { record: { ...record, memo: '新しいメモ' }, editedAt: 2000 });
  drafts.remove('s26-001', 'c1', 'l1');
  assert.equal(drafts.get('s26-001', 'c1', 'l1'), null);
});

test('drafts: list はその生徒だけ。clear は全員の下書きだけを消す', () => {
  const storage = fakeStorage();
  const drafts = createDrafts({ storage });
  storage.setItem('jugyolog:auth', 'そのまま残す');
  drafts.put('s26-001', 'c1', 'l1', record, 1000);
  drafts.put('s26-001', 'c2', 'l2', record, 2000);
  drafts.put('s26-002', 'c1', 'l1', record, 3000);
  drafts.put('s26-0010', 'c1', 'l1', record, 4000);
  assert.deepEqual(drafts.list('s26-001'), [
    { classId: 'c1', lessonId: 'l1', record, editedAt: 1000 },
    { classId: 'c2', lessonId: 'l2', record, editedAt: 2000 },
  ]);
  assert.deepEqual(drafts.list('s26-003'), []);
  storage.setItem('jugyolog:draft:broken', 'こわれた下書き');
  drafts.clear();
  assert.equal(storage.length, 1);
  assert.equal(storage.getItem('jugyolog:auth'), 'そのまま残す');
});

test('drafts: こわれた JSON・時刻・記録と、不完全なキーは一覧に入れない', () => {
  const storage = fakeStorage();
  const drafts = createDrafts({ storage });
  for (const value of ['{', 'null', '[]', '5', JSON.stringify({ record, editedAt: '1000' }),
    JSON.stringify({ record }), '{"record":{},"editedAt":1e400}',
    ...[null, [], 'x', 5].map((v) => JSON.stringify({ record: v, editedAt: 1000 }))]) {
    storage.setItem(key, value);
    assert.equal(drafts.get('s26-001', 'c1', 'l1'), null);
    assert.deepEqual(drafts.list('s26-001'), []);
  }
  storage.removeItem(key);
  for (const suffix of ['c1', ':l1', 'c1:', 'c1:l1:extra']) {
    storage.setItem(`jugyolog:draft:s26-001:${suffix}`, JSON.stringify({ record, editedAt: 1000 }));
  }
  assert.deepEqual(drafts.list('s26-001'), []);
});

test('drafts: 保存するのは記録の項目と時刻だけ', () => {
  const storage = fakeStorage();
  const drafts = createDrafts({ storage });
  drafts.put('s26-001', 'c1', 'l1', { ...record, extra: '不要な項目' }, 1000);
  assert.deepEqual(JSON.parse(storage.getItem(key)), { record, editedAt: 1000 });
});

test('drafts: 容量不足なら put は false。storage が null でも落ちない', () => {
  const fail = () => { throw new Error('保存先を使えません'); };
  const drafts = createDrafts({ storage: { ...fakeStorage(), setItem: fail } });
  assert.equal(drafts.put('s26-001', 'c1', 'l1', record, 1000), false);
  for (const storage of [null, undefined]) {
    const unavailable = createDrafts({ storage });
    assert.equal(unavailable.put('s26-001', 'c1', 'l1', record, 1000), false);
    assert.equal(unavailable.get('s26-001', 'c1', 'l1'), null);
    assert.deepEqual(unavailable.list('s26-001'), []);
    assert.doesNotThrow(() => unavailable.remove('s26-001', 'c1', 'l1'));
    assert.doesNotThrow(() => unavailable.clear());
  }
});

test('drafts: 読み取り・列挙・削除が例外を投げても落ちない', () => {
  for (const failing of ['getItem', 'key', 'length', 'removeItem']) {
    const storage = fakeStorage();
    const drafts = createDrafts({ storage });
    drafts.put('s26-001', 'c1', 'l1', record, 1000);
    drafts.put('s26-001', 'c1', 'l2', record, 2000);
    const fail = () => { throw new Error('保存先を使えません'); };
    if (failing === 'length') Object.defineProperty(storage, 'length', { get: fail });
    else storage[failing] = fail;
    if (failing === 'getItem') assert.equal(drafts.get('s26-001', 'c1', 'l1'), null);
    if (failing !== 'removeItem') assert.deepEqual(drafts.list('s26-001'), []);
    assert.doesNotThrow(() => drafts.remove('s26-001', 'c1', 'l1'));
    assert.doesNotThrow(() => drafts.clear());
  }
});
