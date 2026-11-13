// 接続確認の通信の手順（Firebase と GAS）。
// ブラウザのもの（fetch、タイマー、AbortController など）はすべて deps から受け取る（テストで代役に替えるため）。
// 画面に出す文と例外の文には、トークン・パスワード・メールアドレス・uid を入れない（先生が報告に貼るため）。
import {
  EMAIL_DOMAINS,
  GAS_TIMEOUT_MS,
  FIREBASE_TIMEOUT_MS,
  PARALLEL_COUNT,
  studentEmail,
  checkStudentId,
  randomPassword,
  summarizeParallel,
  formatBytes,
} from './check-logic.js';

const IDENTITY_BASE = 'https://identitytoolkit.googleapis.com/v1/';
const TOKEN_URL = 'https://securetoken.googleapis.com/v1/token';

const NOT_READY = '前の項目ができていないため、確認できません';
const GAS_BAD_REPLY = '保存の仕組みから、正しい形の返事がありませんでした';
const GAS_UNREACHABLE = '保存の仕組みにつながりませんでした';
const FIREBASE_UNREACHABLE = 'Firebase につながりませんでした';

// ミリ秒を「0.8 秒」の形にする
function seconds(ms) {
  return (ms / 1000).toFixed(1) + ' 秒';
}

// GAS の error のうち、そのまま画面に出してよいもの（ほかは 'unknown' にする。想定外の値に秘密が入っていても出さないため）
const GAS_ERROR_CODES = ['bad', 'auth', 'server', 'toobig', 'notfound', 'config'];

function gasErrorCode(error) {
  return typeof error === 'string' && GAS_ERROR_CODES.includes(error) ? error : 'unknown';
}

// Realtime Database の REST は error を文字列で返す。決まった一覧に当たるものだけ名前にする
// （大文字小文字と末尾の句点は無視する。一覧にない文は、秘密が入っていても出さないよう UNKNOWN にする）
const DATABASE_ERROR_NAMES = {
  'permission denied': 'PERMISSION_DENIED',
  'auth token is expired': 'TOKEN_EXPIRED',
  'could not parse auth token': 'BAD_TOKEN',
};

function databaseErrorName(text) {
  const key = text.trim().toLowerCase().replace(/[.。]+$/, '');
  return Object.prototype.hasOwnProperty.call(DATABASE_ERROR_NAMES, key) ? DATABASE_ERROR_NAMES[key] : 'UNKNOWN';
}

// Firebase のエラーの返事から、エラーの名前を取り出す。読めなければ 'UNKNOWN'
// - ログイン（error.message）: 先頭の英大文字と _ だけの並び
// - データベース（error が文字列）: databaseErrorName の一覧
function firebaseErrorName(text) {
  try {
    const body = JSON.parse(text);
    if (body && typeof body.error === 'string') return databaseErrorName(body.error);
    const msg = body && body.error && typeof body.error.message === 'string' ? body.error.message : '';
    const m = msg.match(/^[A-Z_]+/);
    if (m) return m[0];
  } catch {
    // JSON でなければ UNKNOWN
  }
  return 'UNKNOWN';
}

