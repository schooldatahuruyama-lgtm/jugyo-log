// 実在の情報・通信を使わず、写真と保存部品のつなぎ方を DOM の代役で確かめる。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createInkDrafts } from '../js/ink-drafts.js';
import { createRecordQueue } from '../js/record-queue.js';
import { pendingLessonCount, pendingLessons } from '../js/record-flow.js';
import { emptyPictureInk } from '../js/ink-logic.js';
import { CONFIG } from '../js/config.js';
import { NetError } from '../js/errors.js';
import { attachmentPane } from '../js/views/parts/attachment-pane.js';
import { materialPane } from '../js/views/parts/material-pane.js';
import { inkField } from '../js/views/parts/ink-field.js';
import { inkPad } from '../js/views/parts/ink-pad.js';
import { openViewer } from '../js/views/parts/viewer.js';
import { canUsePictureInk, hasPictureInk, pictureInks } from '../js/views/parts/picture-ink.js';
import { mount as mountTeacher } from '../js/views/teacher-record.js';
import { mount as mountStudent } from '../js/views/student-lesson.js';
import { installDom, all, byClass, buttons, settle, draw, touch } from './helpers/picture-dom.js';

const ids = { classId: 'test-class', lessonId: 'test-lesson', studentId: 'test-student' };
const materialId = 'TestPhoto001';
const photo = { place: 'a1', fileId: 'test-photo', type: 'image' };
const stroke = { c: 0, w: 0, p: [80, 120, 640, 420] };
const written = () => ({ ...emptyPictureInk(1600, 1200), s: [stroke] });
const indexFor = (on = photo.fileId, time = 10) => ({ on, fileId: 'test-ink', bytes: 100, strokes: 1, updatedAt: time });
const getDraft = (h, field = 'a1') => h.ctx.inkDrafts.get(ids.studentId, ids.classId, ids.lessonId, field);
const putDraft = (h, field = 'a1', on = photo.fileId, ink = written()) => h.ctx.inkDrafts.put(
  ids.studentId, ids.classId, ids.lessonId, field, { ink, on, editedAt: 50, key: 'test-draft-key' });

function setup(t) {
  const dom = installDom();
  const cleanups = [];
  t.after(() => {
    try { for (const cleanup of cleanups.reverse()) cleanup(); }
    finally { dom.restore(); }
  });
  const storage = new Map();
  const timers = new Map();
  let timerId = 0;
  let time = 100;
  const h = {
    cleanup: (fn) => cleanups.push(fn),
    record: { attachments: [{ slot: 'a1', type: 'image', fileId: photo.fileId, addedAt: 1 }], ink: {}, inkCleared: {} },
    lesson: { title: '動作確認用の授業', date: '2026-01-01', materials: {
      [materialId]: { kind: 'board', type: 'image', fileId: 'test-material', name: '動作確認用の資料', order: 0, bytes: 10 },
    } },
    files: new Map([['test-ink', JSON.stringify(written())]]), loads: [], saves: [], trashes: [],
  };
  h.ctx = {
    params: ids, session: { studentId: ids.studentId }, now: () => ++time, random: () => 0.25,
    timers: { setTimeout(fn) { timers.set(++timerId, fn); return timerId; }, clearTimeout(id) { timers.delete(id); } },
    recordQueue: createRecordQueue(),
    inkDrafts: createInkDrafts({ storage: {
      getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value),
      removeItem: (key) => storage.delete(key), get length() { return storage.size; }, key: (i) => [...storage.keys()][i],
    } }),
    drafts: { get: () => null, remove() {}, put: () => true, list: () => [] },
    thumbs: { load: async () => ({}) },
    setLeaveGuard: (guard) => { h.guard = guard; }, navigate() {},
    repo: {
      getRecord: async () => h.record,
      getLesson: async () => h.lesson,
      getMembers: async () => [{ studentId: ids.studentId, number: 1 }],
      listRecords: async () => ({ [ids.studentId]: h.record }),
      getMyLessonTerms: async () => ({}), getRecThumbs: async () => ({}),
      async setInk(c, l, s, field, index, thumb, editedAt) {
        if (h.saveError) throw h.saveError;
        h.saves.push({ field, index, thumb });
        h.record.ink[field] = { ...index, updatedAt: editedAt };
        delete h.record.inkCleared[field];
      },
      async removeInk(c, l, s, field, editedAt) {
        delete h.record.ink[field]; h.record.inkCleared[field] = editedAt;
      },
      async removeAttachment(c, l, s, slot, editedAt) {
        h.record.attachments = h.record.attachments.filter((item) => item.slot !== slot);
        delete h.record.ink[slot];
        h.record.inkCleared[slot] = editedAt;
      },
    },
    files: {
      async loadInk(id) { h.loads.push(id); if (h.loadError) throw h.loadError; return h.files.get(id); },
      async uploadInk({ text }) {
        if (h.uploadGate) await h.uploadGate;
        const fileId = `uploaded-${h.files.size}`;
        h.files.set(fileId, text); return { fileId, bytes: text.length };
      },
      async trashStudent(id) { h.trashes.push(id); return true; },
      loadStudentFile: async () => new Blob(['fake image']),
      loadImages: async (c, l, materials) => Object.fromEntries(materials.map((item) => [item.id, new Blob(['fake image'])])),
    },
  };
  h.advance = async () => { const jobs = [...timers.values()]; timers.clear(); jobs.forEach((fn) => fn()); await settle(); };
  return h;
}

function attachments(h, readOnly = false) {
  const pane = attachmentPane({ ctx: h.ctx, ...ids, attachments: h.record.attachments,
    ink: h.record.ink, inkCleared: h.record.inkCleared, readOnly });
  document.body.append(pane.node);
  return pane;
}
const viewer = () => byClass(document.body, 'material-viewer')[0];
const paper = () => byClass(viewer(), 'ink-paper')[0];
const close = () => buttons(viewer(), '閉じる')[0].click();
async function startWriting(openButton) {
  openButton.click(); await settle();
  const toggle = buttons(viewer(), '✎ 書きこむ')[0];
  assert.equal(toggle.getAttribute('aria-pressed'), 'false');
  assert.equal(toggle.disabled, false);
  toggle.click();
  assert.equal(buttons(viewer(), '動かす').length, 0);
  assert.equal(buttons(viewer(), '書く').length, 0);
  return paper();
}

test('印の判断: 場所・写真 ID・PDF・下書きの時刻・全消去', () => {
  const index = indexFor();
  assert.equal(hasPictureInk(photo, { a1: index }), true);
  for (const bad of [{ ...photo, place: 'unknown' }, { ...photo, place: 'memo' },
    { ...photo, fileId: 'other' }, { ...photo, type: 'pdf' }, { ...photo, fileId: null }]) {
    assert.equal(hasPictureInk(bad, { [bad.place]: index }), false);
  }
  assert.equal(canUsePictureInk({ ...photo, place: materialId }), true);
  const draft = { on: photo.fileId, editedAt: 20, ink: emptyPictureInk(1, 1) };
  assert.equal(hasPictureInk(photo, { a1: index }, {}, draft), false);
  assert.equal(hasPictureInk(photo, { a1: index }, {}, { ...draft, editedAt: 5 }), true);
  assert.equal(hasPictureInk(photo, {}, {}, { ...draft, ink: written() }), true);
  assert.equal(hasPictureInk(photo, {}, { a1: 30 }, { ...draft, ink: written() }), false);
});

test('自分の写真: 書く→自動保存→印→開き直す。履歴と400%の座標を維持', async (t) => {
  const h = setup(t), pane = attachments(h);
  h.cleanup(() => pane.destroy());
  await settle();
  const svg = await startWriting(byClass(pane.node, 'attachment-open')[0]);
  assert.equal(svg.getAttribute('preserveAspectRatio'), 'none');
  assert.equal(svg.style.touchAction, 'none');
  assert.equal(all(svg, (node) => node.tagName === 'line').length, 0);
  assert.equal(buttons(viewer(), '＋ 下に書く場所を足す').length, 0);
  draw(svg, { type: 'touch' });
  assert.equal(pane.dirty, true);
  assert.equal(getDraft(h).ink.s.length, 1);
  draw(svg);
  assert.equal(getDraft(h).ink.s.length, 2);
  buttons(viewer(), '1 つ戻す')[0].click();
  assert.equal(getDraft(h).on, photo.fileId);
  await h.advance();
  assert.equal(pane.state, 'saved');
  assert.equal(h.record.ink.a1.on, photo.fileId);
  assert.equal(h.saves[0].thumb, undefined);
  assert.match(viewer().textContent, /✓ 保存しました/);
  close();
  assert.equal(byClass(pane.node, 'picture-ink-badge').length, 1);
  const same = await startWriting(byClass(pane.node, 'attachment-open')[0]);
  assert.equal(same, svg);
  assert.equal(h.loads.length, 0);
  for (let i = 0; i < 12; i++) buttons(viewer(), '＋')[0].click();
  assert.match(viewer().textContent, /400%/);
  draw(svg, { type: 'mouse' });
  assert.deepEqual(getDraft(h).ink.s[1].p, stroke.p);
  const viewport = byClass(viewer(), 'viewer-viewport')[0];
  viewport.fire('pointerdown', { pointerType: 'pen', pointerId: 20, clientX: 0, clientY: 0 });
  assert.equal(viewport.hasPointerCapture(20), false);
  buttons(viewer(), '1 つ戻す')[0].click();
  assert.equal(getDraft(h).ink.s.length, 1);
  buttons(viewer(), '全部消す')[0].click();
  const confirmation = byClass(document.body, 'confirm')[0];
  assert.match(confirmation.textContent, /この写真への書きこみを全部消します/);
  buttons(confirmation, '全部消す')[0].click(); await settle();
  assert.equal(byClass(pane.node, 'picture-ink-badge').length, 0);
  close(); await settle();
  assert.equal(h.record.ink.a1, undefined);
});

