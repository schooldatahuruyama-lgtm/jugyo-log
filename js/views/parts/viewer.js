// 先生・生徒の画面で共通の、写真と PDF の大きな表示。
import { el } from '../../ui.js';
import { openPdf } from '../../pdf.js';
import { clampZoom, pinchZoom, nextZoom, zoomScroll } from '../../zoom-logic.js';

export function openViewer({ title, kind, load, pictureInk = null, pageInk = null }) {
  const opener = document.activeElement;
  let closed = false;
  let generation = 0;
  let url = null;
  let pdf = null;
  let picture = null;
  let pictureSize = null;
  const pdfPages = new Map();
  let sharpTimer = null;
  let sharpPage = null;
  let pinch = null;
  let gesture = false;
  const touchIds = new Set();
  let cancelImage = null;
  let zoom = 1;
  let pageNo = 1;
  let busy = false;
  let drag = null;
  let writing = false;
  let toolState = null;
  let ink = null;
  let unsubscribeInk = null;

  const dlg = el('dialog', { class: 'material-viewer', 'aria-label': title });
  const stage = el('div', { class: 'viewer-stage' });
  const pictureFrame = el('div', { class: 'viewer-picture' });
  const inkArea = el('div', { class: 'viewer-ink', hidden: true });
  const viewport = el('div', { class: 'viewer-viewport', tabindex: '0', 'aria-label': '資料の表示。大きな画像は動かせます。' }, stage);
  const message = el('div', { class: 'viewer-message', role: 'status', 'aria-live': 'polite' });
  const minus = el('button', { type: 'button', class: 'btn', text: '－', 'aria-label': '縮小する', onclick: () => changeZoom(-0.25) });
  const plus = el('button', { type: 'button', class: 'btn', text: '＋', 'aria-label': '拡大する', onclick: () => changeZoom(0.25) });
  const zoomLabel = el('span', { class: 'viewer-counter', 'aria-live': 'polite' });
  const previous = el('button', { type: 'button', class: 'btn', text: '前のページ', onclick: () => showPage(pageNo - 1) });
  const next = el('button', { type: 'button', class: 'btn', text: '次のページ', onclick: () => showPage(pageNo + 1) });
  const pageLabel = el('span', { class: 'viewer-counter', 'aria-live': 'polite' });
  const closeBtn = el('button', { type: 'button', class: 'btn', text: '閉じる', onclick: close });
  const writeBtn = el('button', { type: 'button', class: 'btn viewer-write', text: '✎ 書きこむ', hidden: true,
    'aria-pressed': 'false', onclick: () => {
      if (!ink?.editable) return;
      writing = !writing;
      drag = null;
      ink.setEditing(writing);
      syncInk();
      sizePicture();
    } });
  dlg.append(
    el('header', { class: 'viewer-header' }, el('h2', { text: title }), closeBtn),
    el('div', { class: 'viewer-controls' }, kind === 'pdf'
      ? [previous, pageLabel, next, minus, zoomLabel, plus, pageInk ? writeBtn : null] : [minus, zoomLabel, plus, writeBtn]),
    message, inkArea, viewport);

  function syncInk() {
    if (closed) return;
    if (kind !== 'pdf' && writing && !ink?.editable) { writing = false; ink?.setEditing(false); }
    writeBtn.hidden = !ink || ink.readOnly;
    writeBtn.disabled = busy || !ink?.editable;
    writeBtn.setAttribute('aria-pressed', String(writing));
    viewport.classList.toggle('viewer-can-drag', !!picture && (kind === 'pdf' || zoom > 1) && !writing && !busy);
  }

  function syncControls() {
    minus.disabled = busy || !validSize(pictureSize) || zoom <= 1;
    plus.disabled = busy || !validSize(pictureSize) || zoom >= 4;
    zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
    previous.disabled = busy || !pdf || pageNo <= 1;
    next.disabled = busy || !pdf || pageNo >= pdf.pageCount;
    pageLabel.textContent = pdf ? `${pageNo} / ${pdf.pageCount}` : '';
    syncInk();
  }

  function validSize(size) {
    return size && [size.width, size.height].every((value) => Number.isFinite(value) && value > 0);
  }

  function sizePicture() {
    if (!picture || !validSize(pictureSize) || closed) return;
    const scale = Math.min(1, Math.max(1, viewport.clientWidth - 16) / pictureSize.width,
      kind === 'pdf' ? Infinity : Math.max(1, viewport.clientHeight - 16) / pictureSize.height);
    const width = `${Math.round(pictureSize.width * scale * zoom)}px`;
    const height = `${Math.round(pictureSize.height * scale * zoom)}px`;
    pictureFrame.style.width = picture.style.width = width;
    pictureFrame.style.height = picture.style.height = height;
    syncInk();
  }

  function zoomAt(value, from, to = from) {
    if (closed || busy || !picture || !validSize(pictureSize)) return;
    const before = pictureFrame.getBoundingClientRect();
    if (!validSize(before)) return;
    zoom = clampZoom(value, zoom);
    sizePicture();
    // 中央寄せの余白と、縮小時にブラウザが丸めたスクロール位置も含めて合わせる。
    const scroll = zoomScroll({ scroll: { left: viewport.scrollLeft, top: viewport.scrollTop },
      from, to, before, after: pictureFrame.getBoundingClientRect() });
    viewport.scrollLeft = scroll.left;
    viewport.scrollTop = scroll.top;
    syncControls();
    scheduleSharpPage();
  }

  function changeZoom(delta) {
    const rect = viewport.getBoundingClientRect();
    zoomAt(nextZoom(zoom, delta), { x: rect.left + (viewport.clientLeft || 0) + viewport.clientWidth / 2,
      y: rect.top + (viewport.clientTop || 0) + viewport.clientHeight / 2 });
  }

  function cancelSharpPage() {
    clearTimeout(sharpTimer);
    sharpTimer = null;
  }

  function describeCanvas(canvas, number) {
    canvas.className = 'viewer-pdf';
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', `${title} ${number} ページ`);
  }

  function applySharpPage() {
    const ready = sharpPage;
    if (!ready?.canvas) return;
    if (closed || busy || ready.current !== generation || ready.source !== pdf
      || ready.target !== picture || zoom <= 1.5 || !validSize(ready.canvas)) {
      sharpPage = null;
      return;
    }
    if (touchIds.size) return;
    sharpPage = null;
    try {
      // 描画の完了と大きさ・描画先を確かめてから、今の canvas の中身だけを写す。
      const context = picture.getContext('2d');
      if (!context) return;
      const backup = document.createElement('canvas');
      backup.width = picture.width;
      backup.height = picture.height;
      const backupContext = backup.getContext('2d');
      if (!backupContext) return;
      backupContext.drawImage(picture, 0, 0);
      const left = viewport.scrollLeft, top = viewport.scrollTop;
      try {
        picture.width = ready.canvas.width;
        picture.height = ready.canvas.height;
        context.drawImage(ready.canvas, 0, 0);
      } catch {
        try {
          picture.width = backup.width;
          picture.height = backup.height;
          context.drawImage(backup, 0, 0);
          viewport.scrollLeft = left;
          viewport.scrollTop = top;
        } catch {
          // 控えからも戻せない場合は、試行済みの状態を残して読みこみ直す。
          ready.page.canvas = null;
          void showPage(pageNo);
        }
        return;
      }
      ready.page.canvas = picture;
      // 表示の大きさ・線の形・道具・保存部品は作り直さない。
      viewport.scrollLeft = left;
      viewport.scrollTop = top;
    } catch { /* 高精細にできない端末では、今の絵をそのまま使う。 */ }
  }

  function scheduleSharpPage() {
    cancelSharpPage();
    const page = pdfPages.get(pageNo);
    if (closed || busy || !pdf || zoom <= 1.5 || !page || !validSize(page.size)) {
      sharpPage = null;
      return;
    }
    if (page.attempted) return;
    const current = generation, number = pageNo, source = pdf;
    sharpTimer = setTimeout(async () => {
      sharpTimer = null;
      page.attempted = true;
      const request = { current, source, page, target: picture, canvas: null };
      sharpPage = request;
      try {
        const canvas = await source.renderPage(number, 3200);
        if (sharpPage !== request) return;
        request.canvas = canvas;
        applySharpPage();
      } catch {
        if (sharpPage === request) sharpPage = null;
        // 高精細にできない端末では、今の絵をそのまま使う。
      }
    }, 300);
  }

  function detachInk() {
    unsubscribeInk?.();
    unsubscribeInk = null;
    if (ink) {
      toolState = ink.getToolState() ?? toolState;
      ink.setEditing(false);
      ink.setGesture(false);
      void ink.flush();
      ink.node.remove();
      ink.overlay.remove();
      ink = null;
    }
    inkArea.hidden = true;
    writeBtn.hidden = true;
    drag = null;
  }

  function attachInk(field, size, current) {
    ink = field;
    if (!ink) return;
    if (kind === 'pdf') ink.setToolState(toolState);
    ink.setEditing(writing);
    ink.setGesture(gesture);
    inkArea.replaceChildren(ink.node);
    inkArea.hidden = false;
    pictureFrame.append(ink.overlay);
    unsubscribeInk = ink.subscribe(() => {
      if (!closed && current === generation && ink === field) syncInk();
    });
    void ink.show(size);
    syncInk();
  }

  function clearContent() {
    cancelSharpPage();
    sharpPage = null;
    pinch = null;
    gesture = false;
    touchIds.clear();
    detachInk();
    writing = false;
    toolState = null;
    cancelImage?.();
    cancelImage = null;
    if (picture) {
      picture.onload = null;
      picture.onerror = null;
      picture.removeAttribute('src');
      picture = null;
    }
    pictureSize = null;
    pdfPages.clear();
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
    const current = ++generation;
    cancelSharpPage();
    sharpPage = null;
    pinch = null;
    detachInk();
    busy = true;
    if (pageInk) stage.replaceChildren();
    message.textContent = '読みこんでいます…';
    syncControls();
    try {
      let page = pdfPages.get(number);
      const canvas = page?.canvas ?? await pdf.renderPage(number, 1600);
      if (closed || current !== generation) return;
      if (!page) {
        page = { size: { width: canvas.width, height: canvas.height }, canvas: null, attempted: false };
        pdfPages.set(number, page);
      }
      describeCanvas(canvas, number);
      picture = canvas;
      pictureSize = page.size;
      pictureFrame.style.width = pictureFrame.style.height = '';
      pictureFrame.replaceChildren(canvas);
      stage.replaceChildren(pictureFrame);
      pageNo = number;
      zoom = 1;
      sizePicture();
      viewport.scrollTop = 0;
      viewport.scrollLeft = 0;
      message.replaceChildren();
      if (pageInk && number <= 999 && Number.isFinite(canvas.width) && canvas.width > 0
        && Number.isFinite(canvas.height) && canvas.height > 0) {
        attachInk(pageInk(number), pictureSize, current);
      }
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
        pictureFrame.replaceChildren(picture);
        stage.replaceChildren(pictureFrame);
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
        pictureSize = { width: picture.naturalWidth, height: picture.naturalHeight };
        message.replaceChildren();
        if (kind === 'image' && pictureInk && Number.isFinite(picture.naturalWidth) && picture.naturalWidth > 0
          && Number.isFinite(picture.naturalHeight) && picture.naturalHeight > 0) {
          attachInk(pictureInk(), { width: picture.naturalWidth, height: picture.naturalHeight }, current);
        }
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

  function fingers(ev) {
    return Array.from(ev.touches || []).filter((touch) => touch && touch.touchType !== 'stylus'
      && (!touch.target || viewport.contains(touch.target) || touchIds.has(touch.identifier)));
  }

  function touchPair(touches) {
    const [first, second] = touches;
    if (!first || !second) return null;
    const distance = Math.hypot(second.clientX - first.clientX, second.clientY - first.clientY);
    const point = { x: (first.clientX + second.clientX) / 2, y: (first.clientY + second.clientY) / 2 };
    if (!Number.isFinite(distance) || distance <= 0 || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
    return { ids: [first.identifier, second.identifier], distance, point };
  }

  function startPinch(ev) {
    const touches = fingers(ev);
    for (const touch of touches) touchIds.add(touch.identifier);
    if (touches.length < 2) return;
    ev.preventDefault();
    gesture = true;
    ink?.setGesture(true);
    drag = null;
    if (!pinch && !closed && !busy && !ink?.penActive && validSize(pictureSize)) pinch = touchPair(touches);
    scheduleSharpPage();
  }

  function movePinch(ev) {
    const touches = fingers(ev);
    if (touches.length >= 2) ev.preventDefault();
    if (!pinch) return;
    if (busy || ink?.penActive) { pinch = null; return; }
    const pair = touchPair(pinch.ids.map((id) => touches.find((touch) => touch.identifier === id)));
    if (!pair) return;
    zoomAt(pinchZoom(zoom, pinch.distance, pair.distance), pinch.point, pair.point);
    pinch = pair;
  }

  function endPinch(ev) {
    const touches = fingers(ev);
    for (const id of touchIds) if (!touches.some((touch) => touch.identifier === id)) touchIds.delete(id);
    if (touches.length >= 2) ev.preventDefault();
    if (pinch && (ev.type === 'touchcancel' || pinch.ids.some((id) => !touches.some((touch) => touch.identifier === id)))) pinch = null;
    if (!touches.length) { pinch = null; gesture = false; ink?.setGesture(false); }
    applySharpPage();
  }

  const touchOptions = { passive: false, capture: true };
  viewport.addEventListener('touchstart', startPinch, touchOptions);
  viewport.addEventListener('touchmove', movePinch, touchOptions);
  document.addEventListener('touchend', endPinch, touchOptions);
  document.addEventListener('touchcancel', endPinch, touchOptions);
  viewport.addEventListener('wheel', (ev) => {
    if (!ev.ctrlKey && !ev.metaKey) return;
    ev.preventDefault();
    if (!Number.isFinite(ev.deltaY)) return;
    const unit = ev.deltaMode === 1 ? 16 : ev.deltaMode === 2 ? viewport.clientHeight : 1;
    zoomAt(zoom * Math.exp(-ev.deltaY * unit * 0.002), { x: ev.clientX, y: ev.clientY });
  }, { passive: false });
  const preventGesture = (ev) => ev.preventDefault();
  viewport.addEventListener('gesturestart', preventGesture, { passive: false });
  viewport.addEventListener('gesturechange', preventGesture, { passive: false });
  viewport.addEventListener('scroll', scheduleSharpPage);

  // 指 1 本はブラウザのスクロール、マウスとペンはドラッグで動かす。
  viewport.addEventListener('pointerdown', (ev) => {
    if (busy || writing || !picture || (kind !== 'pdf' && zoom <= 1)
      || ev.pointerType === 'touch' || ev.button !== 0) return;
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
    document.removeEventListener('touchend', endPinch, touchOptions);
    document.removeEventListener('touchcancel', endPinch, touchOptions);
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
