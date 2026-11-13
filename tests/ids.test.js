// 生徒 ID・ログイン ID・パスワード・ID の作り方を確かめる
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PASSWORD_CHARS,
  formatStudentId,
  isStudentId,
  normalizeLoginId,
  initialPassword,
  checkNewPassword,
  newId,
  studentEmail,
} from '../js/ids.js';

test('formatStudentId', () => {
  assert.equal(formatStudentId(26, 17), 's26-017');
  assert.equal(formatStudentId(5, 1), 's05-001');
  assert.throws(() => formatStudentId(26, 1000));   // 連番は 1〜999
  assert.throws(() => formatStudentId(26, 0));
});

test('isStudentId', () => {
  assert.equal(isStudentId('s26-017'), true);
  for (const bad of ['S26-017', 's26-17', 's26017', 'chk-7f3a9c2d', 's26-017 ', '', null]) assert.equal(isStudentId(bad), false);
});

test('normalizeLoginId は空白・大文字・全角をそろえる', () => {
  assert.equal(normalizeLoginId('  S26-017 '), 's26-017');
  assert.equal(normalizeLoginId('ｓ２６－０１７'), 's26-017');
  assert.equal(normalizeLoginId('s26ー017'), 's26-017');   // 長音の記号もハイフンにする
  assert.equal(normalizeLoginId('Teacher@Example.com '), 'Teacher@Example.com'); // @ があれば前後の空白だけ取る
});

test('initialPassword は 8 文字で、まぎらわしい文字を使わない', () => {
  const pw = initialPassword(() => 0.999999);
  assert.equal(pw.length, 8);
  assert.match(initialPassword(Math.random), /^[abcdefghijkmnpqrstuvwxyz23456789]{8}$/);
  assert.equal(PASSWORD_CHARS, 'abcdefghijkmnpqrstuvwxyz23456789');
});

test('checkNewPassword', () => {
  assert.equal(checkNewPassword('abcdefg', 's26-017'), 'short');
  assert.equal(checkNewPassword('xxs26-017xx', 's26-017'), 'has-id');
  assert.equal(checkNewPassword('XXS26017XX', 's26-017'), 'has-id'); // ハイフンなし・大文字でも
  assert.equal(checkNewPassword('sakura-2026', 's26-017'), null);
});

test('newId は英数字だけで指定の長さ', () => {
  assert.match(newId(Math.random, 12), /^[A-Za-z0-9]{12}$/);
});

test('studentEmail は check-logic.js のものをそのまま使う', () => {
  assert.equal(studentEmail('s26-017', 1, 'jugyolog.invalid'), 's26-017.g1@jugyolog.invalid');
});