test('書きこみの切り替えと幅変更で写真を合わせ直し、400%でも線の座標を保つ', async (t) => {
  const h = setup(t), pane = attachments(h);
  h.cleanup(() => pane.destroy());
  byClass(pane.node, 'attachment-open')[0].click(); await settle();
  const viewport = byClass(viewer(), 'viewer-viewport')[0];
  const tools = byClass(viewer(), 'ink-tools')[0];
  const image = all(viewer(), (node) => node.tagName === 'img')[0];
  const toggle = buttons(viewer(), '✎ 書きこむ')[0];
  // 道具の表示と折り返しで、写真に使える高さが変わる状況を再現する。
  Object.defineProperty(viewport, 'clientHeight', { get: () => tools.hidden ? 600 : viewport.clientWidth < 600 ? 260 : 400 });
  const expectSize = (width, height, zoom) => {
    assert.equal(image.style.width, `${width}px`);
    assert.equal(image.style.height, `${height}px`);
    assert.equal(byClass(viewer(), 'viewer-counter')[0].textContent, `${zoom}%`);
  };
  const toggleRepeatedly = (zoom) => {
    for (let i = 0; i < 4; i++) {
      toggle.click();
      assert.equal(tools.hidden, false);
      assert.equal(toggle.getAttribute('aria-pressed'), 'true');
      expectSize(Math.round(512 * zoom / 100), Math.round(384 * zoom / 100), zoom);
      toggle.click();
      assert.equal(tools.hidden, true);
      assert.equal(toggle.getAttribute('aria-pressed'), 'false');
      expectSize(Math.round(1600 * 584 / 1200 * zoom / 100), Math.round(584 * zoom / 100), zoom);
    }
  };
  toggleRepeatedly(100);
  toggle.click();
  viewport.clientWidth = 500;
  window.fire('resize');
  expectSize(325, 244, 100);
  viewport.clientWidth = 820;
  window.fire('resize');
  expectSize(512, 384, 100);
  toggle.click();
  for (let i = 0; i < 12; i++) buttons(viewer(), '＋')[0].click();
  toggleRepeatedly(400);
  toggle.click();
  draw(paper(), { type: 'mouse' });
  assert.deepEqual(getDraft(h).ink.s[0].p, stroke.p);
  viewport.clientWidth = 500;
  window.fire('resize');
  expectSize(1301, 976, 400);
  draw(paper(), { type: 'mouse' });
  assert.deepEqual(getDraft(h).ink.s[1].p, stroke.p);
  close();
});

test('写真の道具: すぐ書ける案内と並び、入・切で接触と色・太さを保つ', async (t) => {
  const h = setup(t), pane = attachments(h); h.cleanup(() => pane.destroy());
  const svg = await startWriting(byClass(pane.node, 'attachment-open')[0]);
  const tools = byClass(viewer(), 'ink-tools')[0], status = byClass(tools, 'ink-status')[0];
  const hint = '指 1 本かペンで書けます。指 2 本で動かす・拡大。';
  const controls = all(tools, (node) => node.tagName === 'button');
  assert.deepEqual(controls.map((node) => node.getAttribute('aria-label') || node.textContent),
    ['黒', '赤', '青', '細い', '太い', '定規', '消しゴム', '1 つ戻す', '全部消す']);
  assert.equal(status.textContent, hint);
  buttons(tools, '定規')[0].click(); assert.equal(status.textContent, `${hint}／定規`);
  buttons(tools, '消しゴム')[0].click(); assert.equal(status.textContent, `${hint}／消しゴム`);
  controls[1].click(); controls[4].click();
  assert.equal(status.textContent, hint);
  const toggle = buttons(viewer(), '✎ 書きこむ')[0];
  const checkTouches = (expected) => {
    assert.equal(svg.style.touchAction, expected ? 'none' : 'pan-x pan-y pinch-zoom');
    assert.equal(svg.classList.contains('ink-paper-writing'), expected);
    assert.equal(tools.hidden, !expected);
    assert.equal(toggle.getAttribute('aria-pressed'), String(expected));
    for (const type of ['touchstart', 'touchmove']) {
      assert.equal(svg.fire(type, { cancelable: true, changedTouches: [{}] }).defaultPrevented, expected);
    }
  };
  checkTouches(true);
  for (let i = 0; i < 3; i++) {
    toggle.click(); checkTouches(false);
    draw(svg, { type: 'touch' }); draw(svg);
    assert.equal(getDraft(h), null);
    toggle.click(); checkTouches(true);
    assert.equal(controls[1].getAttribute('aria-pressed'), 'true');
    assert.equal(controls[4].getAttribute('aria-pressed'), 'true');
  }
  draw(svg, { type: 'touch' });
  assert.deepEqual(getDraft(h).ink.s[0], { ...stroke, c: 1, w: 1 });
  close();
});

test('写真のピンチ: まん中を保ち、2本指で移動・半端な倍率・上下限・3本目を扱う', async (t) => {
  const h = setup(t), pane = attachments(h); h.cleanup(() => pane.destroy());
  byClass(pane.node, 'attachment-open')[0].click(); await settle();
  const viewport = byClass(viewer(), 'viewer-viewport')[0], frame = byClass(viewer(), 'viewer-picture')[0];
  const label = byClass(viewer(), 'viewer-counter')[0];
  const anchor = { x: 430, y: 340 }, before = frame.getBoundingClientRect();
  const relative = { x: (anchor.x - before.left) / before.width, y: (anchor.y - before.top) / before.height };
  assert.equal(touch(viewport, 'touchstart', [[1, 380, 340]]).defaultPrevented, false);
  assert.equal(touch(viewport, 'touchstart', [[1, 380, 340], [2, 480, 340]]).defaultPrevented, true);
  assert.equal(touch(viewport, 'touchmove', [[1, 330, 340], [2, 530, 340]]).defaultPrevented, true);
  assert.equal(label.textContent, '200%');
  const after = frame.getBoundingClientRect();
  assert.ok(Math.abs(after.left + relative.x * after.width - anchor.x) < 0.001);
  assert.ok(Math.abs(after.top + relative.y * after.height - anchor.y) < 0.001);
  const left = viewport.scrollLeft, top = viewport.scrollTop;
  touch(viewport, 'touchmove', [[1, 350, 370], [2, 550, 370]]);
  assert.equal(viewport.scrollLeft, left - 20); assert.equal(viewport.scrollTop, top - 30);
  touch(viewport, 'touchmove', [[1, 380, 340], [2, 517, 340]]);
  assert.equal(label.textContent, '137%');
  touch(viewport, 'touchend', []);
  buttons(viewer(), '＋')[0].click(); assert.equal(label.textContent, '162%');
  buttons(viewer(), '－')[0].click(); assert.equal(label.textContent, '137%');
  touch(viewport, 'touchstart', [[1, 300, 340], [2, 400, 340], [3, 1000, 340]]);
  touch(viewport, 'touchmove', [[3, 9000, 340], [2, 600, 340], [1, 300, 340]]);
  assert.equal(label.textContent, '400%'); assert.equal(buttons(viewer(), '＋')[0].disabled, true);
  touch(viewport, 'touchmove', [[1, 300, 340], [2, 301, 340], [3, 9000, 340]]);
  assert.equal(label.textContent, '100%'); assert.equal(buttons(viewer(), '－')[0].disabled, true);
  touch(viewport, 'touchend', [[2, 301, 340], [3, 9000, 340]]);
  touch(viewport, 'touchmove', [[2, 301, 340], [3, 10000, 340]]);
  assert.equal(label.textContent, '100%');
  touch(viewport, 'touchend', []);
  touch(viewport, 'touchstart', [[1, 100, 100], [2, 200, 100]]);
  for (const x of [100, NaN, Infinity]) touch(viewport, 'touchmove', [[1, 100, 100], [2, x, 100]]);
  assert.equal(label.textContent, '100%');
  touch(viewport, 'touchmove', [[1, 100, 100], [2, 300, 100]]);
  assert.equal(label.textContent, '200%');
  touch(viewport, 'touchcancel', []);
  viewport.fire('touchstart'); viewport.fire('touchmove'); viewport.fire('touchend'); viewport.fire('touchcancel');
  for (const type of ['gesturestart', 'gesturechange']) assert.equal(viewport.fire(type).defaultPrevented, true);
  assert.equal(pane.dirty, false); assert.equal(h.saves.length, 0); close();
});

