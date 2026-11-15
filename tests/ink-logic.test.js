// 手書きの計算。形・境界・線の間引き・元の値を変えないことを確かめる。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../js/config.js';
import { emptyInk, round1, cleanStroke, cleanInk, parseInk, serializeInk, inkBytes, isEmptyInk,
  simplify, makeStroke, snapLine, hitStroke, eraseAt, addStroke, addPage, canAddPage,
  strokePath, inkBounds, createHistory, emptyPictureInk, inkPlaceKind, pictureIndex } from '../js/ink-logic.js';

const stroke = (change = {}) => ({ c: 0, w: 0, p: [10, 20, 30, 40], ...change });
const ink = (s = [], h = 400) => ({ v: 1, h, s });
const draw = (points, change = {}, height = 400) => makeStroke({ points, color: 0, width: 0, ruler: false, ...change }, height);

test('写真の手書き: 高さは整数で 100〜4000。線を確かめ、種類と高さを保存して読める', () => {
  for (const [height, expected] of [[601.4, 601], [601.5, 602], [-1, 100], [99.9, 100], [1e300, 4000],
    ['600', 600], [null, 600], [NaN, 600], [Infinity, 600]]) {
    const value = cleanInk({ v: 1, k: 'pic', h: height, s: [stroke({ p: [-1, -1, 900, 5000] }), null] });
    assert.deepEqual(value, { v: 1, k: 'pic', h: expected, s: [stroke({ p: [0, 0, 800, expected] })] });
    assert.deepEqual(parseInk(serializeInk(value)), value);
  }
  for (const k of [undefined, 'other', null]) assert.deepEqual(cleanInk({ ...ink([], 601), k }), ink([], 800));
});

test('emptyPictureInk: 写真の比率と範囲を使い、不正な寸法は高さ 600', () => {
  for (const [w, h, expected] of [[1600, 1200, 600], [3, 2, 533], [1600, 201, 101], [10000, 1, 100],
    [1, 10000, 4000], [1e308, 1e308, 800], [Number.MIN_VALUE, 1e308, 4000]]) {
    assert.deepEqual(emptyPictureInk(w, h), { v: 1, k: 'pic', h: expected, s: [] });
  }
  for (const invalid of [0, -1, NaN, Infinity, '100', null, undefined]) {
    assert.equal(emptyPictureInk(invalid, 100).h, 600);
    assert.equal(emptyPictureInk(100, invalid).h, 600);
  }
  const value = emptyPictureInk(800, 600);
  assert.equal(canAddPage(value), false);
  assert.deepEqual(addPage(value), { ink: value, error: 'too-long' });
});

test('inkPlaceKind: 3 種類を区別し、資料は生成される 12 文字の英数字だけ', () => {
  for (const name of CONFIG.inkFields) assert.equal(inkPlaceKind(name), 'field');
  for (const name of CONFIG.attachmentSlots) assert.equal(inkPlaceKind(name), 'attachment');
  for (const name of ['Abc123Def456', '000000000000']) assert.equal(inkPlaceKind(name), 'material');
  for (const name of [null, undefined, 1, {}, [], '', 'other', 'a0', 'a7', 'a12', 'x'.repeat(11), 'x'.repeat(13),
    'abc/123Def45', 'abc_123Def45', '日本語資料1234567', 'Abc123Def45\n']) assert.equal(inkPlaceKind(name), null);
});

test('pictureIndex: 同じ写真の目録だけを返し、入れ替わった写真や目録なしは null', () => {
  const index = { fileId: 'ink-file', on: 'photo' };
  const record = { ink: { a1: index, Abc123Def456: index } };
  for (const place of ['a1', 'Abc123Def456']) {
    assert.equal(pictureIndex(record, place, 'photo'), index);
    assert.equal(pictureIndex(record, place, 'replaced'), null);
  }
  for (const record of [null, {}, { ink: {} }]) assert.equal(pictureIndex(record, 'a1', 'photo'), null);
});

