// 接続確認の通信の手順（Firebase と GAS）を、fetch とタイマーの代役で確かめる
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCheckSteps } from '../js/check-steps.js';
import { PARALLEL_COUNT } from '../js/check-logic.js';

const GAS_URL = 'https://script.example/macros/s/abc/exec';
const DB_URL = 'https://db.example';
const API_KEY = 'test-api-key';
const TOKEN1 = 'aaa.bbb.c1';
const TOKEN2 = 'aaa.bbb.c2';
const TOKEN3 = 'aaa.bbb.c3';
const UID = 'uidXYZ123';
const HANG = Symbol('返事をしない');

// 次の setImmediate まで待つ（それまでに片付く Promise を全部進める）
const tick = () => new Promise((r) => setImmediate(r));

// fetch・タイマー・時計の代役をまとめて作る。
// handler(url, init, ctx) が返事を決める。undefined を返すと、ふつうの成功の返事になる。
function makeDeps(handler = () => undefined) {
  const calls = [];
  const timers = new Map();
  let nextTimer = 1;
  const db = {};
  const ctx = { clock: 0, db };

  function defaultReply(url, init) {
    if (url.startsWith(GAS_URL)) {
      const req = JSON.parse(init.body);
      if (req.op === 'ping') return { json: { ok: true, version: 'check-1' } };
      if (req.op === 'put') return { json: { ok: true, id: 'file-1', existed: false } };
      if (req.op === 'get') return { json: { ok: true, mime: 'image/jpeg', dataB64: 'QUJD' } };
      if (req.op === 'quota') return { json: { ok: true, limit: 107374182400, used: 13207024435 } };
      if (req.op === 'cleanup') return { json: { ok: true, removed: 1 } };
      return { json: { ok: false, error: 'bad' } };
    }
    if (url.includes('accounts:signUp')) return { json: { idToken: TOKEN1, refreshToken: 'r1', localId: UID } };
    if (url.includes('accounts:signInWithPassword'))
      return { json: { idToken: TOKEN2, refreshToken: 'r2', localId: UID } };
    if (url.includes('accounts:delete')) return { json: {} };
    if (url.startsWith('https://securetoken.googleapis.com/v1/token'))
      return { json: { id_token: TOKEN3, refresh_token: 'r3', user_id: UID } };
    if (url === DB_URL + '/check/ping.json') return { json: true };
    const m = url.match(/^https:\/\/db\.example\/check\/([^/.]+)\.json\?auth=(.+)$/);
    if (m) {
      if (init && init.method === 'PUT') {
        db[m[1]] = JSON.parse(init.body);
        return { json: db[m[1]] };
      }
      return { json: m[1] in db ? db[m[1]] : null };
    }
    return { status: 404, text: 'not found' };
  }

  const deps = {
    fetch: async (url, init) => {
      calls.push({ url, init });
      let r = await handler(url, init, ctx);
      if (r === undefined) r = defaultReply(url, init);
      if (r === HANG) return new Promise(() => {});
      const status = r.status ?? 200;
      const ok = status >= 200 && status < 300;
      // 本文の読み取りで失敗する／返事が止まる場合
      if (r.bodyFails) return { ok, status, text: async () => Promise.reject(new TypeError('network error')) };
      if (r.bodyHangs) return { ok, status, text: () => new Promise(() => {}) };
      const body = 'json' in r ? JSON.stringify(r.json) : r.text;
      return { ok, status, text: async () => body };
    },
    firebase: { databaseURL: DB_URL, apiKey: API_KEY },
    gasUrl: GAS_URL,
    now: () => ctx.clock,
    random: (() => {
      let x = 0.137;
      return () => {
        x = (x * 9301 + 0.49297) % 1;
        return x;
      };
    })(),
    setTimeout: (fn, ms) => {
      const id = nextTimer++;
      timers.set(id, { fn, ms });
      return id;
    },
    clearTimeout: (id) => {
      timers.delete(id);
    },
    AbortController,
  };

  // 残っているタイマーを全部動かす
  function fireTimers() {
    for (const [id, t] of [...timers]) {
      timers.delete(id);
      t.fn();
    }
  }

  return { deps, calls, timers, fireTimers, ctx };
}