test('紙の子要素: 線・けい線・見るだけの重ね表示は接触先にならない', () => {
  const css = readFileSync(new URL('../css/app.css', import.meta.url), 'utf8');
  assert.match(css, /\.ink-paper\s+\*\s*\{\s*pointer-events:\s*none\s*;\s*\}/);
});

for (const ending of ['touchend', 'touchcancel']) {
  test(`写真の既存の線からピンチ: 取り消し後も動かせ、documentの${ending}で書ける状態に戻る`, async (t) => {
    const h = setup(t); h.record.ink.a1 = indexFor();
    const pane = attachments(h); h.cleanup(() => pane.destroy());
    const svg = await startWriting(byClass(pane.node, 'attachment-open')[0]);
    const path = all(svg, (node) => node.tagName === 'path')[0];
    const css = readFileSync(new URL('../css/app.css', import.meta.url), 'utf8');
    // 簡易 DOM に接触判定はないので、線の上の接触先を CSS の規則に従って選ぶ。
    const target = /\.ink-paper\s+\*\s*\{\s*pointer-events:\s*none\s*;\s*\}/.test(css)
      ? path.closest('.ink-paper') : path;
    const rect = svg.getBoundingClientRect();
    const first = { pointerId: 1, pointerType: 'touch', target,
      clientX: rect.left + rect.width * 0.1, clientY: rect.top + rect.height * 0.2 };
    svg.fire('pointerdown', first);
    touch(target, 'touchstart', [[1, first.clientX, first.clientY]]);
    svg.fire('pointermove', { ...first, clientX: first.clientX + 50 });
    touch(target, 'touchstart', [[1, first.clientX, first.clientY], [2, first.clientX + 100, first.clientY]]);
    assert.equal(path.isConnected, false); assert.equal(target, svg); assert.equal(target.isConnected, true);
    touch(target, 'touchmove', [[1, first.clientX, first.clientY], [2, first.clientX + 200, first.clientY]]);
    assert.equal(byClass(viewer(), 'viewer-counter')[0].textContent, '200%');
    svg.fire('pointerup', first);
    assert.equal(all(svg, (node) => node.tagName === 'path').length, 1);
    assert.equal(getDraft(h), null); assert.equal(h.saves.length, 0);
    // 枠を通らない終了でも、残った指で書かず、最後の指の終了で解除する。
    document.fire(ending, { touches: [{ identifier: 1, target }] });
    draw(svg, { type: 'touch' }); assert.equal(getDraft(h), null);
    document.fire(ending, { touches: [] });
    draw(svg, { type: 'touch' }); assert.equal(getDraft(h).ink.s.length, 2);
    close();
  });
}

for (const erasing of [false, true]) {
  test(`写真の書く→ピンチ: ${erasing ? '消しかけ' : '書きかけ'}を保存・履歴に入れず、全部離したら書ける`, async (t) => {
    const h = setup(t), pane = attachments(h); h.cleanup(() => pane.destroy());
    const svg = await startWriting(byClass(pane.node, 'attachment-open')[0]);
    draw(svg, { type: 'touch' }); await pane.flush();
    const original = h.record.ink.a1, saved = h.saves.length;
    if (erasing) buttons(viewer(), '消しゴム')[0].click();
    const rect = svg.getBoundingClientRect();
    const first = { pointerId: 3, pointerType: 'touch', clientX: rect.left + rect.width * 0.1, clientY: rect.top + rect.height * 0.2 };
    svg.fire('pointerdown', first); svg.fire('pointermove', { ...first, clientX: rect.left + rect.width * 0.8 });
    touch(svg, 'touchstart', [[3, first.clientX, first.clientY], [4, first.clientX + 100, first.clientY]]);
    touch(svg, 'touchmove', [[3, first.clientX, first.clientY], [4, first.clientX + 200, first.clientY]]);
    assert.match(viewer().textContent, /200%/);
    svg.fire('pointerup', first);
    assert.equal(all(svg, (node) => node.tagName === 'path').length, 1);
    touch(svg, 'touchend', [[3, first.clientX, first.clientY]]);
    assert.equal(touch(svg, 'touchmove', [[3, first.clientX + 20, first.clientY]]).defaultPrevented, false);
    draw(svg, { type: 'touch' }); await h.advance();
    assert.equal(h.saves.length, saved); assert.equal(h.record.ink.a1, original); assert.equal(getDraft(h), null);
    touch(svg, 'touchend', []);
    // 取り消した線や消しゴムを戻す履歴が挟まっていない。
    buttons(viewer(), '1 つ戻す')[0].click();
    assert.equal(all(svg, (node) => node.tagName === 'path').length, 0);
    assert.equal(buttons(viewer(), '1 つ戻す')[0].disabled, true);
    if (erasing) buttons(viewer(), '消しゴム')[0].click();
    draw(svg, { type: 'touch' }); assert.equal(getDraft(h).ink.s.length, 1);
    close();
  });
}

test('写真のペン: 接触中と離れて500ms以内はピンチせず、指を置いても線は残る', async (t) => {
  const h = setup(t), pane = attachments(h); h.cleanup(() => pane.destroy());
  const svg = await startWriting(byClass(pane.node, 'attachment-open')[0]);
  const pen = { pointerId: 1, pointerType: 'pen', clientX: 200, clientY: 200 };
  svg.fire('pointerdown', pen);
  touch(svg, 'touchstart', [[2, 100, 100], [3, 200, 100]]);
  touch(svg, 'touchmove', [[2, 100, 100], [3, 300, 100]]);
  assert.match(viewer().textContent, /100%/);
  svg.fire('pointerup', { ...pen, clientX: 400 });
  assert.equal(getDraft(h).ink.s.length, 1);
  touch(svg, 'touchend', []);
  touch(svg, 'touchstart', [[2, 100, 100], [3, 200, 100]]);
  touch(svg, 'touchmove', [[2, 100, 100], [3, 300, 100]]);
  assert.match(viewer().textContent, /100%/);
  touch(svg, 'touchend', []); close();
});

test('見るだけの写真: Ctrl/⌘ホイールとピンチ。読込中・サイズ0では変えない', async (t) => {
  setup(t);
  let resolve;
  const v = openViewer({ title: '動作確認用の写真', kind: 'image', load: () => new Promise((done) => { resolve = done; }) });
  const viewport = byClass(viewer(), 'viewer-viewport')[0], label = byClass(viewer(), 'viewer-counter')[0];
  const wheel = { clientX: 430, clientY: 340, deltaY: -100 };
  touch(viewport, 'touchstart', [[1, 100, 100], [2, 200, 100]]);
  touch(viewport, 'touchmove', [[1, 100, 100], [2, 300, 100]]);
  viewport.fire('wheel', { ...wheel, ctrlKey: true });
  assert.equal(label.textContent, '100%');
  touch(viewport, 'touchend', []);
  resolve(new Blob(['fake image'])); await settle();
  assert.equal(viewport.fire('wheel', wheel).defaultPrevented, false); assert.equal(label.textContent, '100%');
  assert.equal(viewport.fire('wheel', { ...wheel, ctrlKey: true }).defaultPrevented, true);
  assert.equal(label.textContent, '122%');
  assert.equal(viewport.fire('wheel', { ...wheel, deltaY: 100, metaKey: true }).defaultPrevented, true);
  assert.equal(label.textContent, '100%');
  touch(viewport, 'touchstart', [[1, 100, 100], [2, 200, 100]]);
  touch(viewport, 'touchmove', [[1, 100, 100], [2, 300, 100]]);
  assert.equal(label.textContent, '200%'); touch(viewport, 'touchend', []);
  v.close();
  const create = document.createElement;
  document.createElement = (tag) => { const node = create(tag); if (tag === 'img') node.naturalHeight = 0; return node; };
  const invalid = openViewer({ title: '大きさ不明', kind: 'image', load: async () => new Blob(['fake']) }); await settle();
  const emptyViewport = byClass(viewer(), 'viewer-viewport')[0];
  touch(emptyViewport, 'touchstart', [[1, 100, 100], [2, 200, 100]]);
  touch(emptyViewport, 'touchmove', [[1, 100, 100], [2, 300, 100]]);
  emptyViewport.fire('wheel', { ...wheel, ctrlKey: true });
  assert.match(viewer().textContent, /100%/); assert.equal(buttons(viewer(), '＋')[0].disabled, true); invalid.close();
});

