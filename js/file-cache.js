// ファイルだけを取り置く。Cache API が使えなければ、このページのメモリで続ける。
export function createFileCache({ caches, name = 'jugyolog-files-v1' }) {
  const memory = new Map();
  let available = Boolean(caches);
  let tail = Promise.resolve();
  const keyFor = (fileId) => `https://files.jugyolog.invalid/${encodeURIComponent(fileId)}`;

  // 保存中に全消去されても、先の保存があとから復活しないよう順番に行う
  function run(work) {
    const result = tail.then(work);
    tail = result.catch(() => {});
    return result;
  }

  async function useCache(work) {
    if (!available) return null;
    try {
      return await work(await caches.open(name));
    } catch {
      // 消去に失敗した古い資料を、あとから読み直さない
      available = false;
      return null;
    }
  }

  return {
    get(fileId) {
      return run(async () => {
        if (memory.has(fileId)) return memory.get(fileId);
        const blob = await useCache(async (cache) => {
          const response = await cache.match(keyFor(fileId));
          return response ? response.blob() : null;
        });
        if (blob) memory.set(fileId, blob);
        return blob;
      });
    },
    put(fileId, blob) {
      return run(async () => {
        memory.set(fileId, blob);
        await useCache((cache) => cache.put(keyFor(fileId), new Response(blob)));
      });
    },
    remove(fileId) {
      return run(async () => {
        memory.delete(fileId);
        await useCache((cache) => cache.delete(keyFor(fileId)));
      });
    },
    clear() {
      return run(async () => {
        memory.clear();
        // 保存などに失敗していても、残っている Cache の消去は試す
        try { await caches?.delete(name); } catch { available = false; }
      });
    },
  };
}
