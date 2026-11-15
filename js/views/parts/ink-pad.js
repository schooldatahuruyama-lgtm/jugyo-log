// 手書きの紙と道具。保存は呼び出した画面が行う。
import { el, confirmDialog } from '../../ui.js';
import { CONFIG } from '../../config.js';
import { cleanInk, cleanStroke, makeStroke, strokePath, snapLine, eraseAt,
  addStroke, addPage, canAddPage, createHistory } from '../../ink-logic.js';

const MESSAGES = {
  'too-many': '線が多すぎて、これ以上書けません。いらない線を消してください。',
  'too-big': 'この欄は、これ以上書けません。いらない線を消すか、写真にとって「自分の写真・PDF」に足してください。',
  'too-long': 'これ以上は、下に足せません。',
};

function svgEl(tag, props = {}) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(props)) node.setAttribute(key, String(value));
  return node;
}

function inkPath(stroke) {
  return svgEl('path', { d: strokePath(stroke), fill: 'none',
    stroke: CONFIG.ink.colors[stroke.c], 'stroke-width': CONFIG.ink.widths[stroke.w],
    'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
}

export function inkPad({ ink, readOnly = false, label = '手書き', onChange }) {
  let current = cleanInk(ink);
  let history = createHistory(CONFIG.ink.undoMax);
  let alive = true;
  let locked = false;
  let mode = 'move';
  let color = 0;
  let width = 0;
  let ruler = false;
  let erasing = false;
  let active = null;
  let penPointer = null;
  let penUntil = 0;
  let confirmation = null;
  const listeners = [];
  const buttons = [];
  const paths = new Map();
  const paper = svgEl('svg', { class: 'ink-paper', role: 'img' });
  const rules = svgEl('g', { 'aria-hidden': 'true', stroke: '#E8EEF7', 'stroke-width': 1 });
  const lines = svgEl('g');
  paper.append(rules, lines);
  const empty = el('p', { class: 'small ink-empty', text: '（手書きはありません）' });
  const tools = el('div', { class: 'ink-tools', role: 'group', 'aria-label': `${label}の道具` });
  const status = el('span', { class: 'ink-status', role: 'status' });
  const message = el('p', { class: 'error ink-message', role: 'alert' });
  const node = el('div', { class: readOnly ? 'ink-pad ink-readonly' : 'ink-pad' });
  let moveButton, writeButton, rulerButton, eraserButton, undoButton, clearButton, moreButton;
  let colorButtons = [], widthButtons = [];

  function listen(target, type, handler, options) {
    target.addEventListener(type, handler, options);
    listeners.push(() => target.removeEventListener(type, handler, options));
  }

  function canEdit() {
    return alive && !readOnly && !locked && !confirmation;
  }

  function button(text, action, className = 'ink-tool') {
    const control = el('button', { type: 'button', class: className, text });
    listen(control, 'click', () => {
      if (!canEdit() || active || control.disabled) return;
      action();
      syncControls();
    });
    buttons.push(control);
    return control;
  }

  function syncControls() {
    if (!alive || readOnly) return;
    for (const control of buttons) control.disabled = locked || !!active || !!confirmation;
    undoButton.disabled ||= !history.canUndo();
    clearButton.disabled ||= current.s.length === 0;
    moreButton.disabled ||= !canAddPage(current);
    moveButton.setAttribute('aria-pressed', String(mode === 'move'));
    writeButton.setAttribute('aria-pressed', String(mode === 'write'));
    colorButtons.forEach((control, i) => control.setAttribute('aria-pressed', String(color === i)));
    widthButtons.forEach((control, i) => control.setAttribute('aria-pressed', String(width === i)));
    rulerButton.setAttribute('aria-pressed', String(ruler));
    eraserButton.setAttribute('aria-pressed', String(erasing));
    status.textContent = (mode === 'write' ? 'いま: 書く（指でもペンでも書けます）'
      : 'いま: 動かす（指では書けません。ペンは書けます）')
      + (ruler ? '／定規' : erasing ? '／消しゴム' : '');
    paper.style.touchAction = mode === 'write' ? 'none' : 'pan-y pinch-zoom';
    node.classList.toggle('ink-writing', mode === 'write' && !locked);
  }

  function describePaper(value) {
    paper.setAttribute('aria-label', `${label}（線 ${value.s.length} 本）`);
  }

  function render() {
    if (!alive) return;
    paper.setAttribute('viewBox', `0 0 ${CONFIG.ink.width} ${current.h}`);
    paper.style.aspectRatio = `${CONFIG.ink.width} / ${current.h}`;
    const horizontal = [];
    for (let y = 40; y < current.h; y += 40) {
      horizontal.push(svgEl('line', { x1: 0, y1: y, x2: CONFIG.ink.width, y2: y }));
    }
    rules.replaceChildren(...horizontal);
    paths.clear();
    lines.replaceChildren();
    for (const stroke of current.s) {
      const path = inkPath(stroke);
      paths.set(stroke, path);
      lines.append(path);
    }
    if (readOnly) node.replaceChildren(current.s.length ? paper : empty);
    describePaper(current);
    syncControls();
  }

  function change(next, remember = true) {
    if (!alive || next === current) return;
    if (remember) history.push(current);
    current = next;
    message.textContent = '';
    render();
    if (typeof onChange === 'function') onChange(cleanInk(current));
  }

  function apply(result) {
    if (result.error) message.textContent = MESSAGES[result.error];
    else change(result.ink);
  }

  function cancelConfirmation() {
    const request = confirmation;
    confirmation = null;
    if (request) request.abort();
  }

  async function clearAll() {
    const request = new AbortController();
    confirmation = request;
    syncControls();
    try {
      const ok = await confirmDialog({ title: '手書きを全部消しますか？',
        body: 'この欄の手書きを全部消します。「1 つ戻す」で戻せます。',
        okLabel: '全部消す', danger: true, signal: request.signal });
      if (!alive || confirmation !== request || locked) return;
      if (ok && current.s.length) change({ ...current, s: [] });
    } finally {
      if (confirmation === request) { confirmation = null; syncControls(); }
    }
  }

  function pointAt(ev) {
    const rect = paper.getBoundingClientRect();
    if (!(rect.width > 0) || !(rect.height > 0)) return null;
    const x = (ev.clientX - rect.left) * CONFIG.ink.width / rect.width;
    const y = (ev.clientY - rect.top) * current.h / rect.height;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    // 途中の表示も紙の端にそろえる。1 点を同じ座標の 2 点として確かめる。
    return cleanStroke({ c: color, w: width, p: [x, y, x, y] }, current.h).p.slice(0, 2);
  }

  function erasePoint(x, y) {
    const next = eraseAt(active.ink, x, y);
    if (next === active.ink) return;
    const remaining = new Set(next.s);
    for (const [stroke, path] of paths) {
      if (!remaining.has(stroke)) { path.remove(); paths.delete(stroke); }
    }
    active.ink = next;
    describePaper(next);
  }

  function addPoint(point) {
    const [x, y] = point;
    if (active.erasing) {
      // 点の間が離れても、なぞった途中の線を取りこぼさない。
      const last = active.last || point;
      const steps = Math.max(1, Math.ceil(Math.hypot(x - last[0], y - last[1]) / CONFIG.ink.eraserRadius));
      for (let i = 1; i <= steps; i += 1) {
        erasePoint(last[0] + (x - last[0]) * i / steps, last[1] + (y - last[1]) * i / steps);
      }
      active.last = point;
      return;
    }
    const p = active.points;
    if (p.length && p[p.length - 2] === x && p[p.length - 1] === y) return;
    if (active.ruler && p.length) active.points = snapLine(p[0], p[1], x, y);
    else p.push(x, y);
    const preview = active.points.length === 2 ? [...active.points, ...active.points] : active.points;
    active.path.setAttribute('d', strokePath({ p: preview }));
  }

  function addEventPoints(ev) {
    const samples = typeof ev.getCoalescedEvents === 'function' ? ev.getCoalescedEvents() : [];
    for (const sample of samples.length ? samples : [ev]) {
      const point = pointAt(sample);
      if (point) addPoint(point);
    }
  }

  function takeActive() {
    const previous = active;
    active = null;
    if (!previous) return null;
    if (previous.pointerType === 'pen') penUntil = Date.now() + 500;
    if (previous.path) previous.path.remove();
    try {
      if (paper.hasPointerCapture(previous.pointerId)) paper.releasePointerCapture(previous.pointerId);
    } catch { /* 紙が画面から外れたときは、ブラウザが捕まえた接触を解く。 */ }
    return previous;
  }

  function cancelActive() {
    if (takeActive()) render();
  }

  function endPen(ev) {
    if (penPointer !== ev.pointerId) return;
    penPointer = null;
    penUntil = Date.now() + 500;
  }

  function pointerDown(ev) {
    if (!canEdit() || active) return;
    if (ev.pointerType === 'mouse' && ev.button !== 0) return;
    if (ev.pointerType !== 'pen' && mode !== 'write') return;
    if (ev.pointerType === 'touch' && (penPointer !== null || Date.now() < penUntil)) return;
    const point = pointAt(ev);
    if (!point) return;
    ev.preventDefault();
    paper.setPointerCapture(ev.pointerId);
    if (ev.pointerType === 'pen') penPointer = ev.pointerId;
    active = { pointerId: ev.pointerId, pointerType: ev.pointerType, color, width, ruler, erasing,
      points: [], ink: current, path: erasing ? null : inkPath({ c: color, w: width, p: [] }) };
    if (active.path) lines.append(active.path);
    addPoint(point);
    syncControls();
  }

  function pointerMove(ev) {
    if (!canEdit() || !active || active.pointerId !== ev.pointerId) return;
    ev.preventDefault();
    addEventPoints(ev);
  }

  function pointerUp(ev) {
    endPen(ev);
    if (!canEdit() || !active || active.pointerId !== ev.pointerId) return;
    ev.preventDefault();
    addEventPoints(ev);
    const finished = takeActive();
    if (finished.erasing) change(finished.ink);
    else {
      const stroke = makeStroke(finished, current.h);
      if (stroke) apply(addStroke(current, stroke));
    }
    syncControls();
  }

  function pointerCancel(ev) {
    if (!alive || !active || active.pointerId !== ev.pointerId) return;
    cancelActive();
  }

  function cancelPointer(ev) {
    endPen(ev);
    pointerCancel(ev);
  }

  if (!readOnly) {
    moveButton = button('動かす', () => { mode = 'move'; }, 'ink-tool ink-mode');
    writeButton = button('書く', () => { mode = 'write'; }, 'ink-tool ink-mode');
    colorButtons = ['黒', '赤', '青'].map((name, i) => {
      const control = button('', () => { color = i; erasing = false; });
      control.setAttribute('aria-label', name);
      const dot = el('span', { class: 'ink-color-dot', 'aria-hidden': 'true' });
      dot.style.backgroundColor = CONFIG.ink.colors[i];
      control.append(dot);
      return control;
    });
    widthButtons = ['細い', '太い'].map((name, i) => {
      const control = button('', () => { width = i; });
      control.setAttribute('aria-label', name);
      control.append(el('span', { class: i === 0 ? 'ink-width-dot' : 'ink-width-dot ink-width-thick', 'aria-hidden': 'true' }));
      return control;
    });
    rulerButton = button('', () => { ruler = !ruler; if (ruler) erasing = false; });
    const icon = svgEl('svg', { class: 'ink-ruler-icon', viewBox: '0 0 26 14', 'aria-hidden': 'true', focusable: 'false' });
    icon.append(svgEl('rect', { x: 1, y: 1, width: 24, height: 12, rx: 2, fill: '#FFF1A8' }),
      svgEl('path', { d: 'M5 1v5M9 1v3M13 1v5M17 1v3M21 1v5', fill: 'none' }));
    rulerButton.append(icon, el('span', { text: '定規' }));
    eraserButton = button('消しゴム', () => { erasing = !erasing; if (erasing) ruler = false; });
    undoButton = button('1 つ戻す', () => {
      const previous = history.undo(current);
      if (previous) change(previous, false);
    });
    clearButton = button('全部消す', () => { void clearAll(); }, 'ink-tool ink-clear');
    moreButton = button('＋ 下に書く場所を足す', () => { apply(addPage(current)); }, 'ink-more');
    tools.append(moveButton, writeButton, ...colorButtons, ...widthButtons,
      rulerButton, eraserButton, undoButton, clearButton, status);
    node.append(tools, paper, moreButton, message);
    listen(paper, 'pointerdown', pointerDown);
    listen(paper, 'pointermove', pointerMove);
    listen(paper, 'pointerup', pointerUp);
    listen(paper, 'pointercancel', cancelPointer);
    listen(paper, 'lostpointercapture', pointerCancel);
    // ロックなどで途中の線を捨てても、ペンが離れるまでは指を受けつけない。
    listen(document, 'pointerup', endPen, true);
    listen(document, 'pointercancel', endPen, true);
    listen(paper, 'touchstart', (ev) => {
      if (canEdit() && Array.from(ev.changedTouches).some((touch) => touch.touchType === 'stylus')) ev.preventDefault();
    }, { passive: false });
  }

  render();
  return {
    node,
    getInk() { return cleanInk(current); },
    setInk(value) {
      if (!alive) return;
      cancelConfirmation();
      takeActive();
      current = cleanInk(value);
      history = createHistory(CONFIG.ink.undoMax);
      message.textContent = '';
      render();
    },
    setLocked(value) {
      if (!alive) return;
      locked = !!value;
      if (locked) { cancelConfirmation(); cancelActive(); }
      syncControls();
    },
    destroy() {
      if (!alive) return;
      cancelConfirmation();
      cancelActive();
      alive = false;
      for (const remove of listeners) remove();
      listeners.length = 0;
    },
  };
}
