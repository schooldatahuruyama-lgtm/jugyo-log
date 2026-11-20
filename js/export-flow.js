// 授業を順に集める。書き出す内容は保存せず、絵を作る処理は draw に任せる。
import { CONFIG } from './config.js';
import { materialList } from './lesson-logic.js';
import { attachmentList, attachmentLabels, normalizeRecord } from './record-logic.js';
import { mergedTerms } from './term-logic.js';
import { linkList, linkLabel } from './link-logic.js';
import { pictureIndex } from './ink-logic.js';
import { loadInkFlow } from './ink-flow.js';
import { pageInkPlaces, pdfPagesToShow } from './export-logic.js';

const fileQueues = new WeakMap();
const abortError = () => Object.assign(new Error('読みこみをやめました。'), { name: 'AbortError' });
function checkAbort(signal) { if (signal?.aborted) throw abortError(); }

// 通信自体を止められない部品でも、画面はすぐ戻す。遅れて開いた PDF も閉じる。
function waitFor(promise, signal, late = () => {}) {
  if (!signal) return Promise.resolve(promise);
  return new Promise((resolve, reject) => {
    const abort = () => reject(abortError());
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    Promise.resolve(promise).then((value) => {
      signal.removeEventListener('abort', abort);
      if (signal.aborted) { Promise.resolve().then(() => late(value)).catch(() => {}); reject(abortError()); }
      else resolve(value);
    }, (error) => {
      signal.removeEventListener('abort', abort);
      reject(signal.aborted ? abortError() : error);
    });
  });
}

// やめて作り直した場合も、前の GAS の応答が届くまで次を呼ばない。
function readFile(files, signal, read) {
  const pending = (fileQueues.get(files) ?? Promise.resolve()).then(() => { checkAbort(signal); return read(); });
  const tail = pending.catch(() => {});
  fileQueues.set(files, tail);
  tail.then(() => { if (fileQueues.get(files) === tail) fileQueues.delete(files); });
  return waitFor(pending, signal);
}