test('先生の資料: 書いてすぐ閉じると送信開始。保存中も開き直せる', async (t) => {
  const h = setup(t);
  let release;
  h.uploadGate = new Promise((resolve) => { release = resolve; });
  const pane = materialPane({ ctx: h.ctx, ...ids, lesson: h.lesson, readOnly: false });
  document.body.append(pane.node); h.cleanup(() => pane.destroy()); await settle();
  const svg = await startWriting(byClass(pane.node, 'student-material-open')[0]);
  draw(svg); close(); await settle();
  assert.equal(pane.state, 'saving');
  assert.equal(byClass(pane.node, 'picture-ink-badge')[0].hidden, false);
  const same = await startWriting(byClass(pane.node, 'student-material-open')[0]);
  assert.equal(same, svg);
  release(); await settle();
  assert.equal(h.record.ink[materialId].on, 'test-material');
  close();
});

test('写真を消す: 保存待ちを止め、下書きと目録を消す。別の写真に引き継がない', async (t) => {
  const h = setup(t); h.record.ink.a1 = indexFor(); putDraft(h);
  const pane = attachments(h); await settle();
  buttons(pane.node, '消す')[0].click();
  const confirmation = byClass(document.body, 'confirm')[0];
  assert.match(confirmation.textContent, /この写真への書きこみも消えます。/);
  buttons(confirmation, '消す')[0].click(); await settle(); await h.advance();
  assert.equal(getDraft(h), null);
  assert.equal(h.record.ink.a1, undefined);
  assert.equal(h.record.attachments.length, 0);
  assert.equal(h.saves.length, 0);
  pane.destroy();
  h.record.attachments = [{ slot: 'a1', type: 'image', fileId: 'replacement-photo', addedAt: 2 }];
  const replacement = attachments(h); h.cleanup(() => replacement.destroy());
  const svg = await startWriting(byClass(replacement.node, 'attachment-open')[0]);
  assert.equal(all(svg, (node) => node.tagName === 'path').length, 0);
  close();
});

test('先生の1人の記録: 生の目録から両方の印と線を出す。道具と書くボタンはない', async (t) => {
  const h = setup(t);
  h.record.ink = { a1: indexFor(), [materialId]: indexFor('test-material') };
  const root = document.createElement('main'); document.body.append(root);
  const destroy = mountTeacher(root, h.ctx); h.cleanup(destroy); await settle();
  assert.equal(byClass(root, 'picture-ink-badge').filter((node) => !node.hidden).length, 2);
  for (const name of ['attachment-open', 'student-material-open']) {
    byClass(root, name)[0].click(); await settle();
    assert.equal(buttons(viewer(), '✎ 書きこむ').filter((node) => !node.hidden).length, 0);
    assert.equal(byClass(viewer(), 'ink-tools').length, 0);
    assert.equal(all(paper(), (node) => node.tagName === 'path').length, 1);
    draw(paper()); close();
  }
  assert.equal(h.saves.length, 0);
  assert.equal(h.ctx.inkDrafts.list(ids.studentId).length, 0);
});

for (const method of ['getRecord', 'removeAttachment']) {
  test(`写真を消す: ${method} の失敗で下書きと部品を残し、自動保存・追記・再削除ができる`, async (t) => {
    const h = setup(t); putDraft(h);
    const pane = attachments(h); h.cleanup(() => pane.destroy());
    const svg = await startWriting(byClass(pane.node, 'attachment-open')[0]);
    const draft = getDraft(h);
    const original = h.ctx.repo[method];
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    let attempts = 0;
    h.ctx.repo[method] = async () => { attempts++; await gate; throw new Error('test offline'); };
    const remove = buttons(pane.node, '消す')[0];
    remove.click(); remove.click();
    assert.equal(byClass(document.body, 'confirm').length, 1);
    buttons(byClass(document.body, 'confirm')[0], '消す')[0].click(); await settle();
    assert.equal(viewer(), undefined);
    assert.deepEqual(getDraft(h), draft);
    draw(svg);
    assert.deepEqual(getDraft(h), draft);
    assert.equal(await pane.flush(), false);
    assert.equal(await pane.retry(), false);
    await h.advance();
    assert.equal(attempts, 1);
    assert.equal(h.saves.length, 0);
    assert.equal(pane.dirty, true);
    release(); await settle();
    h.ctx.repo[method] = original;
    assert.match(pane.node.textContent, /消せませんでした。もう一度ためしてください。/);
    assert.deepEqual(getDraft(h), draft);
    assert.equal(h.record.attachments.length, 1);
    const same = await startWriting(byClass(pane.node, 'attachment-open')[0]);
    assert.equal(same, svg);
    await h.advance();
    assert.equal(getDraft(h), null);
    assert.equal(h.saves.length, 1);
    draw(svg);
    assert.equal(getDraft(h).ink.s.length, 2);
    await h.advance();
    assert.equal(getDraft(h), null);
    assert.equal(h.saves[1].index.strokes, 2);
    close();
    buttons(pane.node, '消す')[0].click();
    buttons(byClass(document.body, 'confirm')[0], '消す')[0].click(); await settle();
    assert.equal(h.record.attachments.length, 0);
    assert.equal(getDraft(h), null);
  });
}

test('写真を消す: 別の端末で消えていたら、削除を送り直さず下書きと部品を片付ける', async (t) => {
  const h = setup(t); putDraft(h);
  const pane = attachments(h); h.cleanup(() => pane.destroy());
  h.record.attachments = [];
  let attempts = 0;
  h.ctx.repo.removeAttachment = async () => { attempts++; throw new Error('test missing photo'); };
  buttons(pane.node, '消す')[0].click();
  buttons(byClass(document.body, 'confirm')[0], '消す')[0].click(); await settle();
  await h.advance();
  assert.equal(attempts, 0);
  assert.equal(getDraft(h), null);
  assert.equal(pane.dirty, false);
  assert.equal(h.saves.length, 0);
  assert.equal(byClass(pane.node, 'attachment-open').length, 0);
  assert.doesNotMatch(pane.node.textContent, /消せませんでした/);
});

test('PDFと大きさ不明の写真には書きこみを出さない', async (t) => {
  setup(t);
  let calls = 0;
  let v = openViewer({ title: '確認用PDF', kind: 'pdf', load: () => new Promise(() => {}), pictureInk: () => { calls++; } });
  assert.equal(buttons(viewer(), '✎ 書きこむ').length, 0); v.close();
  const create = document.createElement;
  document.createElement = (tag) => { const node = create(tag); if (tag === 'img') node.naturalWidth = 0; return node; };
  v = openViewer({ title: '大きさ不明', kind: 'image', load: async () => new Blob(['fake']), pictureInk: () => { calls++; } });
  await settle();
  assert.equal(buttons(viewer(), '✎ 書きこむ')[0].hidden, true);
  assert.equal(calls, 0); v.close();
});

test('欄の手書き: 切りかえ直後に指・ペンで書け、横線・下への追加・戻す・保存が使える', async (t) => {
  const h = setup(t);
  const field = inkField({ ctx: h.ctx, ...ids, field: 'memo', label: 'メモ' });
  document.body.append(field.node); h.cleanup(() => field.destroy());
  await field.show();
  const svg = byClass(field.node, 'ink-paper')[0];
  assert.ok(all(svg, (node) => node.tagName === 'line').length > 0);
  assert.equal(svg.style.touchAction, 'none');
  assert.equal(buttons(field.node, '動かす').length, 0);
  assert.equal(buttons(field.node, '書く').length, 0);
  draw(svg, { type: 'touch' });
  assert.equal(getDraft(h, 'memo').ink.s.length, 1);
  draw(svg);
  assert.equal(getDraft(h, 'memo').ink.s.length, 2);
  buttons(field.node, '＋ 下に書く場所を足す')[0].click();
  assert.equal(getDraft(h, 'memo').ink.h, 800);
  buttons(field.node, '1 つ戻す')[0].click();
  assert.equal(getDraft(h, 'memo').ink.h, 400);
  assert.equal(await field.flush(), true);
  assert.ok(h.record.ink.memo);
  assert.equal('on' in h.record.ink.memo, false);
});

function scrollArea(node) {
  window.getComputedStyle = (element) => element.style;
  const scroller = document.createElement('div');
  scroller.style.overflowY = 'auto';
  scroller.scrollHeight = 2400;
  scroller.clientHeight = 600;
  scroller.append(node); document.body.append(scroller);
  return scroller;
}

