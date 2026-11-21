// 最後に確かめた生徒の uid と生徒 ID だけを残す。
import { isStudentId } from './ids.js';

export function createSessionMemo({ storage, key = 'jugyolog:session' }) {
  return {
    get() {
      try {
        const value = JSON.parse(storage.getItem(key));
        if (typeof value?.uid !== 'string' || !value.uid || !isStudentId(value.studentId)) return null;
        return { uid: value.uid, studentId: value.studentId };
      } catch { return null; }
    },
    put({ uid, studentId }) {
      try { storage.setItem(key, JSON.stringify({ uid, studentId })); } catch { /* 保存できなくても続ける */ }
    },
    clear() {
      try { storage.removeItem(key); } catch { /* 保存先が使えなくても続ける */ }
    },
  };
}
