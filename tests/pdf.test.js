import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pdfThumb } from '../js/pdf.js';

const thumb = 'data:image/jpeg;base64,AAAA';

function fakePdf(urlFor) {
  const calls = [];
  return {
    calls,
    async renderPage(page, edge) {
      calls.push([page, edge]);
      return { toDataURL: () => urlFor(edge) };
    },
  };
}

test('pdfThumb: 1 回目で上限ちょうどに収まれば、1 回だけ描く', async () => {
  const pdf = fakePdf(() => thumb);
  assert.equal(await pdfThumb(pdf, { maxEdge: 320, maxBytes: thumb.length }), thumb);
  assert.deepEqual(pdf.calls, [[1, 320]]);
});

test('pdfThumb: 2 回収まらなければ、320・240・180 の順に描き直す', async () => {
  const pdf = fakePdf((edge) => edge > 180 ? thumb + 'AAAA' : thumb);
  assert.equal(await pdfThumb(pdf, { maxEdge: 320, maxBytes: thumb.length }), thumb);
  assert.deepEqual(pdf.calls, [[1, 320], [1, 240], [1, 180]]);
});

test('pdfThumb: ずっと収まらなければ null を返し、長辺 64 未満では描かない', async () => {
  const pdf = fakePdf(() => thumb + 'AAAA');
  assert.equal(await pdfThumb(pdf, { maxEdge: 320, maxBytes: thumb.length }), null);
  assert.deepEqual(pdf.calls, [[1, 320], [1, 240], [1, 180], [1, 135], [1, 101], [1, 75]]);
});

test('pdfThumb: 長辺 64 は描き、最初から 64 未満なら描かない', async () => {
  const pdf = fakePdf(() => thumb);
  assert.equal(await pdfThumb(pdf, { maxEdge: 64, maxBytes: thumb.length }), thumb);
  assert.deepEqual(pdf.calls, [[1, 64]]);
  pdf.calls.length = 0;
  assert.equal(await pdfThumb(pdf, { maxEdge: 63.9, maxBytes: thumb.length }), null);
  assert.deepEqual(pdf.calls, []);
  assert.equal(await pdfThumb(pdf, { maxEdge: 64, maxBytes: thumb.length - 1 }), null);
  assert.deepEqual(pdf.calls, [[1, 64]]);
});

test('pdfThumb: 正の有限の小数も受けつける', async () => {
  const pdf = fakePdf(() => thumb);
  assert.equal(await pdfThumb(pdf, { maxEdge: 320.5, maxBytes: thumb.length + 0.5 }), thumb);
  assert.deepEqual(pdf.calls, [[1, 320.5]]);
});

test('pdfThumb: renderPage の例外は、描き直しの途中でもそのまま投げる', async () => {
  for (const failAt of [1, 2]) {
    const error = new Error('描けません');
    let calls = 0;
    const pdf = { async renderPage() {
      if (++calls === failAt) throw error;
      return { toDataURL: () => thumb + 'AAAA' };
    } };
    await assert.rejects(pdfThumb(pdf, { maxEdge: 320, maxBytes: thumb.length }), (e) => e === error);
    assert.equal(calls, failAt);
  }
});

test('pdfThumb: compressCanvas の例外はそのまま投げる', async () => {
  const error = new Error('JPEG にできません');
  const pdf = fakePdf(() => { throw error; });
  await assert.rejects(pdfThumb(pdf, { maxEdge: 320, maxBytes: thumb.length }), (e) => e === error);
  assert.deepEqual(pdf.calls, [[1, 320]]);
});

test('pdfThumb: maxEdge・maxBytes が正の有限の数でなければ、描く前に TypeError', async () => {
  const pdf = fakePdf(() => thumb);
  for (const key of ['maxEdge', 'maxBytes']) {
    for (const value of [undefined, null, false, true, '', '320', 0, -1, NaN, Infinity, -Infinity, {}, [], 320n]) {
      await assert.rejects(pdfThumb(pdf, { maxEdge: 320, maxBytes: thumb.length, [key]: value }), TypeError);
    }
  }
  assert.deepEqual(pdf.calls, []);
});
