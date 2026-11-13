// ログイン（ID かメールアドレスか）と、保存してあるログインから今だれなのかを決めることを、代役で確かめる
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signIn, resolveSession } from '../js/session.js';
import { NetError } from '../js/errors.js';

const DOMAIN = 'jugyolog.invalid';

// auth の代役。onSignIn(email, password) の戻り値が signIn の結果（Error を返すと投げる）。
// restore は onRestore() の戻り値（Error を返すと投げる）。signOut の回数を数える
function fakeAuth({ onSignIn = (email) => ({ uid: 'u1', email }), onRestore = () => null } = {}) {
  const a = {
    signOuts: 0,
    signInCalls: [],
    async signIn(email, password) {
      a.signInCalls.push([email, password]);
      const r = await onSignIn(email, password);
      if (r instanceof Error) throw r;
      a.user = r; // 本物と同じく、ログインした人を覚える
      return r;
    },
    async restore() {
      const r = await onRestore();
      if (r instanceof Error) throw r;
      return r;
    },
    user: null,
    signOut() { a.signOuts += 1; a.user = null; },
  };
  return a;
}

// 呼ばれたら失敗にする関数（呼ばれてはいけないところで使う）
const never = (name) => async () => { throw new Error(`${name} を呼んではいけない`); };

async function rejectsCode(promise, code) {
  await assert.rejects(promise, (e) => {
    assert.ok(e instanceof NetError, `NetError のはず: ${e}`);
    assert.equal(e.code, code);
    return true;
  });
}

// ---- signIn: 生徒 ----

test('生徒: ID から何回目かを読み、そのメールアドレスでログインする', async () => {
  const calls = [];
  const auth = fakeAuth({ onSignIn: (email) => { calls.push(email); return { uid: 'u2', email }; } });
  const repo = { getGeneration: async () => 2, getMyStudentId: async () => 's26-017', isTeacher: async () => false };
  const r = await signIn({ input: ' Ｓ26-017 ', password: 'pw', auth, repo, domain: 'jugyolog.invalid' });
  assert.deepEqual(r, { role: 'student', studentId: 's26-017' });
  assert.deepEqual(calls, ['s26-017.g2@jugyolog.invalid']);
});

test('生徒: 全角の英数字とハイフン・大文字でも、同じ ID として読む', async () => {
  const seen = [];
  const auth = fakeAuth({ onSignIn: (email) => ({ uid: 'u2', email }) });
  const repo = {
    getGeneration: async (id) => { seen.push(id); return 1; },
    getMyStudentId: async () => 's26-017',
    isTeacher: never('isTeacher'),
  };
  for (const input of ['ｓ２６－０１７', 'S26-017', '  s26-017\t']) {
    const r = await signIn({ input, password: 'pw', auth, repo, domain: DOMAIN });
    assert.deepEqual(r, { role: 'student', studentId: 's26-017' }, input);
  }
  assert.deepEqual(seen, ['s26-017', 's26-017', 's26-017']);
  assert.deepEqual(auth.signInCalls.map(([e]) => e), Array(3).fill('s26-017.g1@jugyolog.invalid'));
  assert.equal(auth.signInCalls[0][1], 'pw');
});

test('生徒: 形の違う ID は、通信をせずに bad-credentials', async () => {
  const auth = fakeAuth({ onSignIn: never('signIn') });
  const repo = { getGeneration: never('getGeneration'), getMyStudentId: never('getMyStudentId'), isTeacher: never('isTeacher') };
  for (const input of ['abc', '', '   ', 's26-17', 's26-0170', 's2a-017']) {
    await rejectsCode(signIn({ input, password: 'pw', auth, repo, domain: DOMAIN }), 'bad-credentials');
  }
  assert.equal(auth.signInCalls.length, 0);
});

test('生徒: 発行されていない ID（何回目かが null）は bad-credentials で、ログインを試さない', async () => {
  const auth = fakeAuth({ onSignIn: never('signIn') });
  const repo = { getGeneration: async () => null, getMyStudentId: never('getMyStudentId'), isTeacher: never('isTeacher') };
  await rejectsCode(signIn({ input: 's26-099', password: 'pw', auth, repo, domain: DOMAIN }), 'bad-credentials');
  assert.equal(auth.signInCalls.length, 0);
});

