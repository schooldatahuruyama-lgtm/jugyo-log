// PDF の描画・通信・DOM の代役で、ページと保存部品のつなぎ方を確かめる。
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { createInkDrafts } from '../js/ink-drafts.js';
import { createRecordQueue } from '../js/record-queue.js';
import { pendingLessonCount, pendingLessons } from '../js/record-flow.js';
import { emptyPictureInk, inkPagePlace, splitInkPlace } from '../js/ink-logic.js';
import { CONFIG } from '../js/config.js';
import { installDom, all, byClass, buttons, settle, draw } from './helpers/picture-dom.js';

const hooks = registerHooks({
  load(url, context, next) {
    if (url === new URL('../js/pdf.js', import.meta.url).href) return {
      format: 'module', shortCircuit: true,
      source: 'export async function openPdf() { return globalThis.pdfInkScreenTest.openPdf(); }',
    };
    return next(url, context);
  },
});
const { attachmentPane } = await import('../js/views/parts/attachment-pane.js');
const { materialPane } = await import('../js/views/parts/material-pane.js');
const { pictureInks, canUsePictureInk, hasPictureInk } = await import('../js/views/parts/picture-ink.js');
const { mount: mountTeacher } = await import('../js/views/teacher-record.js');
const { mount: mountStudent } = await import('../js/views/student-lesson.js');
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
    cleanup: (fn) => cleanups.push(fn), pageCount: 2, renders: [], renderGates: new Map(), sizes: new Map(), closedPdfs: 0,
    record: { attachments: [{ slot: 'a1', type: 'pdf', fileId: pdf.fileId, addedAt: 1 }], ink: {}, inkCleared: {} },
    lesson: { title: '動作確認用の授業', date: '2026-01-01', materials: {
      [materialId]: { kind: 'handout', type: 'pdf', fileId: 'test-material', name: '動作確認用の PDF', order: 0, bytes: 10 },
    } },
    files: new Map([['test-ink', JSON.stringify(written())]]), loads: [], saves: [], removals: [], trashes: [],
    openPdf() {
      return { pageCount: h.pageCount, async renderPage(number) {
        h.renders.push(number);
        if (h.renderGates.has(number)) await h.renderGates.get(number).promise;
        const canvas = document.createElement('canvas');
        [canvas.width, canvas.height] = h.sizes.get(number) || (number === 1 ? [1200, 1600] : [1600, 900]);
        return canvas;
      }, close() { h.closedPdfs++; } };
    },
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
    assert.equal(buttons(viewer(), '＋').length, 0);
    assert.equal(buttons(viewer(), '＋ 下に書く場所を足す').length, 0);
    close(); pane.destroy();
    const reloaded = paneFor(h, kind); await open(reloaded, kind); assert.equal(paths(), 1);
    await turn(); assert.equal(paths(), 1); assert.equal(h.loads.length, 2);
    close();
  });
}

test('全消去: 他のページの線は残り、全ページ0本で印と目録が消える', async (t) => {
  const h = setup(t); putDraft(h, 1); putDraft(h, 2);
  const pane = paneFor(h); await open(pane); toggle().click();
  await clearPage(); assert.equal(byClass(pane.node, 'picture-ink-badge').length, 1);
  await turn(); await clearPage();
  assert.equal(byClass(pane.node, 'picture-ink-badge').length, 0);
  await pane.flush(); assert.deepEqual(h.record.ink, {});
  assert.ok(h.record.inkCleared['a1#p1']); assert.ok(h.record.inkCleared['a1#p2']); close();
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

test('1ページ・不正な大きさ・999/1000ページの境界。PDFの拡大縮小は増やさない', async (t) => {
  const h = setup(t); h.pageCount = 1;
  let pane = paneFor(h); await open(pane);
  assert.equal(buttons(viewer(), '前のページ')[0].disabled, true);
  assert.equal(buttons(viewer(), '次のページ')[0].disabled, true);
  assert.equal(toggle().disabled, false); close(); pane.destroy();
  h.pageCount = 1000; h.sizes.set(1, [0, 1600]);
  pane = paneFor(h); await open(pane);
  assert.equal(toggle().hidden, true); assert.equal(byClass(viewer(), 'viewer-pdf').length, 1);
  assert.equal(byClass(viewer(), 'ink-paper').length, 0);
  for (let i = 2; i <= 999; i++) await turn();
  assert.equal(toggle().disabled, false); toggle().click(); draw(paper());
  assert.ok(getDraft(h, 999)); await turn(); assert.equal(toggle().disabled, true);
  assert.equal(byClass(viewer(), 'ink-paper').length, 0);
  assert.match(viewer().textContent, /1000 \/ 1000/);
  await turn('前のページ'); assert.equal(paths(), 1); assert.equal(toggle().getAttribute('aria-pressed'), 'true');
  assert.equal(buttons(viewer(), '＋').length, 0); assert.equal(buttons(viewer(), '－').length, 0); close();
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
