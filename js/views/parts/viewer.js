// 先生・生徒の画面で共通の、写真と PDF の大きな表示。
import { el } from '../../ui.js';
import { openPdf } from '../../pdf.js';

export function openViewer({ title, kind, load }) {
  const opener = document.activeElement;
  let closed = false;
  let generation = 0;
  let url = null;
  let pdf = null;
  let picture = null;
  let cancelImage = null;
  let zoom = 1;
  let pageNo = 1;
  let busy = false;
  let drag = null;

  const dlg = el('dialog', { class: 'material-viewer', 'aria-label': title });
  const stage = el('div', { class: 'viewer-stage' });
  const viewport = el('div', { class: 'viewer-viewport', tabindex: '0', 'aria-label': '資料の表示。大きな画像は動かせます。' }, stage);
  const message = el('div', { class: 'viewer-message', role: 'status', 'aria-live': 'polite' });
  const minus = el('button', { type: 'button', class: 'btn', text: '－', 'aria-label': '縮小する', onclick: () => changeZoom(-0.25) });
  const plus = el('button', { type: 'button', class: 'btn', text: '＋', 'aria-label': '拡大する', onclick: () => changeZoom(0.25) });
  const zoomLabel = el('span', { class: 'viewer-counter', 'aria-live': 'polite' });
  const previous = el('button', { type: 'button', class: 'btn', text: '前のページ', onclick: () => showPage(pageNo - 1) });
  const next = el('button', { type: 'button', class: 'btn', text: '次のページ', onclick: () => showPage(pageNo + 1) });
  const pageLabel = el('span', { class: 'viewer-counter', 'aria-live': 'polite' });
  const closeBtn = el('button', { type: 'button', class: 'btn', text: '閉じる', onclick: close });
  dlg.append(
    el('header', { class: 'viewer-header' }, el('h2', { text: title }), closeBtn),
    el('div', { class: 'viewer-controls' }, kind === 'pdf' ? [previous, pageLabel, next] : [minus, zoomLabel, plus]),
    message, viewport);

  function syncControls() {
    minus.disabled = busy || !picture || zoom <= 1;
    plus.disabled = busy || !picture || zoom >= 4;
    zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
    previous.disabled = busy || !pdf || pageNo <= 1;
    next.disabled = busy || !pdf || pageNo >= pdf.pageCount;
    pageLabel.textContent = pdf ? `${pageNo} / ${pdf.pageCount}` : '';
  }

  function sizePicture() {
    if (!picture || !picture.naturalWidth || closed) return;
    const scale = Math.min(1, Math.max(1, viewport.clientWidth - 16) / picture.naturalWidth,
      Math.max(1, viewport.clientHeight - 16) / picture.naturalHeight);
    picture.style.width = `${Math.round(picture.naturalWidth * scale * zoom)}px`;
    picture.style.height = `${Math.round(picture.naturalHeight * scale * zoom)}px`;
    viewport.classList.toggle('viewer-can-drag', zoom > 1);
  }

  function changeZoom(delta) {
    if (busy || !picture) return;
    const ratio = Math.max(1, Math.min(4, zoom + delta)) / zoom;
    const x = (viewport.scrollLeft + viewport.clientWidth / 2) * ratio;
    const y = (viewport.scrollTop + viewport.clientHeight / 2) * ratio;
    zoom = Math.max(1, Math.min(4, zoom + delta));
    sizePicture();
    viewport.scrollLeft = x - viewport.clientWidth / 2;
    viewport.scrollTop = y - viewport.clientHeight / 2;
    syncControls();
  }

  function clearContent() {
    cancelImage?.();
    cancelImage = null;
    if (picture) {
      picture.onload = null;
      picture.onerror = null;
      picture.removeAttribute('src');
      picture = null;
    }
    if (url) URL.revokeObjectURL(url);
    url = null;
    if (pdf) void pdf.close();
    pdf = null;
    stage.replaceChildren();
    viewport.classList.remove('viewer-can-drag');
    drag = null;
  }

  function showError() {
    clearContent();
    message.replaceChildren(
      el('p', { text: '開けませんでした。もう一度ためしてください。' }),
      el('button', { type: 'button', class: 'btn', text: 'もう一度', onclick: start }));
  }

  async function showPage(number) {
    if (closed || busy || !pdf || number < 1 || number > pdf.pageCount) return;
    const current = generation;
    busy = true;
    message.textContent = '読みこんでいます…';
    syncControls();
    try {
      const canvas = await pdf.renderPage(number, 1600);
      if (closed || current !== generation) return;
      canvas.className = 'viewer-pdf';
      canvas.setAttribute('role', 'img');
      canvas.setAttribute('aria-label', `${title} ${number} ページ`);
      stage.replaceChildren(canvas);
      pageNo = number;
      viewport.scrollTop = 0;
      viewport.scrollLeft = 0;
      message.replaceChildren();
    } catch {
      if (!closed && current === generation) showError();
    } finally {
      if (!closed && current === generation) { busy = false; syncControls(); }
    }
  }

  async function start() {
    if (closed || busy) return;
    const current = ++generation;
    clearContent();
    busy = true;
    zoom = 1;
    pageNo = 1;
    message.textContent = '読みこんでいます…';
    syncControls();
    try {
      const blob = await load();
      if (closed || current !== generation) return;
      if (!(blob instanceof Blob)) throw new Error('資料がありません');
      if (kind === 'pdf') {
        const data = await blob.arrayBuffer();
        if (closed || current !== generation) return;
        const opened = await openPdf(data);
        if (closed || current !== generation) { void opened.close(); return; }
        pdf = opened;
        busy = false;
        await showPage(1);
      } else {
        url = URL.createObjectURL(blob);
        picture = el('img', { alt: title, draggable: 'false' });
        stage.replaceChildren(picture);
        await new Promise((resolve, reject) => {
          cancelImage = () => reject(new Error('表示を閉じました'));
          picture.onload = resolve;
          picture.onerror = () => reject(new Error('画像を開けませんでした'));
          picture.src = url;
        });
        if (closed || current !== generation) return;
        cancelImage = null;
        picture.onload = null;
        picture.onerror = null;
        message.replaceChildren();
        sizePicture();
        viewport.scrollTop = 0;
        viewport.scrollLeft = 0;
      }
    } catch {
      if (!closed && current === generation) showError();
    } finally {
      if (!closed && current === generation) { busy = false; syncControls(); }
    }
  }

  // 指はブラウザのスクロール、マウスとペンはドラッグで動かす。
  viewport.addEventListener('pointerdown', (ev) => {
    if (!picture || zoom <= 1 || ev.pointerType === 'touch' || ev.button !== 0) return;
    drag = { id: ev.pointerId, x: ev.clientX, y: ev.clientY, left: viewport.scrollLeft, top: viewport.scrollTop };
    viewport.setPointerCapture(ev.pointerId);
    ev.preventDefault();
  });
  viewport.addEventListener('pointermove', (ev) => {
    if (!drag || drag.id !== ev.pointerId) return;
    viewport.scrollLeft = drag.left + drag.x - ev.clientX;
    viewport.scrollTop = drag.top + drag.y - ev.clientY;
  });
  const endDrag = () => { drag = null; };
  viewport.addEventListener('pointerup', endDrag);
  viewport.addEventListener('pointercancel', endDrag);
  viewport.addEventListener('lostpointercapture', endDrag);
  dlg.addEventListener('cancel', (ev) => { ev.preventDefault(); close(); });
  dlg.addEventListener('close', close);
  window.addEventListener('resize', sizePicture);

  function close() {
    if (closed) return;
    closed = true;
    generation += 1;
    clearContent();
    window.removeEventListener('resize', sizePicture);
    if (dlg.open) dlg.close();
    dlg.remove();
    if (opener?.isConnected && typeof opener.focus === 'function') opener.focus();
  }

  document.body.append(dlg);
  dlg.showModal();
  closeBtn.focus();
  start();
  return { close };
}