test('生徒: パスワードが違う（auth が bad-credentials）はそのまま伝える', async () => {
  const auth = fakeAuth({ onSignIn: () => new NetError('bad-credentials') });
  const repo = { getGeneration: async () => 1, getMyStudentId: never('getMyStudentId'), isTeacher: never('isTeacher') };
  await rejectsCode(signIn({ input: 's26-017', password: 'x', auth, repo, domain: DOMAIN }), 'bad-credentials');
});

test('生徒: 何回目かを読めない（network）はそのまま伝える', async () => {
  const auth = fakeAuth({ onSignIn: never('signIn') });
  const repo = { getGeneration: async () => { throw new NetError('network'); }, getMyStudentId: never('getMyStudentId'), isTeacher: never('isTeacher') };
  await rejectsCode(signIn({ input: 's26-017', password: 'x', auth, repo, domain: DOMAIN }), 'network');
});

test('生徒: 出し直したあとの古いアカウント（対応が null）は、ログアウトしてから bad-credentials', async () => {
  const order = [];
  const auth = fakeAuth({ onSignIn: (email) => ({ uid: 'old', email }) });
  auth.signOut = () => { order.push('signOut'); };
  const repo = { getGeneration: async () => 1, getMyStudentId: async () => { order.push('getMyStudentId'); return null; }, isTeacher: never('isTeacher') };
  await assert.rejects(
    signIn({ input: 's26-017', password: 'pw', auth, repo, domain: DOMAIN }),
    (e) => { order.push('rejected'); return e instanceof NetError && e.code === 'bad-credentials'; },
  );
  assert.deepEqual(order, ['getMyStudentId', 'signOut', 'rejected']);
});

test('生徒: ログインできても、対応する生徒 ID が入力と違えば、ログアウトしてから bad-credentials', async () => {
  const auth = fakeAuth({ onSignIn: (email) => ({ uid: 'u9', email }) });
  const repo = { getGeneration: async () => 1, getMyStudentId: async () => 's26-018', isTeacher: never('isTeacher') };
  await rejectsCode(signIn({ input: 's26-017', password: 'pw', auth, repo, domain: DOMAIN }), 'bad-credentials');
  assert.equal(auth.signOuts, 1);
});

test('生徒: ログインのあと対応を読めない（network）は、ログアウトしてから network', async () => {
  const auth = fakeAuth({ onSignIn: (email) => ({ uid: 'u9', email }) });
  const repo = { getGeneration: async () => 1, getMyStudentId: async () => { throw new NetError('network'); }, isTeacher: never('isTeacher') };
  await rejectsCode(signIn({ input: 's26-017', password: 'pw', auth, repo, domain: DOMAIN }), 'network');
  assert.equal(auth.signOuts, 1);
});

// ---- signIn: 先生 ----

test('先生: @ を含む入力は、そのメールアドレスでログインし、先生かを確かめる', async () => {
  const seen = [];
  const auth = fakeAuth({ onSignIn: (email) => ({ uid: 't1', email }) });
  const repo = { getGeneration: never('getGeneration'), getMyStudentId: never('getMyStudentId'), isTeacher: async (uid) => { seen.push(uid); return true; } };
  const r = await signIn({ input: '  Teacher@School.example ', password: 'secret', auth, repo, domain: DOMAIN });
  assert.deepEqual(r, { role: 'teacher' });
  assert.deepEqual(auth.signInCalls, [['Teacher@School.example', 'secret']]);
  assert.deepEqual(seen, ['t1']);
  assert.equal(auth.signOuts, 0);
});