// 設定を変えずに、指定したバイト数ちょうどの有効な手書きを作る。
function inkOfBytes(bytes) {
  const value = emptyInk();
  const full = stroke({ p: Array(CONFIG.ink.maxPoints * 2).fill(0) });
  while (inkBytes(ink([...value.s, full])) <= bytes - 32) value.s.push(full);
  const tail = stroke({ p: [0, 0, 0, 0] });
  value.s.push(tail);
  const remaining = bytes - inkBytes(value);
  for (let i = 0; i < Math.floor(remaining / 4); i += 1) tail.p.push(0, 0);
  tail.p[0] = [0, 10, 100, 10.1][remaining % 4];
  assert.deepEqual(cleanInk(value), value);
  assert.equal(inkBytes(value), bytes);
  return value;
}

test('emptyInk・isEmptyInk: 空の手書きは毎回新しく、線があれば空ではない', () => {
  const value = emptyInk();
  assert.deepEqual(value, { v: 1, h: 400, s: [] });
  assert.equal(isEmptyInk(value), true);
  assert.notEqual(emptyInk(), value);
  assert.notEqual(emptyInk().s, value.s);
  assert.equal(isEmptyInk(ink([stroke()])), false);
});

test('round1: 小数 1 けたに丸める', () => {
  for (const [value, expected] of [[0, 0], [12, 12], [12.34, 12.3], [12.36, 12.4], [12.35, 12.4], [-12.36, -12.4]]) {
    assert.equal(round1(value), expected);
  }
});

test('cleanStroke: 色と太さの番号を受け取り、余分な項目を除き、新しい線を返す', () => {
  for (const c of [0, 1, 2]) {
    for (const w of [0, 1]) {
      const value = stroke({ c, w, extra: true });
      const before = structuredClone(value);
      const cleaned = cleanStroke(value, 400);
      assert.deepEqual(cleaned, stroke({ c, w }));
      assert.notEqual(cleaned, value);
      assert.notEqual(cleaned.p, value.p);
      assert.deepEqual(value, before);
    }
  }
});

test('cleanStroke: 型・番号・点の個数・有限でない座標を確かめる', () => {
  for (const value of [null, undefined, [], 'x', 3, {}, stroke({ c: 3 }), stroke({ c: -1 }),
    stroke({ w: 2 }), stroke({ w: -1 }), stroke({ c: 1.5 }), stroke({ w: 0.5 }),
    stroke({ c: '1' }), stroke({ w: '0' }), stroke({ c: NaN }), stroke({ w: Infinity }),
    stroke({ p: null }), stroke({ p: {} }), stroke({ p: new Float64Array(4) }),
    stroke({ p: [] }), stroke({ p: [1, 2] }), stroke({ p: [1, 2, 3, 4, 5] }), stroke({ p: Array(4) })]) {
    assert.equal(cleanStroke(value, 400), null);
  }
  for (const bad of ['12', NaN, Infinity, -Infinity, null, undefined, true]) {
    for (const index of [0, 1, 2, 3]) {
      const value = stroke();
      value.p[index] = bad;
      assert.equal(cleanStroke(value, 400), null);
    }
  }
});

test('cleanStroke: 大きな座標も紙の範囲に切りつめ、小数 1 けたにする', () => {
  assert.deepEqual(cleanStroke(stroke({ p: [-100, -20, 99999, 99999, 12.34, 56.78] }), 800),
    stroke({ p: [0, 0, 800, 800, 12.3, 56.8] }));
  assert.deepEqual(cleanStroke(stroke({ p: [-Number.MAX_VALUE, -Number.MAX_VALUE, Number.MAX_VALUE, Number.MAX_VALUE] }), 400),
    stroke({ p: [0, 0, 800, 400] }));
});

test('cleanStroke: 2000 点ちょうどを残し、2001 点は落とす。同じ点も有効', () => {
  const value = stroke({ p: Array(4000).fill(10) });
  assert.deepEqual(cleanStroke(value, 400), value);
  assert.equal(cleanStroke(stroke({ p: [...value.p, 10, 10] }), 400), null);
  assert.deepEqual(cleanStroke(stroke({ p: [20, 30, 20, 30] }), 400), stroke({ p: [20, 30, 20, 30] }));
});

