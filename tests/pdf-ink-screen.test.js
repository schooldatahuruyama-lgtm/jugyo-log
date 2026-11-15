// PDF の描画・通信・DOM の代役で、ページと保存部品のつなぎ方を確かめる。
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { createInkDrafts } from '../js/ink-drafts.js';
import { createRecordQueue } from '../js/record-queue.js';
import { pendingLessonCount, pendingLessons } from '../js/record-flow.js';
import { emptyPictureInk, inkPagePlace, splitInkPlace } from '../js/ink-logic.js';
import { CONFIG } from '../js/config.js';
import { installDom, all, byClass, buttons, settle, draw, touch } from './helpers/picture-dom.js';

const hooks = registerHooks({
  load(url, context, next) {
    if (url === new URL('../js/pdf.js', import.meta.url).href) return {
      format: 'module', shortCircuit: true,
      source: 'export { pdfThumb } from "./pdf.js?thumb-test"; export async function openPdf() { return globalThis.pdfInkScreenTest.openPdf(); }',
    };
    return next(url, context);
  },
});
const { attachmentPane } = await import('../js/views/parts/attachment-pane.js');
const { materialPane } = await import('../js/views/parts/material-pane.js');
const { pictureInks, canUsePictureInk, hasPictureInk } = await import('../js/views/parts/picture-ink.js');
const { openViewer } = await import('../js/views/parts/viewer.js');
const { mount: mountTeacher } = await import('../js/views/teacher-record.js');
const { mount: mountStudent } = await import('../js/views/student-lesson.js');
const { mount: mountTeacherLesson } = await import('../js/views/teacher-lesson.js');
after(() => hooks.deregister());

const ids = { classId: 'test-class', lessonId: 'test-lesson', studentId: 'test-student' };
const materialId = 'TestPdf00001';
const pdf = { place: 'a1', type: 'pdf', fileId: 'test-pdf' };
const stroke = { c: 0, w: 0, p: [80, 120, 640, 420] };
const written = (count = 1) => ({ ...emptyPictureInk(1200, 1600), s: Array(count).fill(stroke) });
const indexFor = (on = pdf.fileId, fileId = 'test-ink', updatedAt = 10) => ({ on, fileId, bytes: 100, strokes: 1, updatedAt });
const getDraft = (h, page = 1, place = 'a1') => h.ctx.inkDrafts.get(ids.studentId, ids.classId, ids.lessonId, inkPagePlace(place, page));
const putDraft = (h, page = 1, place = 'a1', on = pdf.fileId, ink = written()) => h.ctx.inkDrafts.put(
  ids.studentId, ids.classId, ids.lessonId, inkPagePlace(place, page), { ink, on, editedAt: 50, key: `test-draft-${page}` });
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };

function setup(t) {
  const dom = installDom();
  const cleanups = [];
  const previous = globalThis.pdfInkScreenTest;
  t.after(() => {
    try { for (const cleanup of cleanups.reverse()) cleanup(); }
    finally { dom.restore(); if (previous === undefined) delete globalThis.pdfInkScreenTest; else globalThis.pdfInkScreenTest = previous; }
  });
  const storage = new Map(), timers = new Map();
  let timerId = 0, time = 100;
  const h = {
    cleanup: (fn) => cleanups.push(fn), pageCount: 2, renders: [], renderCalls: [], copies: [], backups: [], renderGates: new Map(), sizes: new Map(), closedPdfs: 0,
    record: { attachments: [{ slot: 'a1', type: 'pdf', fileId: pdf.fileId, addedAt: 1 }], ink: {}, inkCleared: {} },
    lesson: { title: '動作確認用の授業', date: '2026-01-01', materials: {
      [materialId]: { kind: 'handout', type: 'pdf', fileId: 'test-material', name: '動作確認用の PDF', order: 0, bytes: 10 },
    } },
    files: new Map([['test-ink', JSON.stringify(written())]]), loads: [], saves: [], removals: [], trashes: [],
    openPdf() {
      return { pageCount: h.pageCount, async renderPage(number, edge) {
        h.renders.push(number);
        h.renderCalls.push([number, edge]);
        if (edge === 3200) {
          if (h.sharpGate) await h.sharpGate.promise;
          if (h.sharpError) throw new Error('test render failed');
        }
        if (h.renderGates.has(number)) await h.renderGates.get(number).promise;
        const canvas = document.createElement('canvas');
        [canvas.width, canvas.height] = h.sizes.get(number) || (number === 1 ? [1200, 1600] : [1600, 900]);
        if (edge === 3200) [canvas.width, canvas.height] = h.sharpSize || [canvas.width * 2, canvas.height * 2];
        canvas.bitmap = { page: number, edge };
        canvas.getContext = () => h.noContext ? null : {
          drawImage: (...args) => {
            h.copies.push({ target: canvas, args, size: [canvas.width, canvas.height] });
            if (h.copyFailures > 0) { h.copyFailures--; throw new Error('test copy failed'); }
            canvas.bitmap = args[0].bitmap;
          },
        };
        return canvas;
      }, close() { h.closedPdfs++; } };
    },
  };
  const createElement = document.createElement;
  document.createElement = (tag) => {
    const node = createElement(tag);
    if (tag === 'canvas') {
      // 大きさを設定すると、それまでの絵が消えることも再現する。
      let width = 300, height = 150;
      Object.defineProperties(node, {
        width: { get: () => width, set: (value) => { width = value; node.bitmap = null; } },
        height: { get: () => height, set: (value) => { height = value; node.bitmap = null; } },
      });
      node.getContext = () => h.noBackupContext ? null : {
        drawImage: (...args) => {
          h.backups.push({ target: node, args });
          if (h.backupError) throw new Error('test backup failed');
          node.bitmap = args[0].bitmap;
        },
      };
    }
    return node;
  };
  globalThis.pdfInkScreenTest = h;
  h.ctx = {
    params: ids, session: { studentId: ids.studentId }, now: () => ++time, random: () => 0.25,
    timers: { setTimeout(fn) { timers.set(++timerId, fn); return timerId; }, clearTimeout(id) { timers.delete(id); } },
    recordQueue: createRecordQueue(),
    inkDrafts: createInkDrafts({ storage: {
      getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value),
      removeItem: (key) => storage.delete(key), get length() { return storage.size; }, key: (i) => [...storage.keys()][i],
    } }),
    drafts: { get: () => null, remove() {}, put: () => true, list: () => [] },
    thumbs: { load: async () => ({}) }, setLeaveGuard: (guard) => { h.guard = guard; }, navigate() {},
    repo: {
      getRecord: async () => structuredClone(h.record), getLesson: async () => h.lesson,
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
      async removeAttachment(c, l, s, slot, editedAt, pages) {
        h.removals.push({ slot, pages });
        h.record.attachments = h.record.attachments.filter((item) => item.slot !== slot);
        delete h.record.ink[slot]; h.record.inkCleared[slot] = editedAt;
        for (const name of Object.keys(h.record.ink)) if (splitInkPlace(name)?.place === slot) delete h.record.ink[name];
        for (const page of pages || []) h.record.inkCleared[inkPagePlace(slot, page)] = editedAt;
      },
    },
    files: {
      async loadInk(id) { h.loads.push(id); if (h.loadError) throw h.loadError; return h.files.get(id); },
      async uploadInk({ text }) {
        if (h.uploadGate) await h.uploadGate.promise;
        const fileId = `uploaded-${h.files.size}`;
        h.files.set(fileId, text); return { fileId, bytes: text.length };
      },
      async trashStudent(id) { h.trashes.push(id); return true; },
      loadStudentFile: async () => new Blob(['fake pdf']), loadFile: async () => new Blob(['fake pdf']),
      loadImages: async () => ({}),
    },
  };
  h.advance = async () => { const jobs = [...timers.values()]; timers.clear(); jobs.forEach((fn) => fn()); await settle(); };
  return h;
}

