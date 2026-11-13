// 単元・授業・資料の計算を、通信なしで確かめる
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkLesson, checkUnitName, sortLessons, sortUnits, moveInOrder,
  materialList, thumbOrder, nextOrder, fileRefs, todayString,
} from '../js/lesson-logic.js';

test('checkLesson: 実在する日付と、空でない上限以内の授業名', () => {
  assert.equal(checkLesson({ date: '2026-11-12', title: '電流と電圧' }, { titleMax: 60 }), null);
  for (const date of ['2026-02-30', '2026/11/12', '2026-2-03', '2026-00-01', '2026-13-01', '2026-11-00', '2026-04-31', '2026-02-29', '1900-02-29', '', null]) {
    assert.equal(checkLesson({ date, title: 'x' }, { titleMax: 60 }), 'bad-date');
  }
  for (const date of ['2024-02-29', '2000-02-29', '2026-12-31']) {
    assert.equal(checkLesson({ date, title: 'x' }, { titleMax: 60 }), null);
  }
  assert.equal(checkLesson({ date: '2026-11-12', title: '   ' }, { titleMax: 60 }), 'no-title');
  assert.equal(checkLesson({ date: '2026-11-12', title: null }, { titleMax: 60 }), 'no-title');
  assert.equal(checkLesson({ date: '2026-11-12', title: 'あ'.repeat(60) }, { titleMax: 60 }), null);
  assert.equal(checkLesson({ date: '2026-11-12', title: 'あ'.repeat(61) }, { titleMax: 60 }), 'long-title');
});

test('checkUnitName: 空白だけは空として扱い、文字数の上限を確かめる', () => {
  assert.equal(checkUnitName('電流', { max: 40 }), null);
  for (const name of ['', '  \n　', null, undefined, 12]) {
    assert.equal(checkUnitName(name, { max: 40 }), 'empty');
  }
  assert.equal(checkUnitName('あ'.repeat(40), { max: 40 }), null);
  assert.equal(checkUnitName('あ'.repeat(41), { max: 40 }), 'long');
});

test('sortLessons: 日付の新しい順、同じ日付は createdAt の新しい順。もとの配列を変えない', () => {
  const lessons = [
    { id: 'a', date: '2026-11-11', createdAt: 900 },
    { id: 'b', date: '2026-11-12', createdAt: 100 },
    { id: 'c', date: '2026-11-12', createdAt: 200 },
  ];
  const before = structuredClone(lessons);
  assert.deepEqual(sortLessons(lessons).map((x) => x.id), ['c', 'b', 'a']);
  assert.deepEqual(lessons, before);
  assert.deepEqual(sortLessons([]), []);
});

test('sortUnits: order の小さい順、同じなら名前順。もとの配列を変えない', () => {
  const units = [{ id: 'a', name: 'あ', order: 3 }, { id: 'b', name: 'い', order: 0 }, { id: 'c', name: 'あ', order: 0 }];
  const before = structuredClone(units);
  assert.deepEqual(sortUnits(units).map((x) => x.id), ['c', 'b', 'a']);
  assert.deepEqual(units, before);
  assert.deepEqual(sortUnits([]), []);
});

test('moveInOrder: 入れかえて 0 から振り直す。端では何もしない', () => {
  const items = [{ id: 'a', order: 0 }, { id: 'b', order: 5 }, { id: 'c', order: 9 }];
  const before = structuredClone(items);
  assert.deepEqual(moveInOrder(items, 'b', -1), { b: 0, a: 1, c: 2 });
  assert.deepEqual(moveInOrder(items, 'b', 1), { a: 0, c: 1, b: 2 });
  assert.deepEqual(moveInOrder(items, 'a', -1), {});
  assert.deepEqual(moveInOrder(items, 'c', 1), {});
  assert.deepEqual(moveInOrder(items, 'x', 1), {});
  assert.deepEqual(moveInOrder([], 'a', 1), {});
  assert.deepEqual(items, before);
});

test('thumbOrder: 板書の画像 → そのほかの画像 → PDF', () => {
  const m = {
    p: { kind: 'handout', type: 'pdf', fileId: 'f1', name: 'a.pdf', order: 0, bytes: 1 },
    h: { kind: 'handout', type: 'image', fileId: 'f2', name: 'a', order: 1, bytes: 1 },
    b2: { kind: 'board', type: 'image', fileId: 'f3', name: 'a', order: 3, bytes: 1 },
    b1: { kind: 'board', type: 'image', fileId: 'f4', name: 'a', order: 2, bytes: 1 },
    bad: { kind: 'board', type: 'video', fileId: 'f5', name: 'a', order: 4, bytes: 1 },
  };
  assert.deepEqual(thumbOrder(m), ['b1', 'b2', 'h', 'p']);
  assert.deepEqual(materialList(m).map((x) => x.id), ['p', 'h', 'b1', 'b2']);
});

test('materialList: 形のおかしい項目を外し、決まった項目だけを返す', () => {
  const valid = { kind: 'board', type: 'image', fileId: 'F', name: '板書', order: 2, bytes: 100 };
  const m = { good: { ...valid, id: '別のID', extra: true }, nil: null, array: [], text: 'x' };
  const bad = [
    { kind: 'other' }, { type: 'video' }, { fileId: '' }, { fileId: 1 },
    { name: null }, { order: '2' }, { order: NaN }, { order: -1 },
    { bytes: '100' }, { bytes: Infinity }, { bytes: -1 },
  ];
  bad.forEach((v, i) => { m[`bad${i}`] = { ...valid, ...v }; });
  for (const field of Object.keys(valid)) {
    m[`missing${field}`] = { ...valid };
    delete m[`missing${field}`][field];
  }
  const before = structuredClone(m);
  assert.deepEqual(materialList(m), [{ id: 'good', ...valid }]);
  assert.deepEqual(m, before);
  for (const value of [null, undefined, [], [valid], 'x', 3]) {
    assert.deepEqual(materialList(value), []);
    assert.deepEqual(thumbOrder(value), []);
  }
});

test('nextOrder: 今ある order の最大 + 1。無ければ 0', () => {
  assert.equal(nextOrder({ a: { order: 5 }, b: { order: 2 }, bad: { order: '9' } }), 6);
  assert.equal(nextOrder({ a: { order: 0 } }), 1);
  for (const value of [{}, null, undefined, [], 'x', { a: null, b: { order: NaN } }]) {
    assert.equal(nextOrder(value), 0);
  }
});

test('fileRefs: 同じファイルを指している授業を全部返す', () => {
  const all = { c1: { l1: { materials: { m1: { fileId: 'F' }, m2: { fileId: 'G' } } } }, c2: { l9: { materials: { m1: { fileId: 'F' } } }, l8: {} } };
  assert.deepEqual(fileRefs(all, 'F'), [{ classId: 'c1', lessonId: 'l1', materialId: 'm1' }, { classId: 'c2', lessonId: 'l9', materialId: 'm1' }]);
  assert.deepEqual(fileRefs(all, 'Z'), []);
  for (const value of [null, [], 'x', { c1: null, c2: { l1: null, l2: { materials: { bad: null } } } }]) {
    assert.deepEqual(fileRefs(value, 'F'), []);
  }
});

test('todayString: 端末の時刻の日付を YYYY-MM-DD で返す', () => {
  assert.equal(todayString(new Date(2026, 0, 2, 0, 1).getTime()), '2026-01-02');
  assert.equal(todayString(new Date(2026, 10, 12, 23, 59).getTime()), '2026-11-12');
});
