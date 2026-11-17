// 行き先に届くかだけを調べる。DOM・ログイン・返事の中身は使わない。
import { validateReachTargets } from './reach-targets.js';

export async function checkReach(target, {
  fetch: fetchFn = (...a) => globalThis.fetch(...a),
  timeoutMs = 10000,
  setTimeout: setTimer = (...a) => globalThis.setTimeout(...a),
  clearTimeout: clearTimer = (...a) => globalThis.clearTimeout(...a),
  AbortController: Controller = globalThis.AbortController,
  signal,
} = {}) {
  validateReachTargets([target]);
  return new Promise((resolve) => {
    let done = false;
    let timer = null;
    let controller = null;
    const finish = (status, abort = false) => {
      if (done) return;
      done = true;
      if (timer !== null) clearTimer(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
      if (abort && controller) {
        try { controller.abort(); } catch { /* 中止できなくても結果は返す */ }
      }
      resolve(status);
    };
    const onAbort = () => finish('blocked', true);
    try {
      // ページを離れたら、通信もタイマーも止める。
      if (signal && signal.aborted) { finish('blocked'); return; }
      controller = new Controller();
      if (signal) signal.addEventListener('abort', onAbort, { once: true });
      timer = setTimer(() => finish('timeout', true), timeoutMs);
      Promise.resolve(fetchFn(target.url, {
        method: 'GET',
        mode: 'no-cors',
        redirect: 'follow',
        cache: 'no-store',
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        signal: controller.signal,
      })).then(() => finish('ok'), () => finish('blocked'));
    } catch {
      finish('blocked', true);
    }
  });
}

// onResult(result, index) は決まった順。戻り値は行き先の順に並べる。
// signal はページを離れたときの中止用。中止した行・未着手の行は結果に含めない。
export async function runReach(targets, { onResult, limit = 4, signal, ...deps } = {}) {
  const list = validateReachTargets(targets);
  if (list.length === 0) return [];
  if (!Number.isInteger(limit) || limit < 1) throw new TypeError('同時に調べる数は 1 以上の整数にしてください');
  const results = new Array(list.length);
  let next = 0;
  async function worker() {
    while (next < list.length && !(signal && signal.aborted)) {
      const i = next++;
      let status;
      try {
        status = await checkReach(list[i], { ...deps, signal });
      } catch {
        status = 'blocked';
      }
      if (signal && signal.aborted) return;
      const result = { ...list[i], status };
      results[i] = result;
      try {
        if (typeof onResult === 'function') onResult(result, i);
      } catch { /* 1 行の表示で失敗しても、ほかの行き先は続ける */ }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, list.length) }, () => worker()));
  return results.filter(Boolean);
}

// コピーするのは日時・名前とホストと注・ブラウザ・場所だけ。URL のパスや追加の値は出さない。
export function reachText({ results, when, place, browser }) {
  const lines = [`確認した日時: ${when}`];
  if (!Array.isArray(results) || results.length === 0) {
    lines.push('調べる行き先がありません。');
  } else {
    const marks = { ok: '○', blocked: '×', timeout: '△' };
    for (const result of results) {
      lines.push(`${marks[result.status] || '－'} ${result.name}（${new URL(result.url).hostname}）${result.note ? `（${result.note}）` : ''}`);
    }
  }
  lines.push(`ブラウザ: ${browser}`);
  lines.push(`場所: ${place}`);
  return lines.join('\n');
}