test('欄の2本指: 上へ100pxで最寄りの入れ物が下へ100px動き、書きかけを保存しない', async (t) => {
  const h = setup(t);
  const field = inkField({ ctx: h.ctx, ...ids, field: 'memo', label: 'メモ' });
  h.cleanup(() => field.destroy());
  const scroller = scrollArea(field.node);
  const outer = document.createElement('div');
  outer.style.overflowY = 'scroll'; outer.scrollHeight = 3000; outer.clientHeight = 600;
  document.body.append(outer); outer.append(scroller);
  window.scrollBy = t.mock.fn();
  await field.show();
  const svg = byClass(field.node, 'ink-paper')[0];
  field.node.style.overflowY = 'auto'; field.node.scrollHeight = field.node.clientHeight;
  const first = { pointerType: 'touch', pointerId: 1, clientX: 80, clientY: 300 };
  svg.fire('pointerdown', first);
  touch(svg, 'touchstart', [[1, 80, 300]]);
  svg.fire('pointermove', { ...first, clientX: 180 });
  assert.equal(all(svg, (node) => node.tagName === 'path').length, 1);
  assert.equal(touch(svg, 'touchstart', [[1, 180, 300], [2, 280, 300]]).defaultPrevented, true);
  assert.equal(touch(svg, 'touchmove', [[1, 180, 200], [2, 280, 200]]).defaultPrevented, true);
  assert.equal(svg.style.touchAction, 'none');
  assert.equal(scroller.scrollTop, 100);
  assert.equal(outer.scrollTop, 0);
  assert.equal(window.scrollBy.mock.callCount(), 0);
  assert.equal(all(svg, (node) => node.tagName === 'path').length, 0);
  assert.equal(buttons(field.node, '1 つ戻す')[0].disabled, true);
  assert.equal(field.dirty, false);
  assert.equal(getDraft(h, 'memo'), null);
  await h.advance(); await field.flush();
  assert.equal(h.saves.length, 0);
  svg.fire('pointerup', first);
  touch(svg, 'touchend', [[2, 280, 200]]);
  touch(svg, 'touchmove', [[2, 280, 100]]);
  draw(svg, { type: 'touch', id: 2 });
  assert.equal(scroller.scrollTop, 100);
  assert.equal(getDraft(h, 'memo'), null);
  touch(document, 'touchend', []);
  draw(svg, { type: 'touch' });
  assert.equal(getDraft(h, 'memo').ink.s.length, 1);
  assert.equal(await field.flush(), true);
  assert.equal(h.saves.length, 1);
});

for (const erasing of [false, true]) {
  test(`欄の2本指: ${erasing ? '消しかけ' : '書きかけ'}を履歴に入れず、既存の線と履歴を保つ`, (t) => {
    const h = setup(t), changes = [];
    const pad = inkPad({ onChange: (ink) => changes.push(ink) }); h.cleanup(() => pad.destroy());
    scrollArea(pad.node);
    draw(pad.paper, { type: 'touch' });
    const before = pad.getInk();
    if (erasing) buttons(pad.node, '消しゴム')[0].click();
    const first = { pointerType: 'touch', pointerId: 1, clientX: 80, clientY: 80 };
    pad.paper.fire('pointerdown', first);
    if (erasing) assert.equal(all(pad.paper, (node) => node.tagName === 'path').length, 0);
    touch(pad.paper, 'touchstart', [[1, 80, 80], [2, 180, 80]]);
    pad.paper.fire('pointerup', first);
    touch(document, 'touchend', []);
    assert.deepEqual(pad.getInk(), before);
    assert.equal(all(pad.paper, (node) => node.tagName === 'path').length, 1);
    assert.equal(changes.length, 1);
    buttons(pad.node, '1 つ戻す')[0].click();
    assert.equal(pad.getInk().s.length, 0);
    assert.equal(buttons(pad.node, '1 つ戻す')[0].disabled, true);
  });
}

test('欄の2本指: 長い紙の上下端・3本目・不正な位置・片方の離脱を扱う', (t) => {
  const h = setup(t), pad = inkPad({}); h.cleanup(() => pad.destroy());
  const scroller = scrollArea(pad.node);
  buttons(pad.node, '＋ 下に書く場所を足す')[0].click();
  assert.ok(pad.getInk().h > scroller.clientHeight);
  const svg = pad.paper;
  touch(svg, 'touchstart', [[1, 100, 300], [2, 200, 300], [3, 900, 0]]);
  touch(svg, 'touchmove', [[3, 900, 10000], [2, 200, 200], [1, 100, 200]]);
  assert.equal(scroller.scrollTop, 100);
  touch(svg, 'touchmove', [[1, 100, NaN], [2, 200, 100], [3, 900, 0]]);
  assert.equal(scroller.scrollTop, 100);
  touch(svg, 'touchmove', [[1, 100, 100], [2, 200, 100], [3, 900, 0]]);
  assert.equal(scroller.scrollTop, 100);
  touch(svg, 'touchmove', [[1, 100, -2000], [2, 200, -2000], [3, 900, 0]]);
  assert.equal(scroller.scrollTop, 1800);
  touch(svg, 'touchmove', [[1, 100, -2100], [2, 200, -2100], [3, 900, 0]]);
  assert.equal(scroller.scrollTop, 1800);
  touch(svg, 'touchmove', [[1, 100, 100], [2, 200, 100], [3, 900, 0]]);
  assert.equal(scroller.scrollTop, 0);
  touch(svg, 'touchmove', [[1, 100, 200], [2, 200, 200], [3, 900, 0]]);
  assert.equal(scroller.scrollTop, 0);
  touch(document, 'touchend', [[2, 200, 200], [3, 900, 0]]);
  touch(svg, 'touchmove', [[2, 200, 100], [3, 900, -100]]);
  touch(svg, 'touchstart', [[2, 200, 100], [3, 900, -100], [4, 1000, 0]]);
  touch(svg, 'touchmove', [[2, 200, 0], [3, 900, -200], [4, 1000, 0]]);
  assert.equal(scroller.scrollTop, 0);
  draw(svg, { type: 'touch', id: 3 }); assert.equal(pad.getInk().s.length, 0);
  touch(document, 'touchcancel', []);
  draw(svg, { type: 'touch' }); assert.equal(pad.getInk().s.length, 1);
});

test('欄の2本指: 入れ物がなければページを動かし、紙の外・ロック・キャンセルでは動かさない', (t) => {
  const h = setup(t), pad = inkPad({}); h.cleanup(() => pad.destroy());
  const scroller = scrollArea(pad.node);
  scroller.style.overflowY = 'hidden';
  window.scrollBy = t.mock.fn();
  assert.equal(touch(pad.tools, 'touchstart', [[1, 100, 300]]).defaultPrevented, false);
  assert.equal(touch(pad.node, 'touchmove', [[1, 100, 200]]).defaultPrevented, false);
  touch(pad.paper, 'touchstart', [[1, 100, 300], [2, 200, 300]]);
  touch(pad.paper, 'touchmove', [[1, 100, 200], [2, 200, 200]]);
  assert.deepEqual(window.scrollBy.mock.calls[0].arguments, [0, 100]);
  touch(document, 'touchcancel', [[1, 100, 200]]);
  draw(pad.paper, { type: 'touch' }); assert.equal(pad.getInk().s.length, 0);
  touch(pad.paper, 'touchmove', [[1, 100, 100], [2, 200, 100]]);
  assert.equal(window.scrollBy.mock.callCount(), 1);
  touch(document, 'touchend', []);
  pad.setLocked(true);
  assert.equal(touch(pad.paper, 'touchstart', [[1, 100, 300], [2, 200, 300]]).defaultPrevented, false);
  assert.equal(touch(pad.paper, 'touchmove', [[1, 100, 200], [2, 200, 200]]).defaultPrevented, false);
  assert.equal(window.scrollBy.mock.callCount(), 1);
  touch(document, 'touchend', []);
  pad.setLocked(false);
  touch(pad.paper, 'touchstart', [[1, 100, 300], [2, 200, 300]]);
  pad.setLocked(true); pad.setLocked(false);
  touch(pad.paper, 'touchmove', [[1, 100, 200], [2, 200, 200]]);
  assert.equal(window.scrollBy.mock.callCount(), 1);
  touch(document, 'touchend', []);
  draw(pad.paper, { type: 'touch' }); assert.equal(pad.getInk().s.length, 1);
  pad.destroy();
  touch(pad.paper, 'touchstart', [[1, 100, 300], [2, 200, 300]]);
  touch(pad.paper, 'touchmove', [[1, 100, 200], [2, 200, 200]]);
  assert.equal(window.scrollBy.mock.callCount(), 1);
});

