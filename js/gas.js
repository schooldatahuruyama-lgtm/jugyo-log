// GAS への通信。やり直しを含めて 1 つずつ送り、トークンや本文をエラーに残さない。
import { NetError } from './errors.js';
import { CONFIG } from './config.js';

export function createGas({
  url, auth, fetch,
  timeoutMs = CONFIG.gas.timeoutMs,
  maxTries = CONFIG.gas.maxTries,
  retryBaseMs = CONFIG.gas.retryBaseMs,
  random = Math.random,
  setTimeout: setTimer = globalThis.setTimeout,
  clearTimeout: clearTimer = globalThis.clearTimeout,
}) {
  let tail = Promise.resolve();
  let pending = 0;

  function checkUser(uid) {
    if (uid === null || (auth.user?.uid ?? null) !== uid) throw new NetError('auth');
  }

  // 送信から本文を読み終わるまでを、1 回の時間切れで止める
  async function attempt(op, payload, token) {
    const controller = new AbortController();
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimer(() => {
        controller.abort();
        reject(new NetError('network'));
      }, timeoutMs);
    });
    async function work() {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ op, token, ...payload }),
        signal: controller.signal,
      });
      return res.json();
    }
    try {
      return await Promise.race([work(), timeout]);
    } catch {
      throw new NetError('network');
    } finally {
      clearTimer(timer);
    }
  }

  async function tokenFrom(refresh = false) {
    try {
      return await (refresh ? auth.forceRefresh() : auth.getToken());
    } catch (e) {
      const code = e instanceof NetError && ['auth', 'network'].includes(e.code) ? e.code : 'unknown';
      throw new NetError(code);
    }
  }

  async function request(op, payload, uid) {
    checkUser(uid);
    if (!url) throw new NetError('unknown');
    let failures = 0;
    let refreshed = false;
    while (true) {
      checkUser(uid);
      const token = await tokenFrom();
      checkUser(uid);
      let response;
      try {
        response = await attempt(op, payload, token);
      } catch {
        response = { ok: false, error: 'server' };
      }
      if (response?.ok === true) return response;
      const error = response?.error;
      if (error === 'auth') {
        checkUser(uid);
        if (refreshed) throw new NetError('auth');
        refreshed = true;
        await tokenFrom(true);
        continue;
      }
      if (error !== 'server') {
        throw new NetError(['denied', 'notfound', 'toobig'].includes(error) ? error : 'unknown');
      }
      failures += 1;
      if (failures >= maxTries) throw new NetError('network');
      const delay = retryBaseMs * 2 ** (failures - 1) * (0.5 + random());
      await new Promise((resolve) => setTimer(resolve, delay));
    }
  }

  return {
    call(op, payload = {}) {
      // 順番待ちややり直しの間に、別の人のトークンで送らない
      const uid = auth.user?.uid ?? null;
      const body = { ...payload };
      pending += 1;
      const result = tail.then(() => request(op, body, uid)).finally(() => { pending -= 1; });
      // 失敗しても、次の呼び出しの順番待ちは止めない
      tail = result.catch(() => {});
      return result;
    },
    get busy() { return pending > 0; },
  };
}
