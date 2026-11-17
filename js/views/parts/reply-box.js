// 先生の返事。記録の保存状態とは別に読みこみ・保存を扱う。
import { el, confirmDialog } from '../../ui.js';
import { CONFIG } from '../../config.js';
import { cleanReply, replyEditState, replyDateLabel, stampKind } from '../../reply-logic.js';
import { headingIcon } from './heading-icon.js';

export function replyBox({ ctx, classId, lessonId, studentId, readOnly = false, onReply = () => {} }) {
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
  const stamp = el('div', { class: 'reply-stamp' });
  const stampButton = el('button', { type: 'button', class: 'btn', text: 'スタンプを押す', onclick: toggleStamp });
  const save = el('button', { type: 'button', class: 'btn btn-primary', text: '保存する', onclick: saveReply });
  const remove = el('button', { type: 'button', class: 'btn btn-danger-text', text: '返事を取り消す', onclick: removeReply });
  const editor = el('div', { class: 'reply-editor' },
    el('label', { class: 'label', for: 'reply-text', text: '返事' }), text,
    el('p', { class: 'small reply-count' }, el('span', { id: 'reply-help', text: `${max} 文字まで` }), count), limit,
    el('div', { class: 'reply-stamp-controls' }, stamp, stampButton),
    el('div', { class: 'page-actions' }, save, remove));
  const body = el('div', { class: 'lesson-section-body' });
  const node = el('section', { class: 'reply-box', hidden: readOnly, 'aria-labelledby': 'reply-heading' },
    el('header', { class: 'lesson-section-band' },
      el('h2', { id: 'reply-heading' }, headingIcon('teacher'), el('span', { text: '先生から' }))), body);

  const draft = () => ({ text: text.value, seen: saved?.seen === true });
  const state = () => replyEditState(draft(), saved, busy || confirming || !ready);
  const dirty = () => !readOnly && ready && state().dirty;

  function syncControls() {
    const value = state();
    text.disabled = stampButton.disabled = busy || confirming || !ready;
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

  function showReply(preserveDraft = false) {
    node.hidden = readOnly && !saved?.text;
    if (readOnly) {
      body.replaceChildren(...(saved?.text ? [
        el('p', { class: 'reply-text', text: saved.text }),
        el('p', { class: 'small reply-date', text: replyDateLabel(saved.updatedAt) }),
      ] : []));
      onReply(saved);
      return;
    }
    if (!preserveDraft) text.value = saved?.text ?? '';
    stamp.hidden = !saved?.seen;
    stamp.replaceChildren(...(saved?.seen ? [
      el('img', { class: 'reply-stamp-image', src: `assets/stamps/seen-${stampKind({ studentId, lessonId, updatedAt: saved.updatedAt })}.svg`,
        width: 56, height: 56, alt: '' }),
      el('span', { text: 'スタンプを押してあります' }),
    ] : []));
    stampButton.textContent = saved?.seen ? 'スタンプを取り消す' : 'スタンプを押す';
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

  async function write(value, message) {
    const current = loadId;
    busy = true;
    error.hidden = true;
    status.textContent = '保存しています…';
    syncControls();
    try {
      const now = ctx.now();
      if (!value) await ctx.repo.removeReply(classId, lessonId, studentId);
      else await ctx.repo.setReply(classId, lessonId, studentId, value, now);
      if (!alive || current !== loadId) return;
      saved = value ? { ...value, updatedAt: now } : null;
      showReply();
      status.textContent = message;
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
    await write(cleanReply(draft()), '✓ 保存しました（生徒に見えています）');
  }

  async function toggleStamp() {
    if (!alive || readOnly || !ready || busy || confirming) return;
    const current = loadId;
    const seen = saved?.seen !== true;
    const preserveDraft = dirty();
    // スタンプだけを変える。保存済みの文と、入力欄の書きかけは別々に残す。
    busy = true;
    error.hidden = true;
    status.textContent = '保存しています…';
    syncControls();
    let failed = false;
    let result = null;
    try {
      try {
        const now = ctx.now();
        if (seen) await ctx.repo.stampReplies(classId, lessonId, [studentId], now);
        else result = await ctx.repo.unstampReply(classId, lessonId, studentId, now);
      } catch {
        failed = true;
      }
      if (!alive || current !== loadId) return;
      // 取り消しは戻り値を使い、押した場合や失敗時は最新の返事を読み直す。
      try {
        const reply = result ? result.reply : await ctx.repo.getReply(classId, lessonId, studentId);
        if (!alive || current !== loadId) return;
        saved = reply;
        showReply(preserveDraft);
      } catch {
        failed = true;
      }
      if (!alive || current !== loadId) return;
      status.textContent = failed ? '' : seen
        ? 'スタンプを押しました（生徒に見えています）' : 'スタンプを取り消しました';
      error.textContent = '保存できませんでした。もう一度押してください。';
      error.hidden = !failed;
    } finally {
      if (alive && current === loadId) { busy = false; syncControls(); }
    }
  }

  async function removeReply() {
    if (!alive || readOnly || !ready || busy || confirming || !saved) return;
    confirming = true;
    syncControls();
    try {
      const ok = await confirmDialog({ title: '返事を取り消しますか？',
        body: '生徒の画面から、この返事が消えます。', okLabel: '取り消す', danger: true, signal: dialogs.signal });
      if (ok && alive) await write(null, '返事を取り消しました');
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