function paneFor(h, kind = 'attachment', readOnly = false) {
  const pane = kind === 'attachment'
    ? attachmentPane({ ctx: h.ctx, ...ids, attachments: h.record.attachments, ink: h.record.ink, inkCleared: h.record.inkCleared, readOnly })
    : materialPane({ ctx: h.ctx, ...ids, lesson: h.lesson, ink: h.record.ink, inkCleared: h.record.inkCleared, readOnly });
  document.body.append(pane.node); h.cleanup(() => pane.destroy()); return pane;
}
const viewer = () => byClass(document.body, 'material-viewer')[0];
const paper = () => byClass(viewer(), 'ink-paper')[0];
const paths = () => all(paper(), (node) => node.tagName === 'path').length;
const close = () => buttons(viewer(), '閉じる')[0].click();
const toggle = () => buttons(viewer(), '✎ 書きこむ')[0];
const control = (name) => all(viewer(), (node) => node.tagName === 'button' && node.getAttribute('aria-label') === name)[0];
async function turn(direction = '次のページ') { buttons(viewer(), direction)[0].click(); await settle(); }
async function open(pane, kind = 'attachment') {
  byClass(pane.node, kind === 'attachment' ? 'attachment-open' : 'student-material-open')[0].click(); await settle();
}
async function clearPage() {
  buttons(viewer(), '全部消す')[0].click();
  const confirmation = byClass(document.body, 'confirm')[0];
  assert.match(confirmation.textContent, /このページへの書きこみを全部消します。「1 つ戻す」で戻せます。/);
  buttons(confirmation, '全部消す')[0].click(); await settle();
}

function thumbnailPdf(h, { error = null, gate = null } = {}) {
  const result = { thumb: 'data:image/jpeg;base64,AAAA', renders: [], closed: 0 };
  h.openPdf = () => {
    let closed = false;
    return {
      async renderPage(page, edge) {
        result.renders.push([page, edge]);
        if (edge < CONFIG.thumb.maxEdge) {
          if (gate) await gate.promise;
          if (closed) throw new Error('閉じた PDF');
          if (error) throw error;
        }
        return { toDataURL: () => edge === CONFIG.thumb.maxEdge
          ? result.thumb + 'A'.repeat(CONFIG.thumb.maxChars) : result.thumb };
      },
      close() { if (!closed) { closed = true; result.closed++; } },
    };
  };
  return result;
}

async function pdfUploadScreen(h, kind) {
  const uploads = [], additions = [];
  h.ctx.files.uploadStudent = h.ctx.files.upload = async (args) => {
    uploads.push(args); return { fileId: 'test-uploaded-pdf', bytes: 3 };
  };
  let root, destroy;
  if (kind === 'attachment') {
    h.record.attachments = [];
    h.ctx.repo.addAttachment = async (c, l, s, slot, item, thumb) => {
      additions.push({ item, thumb });
      h.record.attachments.push({ slot, ...item });
    };
    const pane = paneFor(h);
    root = pane.node; destroy = () => pane.destroy();
  } else {
    h.lesson.materials = {};
    h.ctx.repo.listClasses = async () => [{ id: ids.classId, year: 2026, name: '確認用クラス' }];
    h.ctx.repo.listUnits = async () => [];
    h.ctx.repo.getThumbs = async () => Object.fromEntries(additions.map(({ id, thumb }) => [id, thumb]));
    h.ctx.repo.addMaterial = async (targets, id, item, thumb) => {
      additions.push({ id, item, thumb });
      h.lesson.materials[id] = { ...item, order: targets[0].order };
    };
    root = document.createElement('main'); document.body.append(root);
    destroy = mountTeacherLesson(root, h.ctx); h.cleanup(destroy);
  }
  await settle();
  const input = all(root, (node) => node.tagName === 'input' && node.getAttribute('type') === 'file'
    && node.getAttribute('accept').includes('application/pdf'))[0];
  assert.ok(input);
  return { root, destroy, uploads, additions, async send() {
    input.files = [{ type: 'application/pdf', name: '確認用.pdf', size: 3,
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer }];
    input.fire('change'); await settle();
    if (kind === 'material') {
      const form = byClass(root, 'material-form')[0];
      assert.ok(form);
      form.fire('submit'); await settle();
    }
  } };
}

for (const kind of ['attachment', 'material']) {
  for (const fails of [false, true]) {
    test(`PDF追加・${kind}: ${fails ? '描き直しに失敗しても、小さい画像なしで送る' : '1 回目が大きすぎても、小さい画像を付けて送る'}`, async (t) => {
      const h = setup(t);
      const rendered = thumbnailPdf(h, { error: fails ? new Error('描けません') : null });
      const screen = await pdfUploadScreen(h, kind);
      await screen.send();
      assert.deepEqual(rendered.renders, [[1, 320], [1, 240]]);
      assert.equal(rendered.closed, 1);
      assert.equal(screen.uploads.length, 1);
      assert.equal(screen.uploads[0].mime, 'application/pdf');
      assert.equal(screen.uploads[0].dataB64, 'AQID');
      assert.equal(screen.additions.length, 1);
      assert.equal(screen.additions[0].item.type, 'pdf');
      assert.equal(screen.additions[0].thumb, fails ? null : rendered.thumb);
      const images = all(screen.root, (node) => node.tagName === 'img');
      assert.equal(images.length, fails ? 0 : 1);
      if (!fails) assert.equal(images[0].getAttribute('src'), rendered.thumb);
    });
  }

  test(`PDF追加・${kind}: 描き直しの途中で画面を離れたら送らず、PDF を閉じる`, async (t) => {
    const h = setup(t), gate = deferred();
    const rendered = thumbnailPdf(h, { gate });
    const screen = await pdfUploadScreen(h, kind);
    await screen.send();
    assert.deepEqual(rendered.renders, [[1, 320], [1, 240]]);
    screen.destroy(); gate.resolve(); await settle();
    assert.equal(screen.uploads.length, 0);
    assert.equal(screen.additions.length, 0);
    assert.equal(rendered.closed, 1);
  });
}

