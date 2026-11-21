import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cohortOf, cohorts, daysLeft, matchesYear, fileIdsOf } from '../js/graduate-logic.js';
import { PROBE_ID } from '../js/rules-probe.js';

const DAY = 86400000;

test('完全削除を始めた生徒は 30 日前でももどせず、true 以外の印は使わない', () => {
  for (const purging of [true, false, undefined, null, 1, 'true', {}, []]) {
    const [group] = cohorts({ students: [{ id: 's26-001', uid: 'test1' }],
      removed: { 's26-001': { removedAt: 0, purging } }, now: DAY, graceDays: 30 });
    assert.equal(group.purgeable.length, purging === true ? 1 : 0);
    assert.equal(group.restorable.length, purging === true ? 0 : 1);
    assert.equal(group.state, purging === true ? 'purging' : 'removed');
    assert.equal(group.removed[0].purging, purging === true);
    assert.equal(group.restoreUntil, purging === true ? null : 30 * DAY);
  }
});
test('入学年度は正しい生徒 ID だけから取り出す', () => {
  assert.equal(cohortOf('s26-001'), '26');
  assert.equal(cohortOf('s00-999'), '00');
  for (const id of [null, 26, '', 's26-01', 's2026-001', 'S26-001', 's26-001\n']) assert.equal(cohortOf(id), null);
});

test('年度の新しい順・全員使用中・消してある学年・期限の混在と境界', () => {
  const students = ['s27-001', 's26-001', 's26-002', 's26-003', 's25-001', 'bad'].map((id) => ({ id, uid: null }));
  const removed = { 's26-001': { removedAt: 0, uid: 'test1' }, 's26-002': { removedAt: 1 },
    's25-001': { removedAt: DAY }, bad: { removedAt: 0 } };
  const result = cohorts({ students, removed, now: 30 * DAY, graceDays: 30 });
  assert.deepEqual(result.map((c) => [c.yy, c.year, c.total, c.state]), [
    ['27', 2027, 1, 'active'], ['26', 2026, 3, 'purging'], ['25', 2025, 1, 'removed'],
  ]);
  const group = result[1];
  assert.deepEqual(group.active.map((s) => s.id), ['s26-003']);
  assert.deepEqual(group.restorable.map((s) => s.id), ['s26-002']);
  assert.deepEqual(group.purgeable, [{ id: 's26-001', uid: 'test1', removedAt: 0, purging: false }]);
  assert.equal(group.restoreUntil, 30 * DAY + 1);
  assert.equal(result[0].restoreUntil, null);
  assert.equal(cohorts({ students, removed, now: 30 * DAY - 1, graceDays: 30 })[1].state, 'removed');
});

test('壊れた removed は使わず、台帳の削除後に残った removed も片付けの対象にする', () => {
  for (const value of [null, [], 1, {}, { removedAt: '0' }, { removedAt: NaN }, { removedAt: Infinity }, { removedAt: 0, uid: 1 }]) {
    assert.equal(cohorts({ students: [{ id: 's26-001' }], removed: { 's26-001': value }, now: 30 * DAY, graceDays: 30 })[0].state, 'active');
  }
  const result = cohorts({ students: [], removed: { 's26-001': { removedAt: 0, uid: 'test1' } }, now: 30 * DAY, graceDays: 30 });
  assert.equal(result[0].purgeable[0].uid, 'test1');
  assert.deepEqual(cohorts({ students: [], removed: {}, now: 0, graceDays: 30 }), []);
});

test('除外した確認用の生徒だけなら、台帳の重複や removed の有無にかかわらず学年を作らない', () => {
  for (const students of [[{ id: PROBE_ID }], [{ id: PROBE_ID }, { id: PROBE_ID }], []]) {
    for (const removed of [{}, { [PROBE_ID]: { removedAt: 0 } },
      { [PROBE_ID]: { removedAt: 31 * DAY } }, { [PROBE_ID]: { removedAt: 31 * DAY, purging: true } }]) {
      assert.deepEqual(cohorts({ students, removed, now: 31 * DAY, graceDays: 30, exclude: [PROBE_ID, PROBE_ID] }), []);
    }
  }
});

test('除外した ID はどの状態にも入れず、同じ年度のほかの生徒は残す', () => {
  const students = ['s00-001', 's26-001', 's26-002'].map((id) => ({ id }));
  const removed = { 's26-001': { removedAt: 0 }, 's26-002': { removedAt: 31 * DAY } };
  const expected = cohorts({ students, removed, now: 31 * DAY, graceDays: 30 });
  const result = cohorts({ students: [...students, { id: PROBE_ID }, { id: 's26-003' }, { id: 's26-004' }],
    removed: { ...removed, [PROBE_ID]: { removedAt: 0 }, 's26-004': { removedAt: 31 * DAY },
      's26-005': { removedAt: 0 } }, now: 31 * DAY, graceDays: 30,
    exclude: [PROBE_ID, 's26-003', 's26-004', 's26-005'] });
  assert.deepEqual(result, expected);
});

test('exclude の省略や配列以外の入力は空として扱う', () => {
  const args = { students: [{ id: PROBE_ID }], removed: {}, now: 31 * DAY, graceDays: 30 };
  const expected = cohorts({ ...args, exclude: [] });
  assert.equal(expected[0].active[0].id, PROBE_ID);
  assert.deepEqual(cohorts(args), expected);
  for (const exclude of [undefined, null, PROBE_ID, 1, true, {}, new Set([PROBE_ID])]) {
    assert.deepEqual(cohorts({ ...args, exclude }), expected);
  }
});

test('残り日数は切り上げ、最短の復元期限を使う', () => {
  assert.equal(daysLeft(0, 0, 30), 30);
  assert.equal(daysLeft(0, 29 * DAY + 1, 30), 1);
  assert.equal(daysLeft(0, 30 * DAY, 30), 0);
  assert.equal(daysLeft(0, 31 * DAY, 30), 0);
  const result = cohorts({ students: [{ id: 's26-001' }, { id: 's26-002' }],
    removed: { 's26-001': { removedAt: DAY }, 's26-002': { removedAt: 0 } }, now: DAY, graceDays: 30 });
  assert.equal(result[0].restoreUntil, 30 * DAY);
});

test('年度の入力は空白と全角数字だけを直し、合わない入力は通さない', () => {
  for (const value of ['2026', '２０２６', ' ２０2６　']) assert.equal(matchesYear(value, 2026), true);
  for (const value of ['', ' ', '2025', '20 26', '2026年', '2.026e3', null, 2026, '②⓪②⑥']) assert.equal(matchesYear(value, 2026), false);
});

test('写真・PDF・各種手書きの ID をまとめ、重複と空や型違いを除く', () => {
  assert.deepEqual(fileIdsOf({ attachments: [{ fileId: 'photo' }, { fileId: 'pdf' }, { fileId: 4 }, { fileId: ' ' }],
    ink: { memo: { fileId: 'ink' }, learned: { fileId: 'photo' }, 'a2#p1': { fileId: 'page' }, bad: null } }), ['photo', 'pdf', 'ink', 'page']);
  assert.deepEqual(fileIdsOf({ attachments: { a1: { fileId: 'x' } }, ink: {} }), ['x']);
  assert.deepEqual(fileIdsOf(null), []);
});
