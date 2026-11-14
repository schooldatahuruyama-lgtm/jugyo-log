// ハッシュ（#/...）と画面名の対応を確かめる
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRoute, routeHash, viewFile, roleFor } from '../js/router.js';

// [name, params, ハッシュ, 画面のファイル, だれ]
const TABLE = [
  ['login', {}, '#/login', 'login', 'public'],
  ['home', {}, '#/', 'student-home', 'student'],
  ['home', { classId: 'abc' }, '#/?c=abc', 'student-home', 'student'],
  ['lesson', { classId: 'a', lessonId: 'b' }, '#/lesson/a/b', 'student-lesson', 'student'],
  ['password', {}, '#/password', 'password', 'student'],
  ['t-classes', {}, '#/t', 'teacher-classes', 'teacher'],
  ['t-units', {}, '#/t/units', 'teacher-units', 'teacher'],
  ['t-lessons', {}, '#/t/lessons', 'teacher-lessons', 'teacher'],
  ['t-lesson', { classId: 'A1b2', lessonId: 'c3D4' }, '#/t/lesson/A1b2/c3D4', 'teacher-lesson', 'teacher'],
  ['t-review', {}, '#/t/review', 'teacher-review', 'teacher'],
  ['t-review', { classId: 'a', lessonId: 'b' }, '#/t/review/a/b', 'teacher-review', 'teacher'],
  ['t-record', { classId: 'a', lessonId: 'b', studentId: 's26-001' }, '#/t/review/a/b/s26-001', 'teacher-record', 'teacher'],
  ['t-roster', { classId: 'abc123XYZ' }, '#/t/class/abc123XYZ', 'teacher-roster', 'teacher'],
  ['t-sheet', { classId: 'abc123XYZ' }, '#/t/class/abc123XYZ/sheet', 'teacher-sheet', 'teacher'],
  ['t-rules', {}, '#/t/rules', 'teacher-rules', 'teacher'],
];

test('表の 1 行ずつ、parseRoute と routeHash が行き来する', () => {
  for (const [name, params, hash] of TABLE) {
    assert.deepEqual(parseRoute(hash), { name, params }, hash);
    assert.equal(routeHash(name, params), hash, name);
    assert.deepEqual(parseRoute(routeHash(name, params)), { name, params }, name);
  }
});

test('空と # だけは home', () => {
  assert.deepEqual(parseRoute(''), { name: 'home', params: {} });
  assert.deepEqual(parseRoute('#'), { name: 'home', params: {} });
  assert.deepEqual(parseRoute(undefined), { name: 'home', params: {} });
});

test('画面のファイルと、だれの画面か', () => {
  for (const [name, , , file, role] of TABLE) {
    assert.equal(viewFile(name), file, name);
    assert.equal(roleFor(name), role, name);
  }
  assert.equal(roleFor('not-found'), 'public');
});

test('知らない道筋・余計な部分・ID が無いものは not-found', () => {
  for (const h of [
    '#/t/class/a/b/c', '#/t/class/', '#/t/class', '#/t/class/a%2Fb', '#/x',
    '#/login/x', '#/password/x', '#/t/', '#/t/rules/x', '#/t/class/a/x', '#/t/class/a/sheet/',
    '#/t/units/x', '#/t/lessons/', '#/t/lesson/a', '#/t/lesson/a/b/c', '#/t/lesson/a%2Fb/c',
    '#/t/lesson', '#/t/lesson//b', '#/t/lesson/a/', '#/t/lesson/a/b/',
    'x', '#x', '#//',
  ]) {
    assert.deepEqual(parseRoute(h), { name: 'not-found', params: {} }, h);
  }
});

test('classId は英数字だけを受けつける', () => {
  for (const id of ['a-b', 'a_b', 'a.b', 'a%20b', 'あ', 'a?b=1', '%E0%A4%A']) {
    assert.equal(parseRoute(`#/t/class/${id}`).name, 'not-found', id);
    assert.equal(parseRoute(`#/t/class/${id}/sheet`).name, 'not-found', id);
  }
  assert.deepEqual(parseRoute('#/t/class/A1b2'), { name: 't-roster', params: { classId: 'A1b2' } });
});

test('知らない画面名の routeHash は #/ にする', () => {
  assert.equal(routeHash('nothing'), '#/');
  assert.equal(viewFile('nothing'), undefined);
});

