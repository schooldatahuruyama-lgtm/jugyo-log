import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createInkDrafts } from '../js/ink-drafts.js';
import { createDrafts } from '../js/drafts.js';
import { emptyInk } from '../js/ink-logic.js';

function fakeStorage() {
  const values = new Map();
  return {
    get length() { return values.size; },
    key: (i) => [...values.keys()][i] ?? null,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
}
const path = 'jugyolog:ink:s26-001:c1:l1:memo';
const draft = { ink: emptyInk(), editedAt: 10, key: 'ink-test-1' };

test('手書き下書き: 保存・取得・上書き・削除し、線は cleanInk を通す', () => {
  const storage = fakeStorage();
  const drafts = createInkDrafts({ storage });
  assert.equal(drafts.get('s26-001', 'c1', 'l1', 'memo'), null);
  assert.equal(drafts.put('s26-001', 'c1', 'l1', 'memo', draft), true);
  assert.deepEqual(JSON.parse(storage.getItem(path)), draft);
  assert.deepEqual(createInkDrafts({ storage }).get('s26-001', 'c1', 'l1', 'memo'), draft);
  const next = { ...draft, editedAt: 11, ink: { v: 1, h: 401, s: [{ c: 0, w: 0, p: [-10, 0, 900, 1000] }, null] } };
  assert.equal(drafts.put('s26-001', 'c1', 'l1', 'memo', next), true);
  assert.deepEqual(drafts.get('s26-001', 'c1', 'l1', 'memo'), {
    ...next, ink: { v: 1, h: 800, s: [{ c: 0, w: 0, p: [0, 0, 800, 800] }] },
  });
  drafts.remove('s26-001', 'c1', 'l1', 'memo');
  assert.equal(drafts.get('s26-001', 'c1', 'l1', 'memo'), null);
});

test('手書き下書き: こわれた値・形・欄は読まず、保存もしない', () => {
  const storage = fakeStorage();
  const drafts = createInkDrafts({ storage });
  for (const value of [null, [], {}, { ...draft, ink: null }, { ...draft, ink: { v: 2, h: 400, s: [] } },
    { ...draft, ink: { v: 1 } }, { ...draft, editedAt: '10' }, { ...draft, key: 1 }, { ...draft, key: '' }]) {
    storage.setItem(path, JSON.stringify(value));
    assert.equal(drafts.get('s26-001', 'c1', 'l1', 'memo'), null);
    assert.equal(drafts.put('s26-001', 'c1', 'l1', 'memo', value), false);
  }
  storage.setItem(path, '{');
  assert.equal(drafts.get('s26-001', 'c1', 'l1', 'memo'), null);
  assert.equal(drafts.put('s26-001', 'c1', 'l1', 'other', draft), false);
  storage.setItem(path.replace(':memo', ':other'), JSON.stringify(draft));
  assert.equal(drafts.get('s26-001', 'c1', 'l1', 'other'), null);
  assert.deepEqual(drafts.list('s26-001'), []);
});

test('手書き下書き: list は本人だけ。文字の下書きとは互いに読まず消さない', () => {
  const storage = fakeStorage();
  const drafts = createInkDrafts({ storage });
  const textDrafts = createDrafts({ storage });
  drafts.put('s26-001', 'c1', 'l1', 'memo', draft);
  drafts.put('s26-001', 'c2', 'l2', 'learned', draft);
  drafts.put('s26-002', 'c1', 'l1', 'question', draft);
  storage.setItem('jugyolog:ink:s26-001:c1::memo', JSON.stringify(draft));
  storage.setItem('jugyolog:ink:s26-001:c1:l1:memo:extra', JSON.stringify(draft));
  assert.deepEqual(textDrafts.list('s26-001'), []);
  textDrafts.put('s26-001', 'c1', 'l1', { memo: '文字' }, 10);
  assert.deepEqual(drafts.list('s26-001'), [
    { classId: 'c1', lessonId: 'l1', field: 'memo', ...draft },
    { classId: 'c2', lessonId: 'l2', field: 'learned', ...draft },
  ]);
  textDrafts.clear();
  assert.equal(drafts.list('s26-001').length, 2);
  textDrafts.put('s26-001', 'c1', 'l1', { memo: '文字' }, 10);
  drafts.clear();
  assert.deepEqual(drafts.list('s26-001'), []);
  assert.deepEqual(drafts.list('s26-002'), []);
  assert.equal(storage.length, 1);
  assert.equal(textDrafts.get('s26-001', 'c1', 'l1').record.memo, '文字');
});

test('手書き下書き: 容量不足・保存先なし・保存先の例外を外に出さない', () => {
  const fail = () => { throw new Error('保存できない'); };
  for (const storage of [undefined, { get length() { return fail(); }, getItem: fail, setItem: fail, removeItem: fail },
    { length: 1, key: fail }]) {
    const drafts = createInkDrafts({ storage });
    assert.equal(drafts.put('s26-001', 'c1', 'l1', 'memo', draft), false);
    assert.equal(drafts.get('s26-001', 'c1', 'l1', 'memo'), null);
    assert.deepEqual(drafts.list('s26-001'), []);
    assert.doesNotThrow(() => drafts.remove('s26-001', 'c1', 'l1', 'memo'));
    assert.doesNotThrow(() => drafts.clear());
  }
});