test('cleanInk: 不正な形は空にし、高さを 400〜4000 の 400 の倍数にする', () => {
  for (const value of [null, undefined, [], 3, 'x', {}, { v: 2 }, { v: '1' }]) {
    assert.deepEqual(cleanInk(value), emptyInk());
  }
  for (const h of [undefined, null, '800', NaN, Infinity, -Infinity, -1, 0, 399, 400]) {
    assert.deepEqual(cleanInk({ v: 1, h }), emptyInk());
  }
  for (const [h, expected] of [[400.1, 800], [450, 800], [800, 800], [3600, 3600], [3999, 4000],
    [4000, 4000], [99999, 4000], [Number.MAX_VALUE, 4000]]) {
    assert.deepEqual(cleanInk({ v: 1, h, s: null }), ink([], expected));
  }
});

test('cleanInk: おかしい線だけを落とし、直した高さを使う。元の値は変えない', () => {
  const value = { v: 1, h: 450, s: [stroke(), null, stroke({ c: 3 }), stroke({ p: [1, 900, 2, 1200] })], extra: true };
  const before = structuredClone(value);
  assert.deepEqual(cleanInk(value), ink([stroke(), stroke({ p: [1, 800, 2, 800] })], 800));
  assert.deepEqual(value, before);
  for (const s of [null, undefined, 'x', {}, 5]) assert.deepEqual(cleanInk({ v: 1, h: 400, s }), emptyInk());
});

test('cleanInk: 有効な線を先頭から 2000 本残す', () => {
  const strokes = Array.from({ length: 2001 }, (_, i) => stroke({ c: i % 3, w: i % 2 }));
  assert.deepEqual(cleanInk(ink(strokes)).s, strokes.slice(0, 2000));
  assert.deepEqual(cleanInk(ink([null, ...strokes])).s, strokes.slice(0, 2000));
});

test('parseInk: 壊れた JSON・形や版の違いは null、正しい版は整えて返す', () => {
  for (const text of ['{', '', '[]', 'null', '12', 'true', '"text"', '{}', '{"v":2}', '{"v":"1"}']) {
    assert.equal(parseInk(text), null);
  }
  assert.deepEqual(parseInk('{"v":1,"h":400,"s":[]}'), emptyInk());
  assert.deepEqual(parseInk('{"v":1,"h":450,"s":[null]}'), ink([], 800));
});

test('serializeInk・inkBytes: 整えた JSON を往復でき、バイト数は UTF-8 と一致する', () => {
  const value = ink([stroke({ c: 2, w: 1, p: [0.1, 0.2, 799.9, 399.9] })], 800);
  const before = structuredClone(value);
  const text = serializeInk(value);
  assert.deepEqual(parseInk(text), value);
  assert.equal(inkBytes(value), Buffer.byteLength(text, 'utf8'));
  assert.equal(serializeInk({ ...value, h: 450, extra: '余分な文字' }), text);
  assert.equal(serializeInk(null), '{"v":1,"h":400,"s":[]}');
  assert.deepEqual(value, before);
});

test('simplify: 2 点以下は同じ中身の新しい配列、連続する同じ点は 1 つ', () => {
  for (const points of [[], [10, 20], [10, 20, 30, 40]]) {
    assert.deepEqual(simplify(points, 0.6), points);
    assert.notEqual(simplify(points, 0.6), points);
  }
  assert.deepEqual(simplify([10, 20, 10, 20], 0.6), [10, 20]);
  assert.deepEqual(simplify([10, 20, 10, 20, 10, 20], 0.6), [10, 20]);
  assert.deepEqual(simplify([0, 0, 0, 0, 10, 0, 10, 0, 10, 10, 10, 10], 0.6), [0, 0, 10, 0, 10, 10]);
});

test('simplify: 直線の 10 点は両端にし、角と折り返しは残す', () => {
  const points = Array.from({ length: 10 }, (_, i) => [i, i * 2]).flat();
  const before = [...points];
  assert.deepEqual(simplify(points, 0.6), [0, 0, 9, 18]);
  assert.deepEqual(simplify([0, 0, 5, 0, 10, 0, 10, 5, 10, 10], 0.6), [0, 0, 10, 0, 10, 10]);
  assert.deepEqual(simplify([0, 0, 10, 0, 0, 0], 0.6), [0, 0, 10, 0, 0, 0]);
  assert.deepEqual(simplify([0, 0, 20, 0, 10, 0], 0.6), [0, 0, 20, 0, 10, 0]);
  assert.deepEqual(points, before);
});

