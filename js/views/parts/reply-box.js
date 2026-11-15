// 先生の返事。記録の保存状態とは別に読みこみ・保存を扱う。
import { el, confirmDialog } from '../../ui.js';
import { CONFIG } from '../../config.js';
import { cleanReply, replyEditState, replyDateLabel } from '../../reply-logic.js';
import { headingIcon } from './heading-icon.js';

export function replyBox({ ctx, classId, lessonId, studentId, readOnly = false }) {
  let alive = true;
  let loadId = 0;
  let ready = false;
  let busy = false;
  let confirming = false;
  let saved = null;
  const dialogs = new AbortController();
  const max = CONFIG.reply.textMax;
  const status = el('p', { class: 'reply-status', role: 'status', 'aria-live': 'polite' });
  const error = el('p', { class: 'error', role: 'alert', hidden: true });
  const limit = el('p', { id: 'reply-limit', class: 'error', role: 'alert', hidden: true, text: `${max} 文字までです。` });
  const count = el('span', { id: 'reply-count' });
  const text = el('textarea', { id: 'reply-text', rows: 4, 'aria-describedby': 'reply-help reply-count reply-limit', oninput: edit });
  const seen = el('input', { type: 'checkbox', id: 'reply-seen', onchange: edit });
  const save = el('button', { type: 'button', class: 'btn btn-primary', text: '保存する', onclick: saveReply });
  const remove = el('button', { type: 'button', class: 'btn btn-danger-text', text: '返事を取り消す', onclick: removeReply });
  const editor = el('div', { class: 'reply-editor' },
    el('label', { class: 'label', for: 'reply-text', text: '返事' }), text,
    el('p', { class: 'small reply-count' }, el('span', { id: 'reply-help', text: `${max} 文字まで` }), count), limit,
    el('label', { class: 'reply-seen', for: 'reply-seen' }, seen,
      el('span', { text: '見ました（文を書かずに、印だけ付けられます）' })),
    el('div', { class: 'page-actions' }, save, remove));
  const body = el('div', { class: 'lesson-section-body' });
  const node = el('section', { class: 'reply-box', hidden: readOnly, 'aria-labelledby': 'reply-heading' },
    el('header', { class: 'lesson-section-band' },
      el('h2', { id: 'reply-heading' }, headingIcon('teacher'), el('span', { text: '先生から' }))), body);

  const draft = () => ({ text: text.value, seen: seen.checked === true });
  const state = () => replyEditState(draft(), saved, busy || confirming || !ready);
  const dirty = () => !readOnly && ready && state().dirty;

  function syncControls() {
    const value = state();
    text.disabled = seen.disabled = busy || confirming || !ready;
    save.disabled = !value.canSave;
    remove.disabled = busy || confirming || !ready;
    remove.hidden = !saved;
    count.textContent = `${value.count} / ${max}`;
    limit.hidden = !value.tooLong;
    text.setAttribute('aria-invalid', String(value.tooLong));
  }

  function edit() {
    if (!alive || busy || confirming || !ready) return;
    status.textContent = '';
    error.hidden = true;
    syncControls();
  }

  function showReply() {
    node.hidden = readOnly && !saved;
    if (readOnly) {
      body.replaceChildren(...(saved ? [
        saved.text ? el('p', { class: 'reply-text', text: saved.text }) : null,
        saved.seen ? el('p', { class: 'reply-seen-mark', text: '✓ 先生が見ました' }) : null,
        el('p', { class: 'small reply-date', text: replyDateLabel(saved.updatedAt) }),
      ].filter(Boolean) : []));
      return;
    }
    text.value = saved?.text ?? '';
    seen.checked = saved?.seen === true;
    body.replaceChildren(editor, status, error);
    syncControls();
  }

  async function reload() {
    if (!alive || (!readOnly && (busy || confirming || dirty()))) return;
    const current = ++loadId;
    ready = false;
    busy = true;
    error.hidden = true;
    if (!readOnly) {
      status.textContent = '読みこんでいます…';
      body.replaceChildren(status);
    }
    try {
      const reply = await ctx.repo.getReply(classId, lessonId, studentId);
      if (!alive || current !== loadId) return;
      saved = reply;
      ready = true;
      busy = false;
      status.textContent = '';
      showReply();
    } catch {
      if (!alive || current !== loadId) return;
      node.hidden = false;
      status.textContent = '';
      body.replaceChildren(el('p', { class: 'error', role: 'alert', text: readOnly
        ? '先生からの返事を読みこめませんでした。' : '返事を読みこめませんでした。' }),
      el('button', { type: 'button', class: 'btn', text: 'もう一度', onclick: reload }));
    } finally {
      if (alive && current === loadId) busy = false;
    }
  }

  async function write(removing) {
    const current = loadId;
    const value = cleanReply(draft());
    busy = true;
    error.hidden = true;
    status.textContent = '保存しています…';
    syncControls();
    try {
      if (removing) await ctx.repo.removeReply(classId, lessonId, studentId);
      else await ctx.repo.setReply(classId, lessonId, studentId, value, ctx.now());
      if (!alive || current !== loadId) return;
      saved = removing ? null : value;
      showReply();
      status.textContent = removing ? '返事を取り消しました' : '✓ 保存しました（生徒に見えています）';
    } catch {
      if (!alive || current !== loadId) return;
      status.textContent = '';
      error.textContent = '保存できませんでした。もう一度押してください。';
      error.hidden = false;
    } finally {
      if (alive && current === loadId) { busy = false; syncControls(); }
    }
  }

  async function saveReply() {
    if (!alive || readOnly || !state().canSave) return;
    await write(false);
  }

  async function removeReply() {
    if (!alive || readOnly || !ready || busy || confirming || !saved) return;
    confirming = true;
    syncControls();
    try {
      const ok = await confirmDialog({ title: '返事を取り消しますか？',
        body: '生徒の画面から、この返事が消えます。', okLabel: '取り消す', danger: true, signal: dialogs.signal });
      if (ok && alive) await write(true);
    } finally {
      confirming = false;
      if (alive) syncControls();
    }
  }

  async function okToLeave() {
    if (!alive || confirming) return false;
    if (!dirty()) return true;
    confirming = true;
    syncControls();
    try {
      const ok = await confirmDialog({ title: '保存していない返事があります',
        body: 'このまま移ると、書いた返事は消えます。', okLabel: '移る', cancelLabel: 'もどって保存する', signal: dialogs.signal });
      return ok && alive;
    } finally {
      confirming = false;
      if (alive) syncControls();
    }
  }

  void reload();
  return {
    node, reload, okToLeave, get dirty() { return dirty(); },
    destroy() { alive = false; loadId += 1; dialogs.abort(); },
  };
}