test('ページの印: 場所・on・下書き時刻を確かめ、消去はそのページだけに効く', (t) => {
  const h = setup(t);
  const page = { ...pdf, place: 'a1#p1' };
  assert.equal(canUsePictureInk(page), true);
  assert.equal(canUsePictureInk({ ...page, type: 'image' }), false);
  for (const place of ['a1#p0', 'a1#p1000', 'a1#p01', 'memo#p1', 'unknown#p1']) {
    assert.equal(canUsePictureInk({ ...page, place }), false);
  }
  assert.equal(hasPictureInk(page, { 'a1#p1': indexFor('other') }), false);
  h.record.ink = { 'a1#p1': indexFor(), 'a1#p2': indexFor('other'), 'a1#p01': indexFor() };
  putDraft(h, 1, 'a1', pdf.fileId, emptyPictureInk(1, 1));
  const inks = pictureInks({ ctx: h.ctx, ...ids, ink: h.record.ink, readOnly: false }); h.cleanup(() => inks.destroy());
  assert.equal(inks.has(pdf), false);
  putDraft(h, 2); assert.equal(inks.has(pdf), true);
  inks.restore([pdf]); assert.equal(inks.dirty, true);
  assert.equal(inks.getPage(pdf, 2), inks.getPage(pdf, 2));
  assert.equal(inks.getPage(pdf, 1000), null);
  assert.equal(inks.getPage({ ...pdf, place: 'unknown' }, 1), null);
});

for (const kind of ['attachment', 'material']) {
  test(`${kind}: 2ページに書く→道具・ページ別の履歴→保存→印→再表示。空ページは通信しない`, async (t) => {
    const h = setup(t), pane = paneFor(h, kind);
    const place = kind === 'attachment' ? 'a1' : materialId;
    await open(pane, kind); toggle().click();
    const first = paper();
    assert.equal(first.getAttribute('viewBox'), '0 0 800 1067');
    assert.equal(first.parentNode.parentNode.children[0].tagName, 'canvas');
    assert.equal(first.style.touchAction, 'pan-x pan-y pinch-zoom');
    buttons(viewer(), '書く')[0].click(); control('赤').click(); control('太い').click();
    draw(first, { type: 'touch' });
    assert.equal(getDraft(h, 1, place).ink.s[0].c, 1);
    assert.equal(getDraft(h, 1, place).ink.s[0].w, 1);
    buttons(viewer(), '定規')[0].click();
    await turn();
    assert.equal(toggle().getAttribute('aria-pressed'), 'true');
    assert.equal(buttons(viewer(), '書く')[0].getAttribute('aria-pressed'), 'true');
    assert.equal(buttons(viewer(), '定規')[0].getAttribute('aria-pressed'), 'true');
    assert.equal(control('赤').getAttribute('aria-pressed'), 'true');
    assert.equal(control('太い').getAttribute('aria-pressed'), 'true');
    assert.equal(buttons(viewer(), '1 つ戻す')[0].disabled, true);
    const second = paper();
    assert.equal(second.getAttribute('viewBox'), '0 0 800 450');
    assert.equal(paths(), 0);
    assert.ok(h.record.ink[`${place}#p1`]);
    draw(second, { type: 'touch' });
    buttons(viewer(), '消しゴム')[0].click(); await turn('前のページ');
    assert.equal(paper(), first);
    assert.equal(buttons(viewer(), '消しゴム')[0].getAttribute('aria-pressed'), 'true');
    assert.equal(buttons(viewer(), '定規')[0].getAttribute('aria-pressed'), 'false');
    buttons(viewer(), '1 つ戻す')[0].click(); assert.equal(paths(), 0);
    buttons(viewer(), '消しゴム')[0].click(); draw(first, { type: 'touch' });
    await pane.flush(); close(); await settle();
    assert.equal(pane.state, 'saved');
    assert.equal(byClass(pane.node, 'picture-ink-badge').filter((node) => !node.hidden).length, 1);
    await open(pane, kind); assert.equal(paper(), first); assert.equal(paths(), 1);
    await turn(); assert.equal(paper(), second); assert.equal(paths(), 1);
    assert.equal(h.loads.length, 0);
    assert.equal(buttons(viewer(), '＋').length, 1);
    assert.equal(buttons(viewer(), '＋ 下に書く場所を足す').length, 0);
    close(); pane.destroy();
    const reloaded = paneFor(h, kind); await open(reloaded, kind); assert.equal(paths(), 1);
    await turn(); assert.equal(paths(), 1); assert.equal(h.loads.length, 2);
    close();
  });
}

test('PDFの倍率: ボタン・ピンチ・ホイール・幅変更、ページをめくると100%と先頭に戻る', async (t) => {
  const h = setup(t), pane = paneFor(h); await open(pane);
  const viewport = byClass(viewer(), 'viewer-viewport')[0], frame = byClass(viewer(), 'viewer-picture')[0];
  const label = byClass(viewer(), 'viewer-counter')[1];
  assert.equal(frame.style.width, '804px');
  assert.deepEqual(byClass(viewer(), 'viewer-controls')[0].children.map((node) => node.textContent),
    ['前のページ', '1 / 2', '次のページ', '－', '100%', '＋', '✎ 書きこむ']);
  buttons(viewer(), '＋')[0].click(); assert.equal(label.textContent, '125%');
  assert.equal(frame.style.width, '1005px');
  touch(viewport, 'touchstart', [[1, 300, 300], [2, 400, 300]]);
  assert.equal(touch(viewport, 'touchmove', [[1, 300, 300], [2, 500, 300]]).defaultPrevented, true);
  assert.equal(label.textContent, '250%'); touch(viewport, 'touchend', []);
  const svg = paper(), box = svg.getAttribute('viewBox');
  viewport.clientWidth = 600; window.fire('resize');
  assert.equal(frame.style.width, '1460px'); assert.equal(label.textContent, '250%');
  assert.equal(svg.getAttribute('viewBox'), box);
  const wheel = { clientX: 300, clientY: 300, deltaY: -100 };
  assert.equal(viewport.fire('wheel', wheel).defaultPrevented, false); assert.equal(label.textContent, '250%');
  assert.equal(viewport.fire('wheel', { ...wheel, ctrlKey: true }).defaultPrevented, true);
  assert.equal(label.textContent, '305%');
  await turn(); assert.equal(label.textContent, '100%');
  assert.equal(viewport.scrollLeft, 0); assert.equal(viewport.scrollTop, 0); close();
});

