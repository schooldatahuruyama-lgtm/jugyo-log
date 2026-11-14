// 版の印と、確かめる間隔。画面や通信は使わない。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseVersion, isNewVersion, shouldCheck } from '../js/version-check.js';

test('parseVersion: 前後の空白を取り、7〜40 文字の印を返す', () => {
  assert.equal(parseVersion('abc1234\n'), 'abc1234');
  assert.equal(parseVersion(' \tabc1234\r\n'), 'abc1234');
  const full = '0123456789abcdef0123456789abcdef01234567';
  assert.equal(parseVersion(full), full);
});

test('parseVersion: 空・dev・HTML・長さ違い・大文字・文字以外は null', () => {
  for (const value of ['', 'dev', '<!doctype html>', 'abc123', 'a'.repeat(41), 'ABC1234', null, 1234567, undefined, {}, 'abc 1234']) {
    assert.equal(parseVersion(value), null);
  }
});

test('isNewVersion: 正しい印が違うときだけ true（改行は取り除く）', () => {
  assert.equal(isNewVersion('abc1234', 'def5678'), true);
  assert.equal(isNewVersion('abc1234', 'abc1234'), false);
  assert.equal(isNewVersion('abc1234', 'def5678\n'), true);
  assert.equal(isNewVersion('abc1234\n', 'abc1234'), false);
});

test('isNewVersion: dev や不正な印では知らせない', () => {
  assert.equal(isNewVersion('dev', 'def5678'), false);
  for (const value of ['', '<html>', 'abc123', 'a'.repeat(41), 'ABC1234', null, 1234567]) {
    assert.equal(isNewVersion('abc1234', value), false);
    assert.equal(isNewVersion(value, 'def5678'), false);
  }
});

test('shouldCheck: 初回と、5 分の直前・ちょうど・経過後を区別する', () => {
  assert.equal(shouldCheck(1000, null, 300000), true);
  assert.equal(shouldCheck(300999, 1000, 300000), false);
  assert.equal(shouldCheck(301000, 1000, 300000), true);
  assert.equal(shouldCheck(301001, 1000, 300000), true);
});

test('shouldCheck: 時計が戻ったときや、数でない値も確かめ直す', () => {
  assert.equal(shouldCheck(500, 1000, 300000), true);
  for (const value of [NaN, Infinity, -Infinity, '1000', undefined]) {
    assert.equal(shouldCheck(value, 1000, 300000), true);
    assert.equal(shouldCheck(1000, value, 300000), true);
    assert.equal(shouldCheck(1000, 1000, value), true);
  }
});
