const ALLOWED_ORIGINS = [
  'https://schooldatahuruyama-lgtm.github.io',
  'http://127.0.0.1:8791',
  'http://localhost:8791',
];
export const TARGETS = {
  app: 'https://script.google.com/macros/s/AKfycbxMMvSd3O8xYvOaIvrxT8rISjbn1kDeoYhbzdVR5eJWZDRnvPcBpUEeAOZXPVxAkzXGlg/exec',
  check: 'https://script.google.com/macros/s/AKfycbyOVU7TAYQ-oChU3okxAWMdlguotB2g7_NsNnSs96T4RT9RBQENlJJykpFkP0oJq3G3/exec',
};
const MAX_BODY = 40 * 1024 * 1024;
const VERSION = 'relay-1';

export async function handleRelay(request, { fetch }) {
  const origin = request.headers.get('Origin');
  const allowed = ALLOWED_ORIGINS.includes(origin);
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  };
  if (allowed) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Vary'] = 'Origin';
    headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS';
    headers['Access-Control-Allow-Headers'] = 'Content-Type';
    headers['Access-Control-Max-Age'] = '86400';
  }
  const reply = (status, data) => new Response(data === null ? null : JSON.stringify(data), { status, headers });
  const path = new URL(request.url).pathname;
  if (request.method === 'OPTIONS') return reply(204, null);
  if (request.method === 'GET' && path === '/ping') return reply(200, { ok: true, version: VERSION });
  if (request.method === 'POST' && !allowed) return reply(403, { ok: false, error: 'denied' });
  const target = path === '/gas/app' ? TARGETS.app : path === '/gas/check' ? TARGETS.check : null;
  if (request.method !== 'POST' || !target) return reply(404, { ok: false, error: 'notfound' });
  if (Number(request.headers.get('Content-Length')) > MAX_BODY) return reply(413, { ok: false, error: 'toobig' });

  try {
    // 長さの見出しがなくても、上限を超えたところで読むのを止める。送信前にバイト数を確かめる。
    const chunks = [];
    let size = 0;
    if (request.body) {
      const reader = request.body.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > MAX_BODY) {
            try { await reader.cancel(); } catch { /* 読み取りを止められなくても送らない */ }
            return reply(413, { ok: false, error: 'toobig' });
          }
          chunks.push(value);
        }
      } finally {
        reader.releaseLock();
      }
    }
    const response = await fetch(target, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      redirect: 'follow',
      body: new Blob(chunks),
    });
    return new Response(response.body, { status: response.status, headers });
  } catch {
    return reply(502, { ok: false, error: 'server' });
  }
}

export default {
  async fetch(request) {
    return handleRelay(request, { fetch: (...args) => globalThis.fetch(...args) });
  },
};
