// 練習モード（Firebase の代わりに、このパソコンの中だけで動く net と auth）を確かめる
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isDemoAllowed, createDemoBackend, DEMO_TEACHER_UID } from '../js/dev/demo.js';
import { createRepo } from '../js/repo.js';
import { NetError } from '../js/errors.js';

// localStorage と同じ形の保存先。書いたキーを .keys に残す
function fakeStorage() {
  const map = new Map();
  const keys = new Set();
  return {
    map,
    keys,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { keys.add(k); map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
  };
}

// 決まった順に数を返す random（同じ uid が続かないように進める）
function seqRandom() {
  let i = 0;
  return () => { i = (i + 0.137) % 1; return i; };
}

const make = (storage) => createDemoBackend({ storage, now: () => 1000, random: seqRandom() });

async function rejectsCode(promise, code) {
  await assert.rejects(promise, (e) => {
    assert.ok(e instanceof NetError, `NetError のはず: ${e}`);
    assert.equal(e.code, code);
    return true;
  });
}

test('isDemoAllowed: localhost で ?demo=1 のときだけ', () => {
  assert.equal(isDemoAllowed('localhost', '?demo=1'), true);
  assert.equal(isDemoAllowed('127.0.0.1', '?demo=1'), true);
  assert.equal(isDemoAllowed('schooldatahuruyama-lgtm.github.io', '?demo=1'), false);
  assert.equal(isDemoAllowed('localhost', '?demo=0'), false);
  assert.equal(isDemoAllowed('localhost', ''), false);
  assert.equal(isDemoAllowed('localhost', undefined), false);
});

test('auth は本物の createAuth と同じメソッドを持つ', () => {
  const { auth } = make(fakeStorage());
  for (const m of ['signIn', 'createAccount', 'changePassword', 'restore', 'getToken', 'forceRefresh', 'signOut']) {
    assert.equal(typeof auth[m], 'function', m);
  }
  assert.equal(auth.user, null);
});

test('先生: @ を含むメールアドレスなら、どのパスワードでも入れて、先生として登録されている', async () => {
  const d = make(fakeStorage());
  const u = await d.auth.signIn('teacher@demo', 'なんでも');
  assert.equal(u.uid, DEMO_TEACHER_UID);
  assert.equal(DEMO_TEACHER_UID, 'demo-teacher');
  assert.deepEqual(d.auth.user, { uid: 'demo-teacher', email: 'teacher@demo' });
  assert.equal(await d.auth.getToken(), 'demo-token');
  assert.equal(await d.auth.forceRefresh(), 'demo-token');
  assert.equal(await d.net.get('teacherList/demo-teacher'), true);
  assert.equal(await createRepo(d.net).isTeacher('demo-teacher'), true);
  d.auth.signOut();
  assert.equal(d.auth.user, null);
  await rejectsCode(d.auth.getToken(), 'auth');
});

test('生徒: createAccount で作ったアカウントだけがログインできる', async () => {
  const d = make(fakeStorage());
  const email = 's26-017.g1@jugyolog.invalid';
  await rejectsCode(d.auth.signIn(email, 'abcd2345'), 'bad-credentials');
  const { uid } = await d.auth.createAccount(email, 'abcd2345');
  assert.equal(typeof uid, 'string');
  assert.notEqual(uid, DEMO_TEACHER_UID);
  // 作っただけでは、今のログインは変わらない
  assert.equal(d.auth.user, null);
  const u = await d.auth.signIn(email, 'abcd2345');
  assert.deepEqual(u, { uid, email });
  await rejectsCode(d.auth.signIn(email, 'wrongpass'), 'bad-credentials');
  await rejectsCode(d.auth.createAccount(email, 'other1234'), 'email-exists');
});

test('createAccount は今のログイン（先生）を変えない', async () => {
  const d = make(fakeStorage());
  await d.auth.signIn('teacher@demo', 'x');
  const { uid } = await d.auth.createAccount('s26-001.g1@jugyolog.invalid', 'abcd2345');
  assert.equal(d.auth.user.uid, DEMO_TEACHER_UID);
  const { uid: uid2 } = await d.auth.createAccount('s26-002.g1@jugyolog.invalid', 'abcd2345');
  assert.notEqual(uid, uid2);
});

test('6 文字より短いパスワードの createAccount は weak-password', async () => {
  const d = make(fakeStorage());
  await rejectsCode(d.auth.createAccount('s26-001.g1@jugyolog.invalid', '12345'), 'weak-password');
});

test('changePassword のあとは、新しいパスワードだけが通る', async () => {
  const d = make(fakeStorage());
  const email = 's26-017.g1@jugyolog.invalid';
  await d.auth.createAccount(email, 'oldpass11');
  await d.auth.signIn(email, 'oldpass11');
  await d.auth.changePassword('newpass22');
  assert.equal(d.auth.user.email, email);
  d.auth.signOut();
  await rejectsCode(d.auth.signIn(email, 'oldpass11'), 'bad-credentials');
  assert.equal((await d.auth.signIn(email, 'newpass22')).email, email);
});

test('ログインしていないときの changePassword は auth', async () => {
  const d = make(fakeStorage());
  await rejectsCode(d.auth.changePassword('newpass22'), 'auth');
});

test('storage を渡し直して作り直しても、データとログインが残る', async () => {
  const storage = fakeStorage();
  const d1 = make(storage);
  const email = 's26-017.g1@jugyolog.invalid';
  await d1.auth.createAccount(email, 'abcd2345');
  await d1.net.set('classes/c1', { year: 2026, name: '2年A組', createdAt: 1 });
  await d1.auth.signIn(email, 'abcd2345');

  const d2 = make(storage);
  assert.equal(d2.auth.user.email, email);
  assert.equal((await d2.auth.restore()).email, email);
  assert.deepEqual(await d2.net.get('classes/c1'), { year: 2026, name: '2年A組', createdAt: 1 });
  d2.auth.signOut();
  assert.equal(await d2.auth.restore(), null);
  assert.equal((await d2.auth.signIn(email, 'abcd2345')).email, email);
  assert.equal(await d2.net.get('teacherList/demo-teacher'), true);
});

test('reset() で、データ・アカウント・ログインが全部消える（先生の登録だけは入れ直す）', async () => {
  const storage = fakeStorage();
  const d = make(storage);
  const email = 's26-017.g1@jugyolog.invalid';
  await d.auth.createAccount(email, 'abcd2345');
  await d.net.set('classes/c1', { year: 2026, name: '2年A組', createdAt: 1 });
  await d.auth.signIn(email, 'abcd2345');
  await d.reset();
  assert.equal(d.auth.user, null);
  assert.equal(await d.net.get('classes'), null);
  await rejectsCode(d.auth.signIn(email, 'abcd2345'), 'bad-credentials');
  assert.equal(await d.net.get('teacherList/demo-teacher'), true);

  const again = make(storage);
  assert.equal(again.auth.user, null);
  assert.equal(await again.net.get('classes'), null);
  await rejectsCode(again.auth.signIn(email, 'abcd2345'), 'bad-credentials');
});

test('練習モードの保存のキーは、どれも jugyolog:demo: で始まる', async () => {
  const storage = fakeStorage();
  const d = make(storage);
  await d.auth.createAccount('s26-017.g1@jugyolog.invalid', 'abcd2345');
  await d.auth.signIn('s26-017.g1@jugyolog.invalid', 'abcd2345');
  await d.auth.changePassword('efgh6789');
  await d.net.set('x/y', 1);
  await d.auth.signIn('teacher@demo', 'p');
  await d.reset();
  assert.ok(storage.keys.size > 0);
  for (const k of storage.keys) assert.ok(k.startsWith('jugyolog:demo:'), k);
});

test('保存したものに、パスワードがそのまま入っていない', async () => {
  const storage = fakeStorage();
  const d = make(storage);
  await d.auth.createAccount('s26-017.g1@jugyolog.invalid', 'abcd2345');
  await d.auth.signIn('s26-017.g1@jugyolog.invalid', 'abcd2345');
  await d.auth.changePassword('efgh6789');
  for (const v of storage.map.values()) {
    assert.ok(!v.includes('abcd2345'), v);
    assert.ok(!v.includes('efgh6789'), v);
  }
});

test('保存先が壊れていても落ちずに、空から始める', async () => {
  const storage = fakeStorage();
  storage.setItem('jugyolog:demo:db', '{壊れた');
  storage.setItem('jugyolog:demo:accounts', 'null');
  storage.setItem('jugyolog:demo:auth', '[1');
  const d = make(storage);
  assert.equal(d.auth.user, null);
  assert.equal(await d.net.get('teacherList/demo-teacher'), true);
  await rejectsCode(d.auth.signIn('s26-017.g1@jugyolog.invalid', 'x'), 'bad-credentials');
});
