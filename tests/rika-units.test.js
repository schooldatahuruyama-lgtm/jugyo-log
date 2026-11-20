import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RIKA_UNITS, rikaUnit, rikaUnitLabel, cleanClassUnit } from '../js/rika-units.js';

test('理科の単元は学年順の 20 個で、id が重ならず、表と行を変えられない', () => {
  assert.equal(RIKA_UNITS.length, 20);
  assert.equal(new Set(RIKA_UNITS.map((unit) => unit.id)).size, 20);
  assert.deepEqual(RIKA_UNITS.map((unit) => unit.grade), [...Array(11).fill(1), ...Array(4).fill(2), ...Array(5).fill(3)]);
  assert.ok(Object.isFrozen(RIKA_UNITS));
  for (const unit of RIKA_UNITS) {
    assert.ok(Object.isFrozen(unit));
    assert.equal(rikaUnit(unit.id), unit);
    assert.equal(rikaUnitLabel(unit.id), `${unit.grade}年 ${unit.title}`);
    assert.equal(cleanClassUnit(unit.id), unit.id);
  }
  assert.equal(rikaUnitLabel('light'), '1年 光の世界');
});

test('理科の単元は、教材にない id と文字列でない値を見つけない', () => {
  for (const value of ['unknown-unit', '', 'LIGHT', 'toString', null, undefined, 1, {}, [], ['light']]) {
    assert.equal(rikaUnit(value), null);
    assert.equal(rikaUnitLabel(value), null);
  }
});

test('クラスの単元は小文字・数・ハイフンの 1〜40 文字だけ通す', () => {
  for (const value of ['a', 'unit-123', 'unknown-unit', 'a'.repeat(40)]) assert.equal(cleanClassUnit(value), value);
  for (const value of [null, undefined, 1, true, {}, [], ['light'], '', 'a'.repeat(41), 'Light', 'a_b', 'a/b', 'a.b', '光', ' light', 'light ', 'light\n']) {
    assert.equal(cleanClassUnit(value), null);
  }
});