function bodyOf(call) {
  return JSON.parse(call.init.body);
}

function gasCalls(calls, op) {
  return calls.filter((c) => c.url.startsWith(GAS_URL) && (!op || bodyOf(c).op === op));
}

test('GAS への通信は text/plain の POST で、ほかのヘッダーが無い', async () => {
  const { deps, calls } = makeDeps();
  const steps = createCheckSteps(deps);
  await steps.gasPing();
  const ping = gasCalls(calls, 'ping')[0];
  assert.equal(ping.url, GAS_URL);
  assert.equal(ping.init.method, 'POST');
  assert.deepEqual(Object.keys(ping.init.headers), ['Content-Type']);
  assert.equal(ping.init.headers['Content-Type'], 'text/plain;charset=utf-8');
  assert.equal(bodyOf(ping).op, 'ping');
  assert.equal('token' in bodyOf(ping), false);

  await steps.signUp();
  await steps.gasPut('QUJD');
  const put = gasCalls(calls, 'put')[0];
  assert.equal(put.init.method, 'POST');
  assert.deepEqual(Object.keys(put.init.headers), ['Content-Type']);
  assert.equal(bodyOf(put).token, TOKEN1);
  assert.equal(bodyOf(put).mime, 'image/jpeg');
  assert.equal(bodyOf(put).dataB64, 'QUJD');
  assert.equal(put.url, GAS_URL);
  assert.equal(put.url.includes(TOKEN1), false);
});

test('アカウントは生徒用の形で作り、トークンと uid を覚える', async () => {
  const { deps, calls } = makeDeps();
  const steps = createCheckSteps(deps);
  const detail = await steps.signUp();
  assert.equal(detail.includes('jugyolog.invalid'), true);
  const c = calls[0];
  assert.equal(c.url, 'https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=' + API_KEY);
  assert.equal(c.init.method, 'POST');
  const b = bodyOf(c);
  assert.match(b.email, /^chk-[0-9a-f]{8}\.g1@jugyolog\.invalid$/);
  assert.match(b.password, /^[a-km-np-z2-9]{12}$/);
  assert.equal(b.returnSecureToken, true);
  assert.deepEqual(steps.state(), { domain: 'jugyolog.invalid', uid: UID, hasToken: true, fileId: null });
});

test('INVALID_EMAIL のときだけ次のドメインを試す', async () => {
  let n = 0;
  const { deps, calls } = makeDeps((url) => {
    if (url.includes('accounts:signUp') && ++n === 1) {
      return { status: 400, json: { error: { code: 400, message: 'INVALID_EMAIL' } } };
    }
  });
  const steps = createCheckSteps(deps);
  const detail = await steps.signUp();
  assert.equal(steps.state().domain, 'jugyolog.example');
  assert.ok(detail.includes('jugyolog.example'));
  assert.equal(calls.length, 2);
  const e1 = bodyOf(calls[0]).email;
  const e2 = bodyOf(calls[1]).email;
  assert.ok(e1.endsWith('@jugyolog.invalid'));
  assert.ok(e2.endsWith('@jugyolog.example'));
  // 同じ生徒 ID で試す
  assert.equal(e1.split('@')[0], e2.split('@')[0]);
});

test('ほかのエラーでは次を試さない', async () => {
  const { deps, calls } = makeDeps((url) => {
    if (url.includes('accounts:signUp')) {
      return {
        status: 400,
        json: { error: { code: 400, message: 'TOO_MANY_ATTEMPTS_TRY_LATER : Try again later.' } },
      };
    }
  });
  const steps = createCheckSteps(deps);
  await assert.rejects(steps.signUp(), { message: 'アカウントを作れませんでした（TOO_MANY_ATTEMPTS_TRY_LATER）' });
  assert.equal(calls.length, 1);
  assert.equal(steps.state().hasToken, false);
});

