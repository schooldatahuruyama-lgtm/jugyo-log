// 記録の形と、サーバー・下書きの選び方を確かめる
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LEVELS, emptyRecord, normalizeRecord, sameRecord, pickInitial, tileMark } from '../js/record-logic.js';
import * as logic from '../js/record-logic.js';
import { CONFIG } from '../js/config.js';

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

const attachment = (change = {}) => ({ type: 'image', fileId: 'file-a', bytes: 3, addedAt: 100, ...change });

test('attachmentList: 足した順、同じ時刻なら置き場所の順。元の目録は変えない', () => {
  const value = { a3: attachment({ addedAt: 200 }), a2: attachment(), a1: attachment({ type: 'pdf' }) };
  const before = structuredClone(value);
  assert.deepEqual(logic.attachmentList(value), [
    { slot: 'a1', ...value.a1 }, { slot: 'a2', ...value.a2 }, { slot: 'a3', ...value.a3 },
  ]);
  assert.deepEqual(value, before);
});

test('attachmentList: 形の違う目録と項目、不正な置き場所を除く', () => {
  for (const value of [null, undefined, [], [attachment()], 'x', 3]) {
    assert.deepEqual(logic.attachmentList(value), []);
  }
  for (const value of [null, [], 'x', 3, {}, attachment({ type: 'video' }), attachment({ fileId: 1 }),
    attachment({ fileId: '' }), attachment({ fileId: 'x'.repeat(201) }), attachment({ bytes: -1 }),
    attachment({ bytes: '3' }), attachment({ bytes: Infinity }), attachment({ addedAt: '100' }),
    attachment({ addedAt: NaN }), attachment({ addedAt: undefined })]) {
    assert.deepEqual(logic.attachmentList({ a1: value }), []);
  }
  for (const slot of ['a0', 'a7', 'a11', 'A1', 'a1\n', 'other']) {
    assert.deepEqual(logic.attachmentList({ [slot]: attachment() }), []);
  }
  assert.deepEqual(logic.attachmentList({ a6: attachment({ fileId: 'x'.repeat(200), bytes: 0, extra: true }) }),
    [{ slot: 'a6', ...attachment({ fileId: 'x'.repeat(200), bytes: 0 }) }]);
});

test('freeSlot: 最初の空きを返し、6 個と送信中の置き場所を数える', () => {
  assert.deepEqual(CONFIG.attachmentSlots, ['a1', 'a2', 'a3', 'a4', 'a5', 'a6']);
  const items = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6'].map((slot) => ({ slot, ...attachment() }));
  assert.equal(logic.freeSlot([]), 'a1');
  assert.equal(logic.freeSlot(items.filter((a) => a.slot !== 'a3')), 'a3');
  assert.equal(logic.freeSlot(items), null);
  assert.equal(logic.freeSlot(items.slice(0, 5), ['a6']), null);
  assert.equal(logic.freeSlot(items.slice(0, 1), ['a1', 'a2', 'a2']), 'a3');
  assert.equal(logic.freeSlot([], CONFIG.attachmentSlots), null);
});

test('attachmentLabels: 並び順で写真と PDF を別々に数える', () => {
  const items = logic.attachmentList({
    a3: attachment({ addedAt: 1 }), a1: attachment({ type: 'pdf', addedAt: 2 }), a2: attachment({ addedAt: 3 }),
  });
  assert.deepEqual(logic.attachmentLabels(items), { a3: '写真 1', a1: 'PDF 1', a2: '写真 2' });
  assert.deepEqual(logic.attachmentLabels([]), {});
});
