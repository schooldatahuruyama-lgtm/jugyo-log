// 授業のタイル。小さい画像は見えるときだけ読み、横にすべらせても授業を開かない。
import { el, statusChip } from '../../ui.js';
import { dateLabel, thumbOrder } from '../../lesson-logic.js';
import { swipeDecision, stepIndex } from '../../student-list-logic.js';

export function lessonTile({ lesson, mark, pending, loadThumbs, onOpen, swipe }) {
  let alive = true;
  let loaded = false;
  let opened = false;
  let observer = null;
  let pointer = null;
  let images = [];
  let index = 0;
  const listeners = [];
  const title = lesson.title || '（授業名なし）';
  const date = dateLabel(lesson.date);
  const placeholder = el('span', { class: 'lesson-tile-placeholder', text: title });
  const image = el('img', { hidden: true, draggable: 'false', alt: '' });
  const frame = el('div', { class: 'lesson-tile-frame' }, placeholder, image);
  const dots = el('div', { class: 'lesson-tile-dots', role: 'img' });
  const prev = el('button', { type: 'button', class: 'btn lesson-tile-arrow', 'aria-label': '前の画像', text: '‹' });
  const next = el('button', { type: 'button', class: 'btn lesson-tile-arrow', 'aria-label': '次の画像', text: '›' });
  const controls = el('div', { class: 'lesson-tile-controls', hidden: true }, prev, dots, next);
  const openButton = el('button', {
    type: 'button', class: 'lesson-tile-open', 'aria-label': `${date} ${title} を開く`,
  }, el('span', { class: 'lesson-date', text: date }), el('span', { class: 'lesson-title', text: title }));
  // 印を読めなかった場合は、mark を渡さず、未入力という印も出さない。
  const record = el('div', { class: 'lesson-tile-record' },
    el('div', { class: 'lesson-tile-marks' },
      mark === 'done' ? statusChip('ok', '記録あり') : null,
      mark === 'todo' ? statusChip('warn', '振り返りがまだ') : null,
      pending ? statusChip('danger', 'まだ保存できていません') : null));
  const node = el('article', { class: 'lesson-tile' },
    el('div', { class: 'lesson-tile-materials' }, frame, controls),
    openButton, record);

  function listen(target, type, handler) {
    target.addEventListener(type, handler);
    listeners.push(() => target.removeEventListener(type, handler));
  }

  async function open() {
    if (!alive || opened) return;
    opened = true;
    try {
      if (await onOpen() === 'stayed') opened = false;
    } catch {
      opened = false;
    }
  }

  function showImage() {
    const current = images[index];
    image.hidden = !current;
    placeholder.hidden = Boolean(current);
    if (current) {
      const material = lesson.materials[current.id];
      image.alt = `先生の資料：${material.kind === 'board' ? '板書' : '配布資料'} ${material.name}`;
      image.src = current.src;
    } else {
      image.removeAttribute('src');
    }
    controls.hidden = images.length < 2;
    prev.disabled = index === 0;
    next.disabled = index >= images.length - 1;
    dots.setAttribute('aria-label', `${images.length} 枚中 ${index + 1} 枚目`);
    dots.replaceChildren(...images.map((_, i) => el('span', {
      class: i === index ? 'lesson-tile-dot is-current' : 'lesson-tile-dot', 'aria-hidden': 'true',
    })));
  }

  function step(dir) {
    if (!alive) return;
    const nextIndex = stepIndex(index, dir, images.length);
    if (nextIndex === index) return;
    index = nextIndex;
    showImage();
  }

  function releasePointer() {
    const previous = pointer;
    pointer = null;
    if (previous && frame.hasPointerCapture?.(previous.id)) frame.releasePointerCapture(previous.id);
  }

  listen(openButton, 'click', open);
  listen(prev, 'click', () => step(-1));
  listen(next, 'click', () => step(1));
  listen(image, 'error', () => {
    if (!alive || images.length === 0) return;
    images.splice(index, 1);
    index = stepIndex(index, 0, images.length);
    showImage();
  });
  listen(frame, 'pointerdown', (ev) => {
    if (!alive || ev.isPrimary === false || ev.button !== 0) return;
    pointer = { id: ev.pointerId, x: ev.clientX, y: ev.clientY, moved: false };
    try { frame.setPointerCapture(ev.pointerId); } catch { /* 枠の中の操作だけで続ける */ }
  });
  listen(frame, 'pointermove', (ev) => {
    if (!pointer || pointer.id !== ev.pointerId) return;
    if (Math.abs(ev.clientX - pointer.x) > swipe.tapMax || Math.abs(ev.clientY - pointer.y) > swipe.tapMax) pointer.moved = true;
  });
  listen(frame, 'pointerup', (ev) => {
    if (!alive || !pointer || pointer.id !== ev.pointerId) return;
    const { x, y, moved } = pointer;
    releasePointer();
    const decision = swipeDecision({ dx: ev.clientX - x, dy: ev.clientY - y }, swipe);
    if (decision === 'tap' && !moved) open();
    else if (decision === 'prev') step(-1);
    else if (decision === 'next') step(1);
  });
  listen(frame, 'pointercancel', releasePointer);
  listen(frame, 'lostpointercapture', releasePointer);

  async function load() {
    if (!alive || loaded) return;
    loaded = true;
    observer?.disconnect();
    try {
      const thumbs = await loadThumbs();
      if (!alive) return;
      images = thumbOrder(lesson.materials)
        .filter((id) => typeof thumbs?.[id] === 'string' && thumbs[id].startsWith('data:image/'))
        .map((id) => ({ id, src: thumbs[id] }));
    } catch {
      if (!alive) return;
      images = [];
    }
    showImage();
  }

  if (typeof window.IntersectionObserver === 'function') {
    observer = new window.IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) load();
    });
    observer.observe(node);
  } else {
    load();
  }

  return {
    node,
    destroy() {
      alive = false;
      observer?.disconnect();
      releasePointer();
      for (const remove of listeners) remove();
      image.removeAttribute('src');
    },
  };
}