test('全部 INVALID_EMAIL', async () => {
  const { deps, calls } = makeDeps((url) => {
    if (url.includes('accounts:signUp')) return { status: 400, json: { error: { message: 'INVALID_EMAIL' } } };
  });
  const steps = createCheckSteps(deps);
  await assert.rejects(steps.signUp(), { message: 'どのドメインの形も受け付けられませんでした' });
  assert.equal(calls.length, 3);
});

test('GAS が HTML を返す', async () => {
  const { deps } = makeDeps((url) => {
    if (url.startsWith(GAS_URL)) return { status: 200, text: '<!DOCTYPE html><html><body>ログイン</body></html>' };
  });
  const steps = createCheckSteps(deps);
  await assert.rejects(steps.gasPing(), { message: '保存の仕組みから、正しい形の返事がありませんでした' });
});

test('fetch が失敗する', async () => {
  const { deps } = makeDeps(() => {
    throw new TypeError('Failed to fetch');
  });
  const steps = createCheckSteps(deps);
  await assert.rejects(steps.gasPing(), { message: '保存の仕組みにつながりませんでした' });
});

test('本文の読み取りで切れたら、つながらなかったのと同じ文になる（GAS と Firebase）', async () => {
  const { deps, timers } = makeDeps(() => ({ bodyFails: true }));
  const steps = createCheckSteps(deps);
  await assert.rejects(steps.gasPing(), { message: '保存の仕組みにつながりませんでした' });
  await assert.rejects(steps.readPing(), { message: 'Firebase につながりませんでした' });
  await assert.rejects(steps.signUp(), { message: 'Firebase につながりませんでした' });
  assert.equal(timers.size, 0);
});

test('本文の読み取りの途中で時間切れになったら、時間切れの文になる', async () => {
  const { deps, fireTimers } = makeDeps(() => ({ bodyHangs: true }));
  const steps = createCheckSteps(deps);
  const p1 = steps.gasPing();
  await tick();
  fireTimers();
  await assert.rejects(p1, { message: '30 秒たっても返事がありませんでした' });
  const p2 = steps.readPing();
  await tick();
  fireTimers();
  await assert.rejects(p2, { message: '10 秒たっても返事がありませんでした' });
});

test('GAS の知らないエラーは unknown にし、中身を出さない', async () => {
  const secrets = ['eyJhbGciOiJSUzI1NiJ9.eyJ1c2VyX2lkIjoic2VjcmV0In0.c2lnbmF0dXJlLXNlY3JldA', 'someone@school.example'];
  for (const secret of secrets) {
    for (const error of [secret, { token: secret }, ['auth', secret]]) {
      const { deps } = makeDeps((url) => {
        if (url.startsWith(GAS_URL)) return { json: { ok: false, error } };
      });
      const steps = createCheckSteps(deps);
      await steps.signUp();
      await assert.rejects(steps.gasPing(), { message: '保存の仕組みが断りました（unknown）' });
      const detail = await steps.cleanup();
      assert.ok(detail.includes('unknown'), detail);
      assert.equal(detail.includes(secret), false, detail);
    }
  }
  // 既知のコードはそのまま出す
  for (const code of ['bad', 'auth', 'server', 'toobig', 'notfound']) {
    const { deps } = makeDeps((url) => {
      if (url.startsWith(GAS_URL)) return { json: { ok: false, error: code } };
    });
    await assert.rejects(createCheckSteps(deps).gasPing(), { message: `保存の仕組みが断りました（${code}）` });
  }
});

