// 一覧の見出しと、タイルの指の動きを通信なしで確かめる
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classLabel, groupByDate, groupByUnit, swipeDecision, stepIndex } from '../js/student-list-logic.js';

const lesson = (id, date, createdAt = 0) => ({ id, date, createdAt });
const groups = (value) => value.map((x) => [x.label, x.lessons.map((l) => l.id)]);

test('classLabel: 年度とクラス名を並べる', () => {
  assert.equal(classLabel({ year: 2026, name: '2年A組' }), '2026年度　2年A組');
});

test('groupByDate: これから・今週・先週・月ごと・日付なし。入力を変えない', () => {
  const today = new Date(2026, 10, 12, 9).getTime();
  const lessons = [lesson('a', '2026-11-09'), lesson('b', '2026-11-08'), lesson('c', '2026-11-02'), lesson('d', '2026-11-01'),
    lesson('e', '2026-10-30'), lesson('f', '2026-11-13'), lesson('g', ''), lesson('h', '2026-11-12')];
  const before = structuredClone(lessons);
  assert.deepEqual(groups(groupByDate(lessons, today)), [
    ['これから', ['f']], ['今週', ['h', 'a']], ['先週', ['b', 'c']],
    ['2026年11月', ['d']], ['2026年10月', ['e']], ['日付なし', ['g']],
  ]);
  assert.deepEqual(lessons, before);
  assert.deepEqual(groupByDate([], today), []);
});

test('groupByDate: 月曜とその前の日曜を分け、同じ日は作成日時の新しい順', () => {
  const lessons = [lesson('sun', '2026-11-08'), lesson('mon1', '2026-11-09', 1), lesson('mon2', '2026-11-09', 2), lesson('next', '2026-11-10')];
  for (const hour of [0, 23]) {
    assert.deepEqual(groups(groupByDate(lessons, new Date(2026, 10, 9, hour, 59).getTime())), [
      ['これから', ['next']], ['今週', ['mon2', 'mon1']], ['先週', ['sun']],
    ]);
  }
});

test('groupByDate: 年と月をまたいでも、今週・先週を月の見出しに重ねない', () => {
  const lessons = [lesson('old', '2025-11-30'), lesson('month', '2025-12-21'), lesson('last', '2025-12-28'),
    lesson('this', '2025-12-29'), lesson('today', '2026-01-01'), lesson('future', '2026-01-02')];
  assert.deepEqual(groups(groupByDate(lessons, new Date(2026, 0, 1, 9).getTime())), [
    ['これから', ['future']], ['今週', ['today', 'this']], ['先週', ['last']],
    ['2025年12月', ['month']], ['2025年11月', ['old']],
  ]);
});

test('groupByDate: 不正な日付も消さず、うるう年と 100 年未満の年も確かめる', () => {
  const lessons = ['', '2026-02-30', '2026-02-29', '1900-02-29', '2026/11/12', '2026-1-01', '0000-01-01', null, 5]
    .map((date, i) => lesson(String(i), date));
  const before = structuredClone(lessons);
  const result = groupByDate(lessons, new Date(2026, 10, 12).getTime());
  assert.deepEqual(result.map((x) => x.label), ['日付なし']);
  assert.deepEqual(result[0].lessons.map((x) => x.id).sort(), lessons.map((x) => x.id).sort());
  assert.deepEqual(lessons, before);
  assert.deepEqual(groups(groupByDate([lesson('leap', '2024-02-29'), lesson('early', '0099-01-01')], new Date(2026, 10, 12).getTime())), [
    ['2024年2月', ['leap']], ['99年1月', ['early']],
  ]);
});

test('groupByUnit: 単元の順を保ち、空の単元を出さず、未設定と不明は最後のその他', () => {
  const units = [{ id: 'u2', name: '天気' }, { id: 'u1', name: '電流' }, { id: 'empty', name: '化学変化' }];
  const lessons = [
    { ...lesson('a', '2026-11-11'), unitId: 'u1' }, { ...lesson('b', '2026-11-12', 1), unitId: 'u2' },
    { ...lesson('c', '2026-11-12', 2), unitId: 'u2' }, { ...lesson('d', '2026-11-12'), unitId: 'missing' },
    { ...lesson('e', '2026-11-11'), unitId: '' }, lesson('f', ''),
  ];
  const before = structuredClone({ lessons, units });
  assert.deepEqual(groups(groupByUnit(lessons, units)), [['天気', ['c', 'b']], ['電流', ['a']], ['その他', ['d', 'e', 'f']]]);
  assert.deepEqual({ lessons, units }, before);
  assert.deepEqual(groupByUnit([], units), []);
  assert.deepEqual(groups(groupByUnit([lesson('a', '')], [])), [['その他', ['a']]]);
});

test('swipeDecision: タップ・横移動・縦移動と、境界・不正な数', () => {
  const options = { tapMax: 10, swipeMin: 30 };
  for (const [dx, dy, expected] of [
    [3, -4, 'tap'], [-40, 5, 'next'], [40, 5, 'prev'], [20, 0, 'none'], [-40, 60, 'none'],
    [10, -10, 'tap'], [-10, 10, 'tap'], [11, 0, 'none'], [-30, 0, 'next'], [30, 0, 'prev'],
    [30, 30, 'none'], [29, 0, 'none'], [0, 40, 'none'],
  ]) assert.equal(swipeDecision({ dx, dy }, options), expected);
  for (const value of [NaN, Infinity, -Infinity, '40', null, undefined, {}]) {
    assert.equal(swipeDecision({ dx: value, dy: 0 }, options), 'none');
    assert.equal(swipeDecision({ dx: 40, dy: value }, options), 'none');
  }
});

test('stepIndex: 左右に進み、端では止まる。0 枚・1 枚は 0', () => {
  assert.equal(stepIndex(1, -1, 3), 0);
  assert.equal(stepIndex(1, 1, 3), 2);
  assert.equal(stepIndex(0, -1, 3), 0);
  assert.equal(stepIndex(2, 1, 3), 2);
  for (const count of [0, 1]) for (const dir of [-1, 1]) assert.equal(stepIndex(0, dir, count), 0);
});