for (const ending of ['pointerup', 'pointercancel']) {
  test(`欄の2本指: ペンの${ending}後500ミリ秒までは書かず動かさず、離してから再開できる`, (t) => {
    const h = setup(t), pad = inkPad({}); h.cleanup(() => pad.destroy());
    const scroller = scrollArea(pad.node);
    let now = 1000; t.mock.method(Date, 'now', () => now);
    const pen = { pointerType: 'pen', pointerId: 10, clientX: 80, clientY: 80 };
    const palm = () => {
      assert.equal(touch(pad.paper, 'touchstart', [[1, 100, 300], [2, 200, 300]]).defaultPrevented, true);
      touch(pad.paper, 'touchmove', [[1, 100, 200], [2, 200, 200]]);
      draw(pad.paper, { type: 'touch', id: 1 });
      touch(document, 'touchend', []);
    };
    pad.paper.fire('pointerdown', pen);
    palm(); assert.equal(pad.getInk().s.length, 0);
    now = 2000; pad.paper.fire(ending, { ...pen, clientX: 640, clientY: 280 });
    const count = ending === 'pointerup' ? 1 : 0;
    palm(); now = 2499; palm();
    assert.equal(pad.getInk().s.length, count);
    assert.equal(scroller.scrollTop, 0);
    now = 2500;
    touch(pad.paper, 'touchstart', [[1, 100, 300], [2, 200, 300]]);
    touch(pad.paper, 'touchmove', [[1, 100, 200], [2, 200, 200]]);
    assert.equal(scroller.scrollTop, 100);
    touch(document, 'touchend', []);
    draw(pad.paper, { type: 'touch' }); assert.equal(pad.getInk().s.length, count + 1);
  });
}

test('欄の先生表示: 道具も接触の抑止もなく、指・ペンでは書けない', (t) => {
  const h = setup(t), pad = inkPad({ readOnly: true, ink: written() }); h.cleanup(() => pad.destroy());
  scrollArea(pad.node);
  assert.equal(byClass(pad.node, 'ink-tools').length, 0);
  assert.notEqual(pad.paper.style.touchAction, 'none');
  for (const type of ['touchstart', 'touchmove']) {
    assert.equal(touch(pad.paper, type, [[1, 100, 300], [2, 200, 300]]).defaultPrevented, false);
  }
  draw(pad.paper, { type: 'touch' }); draw(pad.paper);
  assert.equal(pad.getInk().s.length, 1);
});

test('欄の2本指: 途中でペンを書き始めたら、ペンを離した後も同じ指ではスクロールを再開しない', (t) => {
  const h = setup(t), pad = inkPad({}); h.cleanup(() => pad.destroy());
  const scroller = scrollArea(pad.node);
  let now = 1000; t.mock.method(Date, 'now', () => now);
  touch(pad.paper, 'touchstart', [[1, 100, 300], [2, 200, 300]]);
  draw(pad.paper);
  assert.equal(pad.getInk().s.length, 1);
  now = 2000;
  touch(pad.paper, 'touchmove', [[1, 100, 200], [2, 200, 200]]);
  assert.equal(scroller.scrollTop, 0);
  touch(document, 'touchend', []);
  touch(pad.paper, 'touchstart', [[1, 100, 300], [2, 200, 300]]);
  touch(pad.paper, 'touchmove', [[1, 100, 200], [2, 200, 200]]);
  assert.equal(scroller.scrollTop, 100);
});

for (const picture of [false, true]) {
  test(`${picture ? '写真' : '欄の手書き'}: 書く間だけ指のスクロール・拡大を止め、ロックで戻す`, (t) => {
    const h = setup(t), pad = inkPad({ picture });
    h.cleanup(() => pad.destroy());
    const svg = pad.paper, before = pad.getInk();
    const fingers = [undefined, [], [{}], [{ touchType: 'direct' }], [{ touchType: 'direct' }, {}]];
    const stylus = [{ touchType: 'direct' }, { touchType: 'stylus' }];
    const checkTouches = (expected, touches = fingers) => {
      for (const type of ['touchstart', 'touchmove']) {
        for (const changedTouches of touches) {
          assert.equal(svg.fire(type, { cancelable: true, changedTouches }).defaultPrevented, expected);
        }
      }
    };
    assert.equal(buttons(pad.node, '動かす').length, 0);
    assert.equal(buttons(pad.node, '書く').length, 0);
    const hint = picture ? '指 1 本かペンで書けます。指 2 本で動かす・拡大。'
      : '指 1 本かペンで書けます。指 2 本でページを動かす。';
    assert.equal(byClass(pad.node, 'ink-status')[0].textContent, hint);
    buttons(pad.node, '定規')[0].click();
    assert.equal(byClass(pad.node, 'ink-status')[0].textContent, `${hint}／定規`);
    buttons(pad.node, '消しゴム')[0].click();
    assert.equal(byClass(pad.node, 'ink-status')[0].textContent, `${hint}／消しゴム`);
    assert.equal(svg.classList.contains('ink-paper-writing'), true);
    assert.equal(svg.style.touchAction, 'none');
    checkTouches(true);
    for (const type of ['touchstart', 'touchmove']) {
      const preventDefault = t.mock.fn();
      svg.fire(type, { cancelable: false, changedTouches: stylus, preventDefault });
      assert.equal(preventDefault.mock.callCount(), 0);
    }
    pad.setLocked(true);
    assert.equal(svg.classList.contains('ink-paper-writing'), false);
    assert.equal(svg.style.touchAction, picture ? 'pan-x pan-y pinch-zoom' : 'pan-y pinch-zoom');
    checkTouches(false, [...fingers, stylus]);
    draw(svg, { type: 'touch' }); draw(svg);
    pad.setLocked(false);
    assert.equal(svg.classList.contains('ink-paper-writing'), true);
    checkTouches(true);
    assert.deepEqual(pad.getInk(), before);
  });
}

for (const picture of [false, true]) {
  test(`${picture ? '写真' : '欄の手書き'}: 全消去の確認中は接触を止めず、取り消すと書ける状態に戻る`, async (t) => {
    const h = setup(t), pad = inkPad({ picture, ink: written() });
    h.cleanup(() => pad.destroy());
    document.body.append(pad.node);
    buttons(pad.node, '全部消す')[0].click();
    assert.equal(pad.paper.classList.contains('ink-paper-writing'), false);
    for (const type of ['touchstart', 'touchmove']) {
      for (const changedTouches of [[{}], [{ touchType: 'stylus' }]]) {
        assert.equal(pad.paper.fire(type, { cancelable: true, changedTouches }).defaultPrevented, false);
      }
    }
    draw(pad.paper, { type: 'touch' }); draw(pad.paper);
    assert.equal(pad.getInk().s.length, 1);
    buttons(byClass(document.body, 'confirm')[0], 'やめる')[0].click(); await settle();
    assert.equal(pad.paper.classList.contains('ink-paper-writing'), true);
    assert.equal(pad.paper.fire('touchmove', { cancelable: true }).defaultPrevented, true);
    assert.equal(pad.getInk().s.length, 1);
  });
}

test('指で線を書いている途中の接触を止め、2本目の指では線を増やさない', (t) => {
  const h = setup(t), pad = inkPad({ picture: true, ink: emptyPictureInk(1600, 1200) });
  h.cleanup(() => pad.destroy());
  const first = { pointerType: 'touch', pointerId: 1, clientX: 80, clientY: 120 };
  pad.paper.fire('pointerdown', first);
  const second = { ...first, pointerId: 2, clientX: 200 };
  pad.paper.fire('pointerdown', second);
  for (const type of ['touchstart', 'touchmove']) {
    assert.equal(pad.paper.fire(type, { cancelable: true, changedTouches: [{}, {}] }).defaultPrevented, true);
  }
  pad.paper.fire('pointermove', second); pad.paper.fire('pointerup', second);
  assert.equal(pad.getInk().s.length, 0);
  pad.paper.fire('pointerup', { ...first, clientX: 640, clientY: 420 });
  assert.equal(pad.getInk().s.length, 1);
  assert.deepEqual(pad.getInk().s[0].p, stroke.p);
});

for (const ending of ['pointerup', 'pointercancel']) {
  test(`欄の手書き: ロック後もペンの${ending}後500ミリ秒まで手のひらのスクロールを止める`, (t) => {
    const h = setup(t), pad = inkPad({});
    h.cleanup(() => pad.destroy());
    let now = 1000;
    t.mock.method(Date, 'now', () => now);
    const pen = { pointerType: 'pen', pointerId: 1, clientX: 80, clientY: 120 };
    const checkPalm = (expected) => {
      for (const type of ['touchstart', 'touchmove']) {
        assert.equal(pad.paper.fire(type, { cancelable: true, changedTouches: [{}] }).defaultPrevented, expected);
      }
    };
    pad.paper.fire('pointerdown', pen);
    pad.setLocked(true);
    now = 2000;
    checkPalm(true);
    pad.paper.fire(ending, pen);
    checkPalm(true);
    now = 2499; checkPalm(true);
    now = 2500; checkPalm(false);
    now = 2501; checkPalm(false);
    assert.equal(pad.paper.classList.contains('ink-paper-writing'), false);
  });

  test(`写真: ペンの${ending}後500ミリ秒までは指で書かず、その後は書ける`, (t) => {
    const h = setup(t), pad = inkPad({ picture: true }); h.cleanup(() => pad.destroy());
    let now = 1000;
    t.mock.method(Date, 'now', () => now);
    const pen = { pointerType: 'pen', pointerId: 1, clientX: 80, clientY: 120 };
    pad.paper.fire('pointerdown', pen);
    draw(pad.paper, { type: 'touch', id: 2 }); assert.equal(pad.getInk().s.length, 0);
    now = 2000; pad.paper.fire(ending, { ...pen, clientX: 640, clientY: 420 });
    const count = ending === 'pointerup' ? 1 : 0;
    assert.equal(pad.getInk().s.length, count);
    now = 2499; draw(pad.paper, { type: 'touch', id: 2 });
    assert.equal(pad.getInk().s.length, count);
    now = 2500; draw(pad.paper, { type: 'touch', id: 2 });
    assert.equal(pad.getInk().s.length, count + 1);
  });
}