test('Firebase のエラー名は、先頭の英大文字と _ だけを出し、それ以外は UNKNOWN', async () => {
  const cases = [
    ['INVALID_PASSWORD', 'INVALID_PASSWORD'],
    ['TOO_MANY_ATTEMPTS_TRY_LATER : someone@school.example', 'TOO_MANY_ATTEMPTS_TRY_LATER'],
    ['EMAIL_NOT_FOUND2someone@school.example', 'EMAIL_NOT_FOUND'],
    ['someone@school.example is wrong', 'UNKNOWN'],
    ['aaa.bbb.ccc', 'UNKNOWN'],
    [{ token: 'aaa.bbb.ccc' }, 'UNKNOWN'],
  ];
  for (const [message, name] of cases) {
    const { deps } = makeDeps((url) => {
      if (url.includes('accounts:signInWithPassword')) return { status: 400, json: { error: { message } } };
    });
    const steps = createCheckSteps(deps);
    await steps.signUp();
    await assert.rejects(steps.signIn(), { message: `ログインできませんでした（${name}）` });
  }
  const { deps } = makeDeps((url) => {
    if (url.includes('accounts:signInWithPassword')) return { status: 500, text: 'someone@school.example' };
  });
  const steps = createCheckSteps(deps);
  await steps.signUp();
  await assert.rejects(steps.signIn(), { message: 'ログインできませんでした（UNKNOWN）' });
});

test('GAS が断る', async () => {
  const { deps } = makeDeps((url) => {
    if (url.startsWith(GAS_URL)) return { json: { ok: false, error: 'auth' } };
  });
  const steps = createCheckSteps(deps);
  await steps.signUp();
  await assert.rejects(steps.gasPut('QUJD'), (err) => {
    assert.equal(err.message, '保存の仕組みが断りました（auth）');
    return true;
  });
  assert.equal(steps.state().fileId, null);
});

test('時間切れ: GAS は 30 秒、Firebase は 10 秒で打ち切る', async () => {
  const { deps, timers, fireTimers } = makeDeps(() => HANG);
  const steps = createCheckSteps(deps);

  const p1 = steps.gasPing();
  await tick();
  assert.deepEqual([...timers.values()].map((t) => t.ms), [30000]);
  fireTimers();
  await assert.rejects(p1, { message: '30 秒たっても返事がありませんでした' });

  const p2 = steps.readPing();
  await tick();
  assert.deepEqual([...timers.values()].map((t) => t.ms), [10000]);
  fireTimers();
  await assert.rejects(p2, { message: '10 秒たっても返事がありませんでした' });
  assert.equal(timers.size, 0);
});

test('時間切れのとき fetch に渡した signal を止める', async () => {
  let signal;
  const { deps, fireTimers } = makeDeps((url, init) => {
    signal = init.signal;
    return HANG;
  });
  const steps = createCheckSteps(deps);
  const p = steps.gasPing();
  await tick();
  assert.equal(signal.aborted, false);
  fireTimers();
  await assert.rejects(p);
  assert.equal(signal.aborted, true);
});

test('返事が来たらタイマーを残さない', async () => {
  const { deps, timers } = makeDeps();
  const steps = createCheckSteps(deps);
  await steps.readPing();
  await steps.signUp();
  await steps.gasPing();
  assert.equal(timers.size, 0);
});

test('同時に 40 回: 3 回失敗、2 回返事なしでも詳細を返す', async () => {
  let n = 0;
  const { deps, calls, timers, fireTimers } = makeDeps((url, init) => {
    if (url.startsWith(GAS_URL) && JSON.parse(init.body).op === 'get') {
      n++;
      if (n === 1) throw new TypeError('Failed to fetch');
      if (n === 2) return { json: { ok: false, error: 'server' } };
      if (n === 3) return { text: '<html>' };
      if (n === 4 || n === 5) return HANG;
    }
  });
  const steps = createCheckSteps(deps);
  await steps.signUp();
  await steps.gasPut('QUJD');
  const p = steps.gasParallel();
  await tick();
  assert.equal(gasCalls(calls, 'get').length, PARALLEL_COUNT);
  assert.equal(timers.size, 2);
  fireTimers();
  const detail = await p;
  assert.ok(detail.startsWith('成功 35 / 失敗 5'), detail);
  assert.match(detail, /^成功 35 \/ 失敗 5、中央 \d+\.\d 秒、最大 \d+\.\d 秒$/);
  assert.equal(timers.size, 0);
  // 全部同じファイル ID を取り出す
  assert.ok(gasCalls(calls, 'get').every((c) => bodyOf(c).id === 'file-1'));
});

