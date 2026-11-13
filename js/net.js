// データベース（Firebase Realtime Database）の読み書き
// データベースの URL の形を知っているのはこのモジュールだけ。fetch とタイマーは引数で受け取る。
// パスは先頭と末尾に `/` のない文字列（例 'classes/abc/roster'）。'' はルート。
// 変化の受信（EventSource）は使わない。
import { NetError } from './errors.js';
import { CONFIG } from './config.js';

export function createNet({
  databaseURL,
  auth,
  fetch,
  timeoutMs = CONFIG.requestTimeoutMs,
  setTimeout: setTimer = globalThis.setTimeout,
  clearTimeout: clearTimer = globalThis.clearTimeout,
}) {
  const base = String(databaseURL).replace(/\/+$/, '');
  // token が無いとき（getPublic）は ?auth= を付けない
  const urlFor = (path, token) => (token === undefined
    ? `${base}/${path}.json`
    : `${base}/${path}.json?auth=${encodeURIComponent(token)}`);

  // 実物の Firebase は、規則による拒否も HTTP 401 で返す（本文は {"error":"Permission denied"}）。
  // 期限切れ・無効なトークンも 401 だが、本文の文が違う。本文で見分ける
  async function isPermissionDenied(res) {
    try {
      const body = await res.json();
      return !!body && typeof body.error === 'string' && /permission denied/i.test(body.error);
    } catch {
      return false; // 本文が読めないときは、認証の失敗として扱う
    }
  }
  const denied = () => new NetError('denied', '権限がありません');

  // 本文の JSON を読む。受信に失敗したら network、JSON として不正なら unknown（null にしない）
  async function readJson(res) {
    try {
      return await res.json();
    } catch (e) {
      if (e && e.name === 'SyntaxError') throw new NetError('unknown', '応答が JSON ではありません');
      throw new NetError('network', '応答を読み込めませんでした');
    }
  }

  // 1 回の要求（送信〜本文を読み終わるまで）。timeoutMs をすぎたら fetch を止めて network にする。
  // 戻り値: { status, ok, permissionDenied（401 のときだけ）, data（readBody で成功のときだけ） }
  async function attempt(method, path, body, token, readBody) {
    const controller = new AbortController();
    const init = { method, signal: controller.signal };
    if (body !== undefined) {
      init.headers = { 'Content-Type': 'application/json' };
      init.body = JSON.stringify(body);
    }
    async function work() {
      let res;
      try {
        res = await fetch(urlFor(path, token), init);
      } catch {
        throw new NetError('network', 'ネットワークにつながりません');
      }
      const out = { status: res.status, ok: res.ok };
      if (res.status === 401) out.permissionDenied = await isPermissionDenied(res);
      else if (res.ok && readBody) out.data = await readJson(res);
      return out;
    }
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimer(() => {
        controller.abort();
        reject(new NetError('network', '時間内に返事がありませんでした'));
      }, timeoutMs);
    });
    try {
      return await Promise.race([work(), timeout]);
    } finally {
      clearTimer(timer);
    }
  }

  // 401 のとき: 規則による拒否ならすぐ denied。それ以外は 1 回だけトークンを取り直してやり直す
  async function request(method, path, body, readBody = false) {
    let r = await attempt(method, path, body, await auth.getToken(), readBody);
    if (r.status === 401) {
      if (r.permissionDenied) throw denied();
      r = await attempt(method, path, body, await auth.forceRefresh(), readBody);
      if (r.status === 401) {
        if (r.permissionDenied) throw denied();
        throw new NetError('auth', 'ログインが無効です');
      }
    }
    if (r.status === 403) throw denied();
    if (!r.ok) throw new NetError('unknown', `HTTP ${r.status}`);
    return r;
  }

  // トークンを付けずに読む。取り直すトークンが無いので、401・403 はすべて denied
  async function requestPublic(method, path) {
    const r = await attempt(method, path, undefined, undefined, true);
    if (r.status === 401 || r.status === 403) throw denied();
    if (!r.ok) throw new NetError('unknown', `HTTP ${r.status}`);
    return r;
  }

  return {
    async get(path) {
      const { data } = await request('GET', path, undefined, true);
      return data === undefined ? null : data;
    },
    async getPublic(path) {
      const { data } = await requestPublic('GET', path);
      return data === undefined ? null : data;
    },
    async set(path, value) { await request('PUT', path, value); },
    // path が '' ならルートへの複数パスの書きこみ（patch のキーに 'a/b' の形を使える）
    async update(path, patch) { await request('PATCH', path, patch); },
    async remove(path) { await request('DELETE', path); },
    serverTimestamp() { return { '.sv': 'timestamp' }; },
  };
}
