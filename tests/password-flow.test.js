// 生徒のパスワードの変更の手順を確かめる（通信はにせもので記録する）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { changeMyPassword } from '../js/password-flow.js';
import { InputError, NetError } from '../js/errors.js';

const SID = 's26-017';
const EMAIL = 's26-017.g1@jugyolog.invalid';

// 呼ばれた順を calls に残す。fail で、どの呼び出しを失敗させるかを決める
function fakes({ fail = {}, user = { uid: 'u1', email: EMAIL } } = {}) {
  const calls = [];
  const auth = {
    get user() { return user ? { ...user } : null; },
    async signIn(email, password) {
      calls.push(['signIn', email, password]);
      if (fail.signIn) throw fail.signIn;
      return { uid: 'u1', email };
    },
    async changePassword(next) {
      calls.push(['changePassword', next]);
      if (fail.changePassword) throw fail.changePassword;
    },
  };
  const repo = {
    async clearInitialPassword(studentId) {
      calls.push(['clearInitialPassword', studentId]);
      if (fail.clear) throw fail.clear;
    },
  };
  return { auth, repo, calls };
}

// 入力の誤りを確かめる: InputError で code が合い、通信をしない
async function assertInput(args, code) {
  const { auth, repo, calls } = fakes();
  await assert.rejects(
    changeMyPassword({ auth, repo, studentId: SID, ...args }),
    (e) => {
      assert.ok(e instanceof InputError);
      assert.equal(e.name, 'InputError');
      assert.equal(e.code, code);
      // エラーの文にパスワードを入れない
      for (const pw of [args.current, args.next, args.again]) {
        if (pw) assert.ok(!e.message.includes(pw), 'エラーの文にパスワードが入っている');
      }
      return true;
    });
  assert.deepEqual(calls, []);
}

test('2 つの新しいパスワードがちがう → mismatch（通信しない）', async () => {
  await assertInput({ current: 'oldpass88', next: 'newpass123', again: 'newpass124' }, 'mismatch');
});

test('新しいパスワードが今のと同じ → same（通信しない）', async () => {
  await assertInput({ current: 'samepass99', next: 'samepass99', again: 'samepass99' }, 'same');
});

test('8 文字より短い → short（通信しない）', async () => {
  await assertInput({ current: 'oldpass88', next: 'abc1234', again: 'abc1234' }, 'short');
  await assertInput({ current: 'oldpass88', next: '', again: '' }, 'short');
});

test('自分の ID を含む → has-id（通信しない）', async () => {
  await assertInput({ current: 'oldpass88', next: 'xxs26-017xx', again: 'xxs26-017xx' }, 'has-id');
  await assertInput({ current: 'oldpass88', next: 'S26017abc', again: 'S26017abc' }, 'has-id');
});

test('ふつうの流れ: 今のパスワードでログインし直す → 変える → 最初のパスワードを消す', async () => {
  const { auth, repo, calls } = fakes();
  const result = await changeMyPassword({
    auth, repo, studentId: SID, current: 'oldpass88', next: 'newpass123', again: 'newpass123',
  });
  assert.equal(result, undefined);
  assert.deepEqual(calls, [
    ['signIn', EMAIL, 'oldpass88'],
    ['changePassword', 'newpass123'],
    ['clearInitialPassword', SID],
  ]);
});

test('今のパスワードがちがう → bad-credentials をそのまま投げ、変えない', async () => {
  const err = new NetError('bad-credentials');
  const { auth, repo, calls } = fakes({ fail: { signIn: err } });
  await assert.rejects(
    changeMyPassword({ auth, repo, studentId: SID, current: 'wrongpw88', next: 'newpass123', again: 'newpass123' }),
    (e) => e === err);
  assert.deepEqual(calls, [['signIn', EMAIL, 'wrongpw88']]);
});

test('変更の通信が失敗 → そのまま投げ、最初のパスワードは消さない', async () => {
  const err = new NetError('network');
  const { auth, repo, calls } = fakes({ fail: { changePassword: err } });
  await assert.rejects(
    changeMyPassword({ auth, repo, studentId: SID, current: 'oldpass88', next: 'newpass123', again: 'newpass123' }),
    (e) => e === err);
  assert.deepEqual(calls.map((c) => c[0]), ['signIn', 'changePassword']);
});

test('最初のパスワードを消すのに失敗しても、変更は成功として終える', async () => {
  const { auth, repo, calls } = fakes({ fail: { clear: new NetError('network') } });
  const result = await changeMyPassword({
    auth, repo, studentId: SID, current: 'oldpass88', next: 'newpass123', again: 'newpass123',
  });
  assert.equal(result, undefined);
  assert.deepEqual(calls.map((c) => c[0]), ['signIn', 'changePassword', 'clearInitialPassword']);
});

test('ログインしていない（メールアドレスが分からない）→ auth で、通信しない', async () => {
  for (const user of [null, { uid: 'u1' }]) {
    const { auth, repo, calls } = fakes({ user });
    await assert.rejects(
      changeMyPassword({ auth, repo, studentId: SID, current: 'oldpass88', next: 'newpass123', again: 'newpass123' }),
      (e) => e instanceof NetError && e.code === 'auth');
    assert.deepEqual(calls, []);
  }
});

test('InputError の形', () => {
  const e = new InputError('short', '短すぎます');
  assert.ok(e instanceof Error);
  assert.equal(e.name, 'InputError');
  assert.equal(e.code, 'short');
  assert.equal(e.message, '短すぎます');
  assert.equal(new InputError('same').message, 'same');
});
