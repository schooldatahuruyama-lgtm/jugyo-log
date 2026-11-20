// 書き出し用の JPEG と PDF。画面を離れたあとの生成結果も残さない。
import { inkCrop } from './export-logic.js';
import { fitSize } from './image.js';

// 作り直した部品でも、前の PDF が閉じ終わるまで次を開かない。
let pdfQueue = Promise.resolve();

export function createExportDraw({ document, URL, createImageBitmap, openPdf, config }) {
  const urls = new Set(), pdfs = new Set(), imageLoads = new Set();
  let disposed = false;
  const check = () => { if (disposed) throw Object.assign(new Error('読みこみをやめました。'), { name: 'AbortError' }); };
  function revoke(url) { if (urls.delete(url)) URL.revokeObjectURL(url); }
  function objectUrl(blob) { check(); const url = URL.createObjectURL(blob); urls.add(url); return url; }
  function strokes(canvas, ink, top = 0, picture = false) {
    if (!ink) return;
    const g = canvas.getContext('2d');
    const ratio = canvas.width / config.ink.width;
    const ratioY = picture && Number.isFinite(ink.h) && ink.h > 0 ? canvas.height / ink.h : ratio;
    g.lineCap = 'round'; g.lineJoin = 'round';
    for (const stroke of ink.s) {
      g.strokeStyle = config.ink.colors[stroke.c];
      // 写真の SVG は縦横別に伸縮するため、太さには両方の比の平均を使う。
      g.lineWidth = config.ink.widths[stroke.w] * (ratio + ratioY) / 2;
      g.beginPath();
      g.moveTo(stroke.p[0] * ratio, (stroke.p[1] - top) * ratioY);
      for (let i = 2; i < stroke.p.length; i += 2) g.lineTo(stroke.p[i] * ratio, (stroke.p[i + 1] - top) * ratioY);
      g.stroke();
    }
  }
  async function jpeg(canvas) {
    try {
      check();
      const width = canvas.width, height = canvas.height;
      const blob = await new Promise((resolve, reject) => canvas.toBlob((value) => value ? resolve(value)
        : reject(new Error('絵を作れませんでした。')), 'image/jpeg', config.export.jpegQuality));
      check();
      return { url: objectUrl(blob), width, height };
    } finally { canvas.width = canvas.height = 0; }
  }
  async function loadImage(blob) {
    check();
    if (createImageBitmap) return createImageBitmap(blob);
    return new Promise((resolve, reject) => {
      const img = document.createElement('img');
      const url = objectUrl(blob);
      const finish = (error) => {
        imageLoads.delete(cancel); revoke(url);
        img.onload = img.onerror = null;
        if (error) { img.removeAttribute('src'); reject(error); } else resolve(img);
      };
      const cancel = () => finish(Object.assign(new Error('読みこみをやめました。'), { name: 'AbortError' }));
      imageLoads.add(cancel);
      img.onload = () => finish();
      img.onerror = () => finish(new Error('写真を読みこめませんでした。'));
      img.src = url;
    });
  }
  return {
    async picture(blob, ink) {
      const image = await loadImage(blob);
      let canvas;
      try {
        check();
        const width = image.naturalWidth || image.width, height = image.naturalHeight || image.height;
        if (!(width > 0 && height > 0)) throw new Error('写真の大きさが分かりません。');
        canvas = document.createElement('canvas');
        Object.assign(canvas, fitSize(width, height, config.export.imageEdge));
        const g = canvas.getContext('2d');
        g.fillStyle = '#FFFFFF'; g.fillRect(0, 0, canvas.width, canvas.height);
        g.drawImage(image, 0, 0, canvas.width, canvas.height);
        strokes(canvas, ink, 0, true);
        return await jpeg(canvas);
      } finally {
        image.close?.();
        if (canvas) canvas.width = canvas.height = 0;
      }
    },
    async ink(ink) {
      check();
      const crop = inkCrop(ink);
      if (!crop) return null;
      const canvas = document.createElement('canvas');
      try {
        canvas.width = config.ink.width; canvas.height = Math.ceil(crop.height);
        const g = canvas.getContext('2d');
        g.fillStyle = '#FFFFFF'; g.fillRect(0, 0, canvas.width, canvas.height);
        strokes(canvas, ink, crop.top);
        return await jpeg(canvas);
      } finally { canvas.width = canvas.height = 0; }
    },
    async openPdf(blob) {
      check();
      const previous = pdfQueue;
      let release;
      pdfQueue = new Promise((resolve) => { release = resolve; });
      try {
        await previous;
        check();
        const data = await blob.arrayBuffer();
        check();
        const pdf = await openPdf(data);
        let closing = null;
        const close = () => {
          if (!closing) {
            pdfs.delete(wrapper);
            closing = Promise.resolve().then(() => pdf.close()).finally(release);
          }
          return closing;
        };
        const wrapper = {
          pageCount: pdf.pageCount,
          async page(number, ink) {
            check();
            const canvas = await pdf.renderPage(number, config.export.imageEdge);
            try { check(); strokes(canvas, ink, 0, true); return await jpeg(canvas); }
            finally { canvas.width = canvas.height = 0; }
          },
          close,
        };
        if (disposed) { await close(); check(); }
        pdfs.add(wrapper);
        return wrapper;
      } catch (error) {
        // 開く・閉じるの失敗でも、後ろの PDF を止めない。
        release();
        throw error;
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const cancel of imageLoads) cancel();
      for (const url of urls) revoke(url);
      for (const pdf of pdfs) pdf.close().catch(() => {});
    },
  };
}