test('PDFの書く→ピンチ: 線を取り消し、ページ移動中も残る指では書かない', async (t) => {
  const h = setup(t), pane = paneFor(h); await open(pane); toggle().click(); buttons(viewer(), '書く')[0].click();
  const first = paper(), pointer = { pointerId: 1, pointerType: 'touch', clientX: 200, clientY: 200 };
  first.fire('pointerdown', pointer); first.fire('pointermove', { ...pointer, clientX: 300 });
  touch(first, 'touchstart', [[1, 200, 200], [2, 300, 200]]);
  touch(first, 'touchmove', [[1, 200, 200], [2, 400, 200]]);
  first.fire('pointerup', pointer);
  assert.equal(paths(), 0); assert.equal(getDraft(h), null); assert.equal(buttons(viewer(), '1 つ戻す')[0].disabled, true);
  h.renderGates.set(2, deferred()); buttons(viewer(), '次のページ')[0].click();
  const viewport = byClass(viewer(), 'viewer-viewport')[0];
  touch(viewport, 'touchstart', [[1, 200, 200], [2, 300, 200]]);
  touch(viewport, 'touchmove', [[1, 200, 200], [2, 500, 200]]);
  assert.equal(byClass(viewer(), 'viewer-counter')[1].textContent, '200%');
  h.renderGates.get(2).resolve(); await settle();
  draw(paper(), { type: 'touch' }); assert.equal(getDraft(h, 2), null);
  // 元のページの接触が終わってから、新しいページで指を受けつける。
  document.fire('touchend', { touches: [{ identifier: 1, target: first }] });
  draw(paper(), { type: 'touch' }); assert.equal(getDraft(h, 2), null);
  document.fire('touchend', { touches: [] });
  draw(paper(), { type: 'touch' }); assert.equal(getDraft(h, 2).ink.s.length, 1); close();
});

test('PDFの高精細化: 150%超の停止300ms後に1回、道具・線・保存状態・倍率・位置を維持', async (t) => {
  const h = setup(t); t.mock.timers.enable({ apis: ['setTimeout'] });
  const pane = paneFor(h); await open(pane); toggle().click(); buttons(viewer(), '書く')[0].click();
  control('赤').click(); control('太い').click();
  draw(paper(), { type: 'touch' }); await pane.flush();
  buttons(viewer(), '＋')[0].click(); buttons(viewer(), '＋')[0].click();
  t.mock.timers.tick(500); await settle(); assert.deepEqual(h.renderCalls, [[1, 1600]]);
  buttons(viewer(), '＋')[0].click();
  t.mock.timers.tick(299); await settle(); assert.equal(h.renderCalls.length, 1);
  buttons(viewer(), '＋')[0].click(); // 動いている間は300msを数え直す。
  t.mock.timers.tick(299); await settle(); assert.equal(h.renderCalls.length, 1);
  h.sharpGate = deferred(); t.mock.timers.tick(1); await settle();
  assert.deepEqual(h.renderCalls, [[1, 1600], [1, 3200]]);
  assert.equal(buttons(viewer(), '次のページ')[0].disabled, false);
  assert.equal(toggle().disabled, false);
  const svg = paper(), box = svg.getAttribute('viewBox'), old = byClass(viewer(), 'viewer-pdf')[0];
  const size = { ...old.style }, label = old.getAttribute('aria-label');
  draw(svg, { type: 'touch' });
  const draft = structuredClone(getDraft(h)), viewport = byClass(viewer(), 'viewer-viewport')[0];
  viewport.scrollLeft = 150; viewport.scrollTop = 240;
  const text = viewer().textContent;
  h.sharpSize = [2399, 3200]; h.sharpGate.resolve(); await settle();
  const sharp = byClass(viewer(), 'viewer-pdf')[0];
  assert.equal(sharp, old); assert.equal(sharp.height, 3200);
  assert.deepEqual(sharp.style, size); assert.equal(sharp.getAttribute('aria-label'), label);
  assert.equal(sharp.className, 'viewer-pdf');
  assert.equal(h.copies.length, 1); assert.equal(h.copies[0].target, old);
  assert.equal(h.copies[0].args[0].height, 3200); assert.deepEqual(h.copies[0].args.slice(1), [0, 0]);
  assert.deepEqual(sharp.bitmap, { page: 1, edge: 3200 });
  assert.equal(paper(), svg); assert.equal(svg.getAttribute('viewBox'), box); assert.equal(paths(), 2);
  assert.deepEqual(getDraft(h), draft); assert.equal(pane.state, 'dirty'); assert.equal(h.saves.length, 1);
  assert.equal(viewer().textContent, text); assert.equal(control('赤').getAttribute('aria-pressed'), 'true');
  assert.equal(viewport.scrollLeft, 150); assert.equal(viewport.scrollTop, 240);
  buttons(viewer(), '＋')[0].click(); t.mock.timers.tick(1000); await settle();
  assert.equal(h.renderCalls.length, 2);
  await turn(); await turn('前のページ');
  assert.equal(byClass(viewer(), 'viewer-pdf')[0], sharp);
  assert.equal(paper().getAttribute('viewBox'), box);
  for (let i = 0; i < 3; i++) buttons(viewer(), '＋')[0].click();
  t.mock.timers.tick(1000); await settle();
  assert.equal(h.renderCalls.filter(([page, edge]) => page === 1 && edge === 3200).length, 1); close();
});

