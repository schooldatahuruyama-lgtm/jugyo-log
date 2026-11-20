import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../js/config.js';
import { createExportDraw } from '../js/export-draw.js';
import { emptyPictureInk } from '../js/ink-logic.js';

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
};
const settle = async () => { for (let i = 0; i < 150; i++) await Promise.resolve(); };
const blob = () => new Blob(['test']);

function setup(t, { width = 1600, height = 1200, openPdf } = {}) {
  const canvases = [], made = [], revoked = [], draws = [];
  const document = { createElement: (tag) => {
    assert.equal(tag, 'canvas');
    const lines = [], widths = [];
    const context = { fillRect() {}, drawImage() {}, beginPath() {},
      moveTo: (...point) => lines.push(['moveTo', ...point]),
      lineTo: (...point) => lines.push(['lineTo', ...point]),
      stroke() { widths.push(this.lineWidth); } };
    const canvas = { width: 0, height: 0, lines, widths, getContext: () => context,
      toBlob: (done, mime, quality) => {
        assert.equal(mime, 'image/jpeg'); assert.equal(quality, CONFIG.export.jpegQuality); done(blob());
      } };
    canvases.push(canvas); return canvas;
  } };
  const sourcePdf = () => ({ pageCount: 1, close() {}, renderPage: async () => {
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height; return canvas;
  } });
  const create = (pdf = openPdf ?? (async () => sourcePdf())) => {
    const draw = createExportDraw({ document, config: CONFIG, openPdf: pdf,
      createImageBitmap: async () => ({ width, height, close() {} }),
      URL: { createObjectURL: () => { const url = `blob:test${made.length}`; made.push(url); return url; },
        revokeObjectURL: (url) => revoked.push(url) },
    });
    draws.push(draw); return draw;
  };
  t.after(() => { for (const draw of draws) draw.dispose(); });
  return { create, canvases, made, revoked, sourcePdf };
}

const shapes = [
  { name: '横長', width: 1600, height: 100, h: 100, size: [1200, 75],
    points: [400, 80, 800, 100], lines: [['moveTo', 600, 60], ['lineTo', 1200, 75]], lineWidth: 3.375 },
  { name: '縦長', width: 100, height: 1600, h: 4000, size: [75, 1200],
    points: [400, 2000, 800, 4000], lines: [['moveTo', 37.5, 600], ['lineTo', 75, 1200]], lineWidth: 0.590625 },
  { name: '4:3', width: 1600, height: 1200, h: 600, size: [1200, 900],
    points: [400, 300, 800, 600], lines: [['moveTo', 600, 450], ['lineTo', 1200, 900]], lineWidth: 4.5 },
];

for (const kind of ['写真', 'PDF']) {
  for (const shape of shapes) {
    test(`${kind}: ${shape.name}の絵全体に書きこみを合わせ、太さは縦横の比の平均にする`, async (t) => {
      const h = setup(t, kind === '写真' ? shape : { width: shape.size[0], height: shape.size[1] });
      const draw = h.create(), ink = emptyPictureInk(shape.width, shape.height);
      assert.equal(ink.h, shape.h);
      ink.s.push({ c: 0, w: 0, p: shape.points });
      const pdf = kind === 'PDF' ? await draw.openPdf(blob()) : null;
      try {
        const result = pdf ? await pdf.page(1, ink) : await draw.picture(blob(), ink);
        assert.deepEqual([result.width, result.height], shape.size);
        assert.deepEqual(h.canvases[0].lines, shape.lines);
        assert.ok(Math.abs(h.canvases[0].widths[0] - shape.lineWidth) < 1e-10);
      } finally { await pdf?.close(); }
    });
  }

  for (const height of [undefined, 0, -1, NaN, Infinity, -Infinity, '100', null]) {
    test(`${kind}: ink.h が ${String(height)} でも絵を出し、縦も横の比を使う`, async (t) => {
      const h = setup(t, kind === '写真' ? { width: 1600, height: 100 } : { width: 1200, height: 75 });
      const draw = h.create(), ink = { v: 1, k: 'pic', s: [{ c: 0, w: 0, p: [400, 20, 600, 40] }] };
      if (height !== undefined) ink.h = height;
      const pdf = kind === 'PDF' ? await draw.openPdf(blob()) : null;
      try {
        const result = pdf ? await pdf.page(1, ink) : await draw.picture(blob(), ink);
        assert.deepEqual([result.width, result.height], [1200, 75]);
        assert.deepEqual(h.canvases[0].lines, [['moveTo', 600, 30], ['lineTo', 900, 60]]);
        assert.deepEqual(h.canvases[0].widths, [4.5]);
      } finally { await pdf?.close(); }
    });
  }
}

test('手書きの紙は切り出した高さによらず、縦横とも横の比で描く', async (t) => {
  const h = setup(t), draw = h.create();
  const result = await draw.ink({ v: 1, h: 400, s: [{ c: 0, w: 0, p: [100, 100, 200, 200] }] });
  assert.deepEqual([result.width, result.height], [800, 127]);
  assert.deepEqual(h.canvases[0].lines, [['moveTo', 100, 13.5], ['lineTo', 200, 113.5]]);
  assert.deepEqual(h.canvases[0].widths, [3]);
});

