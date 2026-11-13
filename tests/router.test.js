// ハッシュ（#/...）と画面名の対応を確かめる
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRoute, routeHash, viewFile, roleFor } from '../js/router.js';

// [name, params, ハッシュ, 画面のファイル, だれ]
const TABLE = [
  ['login', {}, '#/login', 'login', 'public'],
  ['home', {}, '#/', 'student-home', 'student'],
  ['password', {}, '#/password', 'password', 'student'],
  ['t-classes', {}, '#/t', 'teacher-classes', 'teacher'],
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
