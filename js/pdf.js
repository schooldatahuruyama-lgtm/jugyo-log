// PDF の部品は、初めて開くときだけ自分のサイトから読みこむ。
import { fitSize } from './image.js';

let library = null;

function pdfError(code) {
  const error = new Error(code === 'load-failed' ? 'PDF の部品を読みこめませんでした' : 'PDF を開けませんでした');
  error.code = code;
  return error;
}

function failureCode(error) {
  if (/worker|fetch|import|load.*(?:data|module)|network/i.test(error?.message || '')) return 'load-failed';
  return 'broken';
}

async function loadLibrary() {
  if (!library) library = import('./lib/pdfjs/pdf.min.mjs').catch(() => {
    library = null;
    throw pdfError('load-failed');
  });
  return library;
}

export async function openPdf(data) {
  if (!(data instanceof ArrayBuffer) || data.byteLength === 0) throw pdfError('broken');
  const pdfjs = await loadLibrary();
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('./lib/pdfjs/pdf.worker.min.mjs', import.meta.url).href;
  let worker = null;
  let task = null;
  let closed = false;
  const renders = new Set();

  async function close() {
    if (closed) return;
    closed = true;
    for (const render of renders) render.cancel();
    try { await task?.destroy(); } catch { /* 開く途中の失敗でも、worker は片付ける */ }
    finally { worker?.destroy(); }
  }

  try {
    worker = new pdfjs.PDFWorker();
    await worker.promise;
  } catch {
    await close();
    throw pdfError('load-failed');
  }

  let pdf;
  try {
    task = pdfjs.getDocument({
      data: new Uint8Array(data.slice(0)), worker,
      cMapUrl: new URL('./lib/pdfjs/cmaps/', import.meta.url).href,
      cMapPacked: true,
      standardFontDataUrl: new URL('./lib/pdfjs/standard_fonts/', import.meta.url).href,
      wasmUrl: new URL('./lib/pdfjs/wasm/', import.meta.url).href,
      isEvalSupported: false, stopAtErrors: true,
    });
    pdf = await task.promise;
  } catch (error) {
    await close();
    throw pdfError(failureCode(error));
  }

  return {
    pageCount: pdf.numPages,
    async renderPage(pageNo, maxEdge) {
      if (closed || !Number.isInteger(pageNo) || pageNo < 1 || pageNo > pdf.numPages
        || !Number.isFinite(maxEdge) || maxEdge < 1) throw pdfError('broken');
      let page = null;
      let render = null;
      try {
        page = await pdf.getPage(pageNo);
        if (closed) throw pdfError('broken');
        const original = page.getViewport({ scale: 1 });
        // PDF の座標は画素ではないので、表示用の長辺まで拡大してから描く。
        const scale = maxEdge / Math.max(original.width, original.height);
        const size = fitSize(original.width * scale, original.height * scale, maxEdge);
        const viewport = page.getViewport({ scale: Math.min(size.width / original.width, size.height / original.height) });
        const canvas = document.createElement('canvas');
        canvas.width = size.width;
        canvas.height = size.height;
        render = page.render({ canvasContext: canvas.getContext('2d'), viewport, background: '#FFFFFF' });
        renders.add(render);
        await render.promise;
        if (closed) throw pdfError('broken');
        return canvas;
      } catch (error) {
        throw pdfError(failureCode(error));
      } finally {
        if (render) renders.delete(render);
        page?.cleanup();
      }
    },
    close,
  };
}
