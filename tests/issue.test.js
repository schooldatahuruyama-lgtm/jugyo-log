// 生徒のアカウントの発行（js/issue.js）を確かめる。auth と repo は、呼び出しを記録するにせものを使う
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createIssuer } from '../js/issue.js';
import { NetError } from '../js/errors.js';

// createAccount のふるまいを、メールアドレスごとに決められるにせものの auth
// plan(email, n) は、その呼び出しで投げる NetError の code（無ければ成功）を返す
function fakeAuth(plan = () => null) {
  const calls = [];
  let n = 0;
  return {
    calls,
    async createAccount(email, password) {
      n += 1;
      calls.push({ email, password });
      const code = plan(email, n);
      if (code) throw new NetError(code, `${code} の失敗`);
      return { uid: `uid-${n}` };
    },
  };
}

function fakeRepo({ linkFails = 0, generations = {} } = {}) {
  const links = [];
  let fails = linkFails;
  return {
    links,
    async getGeneration(id) {
      return id in generations ? generations[id] : null;
    },
    async linkAccount(studentId, data, oldUid = null) {
      if (fails > 0) {
        fails -= 1;
        throw new NetError('network', 'つながりません');
      }
      links.push({ studentId, data, oldUid });
    },
  };
}

function issuer(auth, repo, extra = {}) {
  return createIssuer({
    auth, repo, random: Math.random,
    domain: 'jugyolog.invalid', firstGeneration: 1, maxTries: 20,
    ...extra,
  });
}

test('issueOne: ふつうの発行', async () => {
  const auth = fakeAuth();
  const repo = fakeRepo();
  const r = await issuer(auth, repo).issueOne('s26-001', { generation: 1 });
  assert.equal(auth.calls.length, 1);
  assert.equal(auth.calls[0].email, 's26-001.g1@jugyolog.invalid');
  assert.match(auth.calls[0].password, /^[abcdefghijkmnpqrstuvwxyz23456789]{8}$/);
  assert.deepEqual(repo.links, [{
    studentId: 's26-001',
    data: { uid: 'uid-1', generation: 1, password: auth.calls[0].password },
    oldUid: null,
  }]);
  assert.deepEqual(r, { generation: 1, password: auth.calls[0].password, uid: 'uid-1' });
});

test('issueOne: 戻り値の uid は、新しく作ったアカウントの uid（出し直しのあと、画面がすぐ使えるように）', async () => {
  const auth = fakeAuth((email) => (email.includes('.g2@') ? 'email-exists' : null));
  const repo = fakeRepo();
  const r = await issuer(auth, repo).issueOne('s26-001', { generation: 2, oldUid: 'u-old' });
  assert.equal(r.generation, 3);
  assert.equal(r.uid, 'uid-2');
  assert.equal(repo.links[0].data.uid, 'uid-2');
});

test('issueOne: 記録に失敗したあとのやり直しは、回数を 1 つ進める', async () => {
  const created = new Set();
  // 一度作ったメールアドレスは、もう一度作ろうとすると email-exists
  const auth = fakeAuth((email) => {
    if (created.has(email)) return 'email-exists';
    created.add(email);
    return null;
  });
  const repo = fakeRepo({ linkFails: 1 });
  const iss = issuer(auth, repo);

  await assert.rejects(iss.issueOne('s26-001', { generation: 1 }), (e) => e.code === 'network');
  assert.equal(repo.links.length, 0);

  const r = await iss.issueOne('s26-001', { generation: 1 });
  assert.deepEqual(auth.calls.map((c) => c.email), [
    's26-001.g1@jugyolog.invalid',
    's26-001.g1@jugyolog.invalid',
    's26-001.g2@jugyolog.invalid',
  ]);
  assert.equal(repo.links.length, 1);
  assert.equal(repo.links[0].studentId, 's26-001');
  assert.equal(repo.links[0].data.generation, 2);
  assert.equal(repo.links[0].data.password, auth.calls[2].password);
  assert.equal(r.generation, 2);
});

test('issueOne: email-exists が maxTries 回つづいたら NetError(unknown)。linkAccount を呼ばない', async () => {
  const auth = fakeAuth(() => 'email-exists');
  const repo = fakeRepo();
  await assert.rejects(
    issuer(auth, repo, { maxTries: 3 }).issueOne('s26-001', { generation: 1 }),
    (e) => e instanceof NetError && e.code === 'unknown');
  assert.deepEqual(auth.calls.map((c) => c.email), [
    's26-001.g1@jugyolog.invalid',
    's26-001.g2@jugyolog.invalid',
    's26-001.g3@jugyolog.invalid',
  ]);
  assert.equal(repo.links.length, 0);
});

test('issueOne: email-exists のほかの失敗は、そのまま伝える（回数を進めない）', async () => {
  const auth = fakeAuth(() => 'rate');
  const repo = fakeRepo();
  await assert.rejects(issuer(auth, repo).issueOne('s26-001', { generation: 1 }), (e) => e.code === 'rate');
  assert.equal(auth.calls.length, 1);
  assert.equal(repo.links.length, 0);
});