test('simplify: 許容距離以下は間引き、こえた点は残す', () => {
  const points = [0, 0, 5, 1, 10, 0];
  assert.deepEqual(simplify(points, 1), [0, 0, 10, 0]);
  assert.deepEqual(simplify(points, 0.9), points);
  assert.deepEqual(simplify(points, 0), points);
});

test('simplify: 10 万点でもスタックがあふれず、両端を残す', () => {
  const points = [];
  for (let i = 0; i < 100000; i += 1) points.push(i / 125, 200 + 100 * Math.sin(i / 1000));
  const result = simplify(points, 0.6);
  assert.ok(result.length < points.length);
  assert.deepEqual(result.slice(0, 2), points.slice(0, 2));
  assert.deepEqual(result.slice(-2), points.slice(-2));
});

test('makeStroke: 波の線を間引いて両端を残し、元の点は変えない', () => {
  const points = Array.from({ length: 501 }, (_, i) => [i, round1(200 + 30 * Math.sin(i / 25))]).flat();
  const before = [...points];
  const result = draw(points, { color: 2, width: 1 });
  assert.equal(result.c, 2);
  assert.equal(result.w, 1);
  assert.ok(result.p.length < points.length);
  assert.deepEqual(result.p.slice(0, 2), points.slice(0, 2));
  assert.deepEqual(result.p.slice(-2), points.slice(-2));
  assert.deepEqual(points, before);
});

test('makeStroke: 間引き後も多いときは等間隔に 2000 点を選び、両端を残す', () => {
  const points = Array.from({ length: 2401 }, (_, i) => [i * 0.3, i % 2 === 0 ? 20 : 380]).flat();
  const reduced = simplify(points, CONFIG.ink.simplifyTolerance);
  assert.ok(reduced.length > CONFIG.ink.maxPoints * 2);
  const result = draw(points);
  assert.equal(result.p.length, 4000);
  assert.deepEqual(result.p.slice(0, 2), points.slice(0, 2));
  assert.deepEqual(result.p.slice(-2), points.slice(-2));
  const positions = [];
  for (let i = 0; i < result.p.length; i += 2) positions.push(reduced.findIndex((n, j) => j % 2 === 0 && round1(n) === result.p[i]) / 2);
  const gaps = positions.slice(1).map((n, i) => n - positions[i]);
  assert.ok(Math.max(...gaps) - Math.min(...gaps) <= 1);
});

test('makeStroke: 定規では両端だけを使い、横・縦から 3 度ならそろえ、10 度なら残す', () => {
  assert.deepEqual(draw([10, 10, 20, 300, 110, 110], { ruler: true }).p, [10, 10, 110, 110]);
  for (const degrees of [3, 10]) {
    const offset = Math.tan(degrees * Math.PI / 180) * 100;
    for (const direction of [-1, 1]) {
      const end = 200 + direction * 100;
      const across = 200 + direction * offset;
      assert.deepEqual(draw([200, 200, end, across], { ruler: true }).p,
        [200, 200, end, degrees === 3 ? 200 : round1(across)]);
      assert.deepEqual(draw([200, 200, across, end], { ruler: true }).p,
        [200, 200, degrees === 3 ? 200 : round1(across), end]);
    }
  }
});

test('makeStroke: 1 点・同じ点の繰り返し・紙の端でも、0.1 ずらした点として残す', () => {
  for (const ruler of [false, true]) {
    for (const points of [[20, 30], [20, 30, 20, 30, 20, 30]]) {
      assert.deepEqual(draw(points, { ruler }), stroke({ p: [20, 30, 20.1, 30] }));
    }
    assert.deepEqual(draw([800, 400], { ruler }).p, [800, 400, 799.9, 400]);
    assert.deepEqual(draw([0, 0], { ruler }).p, [0, 0, 0.1, 0]);
    assert.deepEqual(draw([Number.MAX_VALUE, Number.MAX_VALUE], { ruler }, 800).p, [800, 800, 799.9, 800]);
  }
});