for (const failures of [1, 2]) {
  test(`PDFの高精細化のコピーが${failures}回失敗: 元の絵を${failures === 1 ? '控えから戻す' : '読みこみ直す'}・同じページでは再試行しない`, async (t) => {
    const h = setup(t); t.mock.timers.enable({ apis: ['setTimeout'] });
    const pane = paneFor(h); await open(pane);
    const canvas = byClass(viewer(), 'viewer-pdf')[0], bitmap = canvas.bitmap, svg = paper();
    h.copyFailures = failures;
    for (let i = 0; i < 3; i++) buttons(viewer(), '＋')[0].click();
    const text = viewer().textContent, size = { ...canvas.style }, viewport = byClass(viewer(), 'viewer-viewport')[0];
    viewport.scrollLeft = 150; viewport.scrollTop = 240;
    t.mock.timers.tick(300); await settle();
    assert.equal(h.backups.length, 1);
    const backup = h.backups[0].target;
    assert.deepEqual(h.backups[0].args, [canvas, 0, 0]);
    assert.deepEqual([backup.width, backup.height], [1200, 1600]); assert.equal(backup.bitmap, bitmap);
    assert.deepEqual([canvas.width, canvas.height], [1200, 1600]);
    assert.equal(h.copies.length, 2); assert.ok(h.copies.every((copy) => copy.target === canvas));
    assert.deepEqual(h.copies[0].size, [2400, 3200]);
    assert.deepEqual(h.copies[0].args[0].bitmap, { page: 1, edge: 3200 });
    assert.deepEqual(h.copies[1].size, [1200, 1600]); assert.deepEqual(h.copies[1].args, [backup, 0, 0]);
    const current = byClass(viewer(), 'viewer-pdf')[0];
    assert.deepEqual([current.width, current.height], [1200, 1600]); assert.deepEqual(current.bitmap, bitmap);
    assert.equal(paper(), svg); assert.equal(h.saves.length, 0);
    if (failures === 1) {
      assert.equal(current, canvas); assert.equal(canvas.bitmap, bitmap);
      assert.deepEqual(canvas.style, size); assert.equal(viewer().textContent, text);
      assert.equal(viewport.scrollLeft, 150); assert.equal(viewport.scrollTop, 240);
      assert.deepEqual(h.renderCalls, [[1, 1600], [1, 3200]]);
    } else {
      assert.notEqual(current, canvas); assert.equal(canvas.bitmap, null);
      assert.deepEqual(h.renderCalls, [[1, 1600], [1, 3200], [1, 1600]]);
      assert.equal(byClass(viewer(), 'viewer-message')[0].textContent, '');
    }
    for (let i = 0; i < 3; i++) buttons(viewer(), '＋')[0].click();
    t.mock.timers.tick(1000); await settle();
    assert.equal(h.copies.length, 2);
    assert.equal(h.renderCalls.filter(([page, edge]) => page === 1 && edge === 3200).length, 1);
    await turn();
    for (let i = 0; i < 3; i++) buttons(viewer(), '＋')[0].click();
    t.mock.timers.tick(300); await settle();
    assert.deepEqual(byClass(viewer(), 'viewer-pdf')[0].bitmap, { page: 2, edge: 3200 });
    assert.equal(h.renderCalls.filter(([page, edge]) => page === 2 && edge === 3200).length, 1);
    await turn('前のページ');
    for (let i = 0; i < 3; i++) buttons(viewer(), '＋')[0].click();
    t.mock.timers.tick(1000); await settle();
    assert.deepEqual(byClass(viewer(), 'viewer-pdf')[0].bitmap, bitmap);
    assert.equal(h.renderCalls.filter(([page, edge]) => page === 1 && edge === 3200).length, 1); close();
  });
}

for (const failure of ['context', 'copy']) {
  test(`PDFの高精細化の控えの${failure}失敗: 今の絵・大きさを変えず、コピーも再試行もしない`, async (t) => {
    const h = setup(t); t.mock.timers.enable({ apis: ['setTimeout'] });
    const pane = paneFor(h); await open(pane);
    const canvas = byClass(viewer(), 'viewer-pdf')[0], bitmap = canvas.bitmap, svg = paper();
    h.noBackupContext = failure === 'context'; h.backupError = failure === 'copy';
    for (let i = 0; i < 3; i++) buttons(viewer(), '＋')[0].click();
    const text = viewer().textContent;
    t.mock.timers.tick(300); await settle();
    assert.equal(byClass(viewer(), 'viewer-pdf')[0], canvas); assert.equal(canvas.bitmap, bitmap);
    assert.deepEqual([canvas.width, canvas.height], [1200, 1600]);
    assert.equal(h.backups.length, failure === 'context' ? 0 : 1); assert.equal(h.copies.length, 0);
    assert.equal(viewer().textContent, text); assert.equal(paper(), svg); assert.equal(h.saves.length, 0);
    h.noBackupContext = false; h.backupError = false;
    buttons(viewer(), '＋')[0].click(); t.mock.timers.tick(1000); await settle();
    assert.deepEqual(h.renderCalls, [[1, 1600], [1, 3200]]); assert.equal(h.copies.length, 0); close();
  });
}

for (const ending of ['touchend', 'touchcancel']) {
  test(`PDFの高精細化: 指が全部${ending}になるまで写さず、同じcanvasでピンチを続けられる`, async (t) => {
    const h = setup(t); t.mock.timers.enable({ apis: ['setTimeout'] });
    const pane = paneFor(h); await open(pane);
    const canvas = byClass(viewer(), 'viewer-pdf')[0], svg = paper();
    const viewport = byClass(viewer(), 'viewer-viewport')[0], label = byClass(viewer(), 'viewer-counter')[1];
    touch(canvas, 'touchstart', [[1, 200, 200], [2, 300, 200]]);
    touch(canvas, 'touchmove', [[1, 200, 200], [2, 400, 200]]);
    t.mock.timers.tick(300); await settle();
    assert.equal(label.textContent, '200%'); assert.equal(byClass(viewer(), 'viewer-pdf')[0], canvas);
    assert.equal(canvas.height, 1600); assert.equal(h.copies.length, 0);
    for (const x of [450, 500, 550]) {
      touch(canvas, 'touchmove', [[1, 200, 200], [2, x, 200]]);
      t.mock.timers.tick(300); await settle();
      assert.equal(canvas.height, 1600); assert.equal(h.copies.length, 0);
    }
    assert.deepEqual(h.renderCalls, [[1, 1600], [1, 3200]]);
    touch(canvas, 'touchend', [[1, 200, 200]]);
    assert.equal(canvas.height, 1600); assert.equal(h.copies.length, 0);
    const size = { ...canvas.style }, text = viewer().textContent;
    viewport.scrollLeft = 140; viewport.scrollTop = 230;
    // 枠の外に残る別の指は待たず、document で最後の指の終了を拾う。
    document.fire(ending, { touches: [{ identifier: 99, target: document.body }] });
    assert.equal(byClass(viewer(), 'viewer-pdf')[0], canvas); assert.equal(canvas.height, 3200);
    assert.equal(h.copies.length, 1); assert.equal(h.copies[0].target, canvas);
    assert.deepEqual(canvas.style, size); assert.equal(viewer().textContent, text); assert.equal(paper(), svg);
    assert.equal(viewport.scrollLeft, 140); assert.equal(viewport.scrollTop, 230);
    touch(canvas, 'touchstart', [[3, 200, 200], [4, 400, 200]]);
    touch(canvas, 'touchmove', [[3, 200, 200], [4, 300, 200]]);
    assert.equal(label.textContent, '175%'); touch(canvas, 'touchend', []);
    t.mock.timers.tick(1000); await settle(); assert.equal(h.renderCalls.length, 2); close();
  });
}

