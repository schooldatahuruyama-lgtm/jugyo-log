// 読んだデータを取り置く。Cache API が使えなければ、このページのメモリで続ける。
export function createOfflineStore({ caches, name = 'jugyolog-data-v1' }) {
  const memory = new Map();
  let available = Boolean(caches);
  let tail = Promise.resolve();
  const prefixFor = (scope) => `https://data.jugyolog.invalid/${encodeURIComponent(scope)}/`;
  const keyFor = (scope, key) => `${prefixFor(scope)}${encodeURIComponent(key)}`;

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
      available = false; // 消せなかった古い内容を、あとから読み直さない
      return null;
    }
  }

  return {
    get(scope, key) {
      return run(async () => {
        const url = keyFor(scope, key);
        let raw = memory.get(url);
        if (raw === undefined) raw = await useCache(async (cache) => {
          const response = await cache.match(url);
          return response ? response.text() : null;
        });
        try {
          const data = JSON.parse(raw);
          if (!data || !Object.hasOwn(data, 'v')) return null;
          memory.set(url, raw);
          return { value: data.v };
        } catch { return null; }
      });
    },
    put(scope, key, value) {
      return run(async () => {
        let raw;
        try { raw = JSON.stringify({ v: value }); } catch { return; }
        const url = keyFor(scope, key);
        memory.set(url, raw);
        await useCache((cache) => cache.put(url, new Response(raw)));
      });
    },
    removeWhere(scope, test) {
      return run(async () => {
        const prefix = prefixFor(scope);
        const matches = (url) => {
          if (!url.startsWith(prefix)) return false;
          try { return test(decodeURIComponent(url.slice(prefix.length))); } catch { return false; }
        };
        for (const url of memory.keys()) if (matches(url)) memory.delete(url);
        await useCache(async (cache) => {
          for (const request of await cache.keys()) {
            if (matches(request.url)) await cache.delete(request);
          }
        });
      });
    },
    clear() {
      return run(async () => {
        memory.clear();
        try { await caches?.delete(name); } catch { available = false; }
      });
    },
  };
}
