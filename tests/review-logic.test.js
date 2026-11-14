// 先生が読む記録の集計・並び順・コピーを、通信なしで確かめる
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  reviewPeople, levelCounts, reviewRows, copyText, neighbors, defaultLesson, levelLabel,
} from '../js/review-logic.js';

const members = [{ studentId: 's26-002', number: 2 }, { studentId: 's26-001', number: 1 }, { studentId: 's26-003', number: 3 }];
const records = {
  's26-001': { memo: '', level: 4, learned: 'オームの法則', question: '', updatedAt: 1 },
  's26-002': { memo: '', level: 1, learned: '', question: 'なぜ電圧が\n分かれるのか\n\n  知りたい', updatedAt: 2 },
  's26-009': { memo: '', level: 2, learned: '', question: '単位が分からない', updatedAt: 3 },
};

test('reviewPeople: 名簿の全員と、名簿にいない生徒の記録', () => {
  const p = reviewPeople(members, records);
  assert.deepEqual(p.map((x) => [x.studentId, x.number, x.inRoster, x.record === null]),
    [['s26-001', 1, true, false], ['s26-002', 2, true, false], ['s26-003', 3, true, true], ['s26-009', null, false, false]]);
  assert.deepEqual(p[0].record, records['s26-001']);
  assert.deepEqual(levelCounts(p), { 4: 1, 3: 0, 2: 1, 1: 1, none: 1, total: 4 });
});

test('reviewRows: 理解度が低い順、入力なしは最後', () => {
  const rows = reviewRows(reviewPeople(members, records), { field: 'question', sort: 'level' });
  assert.deepEqual(rows.map((r) => r.studentId), ['s26-002', 's26-009', 's26-001', 's26-003']);
  assert.equal(rows[3].level, null);
  assert.equal(rows[2].text, '');
  assert.deepEqual(rows[1], { studentId: 's26-009', number: null, inRoster: false, level: 2, text: '単位が分からない' });
});

test('reviewRows: 出席番号順と、分かったことへの切りかえ', () => {
  assert.deepEqual(reviewRows(reviewPeople(members, records), { field: 'learned', sort: 'number' }), [
    { studentId: 's26-001', number: 1, inRoster: true, level: 4, text: 'オームの法則' },
    { studentId: 's26-002', number: 2, inRoster: true, level: 1, text: '' },
    { studentId: 's26-003', number: 3, inRoster: true, level: null, text: '' },
    { studentId: 's26-009', number: null, inRoster: false, level: 2, text: '' },
  ]);
});

test('reviewRows: 知らない項目・並び順は疑問・理解度順', () => {
  const people = reviewPeople(members, records);
  const expected = reviewRows(people, { field: 'question', sort: 'level' });
  for (const options of [undefined, null, {}, [], 'x', { field: 'memo', sort: 'other' }]) {
    assert.deepEqual(reviewRows(people, options), expected);
  }
  assert.deepEqual(reviewRows(people, { field: 'learned', sort: 'other' }),
    reviewRows(people, { field: 'learned', sort: 'level' }));
  assert.deepEqual(reviewRows(people, { field: 'other', sort: 'number' }),
    reviewRows(people, { field: 'question', sort: 'number' }));
});

test('reviewPeople・reviewRows: 同じ番号・番号なし・同じ理解度でも順番が決まる', () => {
  const roster = [
    { studentId: 's26-004', number: '4' }, { studentId: 's26-002', number: 1 },
    { studentId: 's26-006', number: Infinity }, { studentId: 's26-003', number: null },
    { studentId: 's26-001', number: 1 }, { studentId: 's26-005', number: NaN },
  ];
  const all = Object.fromEntries(['s26-009', 's26-008', ...roster.map((m) => m.studentId)]
    .map((id) => [id, { level: 2 }]));
  const expected = ['s26-001', 's26-002', 's26-003', 's26-004', 's26-005', 's26-006', 's26-008', 's26-009'];
  for (const list of [roster, [...roster].reverse()]) {
    const people = reviewPeople(list, all);
    assert.deepEqual(people.map((p) => p.studentId), expected);
    assert.deepEqual(people.map((p) => p.number), [1, 1, null, null, null, null, null, null]);
    for (const sort of ['number', 'level']) {
      assert.deepEqual(reviewRows(people, { sort }).map((r) => r.studentId), expected);
    }
  }
});

test('reviewPeople: 記録の型と文字数をそろえ、形のおかしい欄でも人を消さない', () => {
  const people = reviewPeople(members, {
    's26-001': { memo: 1, level: '3', learned: [], question: 'あ'.repeat(2001), updatedAt: '1' },
    's26-002': '記録ではない', 's26-003': [],
    's26-008': null, 's26-009': { memo: {}, level: 2.5, learned: false, question: null, updatedAt: Infinity },
  });
  assert.deepEqual(people[0].record, { memo: '', level: null, learned: '', question: 'あ'.repeat(2000), updatedAt: 0 });
  assert.equal(people[1].record, null);
  assert.equal(people[2].record, null);
  assert.equal(people[3].studentId, 's26-009');
  assert.deepEqual(people[3].record, { memo: '', level: null, learned: '', question: '', updatedAt: 0 });
  assert.deepEqual(levelCounts(people), { 4: 0, 3: 0, 2: 0, 1: 0, none: 4, total: 4 });
});