test('授業の classId と lessonId は英数字だけを受けつける', () => {
  for (const id of ['a-b', 'a_b', 'a.b', 'a%20b', 'a%2Fb', 'あ', 'a?b=1', '%E0%A4%A']) {
    assert.equal(parseRoute(`#/t/lesson/${id}/b`).name, 'not-found', id);
    assert.equal(parseRoute(`#/t/lesson/a/${id}`).name, 'not-found', id);
  }
  assert.deepEqual(parseRoute('#/t/lesson/a/B2'), {
    name: 't-lesson', params: { classId: 'a', lessonId: 'B2' },
  });
});

test('生徒の授業は classId と lessonId がそろったときだけ開く', () => {
  for (const hash of [
    '#/lesson', '#/lesson/a', '#/lesson/a/b/c', '#/lesson/a%2Fb/c',
    '#/lesson//b', '#/lesson/a/', '#/lesson/a/b/',
  ]) {
    assert.deepEqual(parseRoute(hash), { name: 'not-found', params: {} }, hash);
  }
  for (const id of ['a-b', 'a_b', 'a.b', 'a%20b', 'a%2Fb', 'あ', 'a?b=1', '%E0%A4%A']) {
    assert.equal(parseRoute(`#/lesson/${id}/b`).name, 'not-found', id);
    assert.equal(parseRoute(`#/lesson/a/${id}`).name, 'not-found', id);
  }
  assert.equal(roleFor('lesson'), 'student');
});

test('ホームのクラス指定は英数字の c 一つだけを受けつける', () => {
  for (const hash of [
    '#/?c=', '#/?c=a/b', '#/?x=1', '#/?c=a-b', '#/?c=a_b', '#/?c=あ',
    '#/?c=a%2Fb', '#/?c=%61', '#/?c=a&c=b', '#/?c=a&x=1', '#/?c=a#', '#/?',
  ]) {
    assert.deepEqual(parseRoute(hash), { name: 'not-found', params: {} }, hash);
  }
  assert.deepEqual(parseRoute('#/?c=A1b2'), { name: 'home', params: { classId: 'A1b2' } });
  assert.equal(routeHash('home'), '#/');
  assert.equal(routeHash('home', { classId: '' }), '#/');
});

test('生徒の routeHash は ID の余計な区切りをそのまま入れない', () => {
  assert.equal(routeHash('home', { classId: 'a/b' }), '#/?c=a%2Fb');
  assert.equal(routeHash('lesson', { classId: 'a/b', lessonId: 'c/d' }), '#/lesson/a%2Fb/c%2Fd');
});

test('先生の記録: 不足・余計な部分・形の違う ID は受けつけない', () => {
  for (const hash of [
    '#/t/review/', '#/t/review/a', '#/t/review//b', '#/t/review/a/',
    '#/t/review/a/b/', '#/t/review/a/b/xx', '#/t/review/a/b/s26-001/x',
  ]) assert.deepEqual(parseRoute(hash), { name: 'not-found', params: {} }, hash);
  for (const id of ['a-b', 'a_b', 'a.b', 'a%20b', 'a%2Fb', 'あ', 'a?b=1', '%E0%A4%A']) {
    for (const tail of ['', '/s26-001']) {
      assert.equal(parseRoute(`#/t/review/${id}/b${tail}`).name, 'not-found', id);
      assert.equal(parseRoute(`#/t/review/a/${id}${tail}`).name, 'not-found', id);
    }
  }
  for (const id of ['S26-001', 's26-01', 's2026-001', 's26_001', 's26-001%2Fx', 's26-001?x=1', 's２６-００１']) {
    assert.equal(parseRoute(`#/t/review/a/b/${id}`).name, 'not-found', id);
  }
  const params = { classId: 'A1b2', lessonId: 'C3d4', studentId: 's26-999' };
  assert.deepEqual(parseRoute(routeHash('t-record', params)), { name: 't-record', params });
});

test('先生の記録: routeHash は選択前の一覧に戻り、ID の区切りはそのまま入れない', () => {
  assert.equal(routeHash('t-review'), '#/t/review');
  assert.equal(routeHash('t-review', { classId: 'a' }), '#/t/review');
  assert.equal(routeHash('t-review', { lessonId: 'b' }), '#/t/review');
  assert.equal(routeHash('t-review', { classId: 'a/b', lessonId: 'c/d' }), '#/t/review/a%2Fb/c%2Fd');
  assert.equal(routeHash('t-record', { classId: 'a/b', lessonId: 'c/d', studentId: 's26-001/x' }),
    '#/t/review/a%2Fb/c%2Fd/s26-001%2Fx');
});
