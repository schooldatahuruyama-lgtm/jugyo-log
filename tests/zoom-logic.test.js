import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clampZoom, pinchZoom, nextZoom, zoomScroll, touchScroll } from '../js/zoom-logic.js';

test('2本指のスクロール: まん中の上下差だけを使い、3本目・横移動・拡大では動かさない', () => {
  const pair = (y1, y2) => [{ clientX: 100, clientY: y1 }, { clientX: 200, clientY: y2 }];
  assert.equal(touchScroll(pair(200, 300), pair(100, 200)), 100);
  assert.equal(touchScroll(pair(100, 200), pair(200, 300)), -100);
  assert.equal(touchScroll(pair(200, 300), pair(180, 280)), 20);
  assert.equal(touchScroll(pair(200, 300), pair(100, 400)), 0);
  assert.equal(touchScroll(pair(200, 300), [{ clientX: 0, clientY: 200 }, { clientX: 400, clientY: 300 }]), 0);
  assert.equal(touchScroll([...pair(200, 300), { clientY: -999 }], [...pair(100, 200), { clientY: 999 }]), 100);
});

test('2本指のスクロール: 指が足りない・位置が数でない入力は動かさない', () => {
  const pair = [{ clientX: 100, clientY: 200 }, { clientX: 200, clientY: 300 }];
  for (const bad of [undefined, null, {}, [], [pair[0]], [null, pair[1]]]) {
    assert.equal(touchScroll(bad, pair), 0);
    assert.equal(touchScroll(pair, bad), 0);
  }
  for (const key of ['clientX', 'clientY']) {
    for (const value of [undefined, null, '100', NaN, Infinity, -Infinity]) {
      for (const index of [0, 1]) {
        const bad = pair.map((point, i) => i === index ? { ...point, [key]: value } : point);
        assert.equal(touchScroll(pair, bad), 0);
        assert.equal(touchScroll(bad, pair), 0);
      }
    }
  }
});

test('倍率: 比で拡大縮小し、100〜400% に収める', () => {
  assert.equal(pinchZoom(1.25, 100, 200), 2.5);
  assert.equal(pinchZoom(3, 200, 100), 1.5);
  assert.equal(pinchZoom(1, 100, 1), 1);
  assert.equal(pinchZoom(4, 1, 100), 4);
  for (const value of [0, -1, NaN, Infinity, undefined]) {
    assert.equal(pinchZoom(2, value, 100), 2);
    assert.equal(pinchZoom(2, 100, value), 2);
  }
  assert.equal(clampZoom(NaN, 1.37), 1.37);
  assert.equal(clampZoom(NaN, NaN), 1);
  assert.equal(clampZoom(Infinity), 4);
  assert.equal(clampZoom(-Infinity), 1);
  assert.equal(clampZoom(0), 1);
  assert.equal(clampZoom(undefined, 10), 4);
});

test('ボタン: 半端な倍率から ±0.25、端では止まる', () => {
  assert.equal(nextZoom(1.37, 0.25), 1.62);
  assert.equal(nextZoom(1.37, -0.25), 1.12);
  assert.equal(nextZoom(1.1, -0.25), 1);
  assert.equal(nextZoom(3.9, 0.25), 4);
  assert.equal(nextZoom(2, NaN), 2);
});

test('指のまん中: 中央寄せの余白・既存スクロール・2本指の移動を含める', () => {
  const result = zoomScroll({ scroll: { left: 50, top: 80 },
    from: { x: 300, y: 200 }, to: { x: 320, y: 240 },
    before: { left: 100, top: 50, width: 400, height: 300 },
    after: { left: -30, top: -40, width: 800, height: 600 } });
  assert.deepEqual(result, { left: 100, top: 100 });
});

test('スクロール: 余白に収まる縮小と不正な大きさで負数・NaNにしない', () => {
  const options = { scroll: { left: 0, top: 0 }, from: { x: 200, y: 100 },
    before: { left: 0, top: 0, width: 800, height: 400 },
    after: { left: 0, top: 0, width: 400, height: 200 } };
  assert.deepEqual(zoomScroll(options), { left: 0, top: 0 });
  for (const width of [0, NaN, Infinity]) {
    assert.deepEqual(zoomScroll({ ...options, before: { ...options.before, width } }), options.scroll);
  }
  assert.deepEqual(zoomScroll({ ...options, from: { x: NaN, y: NaN } }), options.scroll);
});