test('先生: 先生として登録されていなければ、ログアウトしてから not-teacher', async () => {
  const auth = fakeAuth({ onSignIn: (email) => ({ uid: 'x1', email }) });
  const repo = { getGeneration: never('getGeneration'), getMyStudentId: never('getMyStudentId'), isTeacher: async () => false };
  await rejectsCode(signIn({ input: 'someone@example.com', password: 'pw', auth, repo, domain: DOMAIN }), 'not-teacher');
  assert.equal(auth.signOuts, 1);
});

test('先生: 登録を確かめられない（network）は、ログアウトしてから network', async () => {
  const auth = fakeAuth({ onSignIn: (email) => ({ uid: 't1', email }) });
  const repo = { getGeneration: never('getGeneration'), getMyStudentId: never('getMyStudentId'), isTeacher: async () => { throw new NetError('network'); } };
  await rejectsCode(signIn({ input: 't@example.com', password: 'pw', auth, repo, domain: DOMAIN }), 'network');
  assert.equal(auth.signOuts, 1);
});

test('先生: パスワードが違う（auth が bad-credentials）はそのまま伝え、登録を読まない', async () => {
  const auth = fakeAuth({ onSignIn: () => new NetError('bad-credentials') });
  const repo = { getGeneration: never('getGeneration'), getMyStudentId: never('getMyStudentId'), isTeacher: never('isTeacher') };
  await rejectsCode(signIn({ input: 't@example.com', password: 'x', auth, repo, domain: DOMAIN }), 'bad-credentials');
});

// ---- resolveSession ----

test('resolveSession: 保存したログインが無ければ none', async () => {
  const auth = fakeAuth({ onRestore: () => null });
  const repo = { isTeacher: never('isTeacher'), getMyStudentId: never('getMyStudentId') };
  assert.deepEqual(await resolveSession({ auth, repo }), { role: 'none' });
  assert.equal(auth.signOuts, 0);
});

test('resolveSession: 先生なら teacher', async () => {
  const auth = fakeAuth({ onRestore: () => ({ uid: 't1', email: 't@example.com' }) });
  const repo = { isTeacher: async (uid) => uid === 't1', getMyStudentId: async () => null };
  assert.deepEqual(await resolveSession({ auth, repo }), { role: 'teacher', uid: 't1' });
});

test('resolveSession: 生徒なら student（生徒 ID つき）', async () => {
  const auth = fakeAuth({ onRestore: () => ({ uid: 'u2', email: 's26-017.g1@jugyolog.invalid' }) });
  const repo = { isTeacher: async () => false, getMyStudentId: async (uid) => (uid === 'u2' ? 's26-017' : null) };
  assert.deepEqual(await resolveSession({ auth, repo }), { role: 'student', uid: 'u2', studentId: 's26-017' });
  assert.equal(auth.signOuts, 0);
});

test('resolveSession: 先生でも生徒でもない（出し直した古いアカウントなど）は、ログアウトして none', async () => {
  const auth = fakeAuth({ onRestore: () => ({ uid: 'old' }) });
  const repo = { isTeacher: async () => false, getMyStudentId: async () => null };
  assert.deepEqual(await resolveSession({ auth, repo }), { role: 'none' });
  assert.equal(auth.signOuts, 1);
});

test('resolveSession: restore が network なら offline（ログアウトしない）', async () => {
  const auth = fakeAuth({ onRestore: () => new NetError('network') });
  const repo = { isTeacher: never('isTeacher'), getMyStudentId: never('getMyStudentId') };
  assert.deepEqual(await resolveSession({ auth, repo }), { role: 'offline' });
  assert.equal(auth.signOuts, 0);
});

test('resolveSession: repo が network なら offline（ログアウトしない）', async () => {
  const auth = fakeAuth({ onRestore: () => ({ uid: 'u2' }) });
  const repo1 = { isTeacher: async () => { throw new NetError('network'); }, getMyStudentId: async () => 's26-017' };
  assert.deepEqual(await resolveSession({ auth, repo: repo1 }), { role: 'offline' });
  const repo2 = { isTeacher: async () => false, getMyStudentId: async () => { throw new NetError('network'); } };
  assert.deepEqual(await resolveSession({ auth, repo: repo2 }), { role: 'offline' });
  assert.equal(auth.signOuts, 0);
});

