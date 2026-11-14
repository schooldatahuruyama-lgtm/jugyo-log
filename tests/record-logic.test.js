// 記録の形と、サーバー・下書きの選び方を確かめる
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LEVELS, emptyRecord, normalizeRecord, sameRecord, pickInitial, tileMark } from '../js/record-logic.js';

test('LEVELS・emptyRecord: 理解度の順と、未入力の記録', () => {
  assert.deepEqual(LEVELS, [
    { value: 4, label: 'よく分かった' }, { value: 3, label: '分かった' },
    { value: 2, label: 'あまり分からなかった' }, { value: 1, label: '全然分からなかった' },
  ]);
  assert.deepEqual(emptyRecord(), { memo: '', level: null, learned: '', question: '' });
  const record = emptyRecord();
  record.memo = 'メモ';
  assert.equal(emptyRecord().memo, '');
});

test('normalizeRecord: おかしい値を直す', () => {
  assert.deepEqual(normalizeRecord({ memo: 5, level: '3', learned: 'あ'.repeat(2001), question: null }, { max: 2000 }),
    { memo: '', level: null, learned: 'あ'.repeat(2000), question: '' });
  for (const level of [null, undefined, '3', 0, 5, 2.5, NaN, Infinity, Number.MAX_VALUE]) {
    assert.equal(normalizeRecord({ level }, { max: 2000 }).level, null);
  }
  for (const value of [null, undefined, [], 'x', 5]) {
    assert.deepEqual(normalizeRecord(value, { max: 2000 }), emptyRecord());
  }
  assert.deepEqual(normalizeRecord({ memo: [], learned: {}, question: false }, { max: 2000 }), emptyRecord());
});

test('normalizeRecord: 各欄の上限ちょうどを残し、超過分と余分な項目を除く。元の記録は変えない', () => {
  for (const length of [2000, 2001]) {
    const record = { memo: 'あ'.repeat(length), level: 1, learned: 'い'.repeat(length), question: 'う'.repeat(length), extra: true };
    const before = structuredClone(record);
    assert.deepEqual(normalizeRecord(record, { max: 2000 }), {
      memo: 'あ'.repeat(2000), level: 1, learned: 'い'.repeat(2000), question: 'う'.repeat(2000),
    });
    assert.deepEqual(record, before);
  }
  assert.deepEqual(normalizeRecord({ memo: 'あいう', level: 4 }, { max: 2 }), { memo: 'あい', level: 4, learned: '', question: '' });
});

test('sameRecord: 4 つの項目だけを比べる', () => {
  const record = { memo: 'メモ', level: 3, learned: '分かったこと', question: '疑問' };
  assert.equal(sameRecord(record, { ...record, updatedAt: 1000 }), true);
  for (const change of [{ memo: '' }, { level: null }, { learned: '' }, { question: '' }, { level: '3' }]) {
    assert.equal(sameRecord(record, { ...record, ...change }), false);
  }
});

test('pickInitial: 下書きのほうが新しければ下書き、古い・同じならサーバー', () => {
  const record = { memo: 'サーバー', level: 3, learned: '', question: '' };
  const server = { ...record, updatedAt: 2000 };
  const draft = { record: { ...emptyRecord(), memo: '下書き' }, editedAt: 3000 };
  assert.deepEqual(pickInitial(server, draft, { max: 2000 }), { record: draft.record, fromDraft: true, updatedAt: 2000 });
  for (const editedAt of [1000, 2000]) {
    assert.deepEqual(pickInitial(server, { ...draft, editedAt }, { max: 2000 }), { record, fromDraft: false, updatedAt: 2000 });
  }
  assert.deepEqual(pickInitial(null, null, { max: 2000 }), { record: emptyRecord(), fromDraft: false, updatedAt: 0 });
  assert.deepEqual(pickInitial(null, draft, { max: 2000 }), { record: draft.record, fromDraft: true, updatedAt: 0 });
  assert.deepEqual(pickInitial(server, null, { max: 2 }), { record: { ...record, memo: 'サー' }, fromDraft: false, updatedAt: 2000 });
  assert.equal(pickInitial(server, draft, { max: 2 }).record.memo, '下書');
});

test('tileMark: 1〜4 の整数だけが記録あり', () => {
  for (const level of [1, 2, 3, 4]) assert.equal(tileMark(level), 'done');
  for (const level of [null, undefined, 0, 5, '3', 2.5, NaN, Infinity, Number.MAX_VALUE]) {
    assert.equal(tileMark(level), 'todo');
  }
});
