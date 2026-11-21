// アプリのファイルだけを取り置く。Firebase・GAS など別 origin の通信は扱わない。
const version = (new URLSearchParams(self.location.search).get('v') || 'dev').replace(/[^a-zA-Z0-9._-]/g, '-');
const CACHE_NAME = `jugyolog-app-${version}`;
const MANIFEST = 'app-files.json';
const TIMEOUT_MS = 5000;
const base = new URL(self.registration.scope);
let installedFiles = null;

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const response = await fetch(new URL(MANIFEST, base).href, { cache: 'no-store' });
    let files = null;
    if (response.status === 200) {
      try {
        const manifest = await response.json();
        if (manifest && typeof manifest.version === 'string' && Array.isArray(manifest.files)) {
          files = new Set(manifest.files.filter((file) => typeof file === 'string').map((file) => new URL(file, base).href)
            .filter((url) => url.startsWith(base.href)));
        }
      } catch { /* 一覧の形が不正なときは、前の版の取り置きを残して起動する */ }
    }
    if (files !== null) {
      const cache = await caches.open(CACHE_NAME);
      for (const url of files) {
        const file = await fetch(url, { cache: 'no-cache' });
        if (file.status !== 200) throw new Error(`アプリのファイルを取得できませんでした: ${file.status}`);
        await cache.put(url, file);
      }
      installedFiles = files;
    }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    try {
      if (installedFiles !== null) {
        for (const name of await caches.keys()) {
          if (name.startsWith('jugyolog-app-') && name !== CACHE_NAME) await caches.delete(name);
        }
        const cache = await caches.open(CACHE_NAME);
        for (const request of await cache.keys()) {
          const url = new URL(request.url);
          url.search = '';
          if (!installedFiles.has(url.href)) await cache.delete(request);
        }
      }
    } catch { /* 片付けができなくても起動する */ }
    await self.clients.claim();
  })());
});

async function cached(request) {
  try {
    const names = [CACHE_NAME, ...(await caches.keys()).filter((name) => name.startsWith('jugyolog-app-') && name !== CACHE_NAME)];
    const requests = request.mode === 'navigate' ? [request, new URL('index.html', base).href] : [request];
    for (const key of requests) {
      for (const name of names) {
        const cache = await caches.open(name);
        const found = await cache.match(key, { ignoreSearch: true });
        if (found) return found;
      }
    }
  } catch { /* 取り置きが使えないときはネットの結果を使う */ }
  return null;
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== base.origin || !url.href.startsWith(base.href)
    || request.cache === 'no-store' || /\/(app-files\.json|version\.txt|sw\.js)$/.test(url.pathname)) return;

  const network = (async () => {
    const response = await fetch(request);
    if (response.status === 200 && response.type === 'basic') {
      try {
        const cache = await caches.open(CACHE_NAME);
        const key = new URL(request.url);
        key.search = ''; // ignoreSearch で探すときに、古いクエリ付きの写しを残さない
        await cache.put(key.href, response.clone());
      } catch { /* 容量不足でも、取れたファイルを返す */ }
    }
    return response;
  })();
  // 時間切れで取り置きを返したあとも、ネットからの更新を続ける。
  event.waitUntil(network.catch(() => {}));
  event.respondWith((async () => {
    let timer;
    const timeout = new Promise((resolve) => {
      timer = setTimeout(async () => {
        const found = await cached(request);
        if (found) resolve(found);
      }, TIMEOUT_MS);
    });
    try {
      return await Promise.race([network.catch(async (error) => {
        const found = await cached(request);
        if (found) return found;
        throw error;
      }), timeout]);
    } finally { clearTimeout(timer); }
  })());
});