test('同時に 40 回とも失敗すると Error', async () => {
  const { deps } = makeDeps((url, init) => {
    if (url.startsWith(GAS_URL) && JSON.parse(init.body).op === 'get') return { json: { ok: false, error: 'server' } };
  });
  const steps = createCheckSteps(deps);
  await steps.signUp();
  await steps.gasPut('QUJD');
  await assert.rejects(steps.gasParallel(), Error);
});

test('同じ実行では put の key が同じ', async () => {
  const { deps, calls } = makeDeps();
  const steps = createCheckSteps(deps);
  await steps.signUp();
  await steps.gasPut('QUJD');
  await steps.gasPut('QUJD');
  const puts = gasCalls(calls, 'put');
  assert.equal(puts.length, 2);
  assert.match(bodyOf(puts[0]).key, /^[A-Za-z0-9-]{8,64}$/);
  assert.equal(bodyOf(puts[0]).key, bodyOf(puts[1]).key);
  assert.equal(steps.state().fileId, 'file-1');
});

test('put と get の詳細はかかった時間', async () => {
  const { deps } = makeDeps((url, init, ctx) => {
    if (url.startsWith(GAS_URL)) ctx.clock += 800;
  });
  const steps = createCheckSteps(deps);
  await steps.signUp();
  assert.equal(await steps.gasPut('QUJD'), '0.8 秒');
  const got = await steps.gasGet();
  assert.equal(got.detail, '0.8 秒');
  assert.equal(got.dataB64, 'QUJD');
});

test('容量の詳細', async () => {
  const { deps } = makeDeps();
  const steps = createCheckSteps(deps);
  await steps.signUp();
  assert.equal(await steps.gasQuota(), '全体 100GB、使用 12.3GB');
});

test('前の項目が無いとき', async () => {
  const { deps, calls } = makeDeps();
  const steps = createCheckSteps(deps);
  const msg = { message: '前の項目ができていないため、確認できません' };
  await assert.rejects(steps.signIn(), msg);
  await assert.rejects(steps.writeAndRead(), msg);
  await assert.rejects(steps.refresh(), msg);
  await assert.rejects(steps.gasPut('QUJD'), msg);
  await assert.rejects(steps.gasGet(), msg);
  await assert.rejects(steps.gasParallel(), msg);
  await assert.rejects(steps.gasQuota(), msg);
  assert.equal(calls.length, 0);

  // アカウントはあってもファイル ID が無ければ get できない
  await steps.signUp();
  await assert.rejects(steps.gasGet(), msg);
  await assert.rejects(steps.gasParallel(), msg);
});

test('ログイン・書いて読む・更新が、決まった URL と形で行われる', async () => {
  const { deps, calls } = makeDeps();
  const steps = createCheckSteps(deps);
  await steps.signUp();
  const signUpBody = bodyOf(calls[0]);

  assert.equal(await steps.signIn(), '');
  const si = calls[1];
  assert.equal(si.url, 'https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=' + API_KEY);
  assert.equal(bodyOf(si).email, signUpBody.email);
  assert.equal(bodyOf(si).password, signUpBody.password);

  assert.equal(await steps.writeAndRead(), '');
  const put = calls[2];
  const get = calls[3];
  assert.equal(put.url, `${DB_URL}/check/${UID}.json?auth=${TOKEN2}`);
  assert.equal(put.init.method, 'PUT');
  assert.equal(typeof JSON.parse(put.init.body), 'number');
  assert.equal(get.url, put.url);

  assert.equal(await steps.refresh(), '');
  const rf = calls[4];
  assert.equal(rf.url, 'https://securetoken.googleapis.com/v1/token?key=' + API_KEY);
  assert.equal(rf.init.method, 'POST');
  assert.equal(rf.init.body, 'grant_type=refresh_token&refresh_token=r2');

  // 更新したあとのトークンが使われる
  await steps.gasQuota();
  assert.equal(bodyOf(gasCalls(calls, 'quota')[0]).token, TOKEN3);
});