test('issueOne: 出し直しは oldUid を linkAccount の 3 つ目に渡す', async () => {
  const auth = fakeAuth();
  const repo = fakeRepo();
  const r = await issuer(auth, repo).issueOne('s26-001', { generation: 2, oldUid: 'u1' });
  assert.equal(auth.calls[0].email, 's26-001.g2@jugyolog.invalid');
  assert.equal(repo.links[0].oldUid, 'u1');
  assert.equal(repo.links[0].data.generation, 2);
  assert.equal(r.generation, 2);
});

test('issueMany: 上限（rate）に当たったら止めて、済んだ分と残りを返す', async () => {
  const auth = fakeAuth((email, n) => (n === 2 ? 'rate' : null));
  const repo = fakeRepo();
  const r = await issuer(auth, repo).issueMany(['s26-001', 's26-002', 's26-003']);
  assert.deepEqual(r, { done: ['s26-001'], left: ['s26-002', 's26-003'], reason: 'rate' });
  assert.equal(auth.calls.length, 2); // 3 人目は試さない
  assert.deepEqual(repo.links.map((l) => l.studentId), ['s26-001']);
});

test('issueMany: つながらないときは network、そのほかは unknown', async () => {
  const net = await issuer(fakeAuth(() => 'network'), fakeRepo()).issueMany(['s26-001', 's26-002']);
  assert.deepEqual(net, { done: [], left: ['s26-001', 's26-002'], reason: 'network' });
  const unk = await issuer(fakeAuth(() => 'denied'), fakeRepo()).issueMany(['s26-001']);
  assert.deepEqual(unk, { done: [], left: ['s26-001'], reason: 'unknown' });
});

test('issueMany: 全員できたら reason は null。onProgress は 1 人ごとに (済んだ数, 全体の数)', async () => {
  const auth = fakeAuth();
  const repo = fakeRepo();
  const progress = [];
  const r = await issuer(auth, repo).issueMany(['s26-001', 's26-002', 's26-003'], {
    onProgress: (...args) => progress.push(args),
  });
  assert.deepEqual(r, { done: ['s26-001', 's26-002', 's26-003'], left: [], reason: null });
  assert.deepEqual(progress, [[1, 3], [2, 3], [3, 3]]);
});

test('issueMany: 続きの発行は、gen の次の回数から（無ければ最初の回数から）', async () => {
  const auth = fakeAuth();
  const repo = fakeRepo({ generations: { 's26-002': 3 } });
  await issuer(auth, repo).issueMany(['s26-001', 's26-002']);
  assert.deepEqual(auth.calls.map((c) => c.email), [
    's26-001.g1@jugyolog.invalid',
    's26-002.g4@jugyolog.invalid',
  ]);
  assert.deepEqual(repo.links.map((l) => l.oldUid), [null, null]);
});

test('issueMany: shouldStop が true を返したら、次の人に進まずに止まる（reason は stopped）', async () => {
  const auth = fakeAuth();
  const repo = fakeRepo();
  let stop = false;
  const r = await issuer(auth, repo).issueMany(['s26-001', 's26-002', 's26-003'], {
    onProgress: (n) => { if (n === 1) stop = true; },
    shouldStop: () => stop,
  });
  assert.deepEqual(r, { done: ['s26-001'], left: ['s26-002', 's26-003'], reason: 'stopped' });
  assert.equal(auth.calls.length, 1);
  assert.deepEqual(repo.links.map((l) => l.studentId), ['s26-001']);
});

test('issueMany: はじめから shouldStop が true なら、だれも発行しない', async () => {
  const auth = fakeAuth();
  const r = await issuer(auth, fakeRepo()).issueMany(['s26-001', 's26-002'], { shouldStop: () => true });
  assert.deepEqual(r, { done: [], left: ['s26-001', 's26-002'], reason: 'stopped' });
  assert.equal(auth.calls.length, 0);
});

// ---- reissueOne（出し直し）: 台帳と gen をデータベースのように持つ repo ----
// linkAccount は書きこんでから、throwAfterApply の回数だけ例外を投げる（応答だけが失われた形）
function ledgerRepo({ students = {}, gens = {}, throwAfterApply = 0 } = {}) {
  const links = [];
  let fails = throwAfterApply;
  return {
    links,
    students,
    gens,
    async listStudents() {
      return Object.keys(students).sort().map((id) => ({ id, uid: students[id] ?? null, createdAt: 0 }));
    },
    async getGeneration(id) {
      return id in gens ? gens[id] : null;
    },
    async linkAccount(studentId, data, oldUid = null) {
      links.push({ studentId, data, oldUid });
      students[studentId] = data.uid;
      gens[studentId] = data.generation;
      if (fails > 0) {
        fails -= 1;
        throw new NetError('network', '応答が届きませんでした');
      }
    },
  };
}