// ---- 離れた画面のログイン（isCurrent が false）は、あとから入った人のログインをこわさない ----

test('生徒: 何回目かを待っている間に画面を離れたら、ログインの通信を送らない', async () => {
  let alive = true;
  const auth = fakeAuth({ onSignIn: never('signIn') });
  const repo = { getGeneration: async () => { alive = false; return 1; }, getMyStudentId: never('getMyStudentId'), isTeacher: never('isTeacher') };
  await rejectsCode(signIn({ input: 's26-017', password: 'pw', auth, repo, domain: DOMAIN, isCurrent: () => alive }), 'auth');
  assert.equal(auth.signInCalls.length, 0);
  assert.equal(auth.signOuts, 0);
});

test('ログインの通信の間に画面を離れたら、自分が入れた分だけ外す', async () => {
  let alive = true;
  const auth = fakeAuth({ onSignIn: (email) => { alive = false; return { uid: 'uA', email }; } });
  const repo = { getGeneration: async () => 1, getMyStudentId: never('getMyStudentId'), isTeacher: never('isTeacher') };
  await rejectsCode(signIn({ input: 's26-017', password: 'pw', auth, repo, domain: DOMAIN, isCurrent: () => alive }), 'auth');
  assert.equal(auth.signOuts, 1);
});

test('確認を待っている間に別の人がログインしていたら、その人を外さない', async () => {
  let alive = true;
  const auth = fakeAuth({ onSignIn: (email) => ({ uid: 'uA', email }) });
  const repo = {
    getGeneration: async () => 1,
    // 確認の間に画面が替わり、別の人（uB）がログインした
    getMyStudentId: async () => { alive = false; auth.user = { uid: 'uB' }; return 's26-017'; },
    isTeacher: never('isTeacher'),
  };
  await rejectsCode(signIn({ input: 's26-017', password: 'pw', auth, repo, domain: DOMAIN, isCurrent: () => alive }), 'auth');
  assert.equal(auth.signOuts, 0);
  assert.deepEqual(auth.user, { uid: 'uB' });
});

test('先生: 確認の失敗でも、別の人に替わっていたら外さない', async () => {
  const auth = fakeAuth({ onSignIn: (email) => ({ uid: 'uT', email }) });
  const repo = { isTeacher: async () => { auth.user = { uid: 'uB' }; throw new NetError('network'); } };
  await rejectsCode(signIn({ input: 't@example.com', password: 'pw', auth, repo, domain: DOMAIN }), 'network');
  assert.equal(auth.signOuts, 0);
});

test('同じ人がログインし直したあと、古い試みの確認が終わっても、新しいログインを外さない（成功・失敗の両方）', async () => {
  for (const mode of ['ok', 'fail']) {
    const auth = fakeAuth({ onSignIn: (email) => ({ uid: 'uSame', email }) });
    let aliveA = true;
    let releaseA;
    const gateA = new Promise((r) => { releaseA = r; });
    let first = true;
    const repo = {
      getGeneration: async () => 1,
      getMyStudentId: async () => {
        if (first) { first = false; await gateA; if (mode === 'fail') throw new NetError('network'); }
        return 's26-017';
      },
      isTeacher: never('isTeacher'),
    };
    // A: 確認（getMyStudentId）で待つ
    const a = signIn({ input: 's26-017', password: 'pw', auth, repo, domain: DOMAIN, isCurrent: () => aliveA });
    await new Promise((r) => setTimeout(r, 0));
    // 画面を離れ、同じ人が B でログインし直す
    aliveA = false;
    const b = await signIn({ input: 's26-017', password: 'pw', auth, repo, domain: DOMAIN });
    assert.deepEqual(b, { role: 'student', studentId: 's26-017' });
    // A の確認が終わる
    releaseA();
    await assert.rejects(a);
    assert.equal(auth.signOuts, 0, `${mode}: 新しいログインを外してはいけない`);
    assert.equal(auth.user && auth.user.uid, 'uSame');
  }
});