test('書いた値を読んで確かめる', async () => {
  const { deps } = makeDeps((url, init) => {
    if (url.startsWith(DB_URL + '/check/' + UID) && (!init || init.method !== 'PUT')) return { json: 12345 };
  });
  const steps = createCheckSteps(deps);
  await steps.signUp();
  await assert.rejects(steps.writeAndRead(), { message: '書いた値と読んだ値が違いました' });
});

test('check/ping が読めないと Error', async () => {
  const { deps } = makeDeps((url) => {
    if (url.endsWith('/check/ping.json')) return { status: 401, json: { error: 'Permission denied' } };
  });
  const steps = createCheckSteps(deps);
  await assert.rejects(steps.readPing(), Error);
});

test('後片付け: トークンが無ければ何もしない', async () => {
  const { deps, calls } = makeDeps();
  const steps = createCheckSteps(deps);
  assert.equal(await steps.cleanup(), '');
  assert.equal(calls.length, 0);
});

test('後片付け: GAS の cleanup が失敗してもアカウントは消し、投げない', async () => {
  const { deps, calls } = makeDeps((url, init) => {
    if (url.startsWith(GAS_URL) && JSON.parse(init.body).op === 'cleanup') return { json: { ok: false, error: 'server' } };
  });
  const steps = createCheckSteps(deps);
  await steps.signUp();
  const detail = await steps.cleanup();
  assert.equal(typeof detail, 'string');
  assert.ok(detail.includes('server'), detail);
  const del = calls.filter((c) => c.url.includes('accounts:delete'));
  assert.equal(del.length, 1);
  assert.equal(del[0].url, 'https://identitytoolkit.googleapis.com/v1/accounts:delete?key=' + API_KEY);
  assert.equal(bodyOf(del[0]).idToken, TOKEN1);
});

test('後片付け: アカウントの削除が失敗しても投げない', async () => {
  const { deps } = makeDeps((url) => {
    if (url.includes('accounts:delete')) return { status: 400, json: { error: { message: 'INVALID_ID_TOKEN' } } };
  });
  const steps = createCheckSteps(deps);
  await steps.signUp();
  const detail = await steps.cleanup();
  assert.ok(detail.includes('INVALID_ID_TOKEN'), detail);
});

test('詳細とエラーの文に、トークン・パスワード・メールアドレス・uid が入らない', async () => {
  // 1 回目: すべて成功
  const ok = makeDeps();
  const s1 = createCheckSteps(ok.deps);
  const texts = [];
  texts.push(await s1.readPing());
  texts.push(await s1.signUp());
  texts.push(await s1.signIn());
  texts.push(await s1.writeAndRead());
  texts.push(await s1.refresh());
  texts.push(await s1.gasPing());
  texts.push(await s1.gasPut('QUJD'));
  texts.push((await s1.gasGet()).detail);
  texts.push(await s1.gasParallel());
  texts.push(await s1.gasQuota());
  texts.push(await s1.cleanup());
  const { email, password } = bodyOf(ok.calls.find((c) => c.url.includes('accounts:signUp')));

  // 2 回目: アカウントを作ったあと、すべて失敗
  let made = false;
  const ng = makeDeps((url) => {
    if (url.includes('accounts:signUp') && !made) {
      made = true;
      return undefined;
    }
    return { status: 400, json: { error: { message: 'INVALID_ID_TOKEN' } } };
  });
  const s2 = createCheckSteps(ng.deps);
  await s2.signUp();
  for (const f of ['signIn', 'writeAndRead', 'refresh', 'gasPing', 'gasPut', 'gasGet', 'gasQuota']) {
    try {
      await s2[f]('QUJD');
    } catch (e) {
      texts.push(e.message);
    }
  }
  texts.push(await s2.cleanup());

  for (const t of texts) {
    assert.equal(typeof t, 'string');
    for (const secret of [TOKEN1, TOKEN2, TOKEN3, UID, email, password, 'r1', 'r2', API_KEY, '@']) {
      assert.equal(t.includes(secret), false, `「${t}」に秘密の値が入っています`);
    }
  }
});