for (const action of ['turn', 'close', 'shrink', 'shrink-restore']) {
  test(`PDFの高精細化の保留中に${action}: 指を離しても古い結果は写さない`, async (t) => {
    const h = setup(t); t.mock.timers.enable({ apis: ['setTimeout'] });
    const pane = paneFor(h); await open(pane);
    const canvas = byClass(viewer(), 'viewer-pdf')[0];
    touch(canvas, 'touchstart', [[1, 200, 200], [2, 300, 200]]);
    touch(canvas, 'touchmove', [[1, 200, 200], [2, 400, 200]]);
    t.mock.timers.tick(300); await settle(); assert.equal(h.copies.length, 0);
    if (action === 'turn') await turn();
    else if (action === 'close') close();
    else {
      buttons(viewer(), '－')[0].click(); buttons(viewer(), '－')[0].click();
      if (action === 'shrink-restore') buttons(viewer(), '＋')[0].click();
    }
    document.fire('touchend', { touches: [] });
    t.mock.timers.tick(1000); await settle();
    assert.equal(h.copies.length, 0); assert.equal(canvas.height, 1600);
    assert.equal(h.renderCalls.filter(([page, edge]) => page === 1 && edge === 3200).length, 1);
    if (action === 'close') assert.equal(viewer(), undefined);
    else {
      assert.equal(byClass(viewer(), 'viewer-pdf')[0].height, action === 'turn' ? 900 : 1600);
      close();
    }
  });
}

for (const action of ['turn', 'close', 'shrink', 'shrink-restore', 'failure', 'zero', 'nan', 'infinite', 'negative', 'string', 'context']) {
  test(`PDFの高精細化の${action}: 遅い結果や失敗で今の表示・線を変えない`, async (t) => {
    const h = setup(t); t.mock.timers.enable({ apis: ['setTimeout'] });
    const pane = paneFor(h); await open(pane); h.sharpGate = deferred();
    for (let i = 0; i < 3; i++) buttons(viewer(), '＋')[0].click();
    t.mock.timers.tick(300); await settle();
    if (action === 'close') close();
    if (action === 'turn') await turn();
    if (action === 'failure') h.sharpError = true;
    if (action === 'zero') h.sharpSize = [0, 0];
    if (action === 'nan') h.sharpSize = [NaN, 3200];
    if (action === 'infinite') h.sharpSize = [2400, Infinity];
    if (action === 'negative') h.sharpSize = [-1, 3200];
    if (action === 'string') h.sharpSize = ['2400', 3200];
    if (action === 'context') h.noContext = true;
    if (action.startsWith('shrink')) {
      buttons(viewer(), '－')[0].click();
      if (action === 'shrink-restore') buttons(viewer(), '＋')[0].click();
    }
    const current = viewer() && byClass(viewer(), 'viewer-pdf')[0], text = viewer()?.textContent;
    const size = current && [current.width, current.height];
    h.sharpGate.resolve(); await settle();
    assert.equal(h.copies.length, 0);
    if (action === 'close') { assert.equal(viewer(), undefined); assert.equal(h.closedPdfs, 1); }
    else {
      assert.equal(byClass(viewer(), 'viewer-pdf')[0], current); assert.equal(viewer().textContent, text);
      assert.deepEqual([current.width, current.height], size);
      assert.equal(h.saves.length, 0);
      if (action !== 'turn') {
        buttons(viewer(), '＋')[0].click(); t.mock.timers.tick(1000); await settle();
        assert.equal(h.renderCalls.filter(([, edge]) => edge === 3200).length, 1);
      }
      close();
    }
  });
}

test('書きこみ部品のないPDF: ピンチ・高精細化・ページ送りを使える', async (t) => {
  const h = setup(t); t.mock.timers.enable({ apis: ['setTimeout'] });
  const v = openViewer({ title: '先生の見るだけのPDF', kind: 'pdf', load: async () => new Blob(['fake pdf']) });
  await settle(); const viewport = byClass(viewer(), 'viewer-viewport')[0];
  touch(viewport, 'touchstart', [[1, 200, 200], [2, 300, 200]]);
  touch(viewport, 'touchmove', [[1, 200, 200], [2, 400, 200]]); touch(viewport, 'touchend', []);
  assert.match(viewer().textContent, /200%/);
  t.mock.timers.tick(300); await settle(); assert.equal(byClass(viewer(), 'viewer-pdf')[0].height, 3200);
  assert.equal(byClass(viewer(), 'ink-paper').length, 0); assert.equal(h.saves.length, 0);
  await turn(); assert.match(viewer().textContent, /100%/); v.close();
});

test('全消去: 他のページの線は残り、全ページ0本で印と目録が消える', async (t) => {
  const h = setup(t); putDraft(h, 1); putDraft(h, 2);
  const pane = paneFor(h); await open(pane); toggle().click();
  await clearPage(); assert.equal(byClass(pane.node, 'picture-ink-badge').length, 1);
  await turn(); await clearPage();
  assert.equal(byClass(pane.node, 'picture-ink-badge').length, 0);
  await pane.flush(); assert.deepEqual(h.record.ink, {});
  assert.ok(h.record.inkCleared['a1#p1']); assert.ok(h.record.inkCleared['a1#p2']); close();
});

test('PDFの接触: ページを移っても書く間だけ止め、動かす・書きこみ終了で戻す', async (t) => {
  const h = setup(t), pane = paneFor(h);
  await open(pane); toggle().click();
  const checkTouches = (expected) => {
    assert.equal(paper().classList.contains('ink-paper-writing'), expected);
    for (const type of ['touchstart', 'touchmove']) {
      for (const changedTouches of [undefined, [{}], [{ touchType: 'direct' }, {}]]) {
        assert.equal(paper().fire(type, { cancelable: true, changedTouches }).defaultPrevented, expected);
      }
    }
  };
  checkTouches(false);
  buttons(viewer(), '書く')[0].click(); checkTouches(true);
  await turn(); checkTouches(true);
  buttons(viewer(), '動かす')[0].click(); checkTouches(false);
  assert.equal(paper().style.touchAction, 'pan-x pan-y pinch-zoom');
  buttons(viewer(), '書く')[0].click(); checkTouches(true);
  toggle().click(); checkTouches(false);
  toggle().click(); checkTouches(true);
  assert.equal(paths(), 0); assert.equal(pane.dirty, false);
  close();
});

test('未表示ページの下書きも保存対象。別の授業・onの下書きは混ぜない', async (t) => {
  const h = setup(t); putDraft(h, 999); putDraft(h, 2, 'a1', 'other-pdf');
  h.ctx.inkDrafts.put(ids.studentId, ids.classId, 'other-lesson', 'a1#p3',
    { on: pdf.fileId, ink: written(), editedAt: 50, key: 'other-draft' });
  const pane = paneFor(h); assert.equal(pane.dirty, true); assert.equal(h.loads.length, 0);
  await pane.flush(); assert.equal(h.saves.length, 1); assert.equal(h.saves[0].field, 'a1#p999');
  assert.ok(getDraft(h, 2)); assert.equal(h.renders.length, 0);
});