for (const picture of [false, true]) {
  test(`${picture ? '写真' : '欄の手書き'}の道具状態: modeは含めず、古いmode・不正値・nullでも指で書ける`, (t) => {
    const h = setup(t), pad = inkPad({ picture }); h.cleanup(() => pad.destroy());
    pad.setToolState({ mode: 'move', color: 1, width: 1 });
    const expected = { color: 1, width: 1, ruler: false, erasing: false };
    assert.deepEqual(pad.getToolState(), expected);
    const invalid = [null, undefined, { mode: 'move', color: -1, width: 2 },
      { mode: 'unknown', color: 3, width: -1 }, { mode: null, color: 0.5, width: 0.5 },
      { color: '0', width: '0' }, { color: NaN, width: Infinity }];
    for (const [i, value] of invalid.entries()) {
      pad.setToolState(value);
      assert.deepEqual(pad.getToolState(), expected);
      draw(pad.paper, { type: 'touch' });
      assert.equal(pad.getInk().s.length, i + 1);
      assert.equal(pad.getInk().s[i].c, 1); assert.equal(pad.getInk().s[i].w, 1);
    }
  });
}

test('下書きがあれば開かなくても保存対象になり、Driveを読まない', async (t) => {
  const h = setup(t); h.record.ink.a1 = indexFor(); putDraft(h);
  const pane = attachments(h); h.cleanup(() => pane.destroy());
  assert.equal(pane.dirty, true); assert.equal(h.loads.length, 0);
  const svg = await startWriting(byClass(pane.node, 'attachment-open')[0]);
  assert.equal(all(svg, (node) => node.tagName === 'path').length, 1);
  assert.equal(h.loads.length, 0);
  close(); await settle(); assert.equal(pane.dirty, false);
});

for (const readOnly of [false, true]) {
  test(`写真の読みこみ: ${readOnly ? '先生' : '生徒'}に理由を出し、再試行で入れかえ、成功したら消す`, async (t) => {
    const h = setup(t); h.record.ink.a1 = indexFor(); h.loadError = new NetError('network', '画面に出さないテスト用の詳細');
    const pane = attachments(h, readOnly); h.cleanup(() => pane.destroy());
    byClass(pane.node, 'attachment-open')[0].click(); await settle();
    const failure = () => byClass(viewer(), 'error');
    assert.equal(failure()[0].getAttribute('role'), 'alert');
    assert.equal(failure()[0].textContent, '書きこみを読みこめませんでした。（理由: 通信できませんでした）');
    h.loadError = null; h.files.set('test-ink', '{');
    buttons(viewer(), 'もう一度')[0].click(); await settle();
    assert.equal(failure().length, 1);
    assert.equal(failure()[0].getAttribute('role'), 'alert');
    assert.equal(failure()[0].textContent, '書きこみを読みこめませんでした。（理由: 中身を読めませんでした）');
    h.files.set('test-ink', JSON.stringify(written()));
    buttons(viewer(), 'もう一度')[0].click(); await settle();
    assert.doesNotMatch(viewer().textContent, /書きこみを読みこめませんでした/);
    assert.equal(buttons(viewer(), 'もう一度').length, 0);
    assert.equal(all(paper(), (node) => node.tagName === 'path').length, 1);
    close();
  });
}

test('読みこみ失敗・notfoundの再試行と新しく書く。先生は目録を読み直す', async (t) => {
  const h = setup(t); h.record.ink.a1 = indexFor(); h.loadError = { code: 'notfound' };
  const pane = attachments(h); h.cleanup(() => pane.destroy());
  byClass(pane.node, 'attachment-open')[0].click(); await settle();
  assert.equal(byClass(viewer(), 'error')[0].textContent, '前の書きこみが見つかりませんでした。');
  assert.equal(buttons(viewer(), '✎ 書きこむ')[0].disabled, true);
  buttons(viewer(), '新しく書く')[0].click();
  buttons(byClass(document.body, 'confirm')[0], '新しく書く')[0].click(); await settle();
  assert.equal(buttons(viewer(), '✎ 書きこむ')[0].disabled, false);
  close(); pane.destroy();
  const teacher = attachments(h, true); h.cleanup(() => teacher.destroy());
  byClass(teacher.node, 'attachment-open')[0].click(); await settle();
  assert.equal(byClass(viewer(), 'error')[0].textContent, '書きこみが見つかりませんでした。');
  assert.equal(buttons(viewer(), '新しく書く').length, 0);
  h.record.ink.a1 = { ...indexFor(), fileId: 'newer-ink', updatedAt: 30 };
  h.files.set('newer-ink', JSON.stringify(written())); h.loadError = null;
  buttons(viewer(), 'もう一度')[0].click(); await settle();
  assert.equal(h.loads.at(-1), 'newer-ink');
  assert.equal(all(paper(), (node) => node.tagName === 'path').length, 1);
  close();
});

test('保存失敗は写真内に表示し、もう一度で送れる', async (t) => {
  const h = setup(t), pane = attachments(h); h.cleanup(() => pane.destroy());
  const svg = await startWriting(byClass(pane.node, 'attachment-open')[0]); draw(svg);
  h.saveError = new Error('test offline');
  assert.equal(await pane.flush(), false);
  assert.match(viewer().textContent, /保存できませんでした/);
  assert.ok(getDraft(h));
  h.saveError = null; buttons(viewer(), 'もう一度')[0].click(); await settle();
  assert.equal(pane.state, 'saved'); assert.equal(getDraft(h), null); close();
});

test('goneは下書きを消し、道具をしまって保存済みとして扱う', async (t) => {
  const h = setup(t), pane = attachments(h); h.cleanup(() => pane.destroy());
  draw(await startWriting(byClass(pane.node, 'attachment-open')[0]));
  h.record.attachments = [];
  assert.equal(await pane.flush(), true);
  assert.equal(pane.dirty, false); assert.equal(getDraft(h), null);
  assert.match(viewer().textContent, /この写真は、もうありません。書きこみは保存されませんでした。/);
  assert.equal(buttons(viewer(), '✎ 書きこむ')[0].disabled, true);
  assert.equal(byClass(viewer(), 'ink-tools').length, 0); close();
});

test('ほかの端末の新しい線を出し、読み直しで消去も反映する', async (t) => {
  const h = setup(t), pane = attachments(h); h.cleanup(() => pane.destroy());
  draw(await startWriting(byClass(pane.node, 'attachment-open')[0]));
  h.record.ink.a1 = indexFor(photo.fileId, 1000);
  await pane.flush(); await settle();
  assert.match(viewer().textContent, /ほかの端末で書いたほうが新しい/);
  assert.equal(h.loads.length, 1);
  pane.refreshInk({}, { a1: 2000 }); await settle();
  assert.equal(all(paper(), (node) => node.tagName === 'path').length, 0);
  assert.equal(byClass(pane.node, 'picture-ink-badge').length, 0); close();
});

test('写真の上限の文・消しゴム・掌の抑止と読むだけの空SVG', async (t) => {
  const h = setup(t);
  let value;
  const pad = inkPad({ picture: true, ink: { ...written(), s: Array(CONFIG.ink.maxStrokes).fill(stroke) }, onChange: (ink) => { value = ink; } });
  h.cleanup(() => pad.destroy());
  draw(pad.paper);
  assert.match(pad.node.textContent, /これ以上は書けません。いらない線を消してください。/);
  assert.doesNotMatch(pad.node.textContent, /写真にとって/);
  buttons(pad.node, '消しゴム')[0].click(); draw(pad.paper);
  assert.equal(value.s.length, 0);
  buttons(pad.node, '消しゴム')[0].click();
  draw(pad.paper, { type: 'touch' }); assert.equal(value.s.length, 0);
  const readonly = inkPad({ picture: true, ink: emptyPictureInk(1, 1), readOnly: true });
  assert.equal(readonly.node.textContent, '');
  readonly.setToolState({ mode: 'write' });
  assert.equal(readonly.paper.classList.contains('ink-paper-writing'), false);
  for (const type of ['touchstart', 'touchmove']) {
    assert.equal(readonly.paper.fire(type, { cancelable: true, changedTouches: [{ touchType: 'stylus' }] }).defaultPrevented, false);
  }
  assert.equal(readonly.paper.tagName, 'svg'); readonly.destroy();
});

