// 写真の画面のための DOM の代役。描画エンジンや実機の接触判定は再現しない。
import { setMaxListeners } from 'node:events';

class FakeTarget {
  listeners = new Map();
  addEventListener(type, fn, options = {}) {
    if (options.signal?.aborted) return;
    const list = this.listeners.get(type) || new Set();
    list.add(fn);
    this.listeners.set(type, list);
    if (options.signal) {
      setMaxListeners(0, options.signal);
      options.signal.addEventListener('abort', () => list.delete(fn), { once: true });
    }
  }
  removeEventListener(type, fn) { this.listeners.get(type)?.delete(fn); }
  fire(type, props = {}) {
    const event = { type, target: this, button: 0, detail: 0, defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; }, ...props };
    for (const fn of [...(this.listeners.get(type) || [])]) fn(event);
    return event;
  }
}

export class FakeNode extends FakeTarget {
  constructor(tag) {
    super();
    this.tagName = tag;
    this.children = [];
    this.attributes = new Map();
    this.style = {};
    this.dataset = {};
    this.parentNode = null;
    this.className = '';
    this.value = '';
    this.disabled = false;
    this.clientWidth = 820;
    this.clientHeight = 600;
    this.scrollLeft = this.scrollTop = 0;
    this.naturalWidth = 1600;
    this.naturalHeight = 1200;
    this.captures = new Set();
    this.classList = {
      contains: (name) => this.className.split(' ').includes(name),
      toggle: (name, force) => {
        const names = new Set(this.className.split(' ').filter(Boolean));
        const include = force ?? !names.has(name);
        if (include) names.add(name); else names.delete(name);
        this.className = [...names].join(' ');
        return include;
      },
      remove: (name) => this.classList.toggle(name, false),
    };
  }
  set hidden(value) { if (value) this.attributes.set('hidden', ''); else this.attributes.delete('hidden'); }
  get hidden() { return this.attributes.has('hidden'); }
  set textContent(value) { this.replaceChildren(); this.text = String(value); }
  get textContent() { return (this.text || '') + this.children.map((node) => node.textContent).join(''); }
  set src(value) { this.attributes.set('src', value); queueMicrotask(() => this.onload?.()); }
  setAttribute(key, value) {
    if (key === 'class') this.className = String(value);
    else if (key === 'src') this.src = value;
    this.attributes.set(key, String(value));
  }
  getAttribute(key) { return key === 'class' ? this.className : this.attributes.get(key) ?? null; }
  removeAttribute(key) { this.attributes.delete(key); }
  append(...nodes) {
    for (const node of nodes) {
      node.remove();
      node.parentNode = this;
      this.children.push(node);
    }
  }
  replaceChildren(...nodes) {
    for (const node of this.children) node.parentNode = null;
    this.children = [];
    this.text = '';
    this.append(...nodes);
  }
  remove() {
    if (this.parentNode) this.parentNode.children = this.parentNode.children.filter((node) => node !== this);
    this.parentNode = null;
  }
  get isConnected() { return this === document.body || !!this.parentNode?.isConnected; }
  focus() { document.activeElement = this; }
  click() { if (!this.disabled) this.fire('click'); }
  showModal() { this.open = true; }
  close() { this.open = false; this.fire('close'); }
  setPointerCapture(id) { this.captures.add(id); }
  hasPointerCapture(id) { return this.captures.has(id); }
  releasePointerCapture(id) { this.captures.delete(id); }
  closest(selector) {
    const matches = selector.startsWith('.') ? this.classList.contains(selector.slice(1)) : this.tagName === selector;
    return matches ? this : this.parentNode?.closest(selector) ?? null;
  }
  querySelectorAll(selector) { return all(this, (node) => node !== this && (selector.startsWith('.')
    ? node.classList.contains(selector.slice(1)) : node.tagName === selector)); }
  getBoundingClientRect() {
    const photo = this.closest('.viewer-picture')?.children.find((node) => node.tagName === 'img');
    const h = Number(this.getAttribute('viewBox')?.split(' ')[3]) || 400;
    return { left: 0, top: 0, width: photo ? parseFloat(photo.style.width) : 800,
      height: photo ? parseFloat(photo.style.height) : h };
  }
}

export function all(root, predicate) {
  return [...(predicate(root) ? [root] : []), ...root.children.flatMap((node) => all(node, predicate))];
}
export const byClass = (root, name) => all(root, (node) => node.classList.contains(name));
export const buttons = (root, text) => all(root, (node) => node.tagName === 'button' && node.textContent === text);
export const settle = async () => { for (let i = 0; i < 100; i++) await Promise.resolve(); };

export function installDom() {
  const previous = Object.fromEntries(['Node', 'document', 'window'].map((name) => [name, globalThis[name]]));
  globalThis.Node = FakeNode;
  const doc = new FakeTarget();
  doc.body = new FakeNode('body');
  doc.activeElement = doc.body;
  doc.visibilityState = 'visible';
  doc.createElement = (tag) => new FakeNode(tag);
  doc.createElementNS = (_, tag) => new FakeNode(tag);
  doc.createTextNode = (text) => { const node = new FakeNode('#text'); node.textContent = text; return node; };
  doc.getElementById = (id) => all(doc.body, (node) => node.getAttribute('id') === id)[0] || null;
  globalThis.document = doc;
  globalThis.window = new FakeTarget();
  doc.restore = () => { Object.assign(globalThis, previous); };
  return doc;
}

export function draw(paper, { type = 'pen', from = [0.1, 0.2], to = [0.8, 0.7], id = 1 } = {}) {
  const rect = paper.getBoundingClientRect();
  const event = ([x, y]) => ({ pointerId: id, pointerType: type, clientX: x * rect.width, clientY: y * rect.height });
  paper.fire('pointerdown', event(from));
  paper.fire('pointermove', event(to));
  paper.fire('pointerup', event(to));
}