for (const method of ['getRecord', 'removeAttachment']) {
  test(`PDF削除の${method}失敗: 全ページの送信を止め、下書きと同じ部品を復帰`, async (t) => {
    const h = setup(t); putDraft(h, 1); putDraft(h, 2); putDraft(h, 999);
    const pane = paneFor(h); await open(pane); toggle().click(); const first = paper();
    const original = h.ctx.repo[method], gate = deferred(); let attempts = 0;
    h.ctx.repo[method] = async () => { attempts++; await gate.promise; throw new Error('test offline'); };
    buttons(pane.node, '消す')[0].click();
    const confirmation = byClass(document.body, 'confirm')[0];
    assert.match(confirmation.textContent, /この PDF への書きこみも消えます。/);
    buttons(confirmation, '消す')[0].click(); await settle();
    assert.equal(viewer(), undefined); const draft = getDraft(h);
    draw(first); assert.deepEqual(getDraft(h), draft);
    assert.equal(await pane.flush(), false); assert.equal(await pane.retry(), false);
    await h.advance(); assert.equal(attempts, 1); assert.equal(h.saves.length, 0);
    for (const page of [1, 2, 999]) assert.ok(getDraft(h, page));
    gate.resolve(); await settle(); h.ctx.repo[method] = original;
    assert.match(pane.node.textContent, /消せませんでした/);
    await open(pane); toggle().click(); assert.equal(paper(), first);
    draw(first); await h.advance(); assert.equal(h.saves.length, 3);
    assert.equal(h.record.ink['a1#p1'].strokes, 2);
    close(); buttons(pane.node, '消す')[0].click();
    buttons(byClass(document.body, 'confirm')[0], '消す')[0].click(); await settle();
    assert.deepEqual(h.removals[0].pages.sort((a, b) => a - b), [1, 2, 999]);
    assert.deepEqual(h.record.ink, {}); assert.equal(h.record.attachments.length, 0);
    for (const page of [1, 2, 999]) assert.equal(getDraft(h, page), null);
    for (const save of h.saves) assert.ok(h.trashes.includes(save.index.fileId));
  });
}

test('送信中のPDFを消す: 全ページの保存完了後に削除し、待機中の下書きを復活させない', async (t) => {
  const h = setup(t); putDraft(h, 1); putDraft(h, 2); putDraft(h, 999);
  const pane = paneFor(h); h.uploadGate = deferred();
  await h.advance(); assert.equal(pane.state, 'saving');
  buttons(pane.node, '消す')[0].click();
  buttons(byClass(document.body, 'confirm')[0], '消す')[0].click(); await settle();
  assert.equal(h.record.attachments.length, 1);
  h.uploadGate.resolve(); await settle(); await h.advance();
  assert.equal(h.record.attachments.length, 0); assert.deepEqual(h.record.ink, {});
  assert.equal(h.ctx.inkDrafts.list(ids.studentId).length, 0);
  for (const save of h.saves) assert.ok(h.trashes.includes(save.index.fileId));
});

test('別端末でPDFが消えていたら、全ページの下書きを片付ける', async (t) => {
  const h = setup(t); putDraft(h, 1); putDraft(h, 999);
  const pane = paneFor(h); h.record.attachments = [];
  buttons(pane.node, '消す')[0].click(); buttons(byClass(document.body, 'confirm')[0], '消す')[0].click();
  await settle(); await h.advance();
  assert.equal(h.removals.length, 0); assert.equal(h.saves.length, 0);
  assert.equal(h.ctx.inkDrafts.list(ids.studentId).length, 0); assert.equal(pane.dirty, false);
});

test('先生の1人の記録: 両方のPDFの印とページ別の線を表示し、道具を出さない', async (t) => {
  const h = setup(t); h.files.set('second-ink', JSON.stringify(written(2)));
  for (const [place, on] of [['a1', pdf.fileId], [materialId, 'test-material']]) {
    h.record.ink[`${place}#p1`] = indexFor(on);
    h.record.ink[`${place}#p2`] = indexFor(on, 'second-ink');
  }
  const root = document.createElement('main'); document.body.append(root);
  h.cleanup(mountTeacher(root, h.ctx)); await settle();
  assert.equal(byClass(root, 'picture-ink-badge').filter((node) => !node.hidden).length, 2);
  for (const kind of ['attachment', 'material']) {
    await open({ node: root }, kind); assert.equal(paths(), 1);
    assert.equal(toggle().hidden, true); assert.equal(byClass(viewer(), 'ink-tools').length, 0);
    draw(paper()); await turn(); assert.equal(paths(), 2);
    assert.equal(byClass(viewer(), 'ink-tools').length, 0); close();
  }
  assert.equal(h.saves.length, 0); assert.equal(h.ctx.inkDrafts.list(ids.studentId).length, 0);
});

test('先生の再試行: 記録の現在の目録を読み直してから当該ページだけを読む', async (t) => {
  const h = setup(t); h.record.ink['a1#p1'] = indexFor(); h.loadError = new Error('test offline');
  const pane = paneFor(h, 'attachment', true); await open(pane);
  assert.match(viewer().textContent, /書きこみを読みこめませんでした。/);
  assert.equal(buttons(viewer(), '新しく書く').length, 0);
  h.files.set('new-ink', JSON.stringify(written(2)));
  h.record.ink['a1#p1'] = indexFor(pdf.fileId, 'new-ink', 1000); h.loadError = null;
  buttons(viewer(), 'もう一度')[0].click(); await settle();
  assert.equal(h.loads.at(-1), 'new-ink'); assert.equal(paths(), 2);
  await turn(); assert.equal(paths(), 0); assert.equal(h.loads.length, 2); close();
});

test('速いページ移動: 遅い線・PDF描画・閉鎖後の結果を別ページへ重ねない', async (t) => {
  const h = setup(t); h.record.ink['a1#p1'] = indexFor();
  const inkGate = deferred(); h.ctx.files.loadInk = async (id) => { h.loads.push(id); return inkGate.promise; };
  const pane = paneFor(h); await open(pane);
  assert.match(viewer().textContent, /書きこみを読みこんでいます…/); assert.equal(toggle().disabled, true);
  h.renderGates.set(2, deferred()); buttons(viewer(), '次のページ')[0].click();
  assert.equal(byClass(viewer(), 'picture-ink-overlay').length, 0);
  assert.equal(toggle().disabled, true); assert.match(viewer().textContent, /読みこんでいます…/);
  for (let i = 0; i < 10; i++) buttons(viewer(), '次のページ')[0].click();
  inkGate.resolve(JSON.stringify(written())); await settle();
  assert.equal(byClass(viewer(), 'ink-paper').length, 0);
  h.renderGates.get(2).resolve(); await settle(); assert.equal(paths(), 0);
  await turn('前のページ'); assert.equal(paths(), 1); assert.equal(h.loads.length, 1);
  await turn(); toggle().click(); draw(paper()); assert.equal(getDraft(h, 2).ink.s.length, 1);
  await turn('前のページ'); assert.equal(paths(), 1);
  h.renderGates.set(2, deferred()); buttons(viewer(), '次のページ')[0].click(); close();
  h.renderGates.get(2).resolve(); await settle();
  assert.equal(viewer(), undefined); assert.equal(h.closedPdfs, 1);
});

