// 名簿の計算（js/roster-logic.js）を確かめる。通信はしない
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkRows,
  diffMembers,
  unassigned,
  carryOver,
  sheetRows,
  schoolYear,
  entryYY,
  isProbeId,
  elsewhereOf,
} from '../js/roster-logic.js';

test('checkRows: 出席番号の重なり・空欄・範囲の外・ほかのクラス', () => {
  const rows = [
    { studentId: 's26-001', number: '1' },
    { studentId: 's26-002', number: '1' },      // 重なり → 2 行とも dup-number
    { studentId: 's26-003', number: '' },       // no-number
    { studentId: 's26-004', number: '100' },    // bad-number
    { studentId: 's26-005', number: '１２' },    // 全角の数は 12 として受けつける
    { studentId: 's26-006', number: '3.5' },    // bad-number
    { studentId: 's26-007', number: '7' },      // elsewhere
    { studentId: 'x', number: '8' },            // bad-id
  ];
  const errs = checkRows(rows, { maxNumber: 99, elsewhere: { 's26-007': '2年B組' } });
  assert.deepEqual(errs.map((e) => [e.index, e.code]),
    [[0, 'dup-number'], [1, 'dup-number'], [2, 'no-number'], [3, 'bad-number'], [5, 'bad-number'], [6, 'elsewhere'], [7, 'bad-id']]);
});

test('checkRows: 同じ生徒 ID が 2 行あれば両方 dup-id', () => {
  const rows = [
    { studentId: 's26-001', number: '1' },
    { studentId: 's26-002', number: '2' },
    { studentId: 's26-001', number: '3' },
  ];
  assert.deepEqual(checkRows(rows, { maxNumber: 99, elsewhere: {} }).map((e) => [e.index, e.code]),
    [[0, 'dup-id'], [2, 'dup-id']]);
});

test('checkRows: 0・負の数・空白だけ・前後の空白', () => {
  const rows = [
    { studentId: 's26-001', number: '0' },     // bad-number
    { studentId: 's26-002', number: '-3' },    // bad-number
    { studentId: 's26-003', number: '   ' },   // no-number
    { studentId: 's26-004', number: ' 4 ' },   // 4 として受けつける
    { studentId: 's26-005', number: '99' },    // 上限ちょうど
    { studentId: 's26-006', number: 5 },       // 数のままでも受けつける
  ];
  assert.deepEqual(checkRows(rows, { maxNumber: 99 }).map((e) => [e.index, e.code]),
    [[0, 'bad-number'], [1, 'bad-number'], [2, 'no-number']]);
});

test('checkRows: まちがいが無ければ空の配列', () => {
  assert.deepEqual(checkRows([{ studentId: 's26-001', number: '1' }], { maxNumber: 99, elsewhere: {} }), []);
  assert.deepEqual(checkRows([], { maxNumber: 99, elsewhere: {} }), []);
});

test('diffMembers: 足す・番号だけ変える・外す・変えない', () => {
  const prev = [
    { studentId: 's26-001', number: 1 },
    { studentId: 's26-002', number: 2 },
    { studentId: 's26-003', number: 3 },
  ];
  const next = [
    { studentId: 's26-001', number: '1' },   // 変えない
    { studentId: 's26-002', number: '５' },  // 番号だけ変える（全角）
    { studentId: 's26-004', number: '4' },   // 足す
  ];
  assert.deepEqual(diffMembers(prev, next), { set: { 's26-002': 5, 's26-004': 4 }, remove: ['s26-003'] });
  assert.deepEqual(diffMembers(prev, prev), { set: {}, remove: [] });
});

test('unassigned: その年度のどのクラスにもいない生徒 ID（ID 順）', () => {
  const students = [
    { id: 's26-003', uid: 'u3' },
    { id: 's26-001', uid: 'u1' },
    { id: 's26-002', uid: null },
    { id: 's25-010', uid: 'u10' },
  ];
  const membersOfYear = { 's26-001': { classId: 'A', number: 1 } };
  assert.deepEqual(unassigned(students, membersOfYear), ['s25-010', 's26-002', 's26-003']);
  assert.deepEqual(unassigned(['s26-002', 's26-001'], {}), ['s26-001', 's26-002']); // 文字の配列でもよい
});

test('isProbeId: 規則の確認用の ID（s00- で始まる）だけ true', () => {
  assert.equal(isProbeId('s00-999'), true);
  assert.equal(isProbeId('s00-001'), true);
  assert.equal(isProbeId('s26-001'), false);
  assert.equal(isProbeId('s01-999'), false);
  assert.equal(isProbeId('xs00-999'), false);
  assert.equal(isProbeId(''), false);
  assert.equal(isProbeId(null), false);
  assert.equal(isProbeId(undefined), false);
});

test('unassigned: 確認用の ID（s00-…）は出さない', () => {
  const students = [
    { id: 's00-999', uid: 'probe' },
    { id: 's26-001', uid: 'u1' },
  ];
  assert.deepEqual(unassigned(students, {}), ['s26-001']);
  assert.deepEqual(unassigned(['s00-999', 's26-002'], {}), ['s26-002']);
});

test('carryOver: 出席番号を空にして、ID 順で引きつぐ', () => {
  const prev = [
    { studentId: 's25-002', number: 1 },
    { studentId: 's25-001', number: 2 },
  ];
  assert.deepEqual(carryOver(prev), [
    { studentId: 's25-001', number: '' },
    { studentId: 's25-002', number: '' },
  ]);
});

test('sheetRows: パスワードが無い ID は null', () => {
  const members = [
    { studentId: 's26-001', number: 1 },
    { studentId: 's26-002', number: 2 },
  ];
  assert.deepEqual(sheetRows(members, { 's26-001': 'abcd2345' }), [
    { number: 1, studentId: 's26-001', password: 'abcd2345' },
    { number: 2, studentId: 's26-002', password: null },
  ]);
});

test('elsewhereOf: 同じ年度のほかのクラスにいる生徒 → そのクラス名（このクラスは除く）', () => {
  const membersOfYear = {
    's26-001': { classId: 'A', number: 1 },
    's26-002': { classId: 'B', number: 1 },
    's26-003': { classId: 'C', number: 2 },
  };
  const classes = [{ id: 'A', name: '2年A組' }, { id: 'B', name: '2年B組' }, { id: 'C', name: '' }];
  assert.deepEqual(elsewhereOf(membersOfYear, classes, 'A'), { 's26-002': '2年B組', 's26-003': '（名前なし）' });
  assert.deepEqual(elsewhereOf({}, classes, 'A'), {});
});

test('schoolYear: 4 月はじまり（3 月 31 日と 4 月 1 日の境）', () => {
  assert.equal(schoolYear(new Date(2027, 2, 31, 23, 59).getTime()), 2026);
  assert.equal(schoolYear(new Date(2027, 3, 1, 0, 0).getTime()), 2027);
  assert.equal(schoolYear(new Date(2026, 0, 10).getTime()), 2025);
  assert.equal(schoolYear(new Date(2026, 11, 31).getTime()), 2026);
});

test('entryYY: 年度の下 2 桁', () => {
  assert.equal(entryYY(2026), 26);
  assert.equal(entryYY(2005), 5);
  assert.equal(entryYY(2100), 0);
});