test('makeStroke: 点なし・不正な点・色や太さは null。範囲外の座標は最後に切りつめる', () => {
  for (const ruler of [false, true]) {
    for (const points of [[], null, [1], [1, 2, 3], [0, 0, '12', 2, 10, 10], [0, 0, NaN, 2, 10, 10],
      [0, 0, Infinity, 2, 10, 10], Array(4)]) assert.equal(draw(points, { ruler }), null);
  }
  assert.equal(draw([0, 0, 10, 10], { color: 3 }), null);
  assert.equal(draw([0, 0, 10, 10], { width: 2 }), null);
  assert.deepEqual(draw([-10, -20, 900, 900], {}, 800).p, [0, 0, 800, 800]);
});

test('snapLine: 境界ちょうどはそろえず、ゼロの長さも扱う', () => {
  assert.deepEqual(snapLine(0, 0, 100, 8.75), [0, 0, 100, 8.75]);
  assert.deepEqual(snapLine(0, 0, 8.75, 100), [0, 0, 8.75, 100]);
  assert.deepEqual(snapLine(0, 0, 100, 8.74), [0, 0, 100, 0]);
  assert.deepEqual(snapLine(0, 0, 8.74, 100), [0, 0, 0, 100]);
  assert.deepEqual(snapLine(10, 20, 10, 20), [10, 20, 10, 20]);
});

test('hitStroke: 線の太さを含む距離の境界・端点・遠くを確かめる', () => {
  for (const [w, half] of [[0, 1.5], [1, 3.5]]) {
    const line = stroke({ w, p: [20, 20, 120, 20] });
    assert.equal(hitStroke(line, 70, 20, 10), true);
    assert.equal(hitStroke(line, 70, 30 + half, 10), true);
    assert.equal(hitStroke(line, 70, 30.1 + half, 10), false);
    assert.equal(hitStroke(line, 70, 20 + half, 0), true);
    assert.equal(hitStroke(line, 10 - half, 20, 10), true);
    assert.equal(hitStroke(line, 9.9 - half, 20, 10), false);
    assert.equal(hitStroke(line, 150, 20, 10), false);
  }
});

test('hitStroke: 斜め・折れ線の後半・同じ点からなる線を扱う', () => {
  assert.equal(hitStroke(stroke({ p: [0, 0, 20, 20] }), 10, 10, 0), true);
  assert.equal(hitStroke(stroke({ p: [0, 0, 20, 20] }), 10, 14, 0), false);
  assert.equal(hitStroke(stroke({ p: [0, 0, 10, 0, 10, 100] }), 10, 80, 0), true);
  assert.equal(hitStroke(stroke({ p: [20, 20, 20, 20] }), 20, 31.5, 10), true);
  assert.equal(hitStroke(stroke({ p: [20, 20, 20, 20] }), 20, 31.6, 10), false);
});

test('eraseAt: 当たらなければ同じオブジェクト、当たった 2 本を消し、元は変えない', () => {
  const value = ink([stroke({ p: [0, 20, 100, 20] }), stroke({ p: [0, 30, 100, 30] }), stroke({ p: [0, 100, 100, 100] })]);
  const before = structuredClone(value);
  assert.equal(eraseAt(value, 200, 200), value);
  const result = eraseAt(value, 50, 25);
  assert.notEqual(result, value);
  assert.deepEqual(result, ink([value.s[2]]));
  assert.deepEqual(value, before);
  assert.deepEqual(eraseAt(ink(value.s.slice(0, 2)), 50, 25), emptyInk());
  const empty = emptyInk();
  assert.equal(eraseAt(empty, 0, 0), empty);
});

test('addStroke: 1999 本には足せて、2000 本には足せず、元の値は変えない', () => {
  const value = ink(Array.from({ length: 1999 }, () => stroke()));
  const before = structuredClone(value);
  const added = stroke({ c: 2 });
  const result = addStroke(value, added);
  assert.equal(result.error, null);
  assert.notEqual(result.ink, value);
  assert.equal(result.ink.s.length, 2000);
  assert.deepEqual(result.ink.s.at(-1), added);
  assert.deepEqual(value, before);
  const rejected = addStroke(result.ink, added);
  assert.equal(rejected.error, 'too-many');
  assert.equal(rejected.ink, result.ink);
});

