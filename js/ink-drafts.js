// 手書きの下書き。文字の下書きとは別の場所に保存し、保存先の失敗は外へ出さない。
import { CONFIG } from './config.js';
import { cleanInk } from './ink-logic.js';

const PREFIX = 'jugyolog:ink:';
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const draftKey = (studentId, classId, lessonId, field) => `${PREFIX}${studentId}:${classId}:${lessonId}:${field}`;

function clean(value) {
  if (!isObj(value) || !isObj(value.ink) || value.ink.v !== 1
    || !isNum(value.ink.h) || !Array.isArray(value.ink.s)
    || !isNum(value.editedAt) || typeof value.key !== 'string' || !value.key) return null;
  return { ink: cleanInk(value.ink), editedAt: value.editedAt, key: value.key };
}

function parse(text) {
  try { return clean(JSON.parse(text)); } catch { return null; }
}

export function createInkDrafts({ storage }) {
  return {
    get(studentId, classId, lessonId, field) {
      if (!CONFIG.inkFields.includes(field)) return null;
      try { return parse(storage.getItem(draftKey(studentId, classId, lessonId, field))); } catch { return null; }
    },

    put(studentId, classId, lessonId, field, draft) {
      try {
        if (!CONFIG.inkFields.includes(field)) return false;
        const value = clean(draft);
        if (!value) return false;
        storage.setItem(draftKey(studentId, classId, lessonId, field), JSON.stringify(value));
        return true;
      } catch { return false; }
    },

    remove(studentId, classId, lessonId, field) {
      if (!CONFIG.inkFields.includes(field)) return;
      try { storage.removeItem(draftKey(studentId, classId, lessonId, field)); } catch { /* 保存先が使えないときは何もしない */ }
    },

    list(studentId) {
      try {
        const prefix = `${PREFIX}${studentId}:`;
        const out = [];
        for (let i = 0; i < storage.length; i++) {
          const key = storage.key(i);
          if (typeof key !== 'string' || !key.startsWith(prefix)) continue;
          const parts = key.slice(prefix.length).split(':');
          if (parts.length !== 3 || parts.some((part) => part === '') || !CONFIG.inkFields.includes(parts[2])) continue;
          const draft = parse(storage.getItem(key));
          if (draft) out.push({ classId: parts[0], lessonId: parts[1], field: parts[2], ...draft });
        }
        return out;
      } catch { return []; }
    },

    clear() {
      try {
        // 消すと添字がずれるので、後ろから調べる。
        for (let i = storage.length - 1; i >= 0; i--) {
          const key = storage.key(i);
          if (typeof key === 'string' && key.startsWith(PREFIX)) storage.removeItem(key);
        }
      } catch { /* 保存先が使えないときは何もしない */ }
    },
  };
}
