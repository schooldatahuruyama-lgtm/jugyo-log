// 下書きをすぐに残し、待ち時間と再試行をまとめて扱う。通信は必ず 1 本ずつ送る。
import { CONFIG } from './config.js';
import { NetError } from './errors.js';
import { normalizeRecord } from './record-logic.js';

export function createRecordSaver({
  save, saveDraft, removeDraft, now, setTimeout: setTimer, clearTimeout: clearTimer,
  delayMs = CONFIG.save.delayMs, retryMs = CONFIG.save.retryMs, onState = () => {},
}) {
  let state = 'idle';
  let dirty = false;
  let disposed = false;
  let record = null;
  let editedAt = null;
  let revision = 0;
  let retryIndex = 0;
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
    const current = generation;
    timer = setTimer(() => {
      if (disposed || current !== generation) return;
      timer = null;
      send(false);
    }, ms);
  }

  async function sendChanges() {
    try {
      while (dirty && !disposed) {
        const sentRevision = revision;
        const sentRecord = record;
        const sentEditedAt = editedAt;
        setState('saving');
        if (disposed) return false;
        try {
          await save(sentRecord, sentEditedAt);
        } catch (error) {
          if (disposed) return false;
          if (immediate || (error instanceof NetError && error.code === 'denied') || retryIndex >= retryMs.length) {
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
        if (sentRevision !== revision) continue;
        dirty = false;
        try { removeDraft(); } catch { /* 下書きを消せなくても、サーバーへの保存は成功している */ }
        setState('saved');
      }
      return !dirty;
    } finally {
      // 完了直後に入力が来ても、終わった通信を待ち続けない。
      pending = null;
    }
  }

  function send(flush) {
    stopTimer();
    if (disposed || !dirty) return Promise.resolve(!dirty);
    // flush が途中で来たら、今の通信を共有し、自動の再試行を止める。
    if (pending) {
      if (flush) immediate = true;
      return pending;
    }
    immediate = flush;
    pending = Promise.resolve().then(sendChanges);
    return pending;
  }

  return {
    edit(value, { editedAt: restoredEditedAt } = {}) {
      if (disposed) return;
      record = normalizeRecord(value, { max: CONFIG.recordTextMax });
      editedAt = Number.isFinite(restoredEditedAt) ? restoredEditedAt : now();
      revision += 1;
      dirty = true;
      retryIndex = 0;
      stopTimer();
      try { saveDraft(record, editedAt); } catch { /* 端末に残せなくても、サーバーへの保存を続ける */ }
      setState('dirty');
      if (!pending) schedule(delayMs);
    },
    flush() { return send(true); },
    retry() { return send(true); },
    get state() { return state; },
    get dirty() { return dirty; },
    dispose() {
      disposed = true;
      stopTimer();
    },
  };
}