test('授業ページの保存状態・再送・離れるときのflushに写真を含める', async (t) => {
  const h = setup(t); putDraft(h);
  const root = document.createElement('main'); document.body.append(root);
  const destroy = mountStudent(root, h.ctx); h.cleanup(destroy); await settle();
  assert.match(byClass(root, 'student-lesson-states')[0].textContent, /保存中/);
  h.saveError = new Error('test offline');
  await h.advance();
  await h.advance();
  await h.advance();
  await h.advance();
  assert.match(byClass(root, 'student-lesson-states')[0].textContent, /保存できませんでした/);
  h.saveError = null;
  buttons(byClass(root, 'student-lesson-states')[0], 'もう一度')[0].click(); await settle();
  assert.equal(getDraft(h), null);
  draw(await startWriting(byClass(root, 'attachment-open')[0]));
  close();
  assert.equal(await h.guard(), true);
  assert.equal(getDraft(h), null);
  assert.ok(h.record.ink.a1);
  assert.match(byClass(root, 'student-lesson-states')[0].textContent, /保存しました/);
});

test('一覧の知らせ・タイル・ログアウトに使う件数へ写真の下書きも入る', async (t) => {
  const h = setup(t);
  putDraft(h); putDraft(h, materialId, 'test-material');
  assert.equal(h.ctx.inkDrafts.list(ids.studentId).length, 2);
  assert.equal(pendingLessonCount(h.ctx.drafts, ids.studentId, h.ctx.inkDrafts), 1);
  assert.deepEqual([...pendingLessons(h.ctx.drafts, ids.studentId, ids.classId, h.ctx.inkDrafts)], [ids.lessonId]);
});

test('送信中の写真を消すと、保存の完了後に目録を消して復活させない', async (t) => {
  const h = setup(t), pane = attachments(h); h.cleanup(() => pane.destroy());
  let release;
  h.uploadGate = new Promise((resolve) => { release = resolve; });
  draw(await startWriting(byClass(pane.node, 'attachment-open')[0]));
  close(); await settle();
  buttons(pane.node, '消す')[0].click();
  buttons(byClass(document.body, 'confirm')[0], '消す')[0].click(); await settle();
  assert.equal(h.record.attachments.length, 1);
  release(); await settle();
  assert.equal(h.record.attachments.length, 0);
  assert.equal(h.record.ink.a1, undefined);
  assert.equal(getDraft(h), null);
  assert.equal(h.saves.length, 1);
  assert.ok(h.trashes.includes(h.saves[0].index.fileId));
});

test('写真の読みこみに失敗しても写真は残り、再表示では読み直さず「もう一度」で読む', async (t) => {
  const h = setup(t); h.record.ink.a1 = indexFor(); h.loadError = new Error('test offline');
  const pane = attachments(h); h.cleanup(() => pane.destroy());
  byClass(pane.node, 'attachment-open')[0].click(); await settle();
  assert.equal(byClass(viewer(), 'error')[0].textContent, '書きこみを読みこめませんでした。（理由: この端末では開けませんでした）');
  assert.equal(all(viewer(), (node) => node.tagName === 'img').length, 1);
  close(); byClass(pane.node, 'attachment-open')[0].click(); await settle();
  assert.equal(h.loads.length, 1);
  h.loadError = null;
  buttons(viewer(), 'もう一度')[0].click(); await settle();
  assert.equal(h.loads.length, 2);
  assert.equal(buttons(viewer(), '✎ 書きこむ')[0].disabled, false); close();
});

test('大きな表示の閉鎖後に保存が失敗しても下書きと部品は残る', async (t) => {
  const h = setup(t), pane = attachments(h); h.cleanup(() => pane.destroy());
  const svg = await startWriting(byClass(pane.node, 'attachment-open')[0]); draw(svg);
  h.saveError = new Error('test offline'); close(); await settle();
  assert.equal(pane.dirty, true); assert.equal(pane.state, 'failed'); assert.ok(getDraft(h));
  byClass(pane.node, 'attachment-open')[0].click(); await settle();
  assert.equal(paper(), svg); assert.match(viewer().textContent, /保存できませんでした/);
  h.saveError = null; close(); await settle(); assert.equal(pane.dirty, false);
});

test('同じ写真の部品は1つ。ロック・再読みこみ中も古い読みこみで上書きしない', async (t) => {
  const h = setup(t); h.record.ink.a1 = indexFor();
  let finish;
  h.ctx.files.loadInk = () => new Promise((resolve) => { finish = resolve; });
  const inks = pictureInks({ ctx: h.ctx, ...ids, ink: h.record.ink, readOnly: false });
  h.cleanup(() => inks.destroy());
  const field = inks.get(photo);
  assert.equal(inks.get(photo), field);
  void field.show({ width: 1600, height: 1200 }); await settle();
  inks.refreshInk({}, { a1: 1000 }); await settle();
  finish(JSON.stringify(written())); await settle();
  assert.equal(field.hasInk(), false);
  inks.setLocked(true); assert.equal(field.editable, false);
  inks.setLocked(false); assert.equal(field.editable, true);
});

test('写真の一時停止: 再試行を止め、全体のロックを外しても書けず、再開後に同じ部品で保存する', async (t) => {
  const h = setup(t); putDraft(h);
  const inks = pictureInks({ ctx: h.ctx, ...ids, readOnly: false });
  h.cleanup(() => inks.destroy());
  const field = inks.get(photo);
  await field.show({ width: 1600, height: 1200 }); field.setEditing(true);
  h.saveError = new Error('test offline');
  await h.advance();
  assert.equal(field.state, 'retrying');
  const draft = getDraft(h);
  const uploads = h.files.size;
  inks.pause(photo);
  inks.setLocked(false);
  assert.equal(field.editable, false);
  buttons(field.node, 'もう一度')[0].click(); await settle();
  await h.advance();
  assert.equal(h.files.size, uploads);
  assert.deepEqual(getDraft(h), draft);
  inks.setLocked(true);
  h.saveError = null;
  inks.resume(photo);
  assert.equal(field.editable, false);
  assert.equal(inks.get(photo), field);
  await settle(); await h.advance();
  assert.equal(field.state, 'saved');
  assert.equal(getDraft(h), null);
  inks.setLocked(false); assert.equal(field.editable, true);
});

for (const discard of [false, true]) {
  test(`写真の一時停止: flush 直後でも削除の列をふさがず、${discard ? '破棄後は送らない' : '再開後に送れる'}`, async (t) => {
    const h = setup(t); putDraft(h);
    const inks = pictureInks({ ctx: h.ctx, ...ids, readOnly: false });
    h.cleanup(() => inks.destroy());
    const field = inks.get(photo);
    const pending = field.flush();
    inks.pause(photo);
    let ran = false;
    await h.ctx.recordQueue.run(`${ids.classId}/${ids.lessonId}`, () => { ran = true; });
    assert.equal(ran, true);
    assert.equal(h.saves.length, 0);
    assert.ok(getDraft(h));
    if (discard) inks.stop(photo); else inks.resume(photo);
    assert.equal(await pending, !discard);
    await h.advance();
    assert.equal(h.saves.length, discard ? 0 : 1);
    assert.equal(getDraft(h), null);
  });
}

test('写真を消す: 送信中に書き足した下書きは、保存と削除が失敗しても残って自動保存に戻る', async (t) => {
  const h = setup(t), pane = attachments(h); h.cleanup(() => pane.destroy());
  let finishUpload;
  h.uploadGate = new Promise((resolve) => { finishUpload = resolve; });
  const svg = await startWriting(byClass(pane.node, 'attachment-open')[0]);
  draw(svg);
  await h.advance();
  assert.equal(pane.state, 'saving');
  draw(svg);
  const draft = getDraft(h);
  let finishRemove;
  const removeGate = new Promise((resolve) => { finishRemove = resolve; });
  let attempts = 0;
  h.ctx.repo.removeAttachment = async () => { attempts++; await removeGate; throw new Error('test offline'); };
  buttons(pane.node, '消す')[0].click();
  buttons(byClass(document.body, 'confirm')[0], '消す')[0].click(); await settle();
  assert.equal(attempts, 0);
  h.saveError = new Error('test offline');
  finishUpload(); await settle();
  assert.equal(attempts, 1);
  const uploads = h.files.size;
  await h.advance();
  assert.equal(h.files.size, uploads);
  assert.deepEqual(getDraft(h), draft);
  finishRemove(); await settle();
  assert.match(pane.node.textContent, /消せませんでした。もう一度ためしてください。/);
  assert.deepEqual(getDraft(h), draft);
  h.saveError = null;
  await h.advance();
  assert.equal(h.saves[0].index.strokes, 2);
  assert.equal(getDraft(h), null);
  assert.equal(pane.dirty, false);
});
