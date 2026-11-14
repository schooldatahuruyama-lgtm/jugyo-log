// 先生の資料を一枚ずつ表示する。写真はまとめて読み、めくるときは通信しない。
import { el } from '../../ui.js';
import { CONFIG } from '../../config.js';
import { materialList } from '../../lesson-logic.js';
import { swipeDecision, stepIndex } from '../../student-list-logic.js';
import { openViewer } from './viewer.js';

export function materialPane({ ctx, classId, lessonId, lesson }) {
  let alive = true;
  let viewer = null;
  let index = 0;
  let pointer = null;
  const events = new AbortController();
  const materialViews = new Map();
  const materials = materialList(lesson.materials);
  const materialsArea = el('div', { class: 'student-material-pane' });
  const frame = el('button', { type: 'button', class: 'student-material-open' });
  const summary = el('div', { class: 'student-material-summary' });
  const counter = el('span', { class: 'student-material-counter', role: 'status' });
  const messages = el('div');
  const dots = el('div', { class: 'lesson-tile-dots', 'aria-hidden': 'true' });
  const prev = el('button', { type: 'button', class: 'btn lesson-tile-arrow', 'aria-label': '前の資料', text: '‹' });
  const next = el('button', { type: 'button', class: 'btn lesson-tile-arrow', 'aria-label': '次の資料', text: '›' });
  const controls = el('div', { class: 'student-material-controls' }, prev, dots, next);

  function listen(target, type, handler) {
    target.addEventListener(type, handler, { signal: events.signal });
  }

  function currentItem() { return materialViews.get(materials[index]?.id); }

  function viewMaterial() {
    const item = currentItem();
    if (!alive || !item || (item.material.type === 'image' && !item.blob)) return;
    viewer?.close();
    const { material } = item;
    viewer = openViewer({ title: material.name, kind: material.type,
      load: () => material.type === 'pdf' ? ctx.files.loadFile(classId, lessonId, material) : item.blob });
  }

  function syncOpen() {
    const item = currentItem();
    // 写真を読めないときも、枠のスワイプと矢印キーは使える。
    frame.setAttribute('aria-disabled', String(item?.material.type === 'image' && !item.blob));
  }

  function showCurrent() {
    const item = currentItem();
    if (!item) return;
    const kind = item.material.kind === 'board' ? '板書' : '配布資料';
    frame.replaceChildren(item.preview);
    frame.setAttribute('aria-label', `${kind} ${item.material.name} を開く${materials.length > 1 ? `（${index + 1} / ${materials.length}）` : ''}`);
    summary.replaceChildren(el('span', { class: 'small', text: kind }),
      el('span', { class: 'material-name', text: item.material.name }));
    messages.replaceChildren(item.message);
    if (materials.length > 1) {
      counter.textContent = `${index + 1} / ${materials.length}`;
      prev.disabled = index === 0;
      next.disabled = index === materials.length - 1;
      dots.replaceChildren(...materials.map((_, i) => el('span', {
        class: i === index ? 'lesson-tile-dot is-current' : 'lesson-tile-dot',
      })));
    }
    syncOpen();
  }

  function step(dir) {
    if (!alive) return;
    const nextIndex = stepIndex(index, dir, materials.length);
    if (nextIndex === index) return;
    index = nextIndex;
    showCurrent();
  }

  function clearImage(item) {
    if (item.image) item.image.removeAttribute('src');
    item.image = null;
    if (item.url) URL.revokeObjectURL(item.url);
    item.url = null;
    item.blob = null;
  }

  function imageFailed(item) {
    if (!alive) return;
    clearImage(item);
    if (item.thumb) showThumb(item);
    else item.preview.replaceChildren(el('span', { text: '写真' }));
    const retry = el('button', { type: 'button', class: 'btn', text: 'もう一度' });
    listen(retry, 'click', () => loadImages([item.material]));
    item.message.replaceChildren(el('span', { text: '読みこめませんでした' }), retry);
    syncOpen();
  }

  async function loadImages(list) {
    const pending = list.filter((material) => !materialViews.get(material.id)?.loading);
    if (!alive || pending.length === 0) return;
    for (const material of pending) {
      const item = materialViews.get(material.id);
      item.loading = true;
      item.message.textContent = '読みこんでいます…';
    }
    let blobs;
    try { blobs = await ctx.files.loadImages(classId, lessonId, pending); } catch { blobs = {}; }
    if (!alive) return;
    for (const material of pending) {
      const item = materialViews.get(material.id);
      item.loading = false;
      const blob = blobs?.[material.id];
      if (!(blob instanceof Blob)) { imageFailed(item); continue; }
      try {
        clearImage(item);
        item.blob = blob;
        item.url = URL.createObjectURL(blob);
        const image = el('img', { alt: material.name, src: item.url, draggable: 'false' });
        item.image = image;
        listen(image, 'error', () => { if (item.image === image) imageFailed(item); });
        item.preview.replaceChildren(image);
        item.message.replaceChildren();
      } catch { imageFailed(item); }
    }
    syncOpen();
  }

  function showThumb(item) {
    const image = el('img', { src: item.thumb, alt: item.material.name, draggable: 'false' });
    listen(image, 'error', () => {
      if (alive && item.image === image) {
        item.thumb = null;
        item.image = null;
        item.preview.replaceChildren(el('span', { text: item.material.type === 'pdf' ? 'PDF' : '写真' }));
      }
    });
    item.image = image;
    item.preview.replaceChildren(image);
  }

  async function loadThumbs() {
    try {
      const thumbs = await ctx.thumbs.load(lesson);
      if (!alive) return;
      for (const [id, item] of materialViews) {
        const thumb = thumbs?.[id];
        // 本物の写真が先に届いたら、小さい画像へは戻さない。
        if (item.blob || typeof thumb !== 'string' || !/^data:image\/(?:jpeg|png|webp);base64,/.test(thumb)) continue;
        item.thumb = thumb;
        showThumb(item);
      }
    } catch { /* 小さい画像がなくても、写真の本体や PDF は開ける */ }
  }

  function releasePointer() {
    const previous = pointer;
    pointer = null;
    if (previous && frame.hasPointerCapture?.(previous.id)) frame.releasePointerCapture(previous.id);
  }

  listen(prev, 'click', () => step(-1));
  listen(next, 'click', () => step(1));
  // 指・マウスのクリックは pointerup で扱い、Enter・Space と読み上げの操作だけここで開く。
  listen(frame, 'click', (ev) => { if (ev.detail === 0) viewMaterial(); });
  listen(materialsArea, 'keydown', (ev) => {
    if (!ev.target.closest('button') || !['ArrowLeft', 'ArrowRight'].includes(ev.key)) return;
    ev.preventDefault();
    step(ev.key === 'ArrowLeft' ? -1 : 1);
  });
  listen(frame, 'pointerdown', (ev) => {
    if (!alive || pointer || ev.isPrimary === false || ev.button !== 0) return;
    pointer = { id: ev.pointerId, x: ev.clientX, y: ev.clientY, moved: false };
    try { frame.setPointerCapture(ev.pointerId); } catch { /* 枠の中の操作だけで続ける */ }
  });
  listen(frame, 'pointermove', (ev) => {
    if (!pointer || pointer.id !== ev.pointerId) return;
    if (Math.abs(ev.clientX - pointer.x) > CONFIG.swipe.tapMax || Math.abs(ev.clientY - pointer.y) > CONFIG.swipe.tapMax) pointer.moved = true;
  });
  listen(frame, 'pointerup', (ev) => {
    if (!alive || !pointer || pointer.id !== ev.pointerId) return;
    const { x, y, moved } = pointer;
    releasePointer();
    const decision = swipeDecision({ dx: ev.clientX - x, dy: ev.clientY - y }, CONFIG.swipe);
    if (decision === 'tap' && !moved) viewMaterial();
    else if (decision === 'prev') step(-1);
    else if (decision === 'next') step(1);
  });
  listen(frame, 'pointercancel', releasePointer);
  listen(frame, 'lostpointercapture', releasePointer);

  if (materials.length === 0) {
    materialsArea.replaceChildren(el('p', { text: '先生の資料は、まだありません。' }));
  } else {
    for (const material of materials) {
      const preview = el('span', { class: 'student-material-preview' },
        el('span', { text: material.type === 'pdf' ? 'PDF' : '写真' }));
      const message = el('div', { class: 'student-material-message', role: 'status' });
      materialViews.set(material.id, { material, preview, message, blob: null, url: null, image: null, thumb: null, loading: false });
    }
    materialsArea.replaceChildren(frame,
      el('div', { class: 'student-material-caption' }, summary, materials.length > 1 ? counter : null),
      materials.length > 1 ? controls : null, messages);
    showCurrent();
    void loadThumbs();
    void loadImages(materials.filter((material) => material.type === 'image'));
  }

  return {
    node: materialsArea,
    destroy() {
      alive = false;
      events.abort();
      releasePointer();
      viewer?.close();
      viewer = null;
      for (const item of materialViews.values()) clearImage(item);
      materialViews.clear();
    },
  };
}