// deps: { fetch, firebase: { databaseURL, apiKey }, gasUrl, now: () => number, random: () => number,
//         setTimeout, clearTimeout, AbortController }
// 戻り値の各関数は、成功したら詳細（文字列。無ければ ''）を返し、失敗したら Error を投げる（message は画面に出す日本語）。
export function createCheckSteps(deps) {
  const dbBase = String(deps.firebase.databaseURL || '').replace(/\/+$/, '');
  const apiKey = encodeURIComponent(deps.firebase.apiKey || '');

  // この実行の中で使う値
  let runId = null; // 確認用の生徒 ID。写真の key にも使う
  let password = null;
  let domain = null;
  let email = null;
  let uid = null;
  let idToken = null;
  let refreshToken = null;
  let fileId = null;

  function ensureRunId() {
    if (runId === null) runId = checkStudentId(deps.random);
    return runId;
  }

  // fetch して本文を文字列で読むまでを、timeoutMs で打ち切る。
  // fetch が例外を投げたら unreachable の文の Error を投げる。
  // （待ち時間のタイマーは、fetch を呼ぶ前に同じ流れの中で仕掛ける）
  function request(url, init, timeoutMs, unreachable) {
    const controller = new deps.AbortController();
    let timer = null;
    const timeout = new Promise((_, reject) => {
      timer = deps.setTimeout(() => {
        timer = null;
        reject(new Error(`${timeoutMs / 1000} 秒たっても返事がありませんでした`));
        controller.abort();
      }, timeoutMs);
    });
    const work = (async () => {
      // 本文の読み取りの途中で切れたときも、つながらなかったのと同じに扱う
      // （時間切れのときは、先に timeout が reject しているので時間切れの文になる）
      try {
        const res = await deps.fetch(url, { ...init, signal: controller.signal });
        const text = await res.text();
        return { status: res.status, ok: res.ok, text };
      } catch {
        throw new Error(unreachable);
      }
    })();
    return Promise.race([work, timeout]).finally(() => {
      if (timer !== null) deps.clearTimeout(timer);
    });
  }

  // Firebase に送り、2xx なら JSON を返す。そうでなければ what（エラーの名前、HTTP の状態番号）の文で投げる。
  // 投げる Error には、名前を firebaseError として、かっこの中の文を reasonText として付ける
  async function firebase(url, init, what) {
    const r = await request(url, init, FIREBASE_TIMEOUT_MS, FIREBASE_UNREACHABLE);
    if (!r.ok) {
      const name = firebaseErrorName(r.text);
      const reasonText = `${name}、HTTP ${r.status}`;
      const err = new Error(`${what}（${reasonText}）`);
      err.firebaseError = name;
      err.reasonText = reasonText;
      throw err;
    }
    try {
      return JSON.parse(r.text);
    } catch {
      const err = new Error(`${what}（返事の形が正しくありません）`);
      err.reasonText = '返事の形が正しくありません';
      throw err;
    }
  }

  function identity(method, body, what) {
    return firebase(
      `${IDENTITY_BASE}accounts:${method}?key=${apiKey}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
      what,
    );
  }

  // ログインの返事から、トークンと uid を覚える
  function remember(res, what) {
    const tok = res && (res.idToken ?? res.id_token);
    const ref = res && (res.refreshToken ?? res.refresh_token);
    const id = res && (res.localId ?? res.user_id);
    if (typeof tok !== 'string' || typeof ref !== 'string' || typeof id !== 'string') {
      throw new Error(`${what}（返事の形が正しくありません）`);
    }
    idToken = tok;
    refreshToken = ref;
    uid = id;
  }

  // GAS に送る。成功（ok: true）なら返事の JSON を返す
  async function gas(body) {
    const r = await request(
      deps.gasUrl,
      { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) },
      GAS_TIMEOUT_MS,
      GAS_UNREACHABLE,
    );
    let res;
    try {
      res = JSON.parse(r.text);
    } catch {
      throw new Error(GAS_BAD_REPLY);
    }
    if (!res || typeof res !== 'object' || Array.isArray(res) || typeof res.ok !== 'boolean') {
      throw new Error(GAS_BAD_REPLY);
    }
    if (!res.ok) throw new Error('保存の仕組みが断りました（' + gasErrorCode(res.error) + '）');
    return res;
  }

  function needToken() {
    if (!idToken) throw new Error(NOT_READY);
  }

  function needFile() {
    if (!idToken || !fileId) throw new Error(NOT_READY);
  }

  function getPhoto() {
    return gas({ op: 'get', token: idToken, id: fileId });
  }

  return {
    // 1. check/ping を読む
    async readPing() {
      const v = await firebase(`${dbBase}/check/ping.json`, { method: 'GET' }, 'check/ping を読めませんでした');
      // 値の種類を「文字」のまま入れたとき（"true"）は、直し方がわかる文にする
      if (v === 'true') throw new Error('check/ping が文字の "true" になっています。種類を boolean にしてください');
      if (v !== true) throw new Error('check/ping に true が入っていません');
      return '';
    },

    // 2. 生徒用の形のアカウントを作る。詳細は使えたドメイン
    async signUp() {
      const id = ensureRunId();
      if (password === null) password = randomPassword(deps.random);
      for (const d of EMAIL_DOMAINS) {
        const e = studentEmail(id, 1, d);
        let res;
        try {
          res = await identity(
            'signUp',
            { email: e, password, returnSecureToken: true },
            'アカウントを作れませんでした',
          );
        } catch (err) {
          if (err.firebaseError === 'INVALID_EMAIL') continue;
          throw err;
        }
        remember(res, 'アカウントを作れませんでした');
        domain = d;
        email = e;
        return d;
      }
      throw new Error('どのドメインの形も受け付けられませんでした');
    },

    // 3. 作ったアカウントでログインする
    async signIn() {
      if (!email || !password) throw new Error(NOT_READY);
      const what = 'ログインできませんでした';
      const res = await identity('signInWithPassword', { email, password, returnSecureToken: true }, what);
      remember(res, what);
      return '';
    },

    // 4. check/<uid> に数値を書いて読み、同じ値か確かめる
    async writeAndRead() {
      if (!idToken || !uid) throw new Error(NOT_READY);
      const value = Math.floor(deps.random() * 1000000000);
      const url = `${dbBase}/check/${encodeURIComponent(uid)}.json?auth=${encodeURIComponent(idToken)}`;
      const headers = { 'Content-Type': 'application/json' };
      await firebase(url, { method: 'PUT', headers, body: JSON.stringify(value) }, '書き込めませんでした');
      const got = await firebase(url, { method: 'GET' }, '読み出せませんでした');
      if (got !== value) throw new Error('書いた値と読んだ値が違いました');
      return '';
    },

    // 5. 更新用のトークンでログインを更新する
    async refresh() {
      if (!refreshToken) throw new Error(NOT_READY);
      const what = 'ログインを更新できませんでした';
      const res = await firebase(
        `${TOKEN_URL}?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: 'grant_type=refresh_token&refresh_token=' + encodeURIComponent(refreshToken),
        },
        what,
      );
      remember(res, what);
      return '';
    },

    // 6. GAS に届く
    async gasPing() {
      await gas({ op: 'ping' });
      return '';
    },

    // 7. 写真を 1 枚保存する。詳細は「0.8 秒」のようなかかった時間
    async gasPut(dataB64) {
      needToken();
      const t0 = deps.now();
      const res = await gas({ op: 'put', token: idToken, key: ensureRunId(), mime: 'image/jpeg', dataB64 });
      if (typeof res.id !== 'string' || res.id === '') throw new Error(GAS_BAD_REPLY);
      fileId = res.id;
      return seconds(deps.now() - t0);
    },

    // 8. 保存した写真を取り出す。戻り値は { detail, dataB64 }
    async gasGet() {
      needFile();
      const t0 = deps.now();
      const res = await getPhoto();
      if (typeof res.dataB64 !== 'string') throw new Error(GAS_BAD_REPLY);
      return { detail: seconds(deps.now() - t0), dataB64: res.dataB64 };
    },

    // 9. 同時に PARALLEL_COUNT 回取り出す。詳細は「成功 38 / 失敗 2、中央 2.1 秒、最大 6.4 秒」
    async gasParallel() {
      needFile();
      const jobs = [];
      const times = []; // 1 回ごとにかかった時間（失敗・時間切れも数える）
      for (let i = 0; i < PARALLEL_COUNT; i++) {
        const t0 = deps.now();
        jobs.push(
          getPhoto()
            .then((res) => {
              if (typeof res.dataB64 !== 'string') throw new Error(GAS_BAD_REPLY);
            })
            .finally(() => {
              times[i] = deps.now() - t0;
            }),
        );
      }
      const settled = await Promise.allSettled(jobs);
      const runs = settled.map((s, i) => ({ ok: s.status === 'fulfilled', ms: times[i] }));
      const sum = summarizeParallel(runs);
      if (sum.ok === 0) throw new Error(`同時に ${PARALLEL_COUNT} 回取り出して、1 回も成功しませんでした`);
      return `成功 ${sum.ok} / 失敗 ${sum.ng}、中央 ${seconds(sum.medianMs)}、最大 ${seconds(sum.maxMs)}`;
    },

    // 10. Drive の容量。詳細は「全体 100GB、使用 12.3GB」
    async gasQuota() {
      needToken();
      const res = await gas({ op: 'quota', token: idToken });
      if (typeof res.limit !== 'number' || typeof res.used !== 'number') throw new Error(GAS_BAD_REPLY);
      return `全体 ${formatBytes(res.limit)}、使用 ${formatBytes(res.used)}`;
    },

    // 後片付け: GAS の cleanup、データベースの check/<uid> の削除、Firebase のアカウントの削除（accounts:delete）。
    // 失敗しても投げず、詳細に書く
    async cleanup() {
      if (!idToken) return '';
      const notes = [];
      try {
        const res = await gas({ op: 'cleanup', token: idToken });
        notes.push(`確認用の写真 ${Number(res.removed) || 0} 枚をゴミ箱に入れました`);
      } catch (err) {
        notes.push(`写真の後片付けができませんでした（${err.message}）`);
      }
      // アカウントを消すと書き込んだ数値を消せなくなるので、先に消す
      if (uid) {
        try {
          await firebase(
            `${dbBase}/check/${encodeURIComponent(uid)}.json?auth=${encodeURIComponent(idToken)}`,
            { method: 'DELETE' },
            'データベースの後片付けができませんでした',
          );
        } catch (err) {
          notes.push(`データベースの後片付けができませんでした（${err.reasonText ?? err.message}）`);
        }
      }
      try {
        await identity('delete', { idToken }, 'アカウントを消せませんでした');
        notes.push('確認用のアカウントを消しました');
        idToken = null;
        refreshToken = null;
        fileId = null;
      } catch (err) {
        notes.push(err.message);
      }
      return notes.join('、');
    },

    // { domain, uid, hasToken, fileId } を返す（テストと画面用）
    state() {
      return { domain, uid, hasToken: idToken !== null, fileId };
    },
  };
}