test('levelCounts・reviewRows・levelLabel: 1〜4 の整数だけを理解度として扱う', () => {
  const levels = [1, 2, 3, 4, null, undefined, '3', 0, 5, 2.5, NaN, Infinity];
  const all = Object.fromEntries(levels.map((level, i) => [`s26-${String(i + 1).padStart(3, '0')}`, { level }]));
  const people = reviewPeople([], all);
  assert.deepEqual(levelCounts(people), { 4: 1, 3: 1, 2: 1, 1: 1, none: 8, total: 12 });
  assert.deepEqual(reviewRows(people).map((r) => r.level), [1, 2, 3, 4, ...Array(8).fill(null)]);
  assert.deepEqual([1, 2, 3, 4].map(levelLabel), ['全然分からなかった', 'あまり分からなかった', '分かった', 'よく分かった']);
  for (const level of levels.slice(4)) assert.equal(levelLabel(level), 'まだ入力なし');
});

test('copyText: 1 人 1 行。番号も ID も入れない', () => {
  const rows = reviewRows(reviewPeople(members, records), { field: 'question', sort: 'level' });
  const c = copyText(rows);
  assert.deepEqual(c, { text: 'なぜ電圧が 分かれるのか 知りたい\n単位が分からない', count: 2 });
  assert.ok(!/s26|\b[0-9]+\b/.test(c.text));
});

test('copyText: 空白だけを除き、いろいろな改行を空白にして、順番と 2000 文字を残す', () => {
  const long = 'あ'.repeat(2000);
  const rows = [
    { text: ' \t\n\r\n　' }, { text: ' 先頭\r\n  次\r最後\u2028 続き\u2029 終わり ' },
    { text: long }, { text: '' }, { text: null }, null, [],
  ];
  assert.deepEqual(copyText(rows), { text: `先頭 次 最後 続き 終わり\n${long}`, count: 2 });
  assert.deepEqual(copyText(reviewRows(reviewPeople(members, records), { field: 'learned' })),
    { text: 'オームの法則', count: 1 });
});

test('neighbors: 出席番号順の前後。名簿にいない人は最後', () => {
  const people = reviewPeople(members, records);
  assert.deepEqual(neighbors(people, 's26-001'), { prev: null, next: 's26-002' });
  assert.deepEqual(neighbors(people, 's26-002'), { prev: 's26-001', next: 's26-003' });
  assert.deepEqual(neighbors(people, 's26-003'), { prev: 's26-002', next: 's26-009' });
  assert.deepEqual(neighbors(people, 's26-009'), { prev: 's26-003', next: null });
  assert.deepEqual(neighbors(people, 's26-999'), { prev: null, next: null });
  assert.deepEqual(neighbors(people.slice(0, 1), 's26-001'), { prev: null, next: null });
});

test('defaultLesson: 今日以前の最新を選び、同じ日なら作成日時の新しい順', () => {
  const lessons = [
    { id: 'old', date: '2026-11-13', createdAt: 900 },
    { id: 'today1', date: '2026-11-14', createdAt: 1 },
    { id: 'future', date: '2026-11-15', createdAt: 1 },
    { id: 'today2', date: '2026-11-14', createdAt: 2 },
  ];
  const before = structuredClone(lessons);
  for (const hour of [0, 23]) {
    assert.equal(defaultLesson(lessons, new Date(2026, 10, 14, hour, 1).getTime()), 'today2');
  }
  assert.equal(defaultLesson(lessons, new Date(2026, 10, 13).getTime()), 'old');
  assert.equal(defaultLesson(lessons, new Date(2026, 10, 12).getTime()), 'future');
  assert.deepEqual(lessons, before);
});

test('空のクラスや、不正な一覧を渡しても落ちない', () => {
  for (const value of [null, undefined, 'x', 1, {}]) {
    assert.deepEqual(reviewPeople(value, null), []);
    assert.deepEqual(levelCounts(value), { 4: 0, 3: 0, 2: 0, 1: 0, none: 0, total: 0 });
    assert.deepEqual(reviewRows(value), []);
    assert.deepEqual(copyText(value), { text: '', count: 0 });
    assert.deepEqual(neighbors(value, 's26-001'), { prev: null, next: null });
    assert.equal(defaultLesson(value, 0), null);
  }
  for (const value of [null, undefined, [], [{ level: 3 }], 'x', 1]) {
    assert.deepEqual(reviewPeople([], value), []);
    assert.ok(reviewPeople(members, value).every((p) => p.record === null));
  }
  const people = reviewPeople([], {});
  assert.deepEqual(levelCounts(people), { 4: 0, 3: 0, 2: 0, 1: 0, none: 0, total: 0 });
  assert.deepEqual(reviewRows(people), []);
  assert.deepEqual(copyText([]), { text: '', count: 0 });
  assert.deepEqual(neighbors([], 's26-001'), { prev: null, next: null });
  assert.equal(defaultLesson([], 0), null);
  assert.deepEqual(reviewPeople([null, [], 'x', {}, { studentId: 1 }], {}), []);
  assert.equal(defaultLesson([null, [], 'x', {}], 0), null);
});

test('集計とコピーで、渡された名簿・記録・一覧を変えない', () => {
  const beforeMembers = structuredClone(members);
  const beforeRecords = structuredClone(records);
  const people = reviewPeople(members, records);
  const beforePeople = structuredClone(people);
  levelCounts(people);
  neighbors(people, 's26-002');
  const rows = reviewRows(people, { field: 'question', sort: 'level' });
  const beforeRows = structuredClone(rows);
  copyText(rows);
  assert.deepEqual(rows, beforeRows);
  assert.deepEqual(people, beforePeople);
  assert.deepEqual(members, beforeMembers);
  assert.deepEqual(records, beforeRecords);
});
