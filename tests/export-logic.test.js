import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exportScopes, defaultScope, checkSelection, pdfPagesToShow, pageInkPlaces, inkCrop, exportDateLabel, countProblems } from '../js/export-logic.js';

const lesson = (id, date, unitId = 'u1', createdAt = 0) => ({ id, date, unitId, createdAt });
const units = [{ id: 'u2', name: '後', order: 2 }, { id: 'empty', name: '空', order: 0 }, { id: 'u1', name: '前', order: 1 }];

test('単元順と未所属、日付・作成時刻・id の順を保ち、元の配列は変えない', () => {
  const lessons = [lesson('z', '2026-01-02'), lesson('b', '2026-01-01', 'u1', 2), lesson('a', '2026-01-01', 'u1', 2),
    lesson('c', '2026-01-01', 'u1', 1), lesson('d', '2026-01-03', 'u2'), lesson('e', '2026-01-04', 'deleted'), lesson('f', '2026-01-05', '')];
  const before = structuredClone({ lessons, units });
  const scopes = exportScopes(lessons, units);
  assert.deepEqual(scopes.map((s) => [s.id, s.lessons.map((l) => l.id)]), [['u1', ['c', 'a', 'b', 'z']], ['u2', ['d']], ['', ['e', 'f']]]);
  assert.equal(scopes.at(-1).label, '単元に入っていない授業');
  assert.deepEqual({ lessons, units }, before);
  assert.equal(defaultScope(scopes), '');
});

test('一覧の欠落・不正な値・空の単元、最新日付が同じ場合', () => {
  for (const value of [null, undefined, {}, 1]) {
    assert.deepEqual(exportScopes(value, units), []);
    assert.equal(exportScopes([lesson('a', '2026-01-01')], value)[0].id, '');
    assert.equal(defaultScope(value), null);
  }
  const scopes = exportScopes([lesson('b', '2026-01-02', 'u2'), lesson('a', '2026-01-02')], units);
  assert.equal(defaultScope(scopes), 'u1');
  assert.deepEqual(exportScopes([null, {}, lesson('a', null)], [null, {}]).map((s) => s.id), ['']);
  assert.equal(defaultScope([]), null);
});

test('選択は所属だけを重複せず数える。0・1・15・16 個の境目', () => {
  const scope = { lessons: Array.from({ length: 16 }, (_, i) => lesson(String(i), '2026-01-01')) };
  for (const [count, reason] of [[0, 'none'], [1, null], [15, null], [16, 'many']]) {
    const ids = scope.lessons.slice(0, count).map((l) => l.id);
    assert.deepEqual(checkSelection([...ids, ...ids, 'foreign'], scope, { maxLessons: 15 }), { ok: reason === null, count, reason });
  }
  for (const value of [null, undefined, {}, '0']) assert.equal(checkSelection(value, scope, { maxLessons: 15 }).count, 0);
  assert.equal(checkSelection(['0'], null, { maxLessons: 15 }).reason, 'none');
});

test('PDF は 20 ページと後ろの書きこみ。整数だけで重複せず昇順', () => {
  assert.deepEqual(pdfPagesToShow(20, [], 20), { pages: Array.from({ length: 20 }, (_, i) => i + 1), skipped: 0 });
  assert.equal(pdfPagesToShow(21, [], 20).skipped, 1);
  assert.equal(pdfPagesToShow(21, [21], 20).skipped, 0);
  assert.deepEqual(pdfPagesToShow(26, [25, 23, 25, 0, -1, 27, 21.5, '22', NaN], 2), { pages: [1, 2, 23, 25], skipped: 22 });
  assert.deepEqual(pdfPagesToShow(1, null, 20), { pages: [1], skipped: 0 });
  for (const value of [0, -1, 1.5, '20', null, NaN, Infinity]) assert.deepEqual(pdfPagesToShow(value, [], 20), { pages: [], skipped: 0 });
  assert.deepEqual(pdfPagesToShow(3, [2], null), { pages: [2], skipped: 2 });
});

test('ページの書きこみは場所と on が合うものだけ', () => {
  const a = { on: 'file', fileId: 'ink' };
  const record = { ink: { 'a1#p21': a, 'a1#p2': a, 'a1#p1': { on: 'old' }, a1: a,
    'a2#p1': a, 'a1#p0': a, 'a1#p1000': a, 'a1#p3': null } };
  assert.deepEqual(pageInkPlaces(record, 'a1', 'file'), [{ page: 2, index: a }, { page: 21, index: a }]);
  assert.deepEqual(pageInkPlaces(null, 'a1', 'file'), []);
});

test('手書きの上下を余白つきで切り出し、紙の範囲に収める', () => {
  const ink = { v: 1, h: 400, s: [{ c: 0, w: 0, p: [10, 100, 20, 200] }] };
  assert.deepEqual(inkCrop(ink), { top: 86.5, height: 127 });
  assert.deepEqual(inkCrop({ ...ink, s: [{ c: 0, w: 0, p: [0, 0, 800, 400] }] }), { top: 0, height: 400 });
  for (const value of [null, {}, { v: 1, h: 400, s: [] }]) assert.equal(inkCrop(value), null);
});

test('作った日は端末の日付。無効な値は空欄', () => {
  assert.equal(exportDateLabel(new Date(2026, 0, 2).getTime()), '2026/01/02');
  for (const value of [null, undefined, '0', NaN, Infinity, -Infinity, 9e15]) assert.equal(exportDateLabel(value), '');
});

test('読みこみ失敗だけを数え、絵の上限は含めない', () => {
  assert.equal(countProblems([{ recordProblem: true, replyProblem: true,
    materials: [{ problem: 'pdf', pictures: [{ problem: 'ink', url: 'blob:test' }, { problem: 'budget' }] }],
    attachments: [{ problem: 'image', pictures: [] }], inks: { memo: { problem: 'ink' }, learned: null, question: { problem: 'budget' } } }]), 6);
  assert.equal(countProblems([{ materials: null, inks: {} }]), 0);
  assert.equal(countProblems(null), 0);
});
