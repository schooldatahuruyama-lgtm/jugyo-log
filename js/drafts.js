// 下書きの保存先は引数で受け取る。端末の保存が使えなくても処理を止めない。
import { CONFIG } from './config.js';
import { normalizeRecord } from './record-logic.js';

const PREFIX = 'jugyolog:draft:';
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const draftKey = (studentId, classId, lessonId) => `${PREFIX}${studentId}:${classId}:${lessonId}`;

function parse(text) {
  try {
    const value = JSON.parse(text);
    if (!isObj(value) || !isObj(value.record) || !isNum(value.editedAt)) return null;
    return { record: normalizeRecord(value.record, { max: CONFIG.recordTextMax }), editedAt: value.editedAt };
  } catch {
    return null;
  }
}

export function createDrafts({ storage }) {
  return {
    get(studentId, classId, lessonId) {
      try {
        return parse(storage.getItem(draftKey(studentId, classId, lessonId)));
      } catch {
        return null;
      }
    },

    put(studentId, classId, lessonId, record, editedAt) {
      try {
        if (!isObj(record) || !isNum(editedAt)) return false;
        const value = { record: normalizeRecord(record, { max: CONFIG.recordTextMax }), editedAt };
        storage.setItem(draftKey(studentId, classId, lessonId), JSON.stringify(value));
        return true;
      } catch {
        return false;
      }
    },

    remove(studentId, classId, lessonId) {
      try {
        storage.removeItem(draftKey(studentId, classId, lessonId));
      } catch { /* 保存先が使えないときは何もしない */ }
    },

    list(studentId) {
      try {
        const prefix = `${PREFIX}${studentId}:`;
        const out = [];
        for (let i = 0; i < storage.length; i++) {
          const key = storage.key(i);
          if (typeof key !== 'string' || !key.startsWith(prefix)) continue;
          const parts = key.slice(prefix.length).split(':');
          if (parts.length !== 2 || parts.some((part) => part === '')) continue;
          const draft = parse(storage.getItem(key));
          if (draft) out.push({ classId: parts[0], lessonId: parts[1], ...draft });
        }
        return out;
      } catch {
        return [];
      }
    },

    clear() {
      try {
        // 消すと添字がずれるので、後ろから調べる
        for (let i = storage.length - 1; i >= 0; i--) {
          const key = storage.key(i);
          if (typeof key === 'string' && key.startsWith(PREFIX)) storage.removeItem(key);
        }
      } catch { /* 保存先が使えないときは何もしない */ }
    },
  };
}
