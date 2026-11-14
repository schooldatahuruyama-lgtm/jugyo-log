// 先生と自分の用語を同じ並びで出す。用語の通信は記録の保存から独立させる。
import { el } from '../../ui.js';
import { CONFIG } from '../../config.js';
import { cleanTerm, checkTerm, mergedTerms, hasTerm, freeTermSlot } from '../../term-logic.js';

export function termRow({ ctx, classId, lessonId, studentId, lesson, readOnly }) {
  let alive = true;
  let loading = false;
  let loaded = false;
  let busy = false;
  let locked = false;
  let request = null;
  let myTerms = {};
  const list = el('div', { class: 'term-list' });
  const message = el('p', { class: 'error term-message', role: 'alert' });
  const status = el('p', { class: 'small term-message', role: 'status' });
  const retry = el('button', { type: 'button', class: 'btn', text: 'もう一度', hidden: true, onclick: load });
  const input = el('input', { type: 'text', maxlength: CONFIG.termMax, autocomplete: 'off',
    placeholder: `自分で用語を足す（${CONFIG.termMax} 文字まで）`, 'aria-label': '自分で用語を足す',
    onkeydown: (ev) => { if (ev.key === 'Enter' && (ev.isComposing || ev.keyCode === 229)) ev.preventDefault(); } });
  const add = el('button', { type: 'submit', class: 'btn', text: '＋ 足す' });
  const form = el('form', { class: 'term-input-row', hidden: true, novalidate: true,
    onsubmit: (ev) => { ev.preventDefault(); void addTerm(); } }, input, add);
  const node = el('div', { class: 'term-row' }, list, readOnly ? null : form, status, message, retry);

  function syncControls() {
    if (!alive) return;
    const full = loaded && freeTermSlot(myTerms, CONFIG.myTermSlots) === null;
    form.hidden = readOnly || !loaded;
    for (const button of node.querySelectorAll('button')) button.disabled = loading || busy || locked;
    input.disabled = loading || busy || locked || full;
    add.disabled = input.disabled;
    status.textContent = loading ? '用語を読みこんでいます…'
      : !readOnly && full ? `自分で足せる用語は ${CONFIG.myTermSlots.length} 個までです。` : '';
  }

  function renderTerms() {
    if (!alive) return;
    const terms = mergedTerms(lesson, myTerms);
    list.replaceChildren(...(terms.length ? terms.map((term) => term.own && !readOnly
      ? el('button', { type: 'button', class: 'term-pill', text: `${term.text} ×`,
        'aria-label': `${term.text} を外す`, onclick: () => removeTerm(term.slot) })
      : el('span', { class: 'term-pill', text: term.text }))
      : [el('span', { class: 'small', text: '（まだありません）' })]));
    syncControls();
  }

  async function load() {
    if (!alive || loading || busy) return;
    loading = true;
    message.textContent = '';
    retry.hidden = true;
    syncControls();
    try {
      const terms = await ctx.repo.getMyLessonTerms(studentId, classId, lessonId);
      if (!alive) return;
      myTerms = terms;
      loaded = true;
      renderTerms();
    } catch {
      if (!alive) return;
      message.textContent = '自分の用語を読みこめませんでした。';
      retry.hidden = false;
    } finally { loading = false; syncControls(); }
  }

  async function saveTerm(slot, text) {
    busy = true;
    message.textContent = '';
    syncControls();
    try {
      request = text === null ? ctx.repo.removeMyTerm(studentId, classId, lessonId, slot)
        : ctx.repo.setMyTerm(studentId, classId, lessonId, slot, text);
      await request;
      if (!alive) return;
      myTerms = { ...myTerms };
      if (text === null) delete myTerms[slot];
      else { myTerms[slot] = text; input.value = ''; }
      renderTerms();
    } catch {
      if (alive) message.textContent = '保存できませんでした。もう一度ためしてください。';
    } finally { busy = false; syncControls(); }
  }

  async function addTerm() {
    if (!alive || readOnly || !loaded || loading || busy || locked) return;
    const code = checkTerm(input.value);
    message.textContent = '';
    if (code === 'empty') return;
    if (code) { message.textContent = `用語は ${CONFIG.termMax} 文字までです。`; return; }
    const text = cleanTerm(input.value);
    if (hasTerm(lesson, myTerms, text)) { message.textContent = 'その用語は、もうあります。'; return; }
    const slot = freeTermSlot(myTerms, CONFIG.myTermSlots);
    if (slot === null) { syncControls(); return; }
    await saveTerm(slot, text);
  }

  async function removeTerm(slot) {
    if (!alive || readOnly || !loaded || loading || busy || locked) return;
    await saveTerm(slot, null);
  }

  renderTerms();
  void load();
  return {
    node,
    setLocked(value) { locked = value; syncControls(); },
    async settle() {
      if (!busy) return true;
      try { await request; return true; } catch { return false; }
    },
    destroy() { alive = false; },
  };
}
