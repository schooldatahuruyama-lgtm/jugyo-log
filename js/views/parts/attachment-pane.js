// 生徒の写真・PDF。送れていないファイルは、この部品を開いている間だけ持つ。
import { el, confirmDialog, toast } from '../../ui.js';
import { CONFIG } from '../../config.js';
import { newId } from '../../ids.js';
import { freeSlot, attachmentLabels } from '../../record-logic.js';
import { addAttachmentFlow, settleAttachmentFlow, removeAttachmentFlow } from '../../attachment-flow.js';
import { compressImage, compressCanvas, dataUrlToBase64 } from '../../image.js';
import { openPdf } from '../../pdf.js';
import { openViewer } from './viewer.js';

// PDF は大きいので、一度に全バイトを引数に広げない。
function bufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const parts = [];
  for (let i = 0; i < bytes.length; i += 8192) parts.push(String.fromCharCode(...bytes.subarray(i, i + 8192)));
  return btoa(parts.join(''));
}

export function attachmentPane({ ctx, classId, lessonId, studentId, attachments, readOnly }) {
  let alive = true;
  let viewer = null;
  let viewedItem = null;
  let operating = false;
  const dialogs = new AbortController();
  const events = new AbortController();
  let rowEvents = new AbortController();
  const savedItem = (attachment) => ({
    slot: attachment.slot, type: attachment.type, attachment, thumb: null, state: 'saved', error: '',
  });
  const items = (Array.isArray(attachments) ? attachments : []).map(savedItem);
  const listArea = el('div');
  const message = el('p', { class: 'error attachment-message', role: 'alert' });
  const limit = el('p', { class: 'small attachment-message', role: 'status' });
  const input = el('input', { type: 'file', accept: 'image/*,application/pdf', hidden: true });
  const add = el('button', { type: 'button', class: 'btn attachment-add', text: '＋ 写真・PDF' });
  const node = el('div', { class: 'attachment-pane' }, listArea,
    readOnly ? null : [el('div', { class: 'attachment-actions' }, add, input), limit, message]);

  function availableSlot(except = null) {
    return freeSlot(items.filter((item) => item.state === 'saved').map((item) => item.attachment),
      items.filter((item) => item.state !== 'saved' && item !== except).map((item) => item.slot));
  }

  function labels() {
    // 置き場所を読み直す間は、場所のない添付が複数あっても別々に数える。
    return attachmentLabels(items.map((item, index) => ({ slot: index, type: item.type })));
  }

  function action(text, fn, props = {}) {
    const button = el('button', { type: 'button', class: 'btn', text, ...props });
    button.addEventListener('click', fn, { signal: rowEvents.signal });
    return button;
  }

  function view(item) {
    if (!alive || item.state !== 'saved' || item.removing) return;
    viewer?.close();
    viewedItem = item;
    viewer = openViewer({ title: labels()[items.indexOf(item)], kind: item.type,
      load: () => ctx.files.loadStudentFile(item.attachment.fileId) });
  }

  function render() {
    if (!alive) return;
    rowEvents.abort();
    rowEvents = new AbortController();
    const names = labels();
    listArea.replaceChildren(items.length ? el('ul', { class: 'attachment-list' }, items.map((item, index) => {
      const kind = item.type === 'pdf' ? 'PDF' : '写真';
      const preview = el('span', { class: 'attachment-preview' }, el('span', { text: kind }));
      if (typeof item.thumb === 'string' && /^data:image\/(?:jpeg|png|webp);base64,/.test(item.thumb)) {
        const image = el('img', { src: item.thumb, alt: '' });
        image.addEventListener('error', () => {
          item.thumb = null;
          preview.replaceChildren(el('span', { text: kind }));
        }, { once: true, signal: rowEvents.signal });
        preview.replaceChildren(image);
      }
      const summary = [preview, el('span', { class: 'material-name', text: names[index] })];
      const heading = item.state === 'saved'
        ? action('', () => view(item), { class: 'attachment-open', 'aria-label': `${names[index]} を開く`, disabled: item.removing })
        : el('div', { class: 'attachment-pending' });
      heading.append(...summary);
      const controls = el('div', { class: 'attachment-actions' });
      const progress = el('p', { class: 'attachment-message', role: 'status' });
      const error = el('p', { class: 'error attachment-message', role: 'alert', text: item.error });
      if (item.state === 'sending') progress.textContent = '送っています…';
      if (!readOnly && item.state === 'saved') {
        controls.append(action('消す', () => remove(item), {
          class: 'btn btn-danger-text', disabled: operating, 'aria-label': `${names[index]} を消す`,
        }));
        if (item.removing) progress.textContent = item.confirming ? '消すか確かめています…' : '消しています…';
      }
      if (!readOnly && item.state === 'failed') {
        const slotAvailable = item.slot && !items.some((entry) => entry.state === 'saved' && entry.slot === item.slot);
        const canRetry = item.needsRefresh || slotAvailable || availableSlot();
        if (item.retryable && canRetry) controls.append(action('やり直す', () => send(item), { disabled: operating }));
        if (!canRetry) progress.textContent = '写真・PDF は 6 個までです。';
        if (item.settling) progress.textContent = '確かめています…';
        controls.append(action('やめる', () => cancel(item), { disabled: operating }));
      }
      return el('li', { class: 'attachment-item' }, heading, progress, error, controls);
    })) : el('p', { text: '（まだありません）' }));
    add.disabled = operating || !availableSlot();
    input.disabled = add.disabled;
    limit.textContent = operating ? '終わるまで、少し待ってください。'
      : add.disabled ? '写真・PDF は 6 個までです。' : '';
  }

  async function loadThumbs() {
    const initial = items.filter((item) => item.state === 'saved');
    if (!initial.length) return;
    try {
      const thumbs = await ctx.repo.getRecThumbs(classId, lessonId, studentId);
      if (!alive) return;
      for (const item of initial) {
        // 読む間に消して同じ場所に足した場合、新しい添付の画像は変えない。
        if (items.includes(item)) item.thumb = thumbs?.[item.slot] ?? null;
      }
      render();
    } catch { /* 小さい画像がなくても、種類の文字から本体を開ける */ }
  }

  async function prepare(item) {
    if (item.prepared) return item.prepared;
    if (item.type === 'image') {
      try {
        const image = await compressImage(item.file, { maxEdge: CONFIG.image.maxEdge, maxBytes: CONFIG.image.maxChars });
        if (!alive) return null;
        const thumb = await compressImage(item.file, { maxEdge: CONFIG.thumb.maxEdge, maxBytes: CONFIG.thumb.maxChars });
        return { mime: 'image/jpeg', dataB64: dataUrlToBase64(image), thumb };
      } catch {
        const error = new Error('この写真は読みこめませんでした。');
        error.code = 'unreadable-image';
        throw error;
      }
    }
    const buffer = await item.file.arrayBuffer();
    if (!alive) return null;
    const dataB64 = bufferToBase64(buffer);
    let thumb = null;
    let pdf = null;
    try {
      pdf = await openPdf(buffer);
      if (!alive) return null;
      item.pdf = pdf;
      const canvas = await pdf.renderPage(1, CONFIG.thumb.maxEdge);
      if (alive) thumb = compressCanvas(canvas, { maxBytes: CONFIG.thumb.maxChars });
    } catch { /* こわれた PDF も、小さい画像なしで送る */ }
    finally {
      if (pdf) await pdf.close();
      item.pdf = null;
    }
    return { mime: 'application/pdf', dataB64, thumb };
  }

  function reconcileAttachments(attachments, previous) {
    const saved = attachments.map((attachment) => previous.find((entry) =>
      entry.slot === attachment.slot && entry.attachment.fileId === attachment.fileId) || savedItem(attachment));
    // 読む間に送信が終わった添付も残す。
    for (const entry of items.filter((entry) => entry.state === 'saved' && !previous.includes(entry))) {
      const index = saved.findIndex((other) => other.slot === entry.slot);
      if (index < 0) saved.push(entry); else saved[index] = entry;
    }
    saved.sort((a, b) => (a.attachment.addedAt - b.attachment.addedAt) || a.slot.localeCompare(b.slot));
    if (viewedItem && !saved.includes(viewedItem)) { viewer?.close(); viewer = null; viewedItem = null; }
    // 応答待ち・応答を失った添付も、保存済みなら 1 つにまとめる。
    const savedIds = new Set(saved.map((entry) => entry.attachment.fileId));
    const pending = items.filter((entry) => entry.state !== 'saved'
      && !(typeof entry.fileId === 'string' && savedIds.has(entry.fileId)));
    items.splice(0, items.length, ...saved, ...pending);
    for (const entry of pending) {
      if (!entry.needsRefresh) continue;
      entry.needsRefresh = false;
      entry.slot = availableSlot(entry);
    }
    void loadThumbs();
  }

  async function refreshAttachments() {
    const previous = items.filter((entry) => entry.state === 'saved');
    const record = await ctx.repo.getRecord(classId, lessonId, studentId);
    if (!alive) return;
    reconcileAttachments(Array.isArray(record?.attachments) ? record.attachments : [], previous);
  }

  async function send(item) {
    if (!alive || readOnly || operating || item.settling || !items.includes(item) || !['pending', 'failed'].includes(item.state)) return;
    operating = true;
    try {
      item.state = 'sending';
      item.error = '';
      render();
      if (item.needsRefresh) await refreshAttachments();
      if (!alive || !items.includes(item)) return;
      if (!item.slot) item.slot = availableSlot(item);
      if (!item.slot) { item.state = 'failed'; item.error = '送れませんでした'; return; }
      const prepared = await prepare(item);
      if (!alive || !items.includes(item) || !prepared) return;
      item.prepared = prepared;
      item.thumb = prepared.thumb;
      render();
      // 応答を失っても、受け取れたファイル ID は「やめる」の片付けに使う。
      const mayBeRegistered = typeof item.fileId === 'string' && !!item.fileId;
      const files = {
        async uploadStudent(args) {
          const uploaded = await ctx.files.uploadStudent(args);
          item.fileId = uploaded.fileId;
          return uploaded;
        },
        async trashStudent(fileId) {
          // 再送中に離れた場合も、前の登録が反映済みなら残す。
          if (!alive && mayBeRegistered) {
            await settleAttachmentFlow({ repo: ctx.repo, files: ctx.files,
              classId, lessonId, studentId, fileId });
            return;
          }
          return ctx.files.trashStudent(fileId);
        },
      };
      const { fileId } = await addAttachmentFlow({ repo: ctx.repo, files, classId, lessonId, studentId,
        slot: item.slot, key: item.key, type: item.type, ...prepared, now: item.addedAt,
        isCancelled: () => !alive });
      if (!alive || !items.includes(item)) return;
      if (items.some((entry) => entry.state === 'saved' && entry.attachment.fileId === fileId)) { forget(item); return; }
      item.attachment = { slot: item.slot, type: item.type, fileId, addedAt: item.addedAt };
      item.state = 'saved';
      item.prepared = null;
      item.file = null;
    } catch (error) {
      if (!alive || !items.includes(item)) return;
      if (error?.code === 'slot-taken') {
        item.fileId = null;
        item.key = newId(ctx.random, 24);
        item.slot = null;
        item.needsRefresh = true;
        try { await refreshAttachments(); } catch { /* 読み直せるまでは、次の送信も読み直しから始める */ }
        if (!alive || !items.includes(item)) return;
      }
      // 読み直した時点で ID がまだ不明でも、後から分かったら保存済みにまとめる。
      if (typeof item.fileId === 'string' && items.some((entry) => entry.state === 'saved'
        && entry.attachment.fileId === item.fileId)) { forget(item); return; }
      item.state = 'failed';
      item.retryable = error?.code !== 'unreadable-image';
      item.error = error?.code === 'unreadable-image' ? 'この写真は読みこめませんでした。'
        : error?.code === 'toobig' ? '送れませんでした。ファイルが大きすぎます。' : '送れませんでした';
      if (!item.retryable) item.file = null;
    } finally {
      operating = false;
      if (alive) render();
    }
  }

  function forget(item) {
    const index = items.indexOf(item);
    if (index < 0) return;
    items.splice(index, 1);
    item.file = null;
    item.prepared = null;
    item.thumb = null;
    render();
  }

  async function cancel(item) {
    if (!alive || readOnly || operating || item.settling || !items.includes(item) || item.state !== 'failed') return;
    operating = true;
    try {
      item.settling = true;
      item.error = '';
      render();
      const previous = items.filter((entry) => entry.state === 'saved');
      const { saved, attachments } = await settleAttachmentFlow({ repo: ctx.repo, files: ctx.files,
        classId, lessonId, studentId, fileId: item.fileId });
      if (!alive) return;
      reconcileAttachments(attachments, previous);
      forget(item);
      if (saved) toast(item.type === 'pdf' ? 'この PDF は、もう保存されていました。' : 'この写真は、もう保存されていました。');
    } catch {
      if (alive) item.error = '確かめられませんでした。もう一度ためしてください。';
    } finally {
      operating = false;
      item.settling = false;
      if (alive) render();
    }
  }

  function choose() {
    if (!alive) return;
    const file = input.files?.[0];
    input.value = '';
    if (readOnly || operating || !file) return;
    message.textContent = '';
    const type = file.type.startsWith('image/') ? 'image' : file.type === 'application/pdf' ? 'pdf' : null;
    if (!type) { message.textContent = '写真か PDF だけを足せます。'; return; }
    if (type === 'pdf' && file.size > CONFIG.pdfMaxBytes) { message.textContent = 'PDF は 10MB までです。'; return; }
    const slot = availableSlot();
    if (!slot) { message.textContent = '写真・PDF は 6 個までです。'; return; }
    const item = { slot, type, key: newId(ctx.random, 24), addedAt: ctx.now(), file,
      prepared: null, thumb: null, state: 'pending', error: '', retryable: true };
    items.push(item);
    void send(item);
  }

  async function remove(item) {
    if (!alive || readOnly || operating || item.state !== 'saved' || !items.includes(item)) return;
    operating = true;
    try {
      item.removing = true;
      item.confirming = true;
      item.error = '';
      render();
      const ok = await confirmDialog({ title: item.type === 'pdf' ? 'この PDF を消しますか？' : 'この写真を消しますか？',
        body: '消すと元にもどせません。', okLabel: '消す', danger: true, signal: dialogs.signal });
      if (!ok || !alive) return;
      item.confirming = false;
      render();
      const result = await removeAttachmentFlow({ repo: ctx.repo, files: ctx.files, classId, lessonId, studentId,
        attachment: item.attachment });
      if (!alive) return;
      if (viewedItem === item) { viewer?.close(); viewer = null; viewedItem = null; }
      const index = items.indexOf(item);
      if (index >= 0) items.splice(index, 1);
      item.thumb = null;
      if (!result.trashed) message.textContent = '一覧から外しましたが、ファイルの片付けはできませんでした。';
    } catch {
      if (alive) item.error = '消せませんでした。もう一度ためしてください。';
    } finally {
      operating = false;
      item.removing = false;
      item.confirming = false;
      if (alive) render();
    }
  }

  if (!readOnly) {
    add.addEventListener('click', () => { if (alive && !operating && availableSlot()) input.click(); }, { signal: events.signal });
    input.addEventListener('change', choose, { signal: events.signal });
  }
  render();
  void loadThumbs();
  return {
    node,
    get busy() { return items.some((item) => item.state !== 'saved'); },
    destroy() {
      if (!alive) return;
      alive = false;
      dialogs.abort();
      events.abort();
      rowEvents.abort();
      viewer?.close();
      viewer = null;
      viewedItem = null;
      for (const item of items) {
        if (item.pdf) void item.pdf.close();
        item.file = null;
        item.prepared = null;
        item.thumb = null;
      }
      items.length = 0;
      input.value = '';
      node.replaceChildren();
    },
  };
}