test('PDF を開く途中で dispose しても、開いて閉じ終わるまで別の部品は開かない', async (t) => {
  const opening = deferred(), closing = deferred(), events = [];
  t.after(() => { opening.resolve(); closing.resolve(); });
  const h = setup(t);
  const first = h.create(async () => {
    events.push('open1'); await opening.promise;
    return { ...h.sourcePdf(), close: async () => { events.push('close1'); await closing.promise; events.push('closed1'); } };
  });
  const pending = first.openPdf(blob());
  const aborted = assert.rejects(pending, { name: 'AbortError' });
  await settle(); assert.deepEqual(events, ['open1']);
  assert.equal(first.dispose(), undefined);
  const second = h.create(async () => { events.push('open2'); return h.sourcePdf(); });
  const next = second.openPdf(blob());
  await settle(); assert.deepEqual(events, ['open1']);
  opening.resolve(); await settle(); assert.deepEqual(events, ['open1', 'close1']);
  closing.resolve(); await aborted;
  const pdf = await next;
  assert.deepEqual(events, ['open1', 'close1', 'closed1', 'open2']);
  await pdf.close();
});

for (const sameDraw of [false, true]) {
  test(`PDF の開く途中・開いている間・閉じる途中を含めて最大 1 つ（${sameDraw ? '同じ' : '別の'}部品）`, async (t) => {
    const opening = deferred(), closing = deferred();
    t.after(() => { opening.resolve(); closing.resolve(); });
    let active = 0, maximum = 0, opened = 0, closed = 0;
    const h = setup(t, { openPdf: async () => {
      const number = ++opened;
      active++; maximum = Math.max(maximum, active);
      if (number === 1) await opening.promise;
      return { ...h.sourcePdf(), close: async () => {
        closed++;
        if (number === 1) await closing.promise;
        active--;
      } };
    } });
    const first = h.create(), second = sameDraw ? first : h.create();
    const pending = first.openPdf(blob()), next = second.openPdf(blob());
    await settle(); assert.equal(opened, 1); assert.equal(active, 1);
    opening.resolve(); const pdf = await pending;
    await settle(); assert.equal(opened, 1);
    const close = pdf.close(); assert.equal(pdf.close(), close);
    await settle(); assert.equal(closed, 1); assert.equal(opened, 1); assert.equal(active, 1);
    closing.resolve(); await close;
    const pdf2 = await next;
    assert.equal(opened, 2); assert.equal(maximum, 1); assert.equal(active, 1);
    await pdf2.close(); assert.equal(active, 0); assert.equal(closed, 2);
  });
}

for (const duringOpen of [false, true]) {
  test(`PDF の${duringOpen ? '開く途中で中止したあとの' : ''}閉じる処理が失敗しても次を開ける`, async (t) => {
    const opening = deferred(), closing = deferred(), events = [], error = new Error('確認用の失敗');
    t.after(() => { opening.resolve(); closing.resolve(); });
    const h = setup(t), first = h.create(async () => {
      events.push('open1');
      if (duringOpen) await opening.promise;
      return { ...h.sourcePdf(), close: () => { events.push('close1'); return closing.promise; } };
    });
    const pending = first.openPdf(blob());
    const failed = duringOpen ? assert.rejects(pending, error) : null;
    const pdf = duringOpen ? null : await pending;
    await settle(); first.dispose();
    const closeFailed = pdf ? assert.rejects(pdf.close(), error) : failed;
    const second = h.create(async () => { events.push('open2'); return h.sourcePdf(); });
    const next = second.openPdf(blob());
    opening.resolve(); await settle(); assert.deepEqual(events, ['open1', 'close1']);
    closing.reject(error); await closeFailed;
    const pdf2 = await next;
    assert.deepEqual(events, ['open1', 'close1', 'open2']);
    await pdf2.close();
  });
}

for (const failure of ['ファイルの読みこみ', 'PDF を開く', 'PDF を閉じる']) {
  test(`${failure}が同期的に失敗しても待ち列は止まらない`, async (t) => {
    const h = setup(t), error = new Error('確認用の失敗');
    const first = h.create(() => {
      if (failure === 'PDF を開く') throw error;
      return { ...h.sourcePdf(), close() { throw error; } };
    });
    const input = failure === 'ファイルの読みこみ' ? { arrayBuffer() { throw error; } } : blob();
    const pending = first.openPdf(input), next = h.create().openPdf(blob());
    if (failure === 'PDF を閉じる') {
      const pdf = await pending;
      await assert.rejects(pdf.close(), error);
    } else await assert.rejects(pending, error);
    const pdf = await next; await pdf.close();
  });
}

test('待っている間に dispose した PDF は開かず、その次の部品へ進む', async (t) => {
  const h = setup(t), first = h.create(), pdf = await first.openPdf(blob());
  let opened = 0;
  const second = h.create(async () => { opened++; return h.sourcePdf(); });
  const pending = second.openPdf(blob()), aborted = assert.rejects(pending, { name: 'AbortError' });
  second.dispose();
  const next = h.create().openPdf(blob());
  await pdf.close(); await aborted;
  const pdf2 = await next; assert.equal(opened, 0); await pdf2.close();
});

test('dispose で写真・手書き・PDF ページの全 URL を一度だけ破棄する', async (t) => {
  const h = setup(t), draw = h.create();
  await draw.picture(blob(), null);
  await draw.ink({ v: 1, h: 400, s: [{ c: 0, w: 0, p: [100, 100, 200, 200] }] });
  const pdf = await draw.openPdf(blob()); await pdf.page(1, null);
  assert.equal(h.made.length, 3);
  draw.dispose(); draw.dispose(); await pdf.close();
  assert.deepEqual(h.revoked, h.made);
  assert.ok(h.canvases.every((canvas) => canvas.width === 0 && canvas.height === 0));
});
