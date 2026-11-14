// 小さい画像を更新時刻と一緒に取り置く。取り置きが使えなくても読み取りは続ける。
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

export function createThumbStore({ repo, cache, Blob = globalThis.Blob }) {
  const pending = new Map();
  let generation = 0;

  async function read(lesson, key, version) {
    try {
      const blob = await cache.get(key);
      if (blob) {
        const value = JSON.parse(await blob.text());
        if (isObj(value) && value.updatedAt === lesson.updatedAt && isObj(value.thumbs)
          && Object.values(value.thumbs).every((thumb) => typeof thumb === 'string')) return value.thumbs;
      }
    } catch { /* 読めない取り置きは使わず、サーバーから読む */ }
    const thumbs = await repo.getThumbs(lesson.classId, lesson.id);
    try {
      // 消去前に始まった読みこみは、取り置きへ戻さない。
      if (version === generation) await cache.put(key, new Blob([JSON.stringify({ updatedAt: lesson.updatedAt, thumbs })], { type: 'application/json' }));
    } catch { /* 取り置けなくても、今回読み取った画像は返す */ }
    return thumbs;
  }

  return {
    load(lesson) {
      if (!isObj(lesson.materials) || Object.keys(lesson.materials).length === 0) return Promise.resolve({});
      const { classId, id, updatedAt } = lesson;
      const key = `thumbs-${classId}-${id}`;
      const current = pending.get(key);
      if (current && current.updatedAt === updatedAt) return current.promise;
      const version = generation;
      // 更新前の取得が残っているときは待ち、古い画像で新しい取り置きを上書きしない。
      const promise = (current ? current.promise.catch(() => {}) : Promise.resolve())
        .then(() => read({ classId, id, updatedAt }, key, version))
        .finally(() => { if (pending.get(key)?.promise === promise) pending.delete(key); });
      pending.set(key, { updatedAt, promise });
      return promise;
    },

    clear() {
      generation += 1;
      pending.clear();
    },
  };
}
