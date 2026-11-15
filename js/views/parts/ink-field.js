// 1 つの欄の手書き。開くまで Drive を読まず、読めなければ紙を出さない。
import { el, confirmDialog } from '../../ui.js';
import { CONFIG } from '../../config.js';
import { newId } from '../../ids.js';
import { emptyInk, isEmptyInk, serverInkTime } from '../../ink-logic.js';
import { saveInkFlow, loadInkFlow } from '../../ink-flow.js';
import { createInkSaver } from '../../ink-saver.js';
import { inkThumb } from '../../ink-thumb.js';
import { inkPad } from './ink-pad.js';

export function inkField({ ctx, classId, lessonId, studentId, field, label, index, cleared,
  onState = () => {}, onChange = () => {} }) {
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
  const area = el('div');
  const warning = el('p', { class: 'notice ink-draft-warning', role: 'alert', hidden: true });
  const notice = el('p', { class: 'notice', role: 'status', hidden: true });
  const node = el('div', { class: 'ink-field' }, area, warning, notice);
  const removeDraft = () => ctx.inkDrafts.remove(studentId, classId, lessonId, field);
  const draft = ctx.inkDrafts.get(studentId, classId, lessonId, field);
  const fromDraft = draft && draft.editedAt > currentTime;
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
        const thumb = CONFIG.inkThumbFields.includes(field) ? inkThumb(value) : null;
        const result = await saveInkFlow({ repo: ctx.repo, files: ctx.files, classId, lessonId, studentId,
          field, ink: value, editedAt, key, thumb, onUploaded: (fileId) => uploaded.add(fileId) });
        for (const fileId of uploaded) {
          if (fileId === result.index?.fileId) continue;
          try { await ctx.files.trashStudent(fileId); } catch { /* 保存結果は変えない */ }
          uploaded.delete(fileId);
        }
        if (!alive) return;
        currentIndex = result.index;
        currentTime = result.superseded ? serverInkTime(result.record, field) : editedAt;
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
      try { saved = ctx.inkDrafts.put(studentId, classId, lessonId, field, { ink: value, editedAt, key }); }
      catch { /* 保存できなくても通信は続ける */ }
      if (saved === false && !draftWarned && alive) {
        draftWarned = true;
        warning.textContent = 'この iPad に下書きを残せません。保存しましたと出るまで、このページを閉じないでください。';
        warning.hidden = false;
      }
    },
    removeDraft, newKey: () => newId(ctx.random, 24), now: ctx.now, ...ctx.timers,
    delayMs: CONFIG.ink.saveDelayMs, intervalMs: CONFIG.ink.saveIntervalMs, retryMs: CONFIG.save.retryMs, onState,
  });

  function showPad() {
    if (!alive || pad) return;
    pad = inkPad({ ink, label: `${label}の手書き`, onChange(value) {
      if (!alive || locked) return;
      ink = value;
      saver.edit(value);
      notifyChange();
    } });
    pad.setLocked(locked);
    area.replaceChildren(pad.node);
    notifyChange();
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
    notifyChange();
    if (shown) void load();
  }

  function load() {
    if (!alive || pending || pad || confirmation) return pending;
    if (ink !== null || !currentIndex) {
      ink ??= emptyInk();
      showPad();
      return Promise.resolve();
    }
    const current = ++loadId;
    const fileId = currentIndex.fileId;
    loadFailed = false;
    area.replaceChildren(el('p', { role: 'status', text: '手書きを読みこんでいます…' }));
    pending = Promise.resolve().then(() => loadInkFlow({ files: ctx.files, fileId })).then((value) => {
      if (!alive || current !== loadId) return;
      ink = value;
      showPad();
    }).catch((error) => {
      if (!alive || current !== loadId) return;
      loadFailed = true;
      const missing = error?.code === 'notfound';
      area.replaceChildren(el('p', { class: 'error', role: 'alert', text: missing
        ? '前に書いた手書きが見つかりませんでした。' : '手書きを読みこめませんでした。' }),
        el('button', { type: 'button', class: 'btn', text: 'もう一度', onclick: () => { void load(); } }));
      if (missing) area.append(el('button', { type: 'button', class: 'btn', text: '新しく書く',
        onclick: async () => {
          if (!alive || locked || pending || pad || confirmation || current !== loadId) return;
          const request = new AbortController();
          confirmation = request;
          try {
            const ok = await confirmDialog({ title: '新しく書きますか？',
              body: '前に書いた手書きは、もどせません。空の紙から書き直します。',
              okLabel: '新しく書く', cancelLabel: 'やめる', danger: true, signal: request.signal });
            if (!ok || !alive || locked || current !== loadId) return;
            // 書き始めるまで目録は変えず、保存時に古いファイルの片付けを試す。
            ink = emptyInk();
            loadFailed = false;
            showPad();
          } finally { if (confirmation === request) confirmation = null; }
        } }));
    }).finally(() => { if (current === loadId) pending = null; });
    return pending;
  }

  if (fromDraft) saver.edit(ink, { editedAt: draft.editedAt, key: draft.key });
  return {
    node,
    show() {
      if (!alive) return;
      shown = true;
      if (!loadFailed) return load();
    },
    hasInk,
    get dirty() { return saver.dirty; },
    get state() { return saver.state; },
    flush() { return saver.flush(); },
    retry() { return saver.retry(); },
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
      pad?.setLocked(locked);
    },
    destroy() {
      alive = false;
      loadId += 1;
      cancelConfirmation();
      pad?.destroy();
      saver.dispose();
    },
  };
}