export async function gatherLesson({ repo, files, classId, lesson, studentId, myTerms, withMaterials, draw, budget, signal }) {
  checkAbort(signal);
  const [recordResult, replyResult] = await waitFor(Promise.allSettled([
    Promise.resolve().then(() => repo.getRecord(classId, lesson.id, studentId)),
    Promise.resolve().then(() => repo.getReply(classId, lesson.id, studentId)),
  ]), signal);
  checkAbort(signal);
  const record = recordResult.status === 'fulfilled' ? recordResult.value : null;
  const reply = replyResult.status === 'fulfilled' ? replyResult.value : null;
  const materials = withMaterials ? materialList(lesson.materials) : [];
  // repo は目録を配列で返す。もう一度目録の検査を通し、余分な項目を持ち出さない。
  const attachments = attachmentList(Array.isArray(record?.attachments)
    ? Object.fromEntries(record.attachments.filter((a) => a && typeof a.slot === 'string').map((a) => [a.slot, a]))
    : record?.attachments);
  const labels = attachmentLabels(attachments);
  const result = {
    id: lesson.id, date: lesson.date, title: lesson.title,
    terms: mergedTerms(lesson, myTerms).map(({ text }) => text),
    materials: withMaterials ? materials.map(({ id, kind, type, name }) => ({ id, kind, type, name, pictures: [], skipped: 0, problem: null })) : null,
    links: withMaterials ? linkList(lesson.links).filter((link) => link.ok).map((link) => ({ label: linkLabel(link), url: link.url })) : null,
    record: record == null ? null : normalizeRecord(record, { max: CONFIG.recordTextMax }),
    recordProblem: recordResult.status === 'rejected',
    inks: { memo: null, learned: null, question: null },
    attachments: attachments.map(({ slot, type }) => ({ slot, label: labels[slot], type, pictures: [], skipped: 0, problem: null })),
    reply: reply ? { text: typeof reply.text === 'string' ? reply.text : '', seen: reply.seen === true } : null,
    replyProblem: replyResult.status === 'rejected',
  };
  const omitted = (page = null) => ({ url: null, page, problem: 'budget' });
  async function gatherPicture(item, page, index, render) {
    checkAbort(signal);
    let ink = null, problem = null;
    if (index) {
      try { ink = await readFile(files, signal, () => loadInkFlow({ files, fileId: index.fileId })); }
      catch { checkAbort(signal); problem = 'ink'; }
    }
    checkAbort(signal);
    try {
      let picture;
      try { picture = await waitFor(render(ink), signal); }
      catch (error) {
        checkAbort(signal);
        if (!ink) throw error;
        // 書きこみを重ねられなかったときも、元の絵を残す。
        picture = await waitFor(render(null), signal);
        problem = 'ink';
      }
      checkAbort(signal);
      item.pictures.push({ ...picture, page, problem });
      budget.left -= 1;
    } catch { checkAbort(signal); item.problem = item.type; }
  }
  async function gatherPdf(source, item, load) {
    if (budget.left <= 0) { item.pictures.push(omitted()); return; }
    let pdf;
    try {
      const blob = await readFile(files, signal, load);
      checkAbort(signal);
      pdf = await waitFor(draw.openPdf(blob), signal, (opened) => opened.close());
      checkAbort(signal);
      const places = pageInkPlaces(record, source.id ?? source.slot, source.fileId);
      const { pages, skipped } = pdfPagesToShow(pdf.pageCount, places.map(({ page }) => page), CONFIG.export.pdfPages);
      if (!pages.length) throw new Error('PDF にページがありません。');
      item.skipped = skipped;
      for (const page of pages) {
        checkAbort(signal);
        if (budget.left <= 0) { item.pictures.push(omitted(page)); break; }
        await gatherPicture(item, page, places.find((entry) => entry.page === page)?.index, (ink) => pdf.page(page, ink));
      }
    } catch {
      checkAbort(signal);
      item.problem = 'pdf';
    } finally {
      if (pdf) {
        try { await waitFor(Promise.resolve().then(() => pdf.close()), signal); } catch { /* 次のファイルは止めない */ }
      }
      checkAbort(signal);
    }
  }
  // 写真も PDF も、書きこみを読んで絵にしてから次のファイルへ進む。
  const photos = materials.filter((material) => material.type === 'image');
  const batch = photos.slice(0, Math.max(0, budget.left));
  let images = {};
  if (batch.length) {
    try { images = await readFile(files, signal, () => files.loadImages(classId, lesson.id, batch)); }
    catch { checkAbort(signal); }
  }
  for (const source of photos) {
    checkAbort(signal);
    const item = result.materials.find((entry) => entry.id === source.id);
    if (!batch.includes(source) || budget.left <= 0) { item.pictures.push(omitted()); continue; }
    const blob = images?.[source.id];
    if (!blob) { item.problem = 'image'; continue; }
    delete images[source.id];
    await gatherPicture(item, null, pictureIndex(record, source.id, source.fileId), (ink) => draw.picture(blob, ink));
  }
  for (const source of materials.filter((material) => material.type === 'pdf')) {
    checkAbort(signal);
    await gatherPdf(source, result.materials.find((entry) => entry.id === source.id), () => files.loadFile(classId, lesson.id, source));
  }
  for (const source of attachments) {
    checkAbort(signal);
    const item = result.attachments.find((entry) => entry.slot === source.slot);
    if (budget.left <= 0) { item.pictures.push(omitted()); continue; }
    if (source.type === 'pdf') await gatherPdf(source, item, () => files.loadStudentFile(source.fileId));
    else {
      try {
        const blob = await readFile(files, signal, () => files.loadStudentFile(source.fileId));
        await gatherPicture(item, null, pictureIndex(record, source.slot, source.fileId), (ink) => draw.picture(blob, ink));
      } catch { checkAbort(signal); item.problem = 'image'; }
    }
  }
  for (const field of CONFIG.inkFields) {
    checkAbort(signal);
    const index = record?.ink?.[field];
    if (!index) continue;
    if (budget.left <= 0) { result.inks[field] = omitted(); continue; }
    try {
      const ink = await readFile(files, signal, () => loadInkFlow({ files, fileId: index.fileId }));
      const picture = await waitFor(draw.ink(ink), signal);
      checkAbort(signal);
      if (picture) { result.inks[field] = { ...picture, page: null, problem: null }; budget.left -= 1; }
    } catch { checkAbort(signal); result.inks[field] = { url: null, problem: 'ink' }; }
  }
  checkAbort(signal);
  return result;
}

export async function exportLessons({ lessons, onProgress, ...options }) {
  const result = [];
  checkAbort(options.signal);
  onProgress?.(0, lessons.length);
  for (const lesson of lessons) {
    checkAbort(options.signal);
    result.push(await gatherLesson({ ...options, lesson, myTerms: options.myTerms?.[lesson.id] }));
    checkAbort(options.signal);
    onProgress?.(result.length, lessons.length);
  }
  return result;
}
