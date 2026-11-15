// 手書きの下書き・保存の間隔・再試行をまとめる。通信は必ず 1 本ずつ送る。
import { CONFIG } from './config.js';
import { cleanInk } from './ink-logic.js';

export function createInkSaver({
  save, saveDraft, removeDraft, newKey, now, setTimeout: setTimer, clearTimeout: clearTimer,
  delayMs = CONFIG.ink.saveDelayMs, intervalMs = CONFIG.ink.saveIntervalMs,
  retryMs = CONFIG.save.retryMs, onState = () => {},
}) {
  let state = 'idle';
  let dirty = false;
  let disposed = false;
  let ink = null;
  let editedAt = null;
  let key = null;
  let revision = 0;
  let retryIndex = 0;
  let lastEdit = 0;
  let lastStarted = null;
  let timer = null;
  let generation = 0;
  let pending = null;
  let immediate = false;

  function setState(next) {
    if (disposed || state === next) return;
    state = next;
    onState(state);
  }

  function stopTimer() {
    generation += 1;
    if (timer !== null) clearTimer(timer);
    timer = null;
  }

  function schedule(ms) {
    stopTimer();
    if (disposed) return;
    const current = generation;
    timer = setTimer(() => {
      if (disposed || current !== generation) return;
      timer = null;
      void send(false);
    }, ms);
  }

  function scheduleChanges() {
    const due = Math.max(lastEdit + delayMs, lastStarted === null ? 0 : lastStarted + intervalMs);
    schedule(Math.max(0, due - now()));
  }

  async function sendChanges() {
    try {
      while (dirty && !disposed) {
        const sentRevision = revision;
        const sentInk = ink;
        const sentEditedAt = editedAt;
        const sentKey = key;
        lastStarted = now();
        setState('saving');
        if (disposed) return false;
        try {
          await save(sentInk, sentEditedAt, sentKey);
        } catch (error) {
          if (disposed) return false;
          // 前の内容の失敗で、保存中に書き足した内容の待ち時間を変えない。
          if (sentRevision !== revision) {
            if (immediate) continue;
            setState('dirty');
            scheduleChanges();
          } else if (immediate || error?.code === 'denied' || retryIndex >= retryMs.length) {
            setState('failed');
          } else {
            const ms = retryMs[retryIndex++];
            setState('retrying');
            schedule(ms);
          }
          return false;
        }
        // 画面を離れた後は、保存が成功しても下書きを消さない。
        if (disposed) return false;
        retryIndex = 0;
        if (sentRevision !== revision) {
          if (immediate) continue;
          setState('dirty');
          scheduleChanges();
          return false;
        }
        dirty = false;
        try { removeDraft(); } catch { /* 下書きを消せなくても、サーバーへの保存は成功している */ }
        setState('saved');
      }
      return !dirty;
    } finally {
      pending = null;
      immediate = false;
    }
  }

  function send(flush) {
    stopTimer();
    if (disposed) return Promise.resolve(false);
    if (!dirty) return Promise.resolve(true);
    if (pending) {
      if (flush) immediate = true;
      return pending;
    }
    immediate = flush;
    pending = Promise.resolve().then(sendChanges);
    return pending;
  }

  return {
    edit(value, { editedAt: restoredEditedAt, key: restoredKey } = {}) {
      if (disposed) return;
      ink = cleanInk(value);
      lastEdit = now();
      editedAt = Number.isFinite(restoredEditedAt) ? restoredEditedAt : lastEdit;
      key = restoredKey ?? newKey();
      revision += 1;
      retryIndex = 0;
      dirty = true;
      stopTimer();
      try { saveDraft(ink, editedAt, key); } catch { /* 端末に残せなくても、サーバーへの保存を続ける */ }
      setState('dirty');
      if (!pending) scheduleChanges();
    },
    flush() { return send(true); },
    retry() {
      return state === 'failed' || state === 'retrying' ? send(true) : Promise.resolve(!dirty);
    },
    get dirty() { return dirty; },
    get state() { return state; },
    dispose() {
      disposed = true;
      stopTimer();
    },
  };
}
