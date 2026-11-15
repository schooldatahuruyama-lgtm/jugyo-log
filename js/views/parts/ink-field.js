// 1 つの欄・写真の手書き。開くまで Drive を読まず、読めなければ書けなくする。
import { el, confirmDialog } from '../../ui.js';
import { CONFIG } from '../../config.js';
import { newId } from '../../ids.js';
import { emptyInk, emptyPictureInk, isEmptyInk, serverInkTime } from '../../ink-logic.js';
import { saveInkFlow, loadInkFlow } from '../../ink-flow.js';
import { createInkSaver } from '../../ink-saver.js';
import { inkThumb } from '../../ink-thumb.js';
import { inkPad } from './ink-pad.js';

export function inkField({ ctx, classId, lessonId, studentId, field, label, index, cleared,
  picture = null, readOnly = false, reloadIndex = null, onState = () => {}, onChange = () => {} }) {
  let alive = true;
  let locked = false;
  let shown = false;
  let currentIndex = index ?? null;
  const inkTime = (next, time) => serverInkTime({ ink: { [field]: next }, inkCleared: { [field]: time } }, field);
  let currentTime = inkTime(currentIndex, cleared);
  let revision = 0;
  // ページを閉じて覚えが消えたファイルは片付けず、Drive に残る（目録からは見えない）。
  const uploaded = new Set();
  let ink = null;
  let pad = null;
  let pending = null;
  let loadId = 0;
  let loadFailed = false;
  let confirmation = null;
  let draftWarned = false;
  let editing = !picture;
  let gone = false;
  let discarded = false;
  const subscribers = new Set();
  const broadcast = () => { for (const fn of subscribers) fn(); };
  const blankInk = () => picture ? emptyPictureInk(picture.width, picture.height) : emptyInk();
  const overlay = el('div', { class: 'picture-ink-overlay' });
  const saveStatus = el('div', { class: 'picture-ink-save', role: 'status' });
  const area = el('div');
  const warning = el('p', { class: 'notice ink-draft-warning', role: 'alert', hidden: true });
  const notice = el('p', { class: 'notice', role: 'status', hidden: true });
  const node = el('div', { class: 'ink-field' }, area, warning, notice, picture && !readOnly ? saveStatus : null);
  const removeDraft = () => {
    if (picture && ctx.inkDrafts.get(studentId, classId, lessonId, field)?.on !== picture.on) return;
    ctx.inkDrafts.remove(studentId, classId, lessonId, field);
  };
  const draft = readOnly ? null : ctx.inkDrafts.get(studentId, classId, lessonId, field);
  const fromDraft = draft && (!picture || draft.on === picture.on) && draft.editedAt > currentTime;
  if (fromDraft) ink = draft.ink;
  else if (draft) removeDraft();

  const hasInk = () => ink !== null ? !isEmptyInk(ink) : !!currentIndex;
  let hadInk = hasInk();
  function notifyChange() {
    const filled = hasInk();
    if (!alive || filled === hadInk) return;
    hadInk = filled;
    onChange(filled);
  }

  const saver = createInkSaver({
    save: (value, editedAt, key) => {
      const sentRevision = revision;
      return ctx.recordQueue.run(`${classId}/${lessonId}`, async () => {
        if (discarded || gone) return;
        const thumb = !picture && CONFIG.inkThumbFields.includes(field) ? inkThumb(value) : null;
        const result = await saveInkFlow({ repo: ctx.repo, files: ctx.files, classId, lessonId, studentId,
          field, ink: value, editedAt, key, ...(picture ? { on: picture.on } : { thumb }),
          onUploaded: (fileId) => uploaded.add(fileId) });
        for (const fileId of uploaded) {
          if (fileId === result.index?.fileId) continue;
          try { await ctx.files.trashStudent(fileId); } catch { /* 保存結果は変えない */ }
          uploaded.delete(fileId);
        }
        if (!alive) return;
        currentIndex = result.index;
        currentTime = result.superseded ? serverInkTime(result.record, field) : editedAt;
        if (result.gone) {
          gone = true;
          editing = false;
          cancelConfirmation();
          loadId += 1;
          pad?.destroy();
          pad = null;
          ink = blankInk();
          area.replaceChildren();
          overlay.replaceChildren();
          notice.textContent = 'この写真は、もうありません。書きこみは保存されませんでした。';
          notice.hidden = false;
          removeDraft();
          notifyChange();
          broadcast();
          return;
        }
        if (result.superseded && sentRevision === revision) {
          replaceInk();
          if (notice.hidden) {
            notice.textContent = 'ほかの端末で書いたほうが新しいので、そちらを出しました。';
            notice.hidden = false;
          }
        }
      });
    },
    saveDraft(value, editedAt, key) {
      revision += 1;
      let saved = false;
      try { saved = ctx.inkDrafts.put(studentId, classId, lessonId, field,
        { ink: value, editedAt, key, ...(picture ? { on: picture.on } : {}) }); }
      catch { /* 保存できなくても通信は続ける */ }
      if (saved === false && !draftWarned && alive) {
        draftWarned = true;
        warning.textContent = 'この iPad に下書きを残せません。保存しましたと出るまで、このページを閉じないでください。';
        warning.hidden = false;
      }
    },
    removeDraft, newKey: () => newId(ctx.random, 24), now: ctx.now, ...ctx.timers,
    delayMs: CONFIG.ink.saveDelayMs, intervalMs: CONFIG.ink.saveIntervalMs, retryMs: CONFIG.save.retryMs,
    onState(state) {
      if (picture && !readOnly) {
        const text = gone ? '' : state === 'saved' ? '✓ 保存しました'
          : ['failed', 'retrying'].includes(state) ? '保存できませんでした' : '保存中…';
        saveStatus.replaceChildren(el('span', { text }));
        if (!gone && ['failed', 'retrying'].includes(state)) saveStatus.append(el('button', {
          type: 'button', class: 'btn', text: 'もう一度', onclick: () => { void saver.retry(); },
        }));
      }
      onState(state);
      broadcast();
    },
  });

  function showPad() {
    if (!alive || pad) return;
    pad = inkPad({ ink, picture: !!picture, readOnly, label: `${label}の${picture ? '書きこみ' : '手書き'}`, onChange(value) {
      if (!alive || locked) return;
      ink = value;
      saver.edit(value);
      notifyChange();
    } });
    pad.setLocked(locked || !editing);
    if (picture) {
      pad.tools.hidden = !editing || readOnly;
      overlay.replaceChildren(pad.paper);
      overlay.classList.toggle('is-editing', editing && !locked && !readOnly);
    }
    area.replaceChildren(pad.node);
    notifyChange();
    broadcast();
  }

  function cancelConfirmation() {
    const request = confirmation;
    confirmation = null;
    request?.abort();
  }

  function replaceInk() {
    cancelConfirmation();
    ink = null;
    loadId += 1;
    pending = null;
    loadFailed = false;
    pad?.destroy();
    pad = null;
    if (picture) { overlay.replaceChildren(); area.replaceChildren(); }
    notifyChange();
    broadcast();
    if (shown) void load();
  }

  function load(refresh = false) {
    if (!alive || gone || pending || pad || confirmation) return pending;
    if (!refresh && (ink !== null || !currentIndex)) {
      ink ??= blankInk();
      showPad();
      return Promise.resolve();
    }
    const current = ++loadId;
    const fileId = currentIndex?.fileId;
    loadFailed = false;
    area.replaceChildren(el('p', { role: 'status', text: picture ? '書きこみを読みこんでいます…' : '手書きを読みこんでいます…' }));
    broadcast();
    pending = Promise.resolve().then(async () => {
      if (refresh && reloadIndex) {
        const latest = await reloadIndex();
        if (!alive || current !== loadId) return null;
        currentIndex = latest.index;
        currentTime = inkTime(currentIndex, latest.cleared);
      }
      return currentIndex ? loadInkFlow({ files: ctx.files, fileId: refresh ? currentIndex.fileId : fileId }) : blankInk();
    }).then((value) => {
      if (!alive || current !== loadId) return;
      ink = value;
      showPad();
    }).catch((error) => {
      if (!alive || current !== loadId) return;
      loadFailed = true;
      const missing = error?.code === 'notfound';
      area.replaceChildren(el('p', { class: 'error', role: 'alert', text: missing
        ? picture ? readOnly ? '書きこみが見つかりませんでした。' : '前の書きこみが見つかりませんでした。'
          : '前に書いた手書きが見つかりませんでした。'
        : picture ? '書きこみを読みこめませんでした。' : '手書きを読みこめませんでした。' }),
        el('button', { type: 'button', class: 'btn', text: 'もう一度', onclick: () => { void load(readOnly); } }));
      if (missing && !readOnly) area.append(el('button', { type: 'button', class: 'btn', text: '新しく書く',
        onclick: async () => {
          if (!alive || locked || pending || pad || confirmation || current !== loadId) return;
          const request = new AbortController();
          confirmation = request;
          try {
            const ok = await confirmDialog({ title: '新しく書きますか？',
              body: picture ? '前に書いた書きこみは、もどせません。空の紙から書き直します。'
                : '前に書いた手書きは、もどせません。空の紙から書き直します。',
              okLabel: '新しく書く', cancelLabel: 'やめる', danger: true, signal: request.signal });
            if (!ok || !alive || locked || current !== loadId) return;
            // 書き始めるまで目録は変えず、保存時に古いファイルの片付けを試す。
            ink = blankInk();
            loadFailed = false;
            showPad();
          } finally { if (confirmation === request) confirmation = null; }
        } }));
    }).finally(() => { if (current === loadId) { pending = null; broadcast(); } });
    return pending;
  }

  if (fromDraft) saver.edit(ink, { editedAt: draft.editedAt, key: draft.key });
  return {
    node, overlay, readOnly,
    get editable() { return alive && !!pad && !readOnly && !locked && !gone; },
    subscribe(fn) { subscribers.add(fn); return () => subscribers.delete(fn); },
    setEditing(value) {
      editing = !!value && !readOnly && !gone;
      if (!editing) cancelConfirmation();
      pad?.setLocked(locked || !editing);
      if (pad && picture) pad.tools.hidden = !editing;
      overlay.classList.toggle('is-editing', editing && !locked);
    },
    show(size) {
      if (!alive) return;
      if (picture && size) { picture.width = size.width; picture.height = size.height; }
      shown = true;
      if (!loadFailed) return load();
    },
    hasInk,
    get dirty() { return !gone && saver.dirty; },
    get state() { return gone ? 'saved' : saver.state; },
    flush() { return saver.flush().then((saved) => gone || saved); },
    retry() { return saver.retry().then((saved) => gone || saved); },
    refresh(next, cleared) {
      const time = inkTime(next, cleared);
      if (!alive || saver.dirty || saver.state === 'saving' || time <= currentTime) return;
      currentIndex = next ?? null;
      currentTime = time;
      replaceInk();
    },
    setLocked(value) {
      if (!alive) return;
      locked = !!value;
      if (locked) cancelConfirmation();
      pad?.setLocked(locked || !editing);
      if (picture) overlay.classList.toggle('is-editing', editing && !locked);
      broadcast();
    },
    destroy({ discard = false } = {}) {
      if (!alive) return;
      discarded = discard;
      alive = false;
      loadId += 1;
      cancelConfirmation();
      pad?.destroy();
      saver.dispose();
      subscribers.clear();
      if (discard && !readOnly) removeDraft();
    },
  };
}