test('reissueOne: 台帳の uid を oldUid に、gen の次の回数で出し直す', async () => {
  const auth = fakeAuth();
  const repo = ledgerRepo({ students: { 's26-101': 'u-old' }, gens: { 's26-101': 1 } });
  const r = await issuer(auth, repo).reissueOne('s26-101');
  assert.equal(auth.calls[0].email, 's26-101.g2@jugyolog.invalid');
  assert.equal(repo.links[0].oldUid, 'u-old');
  assert.deepEqual(r, { generation: 2, password: auth.calls[0].password, uid: 'uid-1' });
});

test('reissueOne: 応答だけ失われたあとのやり直しは、台帳の新しい uid を oldUid にし、回数も進む', async () => {
  const auth = fakeAuth();
  const repo = ledgerRepo({ students: { 's26-102': 'u-old' }, gens: { 's26-102': 1 }, throwAfterApply: 1 });
  const iss = issuer(auth, repo);
  await assert.rejects(iss.reissueOne('s26-102'), (e) => e.code === 'network');
  assert.equal(repo.students['s26-102'], 'uid-1'); // データベースには反映されている

  const r = await iss.reissueOne('s26-102');
  assert.equal(repo.links[1].oldUid, 'uid-1');
  assert.equal(repo.links[1].data.generation, 3);
  assert.equal(auth.calls[1].email, 's26-102.g3@jugyolog.invalid');
  assert.equal(r.uid, 'uid-2');
});

test('reissueOne: 同じ ID の出し直しが進行中なら、終わってから読み直して始める（画面を作り直しても共有）', async () => {
  const auth = fakeAuth();
  const repo = ledgerRepo({ students: { 's26-103': 'u-old' }, gens: { 's26-103': 1 } });
  // 別々の issuer（画面を作り直した形）から、続けて呼ぶ
  const p1 = issuer(auth, repo).reissueOne('s26-103');
  const p2 = issuer(auth, repo).reissueOne('s26-103');
  const [r1, r2] = await Promise.all([p1, p2]);
  assert.deepEqual(repo.links.map((l) => l.oldUid), ['u-old', r1.uid]);
  assert.equal(r1.generation, 2);
  assert.equal(r2.generation, 3);
  assert.equal(repo.students['s26-103'], r2.uid);
});

test('reissueOne: 1 回目が失敗しても、2 回目は待ったあとに始まる', async () => {
  const auth = fakeAuth((email, n) => (n === 1 ? 'network' : null));
  const repo = ledgerRepo({ students: { 's26-104': 'u-old' }, gens: { 's26-104': 1 } });
  const iss = issuer(auth, repo);
  const p1 = iss.reissueOne('s26-104');
  const p2 = iss.reissueOne('s26-104');
  await assert.rejects(p1, (e) => e.code === 'network');
  const r2 = await p2;
  assert.equal(repo.links.length, 1);
  assert.equal(repo.links[0].oldUid, 'u-old');
  assert.equal(r2.generation, 2);
});

test('reissueOne: 台帳に uid が無い ID は断り、createAccount を呼ばない', async () => {
  const auth = fakeAuth();
  const repo = ledgerRepo({ students: { 's26-105': null } });
  await assert.rejects(issuer(auth, repo).reissueOne('s26-105'), (e) => e instanceof NetError && e.code === 'unknown');
  await assert.rejects(issuer(auth, repo).reissueOne('s26-999'), (e) => e instanceof NetError && e.code === 'unknown');
  assert.equal(auth.calls.length, 0);
  assert.equal(repo.links.length, 0);
});

test('作ったパスワードが、例外の文や onProgress の引数に入っていない', async () => {
  // 記録に失敗する
  const auth1 = fakeAuth();
  let err;
  try {
    await issuer(auth1, fakeRepo({ linkFails: 1 })).issueOne('s26-001', { generation: 1 });
  } catch (e) { err = e; }
  assert.ok(err);
  const pw1 = auth1.calls[0].password;
  assert.ok(!String(err.message).includes(pw1));
  assert.ok(!String(err.stack).includes(pw1));

  // 回数が尽きる
  const auth2 = fakeAuth(() => 'email-exists');
  let err2;
  try {
    await issuer(auth2, fakeRepo(), { maxTries: 2 }).issueOne('s26-001', { generation: 1 });
  } catch (e) { err2 = e; }
  for (const c of auth2.calls) assert.ok(!String(err2.message).includes(c.password));

  // onProgress
  const auth3 = fakeAuth();
  const seen = [];
  await issuer(auth3, fakeRepo()).issueMany(['s26-001', 's26-002'], { onProgress: (...a) => seen.push(JSON.stringify(a)) });
  for (const c of auth3.calls) for (const s of seen) assert.ok(!s.includes(c.password));
});