test('addStroke: 250000 バイトちょうどは足せて、1 バイト超過は元のまま', () => {
  const added = stroke();
  const increase = JSON.stringify(added).length + 1;
  const value = inkOfBytes(CONFIG.ink.maxBytes - increase);
  const before = structuredClone(value);
  const result = addStroke(value, added);
  assert.equal(result.error, null);
  assert.equal(inkBytes(result.ink), 250000);
  assert.deepEqual(value, before);
  const over = inkOfBytes(CONFIG.ink.maxBytes - increase + 1);
  const overBefore = structuredClone(over);
  const rejected = addStroke(over, added);
  assert.equal(rejected.error, 'too-big');
  assert.equal(rejected.ink, over);
  assert.deepEqual(over, overBefore);
});

test('addPage・canAddPage: 400 ずつ増やし、3600 → 4000 は成功、次は元のまま', () => {
  for (const h of [400, 3600]) {
    const value = ink([stroke()], h);
    const before = structuredClone(value);
    assert.equal(canAddPage(value), true);
    const result = addPage(value);
    assert.equal(result.error, null);
    assert.notEqual(result.ink, value);
    assert.deepEqual(result.ink, ink(value.s, h + 400));
    assert.deepEqual(value, before);
  }
  const full = ink([stroke()], 4000);
  assert.equal(canAddPage(full), false);
  const result = addPage(full);
  assert.equal(result.error, 'too-long');
  assert.equal(result.ink, full);
});

test('strokePath: 小数 1 けたの SVG の M・L を返す', () => {
  assert.equal(strokePath(stroke({ p: [0, 1.23, 12.36, 40, 50, 60.78] })), 'M 0.0 1.2 L 12.4 40.0 L 50.0 60.8');
});

test('inkBounds: 線の太さの半分と途中の点を含めて囲み、空なら null', () => {
  assert.equal(inkBounds(emptyInk()), null);
  assert.deepEqual(inkBounds(ink([stroke()])), { x: 8.5, y: 18.5, w: 23, h: 23 });
  const value = ink([stroke(), stroke({ w: 1, p: [0, 0, 100, 200, 50, 60] })]);
  assert.deepEqual(inkBounds(value), { x: -3.5, y: -3.5, w: 107, h: 207 });
  assert.deepEqual(inkBounds(ink([stroke({ p: [20, 30, 20, 30] })])), { x: 18.5, y: 28.5, w: 3, h: 3 });
});

test('createHistory: 積んだ順の逆に戻り、空なら null。現在の状態は積まない', () => {
  const history = createHistory(30);
  const first = emptyInk();
  const second = ink([stroke()]);
  const current = ink([stroke(), stroke({ c: 1 })]);
  const before = structuredClone({ first, second, current });
  assert.equal(history.canUndo(), false);
  assert.equal(history.undo(current), null);
  history.push(first);
  history.push(second);
  assert.equal(history.canUndo(), true);
  assert.deepEqual(history.undo(current), second);
  assert.equal(history.canUndo(), true);
  assert.deepEqual(history.undo(second), first);
  assert.equal(history.canUndo(), false);
  assert.equal(history.undo(first), null);
  assert.deepEqual({ first, second, current }, before);
});

test('createHistory: 上限をこえた古い状態を捨て、0 件なら保持しない', () => {
  const history = createHistory(2);
  history.push(emptyInk());
  history.push(ink([], 800));
  history.push(ink([], 1200));
  assert.deepEqual(history.undo(ink([], 1600)), ink([], 1200));
  assert.deepEqual(history.undo(ink([], 1200)), ink([], 800));
  assert.equal(history.undo(emptyInk()), null);
  const disabled = createHistory(0);
  disabled.push(emptyInk());
  assert.equal(disabled.canUndo(), false);
  assert.equal(disabled.undo(emptyInk()), null);
});
