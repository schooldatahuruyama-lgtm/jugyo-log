// 保存した記録を、画面を離れたあとも読み直して取り置く。
export function createOfflineRefresh({ repo, setTimeout: setTimer, clearTimeout: clearTimer, delayMs }) {
  const timers = new Map();
  return {
    touch(classId, lessonId, studentId) {
      const key = JSON.stringify([classId, lessonId, studentId]);
      if (timers.has(key)) clearTimer(timers.get(key));
      const timer = setTimer(async () => {
        if (timers.get(key) !== timer) return;
        timers.delete(key);
        try { await repo.getRecord(classId, lessonId, studentId); } catch { /* 次に開いたときに読み直す */ }
      }, delayMs);
      timers.set(key, timer);
    },
    clear() {
      for (const timer of timers.values()) clearTimer(timer);
      timers.clear();
    },
  };
}