test('読みこみ失敗から新しく書く・ほかの端末の新しい線はそのページだけに効く', async (t) => {
  const h = setup(t); h.record.ink['a1#p1'] = indexFor(); h.loadError = { code: 'notfound' };
  const pane = paneFor(h); await open(pane);
  assert.match(viewer().textContent, /前の書きこみが見つかりませんでした。/);
  await turn(); toggle().click(); draw(paper()); const second = paper();
  await turn('前のページ'); assert.equal(h.loads.length, 1);
  buttons(viewer(), '新しく書く')[0].click();
  buttons(byClass(document.body, 'confirm')[0], '新しく書く')[0].click(); await settle();
  assert.equal(paths(), 0); draw(paper());
  h.record.ink['a1#p1'] = indexFor(pdf.fileId, 'test-ink', 1000); h.loadError = null;
  await pane.flush(); await settle();
  assert.match(viewer().textContent, /ほかの端末で書いたほうが新しい/);
  await turn(); assert.equal(paper(), second); assert.equal(paths(), 1); close();
});

test('保存失敗・再試行・goneの文と下書きをPDFの中に出す', async (t) => {
  const h = setup(t), pane = paneFor(h); await open(pane); toggle().click(); draw(paper());
  h.saveError = new Error('test offline'); assert.equal(await pane.flush(), false);
  assert.match(viewer().textContent, /保存できませんでした/); assert.ok(getDraft(h));
  h.saveError = null; buttons(viewer(), 'もう一度')[0].click(); await settle();
  assert.match(viewer().textContent, /✓ 保存しました/); assert.equal(getDraft(h), null);
  draw(paper()); h.record.attachments = []; assert.equal(await pane.flush(), true);
  assert.match(viewer().textContent, /この PDF は、もうありません。書きこみは保存されませんでした。/);
  assert.equal(toggle().disabled, true); assert.equal(byClass(viewer(), 'ink-tools').length, 0);
  assert.equal(getDraft(h), null); close();
});

test('授業ページ: 全ページの保存状態・再送・離れる確認・戻ったときの読み直し', async (t) => {
  const h = setup(t); putDraft(h, 2); putDraft(h, 1, materialId, 'test-material');
  const root = document.createElement('main'); document.body.append(root);
  h.cleanup(mountStudent(root, h.ctx)); await settle();
  assert.match(byClass(root, 'student-lesson-states')[0].textContent, /保存中/);
  h.saveError = new Error('test offline');
  for (let i = 0; i < 4; i++) await h.advance();
  assert.match(byClass(root, 'student-lesson-states')[0].textContent, /保存できませんでした/);
  assert.equal(pendingLessonCount(h.ctx.drafts, ids.studentId, h.ctx.inkDrafts), 1);
  assert.deepEqual([...pendingLessons(h.ctx.drafts, ids.studentId, ids.classId, h.ctx.inkDrafts)], [ids.lessonId]);
  h.saveError = null; buttons(byClass(root, 'student-lesson-states')[0], 'もう一度')[0].click(); await settle();
  assert.equal(getDraft(h, 2), null); assert.equal(getDraft(h, 1, materialId), null);
  await open({ node: root }); toggle().click(); draw(paper());
  h.saveError = new Error('test offline'); const leaving = h.guard(); await settle();
  const confirmation = byClass(document.body, 'confirm')[0]; assert.match(confirmation.textContent, /まだ保存できていません/);
  buttons(confirmation, 'ここに残る')[0].click(); assert.equal(await leaving, false);
  assert.ok(getDraft(h)); h.saveError = null; close(); await settle();
  await open({ node: root });
  h.record.ink['a1#p1'] = indexFor(pdf.fileId, 'test-ink', 1000);
  document.fire('visibilitychange'); await settle(); assert.equal(paths(), 1);
  delete h.record.ink['a1#p1']; h.record.inkCleared['a1#p1'] = 2000;
  document.fire('visibilitychange'); await settle(); assert.equal(paths(), 0);
  close(); assert.equal(await h.guard(), true);
});

test('1ページ・不正な大きさ・999/1000ページの境界。大きさ不明では拡大しない', async (t) => {
  const h = setup(t); h.pageCount = 1;
  let pane = paneFor(h); await open(pane);
  assert.equal(buttons(viewer(), '前のページ')[0].disabled, true);
  assert.equal(buttons(viewer(), '次のページ')[0].disabled, true);
  assert.equal(toggle().disabled, false); close(); pane.destroy();
  h.pageCount = 1000; h.sizes.set(1, [0, 1600]);
  pane = paneFor(h); await open(pane);
  assert.equal(toggle().hidden, true); assert.equal(byClass(viewer(), 'viewer-pdf').length, 1);
  assert.equal(byClass(viewer(), 'ink-paper').length, 0);
  assert.equal(buttons(viewer(), '＋')[0].disabled, true);
  for (let i = 2; i <= 999; i++) await turn();
  assert.equal(toggle().disabled, false); toggle().click(); draw(paper());
  assert.ok(getDraft(h, 999)); await turn(); assert.equal(toggle().disabled, true);
  assert.equal(byClass(viewer(), 'ink-paper').length, 0);
  assert.match(viewer().textContent, /1000 \/ 1000/);
  await turn('前のページ'); assert.equal(paths(), 1); assert.equal(toggle().getAttribute('aria-pressed'), 'true');
  assert.equal(buttons(viewer(), '＋').length, 1); assert.equal(buttons(viewer(), '－').length, 1); close();
});

test('PDFのページごとの上限・動かすの指スクロールと上下左右のドラッグ', async (t) => {
  const h = setup(t); putDraft(h, 1, 'a1', pdf.fileId, written(CONFIG.ink.maxStrokes));
  const pane = paneFor(h); await open(pane);
  const viewport = byClass(viewer(), 'viewer-viewport')[0];
  viewport.fire('pointerdown', { pointerType: 'mouse', pointerId: 5, clientX: 100, clientY: 100 });
  viewport.fire('pointermove', { pointerId: 5, clientX: 40, clientY: 50 });
  assert.equal(viewport.scrollLeft, 60); assert.equal(viewport.scrollTop, 50);
  viewport.fire('pointerup', { pointerId: 5 }); toggle().click();
  assert.equal(paper().style.touchAction, 'pan-x pan-y pinch-zoom');
  draw(paper(), { type: 'touch' }); assert.equal(paths(), CONFIG.ink.maxStrokes);
  draw(paper()); assert.match(viewer().textContent, /これ以上は書けません。いらない線を消してください。/);
  await turn(); draw(paper()); assert.equal(getDraft(h, 2).ink.s.length, 1); close();
});
