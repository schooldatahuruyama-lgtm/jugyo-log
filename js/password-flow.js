// 生徒が自分のパスワードを変える手順（設計書 5.4）。画面は js/views/password.js
// パスワードは、console・エラーの文・端末の保存に出さない
import { checkNewPassword } from './ids.js';
import { InputError, NetError } from './errors.js';

// 入力を確かめてから、今のパスワードでログインし直し → 新しいパスワードに変える → 最初のパスワードの保存を消す。
// 失敗は InputError（code: 'mismatch' | 'same' | 'short' | 'has-id'。通信はしない）か NetError
export async function changeMyPassword({ auth, repo, studentId, current, next, again }) {
  const cur = String(current ?? '');
  const pw = String(next ?? '');
  if (pw !== String(again ?? '')) throw new InputError('mismatch', '2 つの新しいパスワードがちがいます');
  if (pw === cur) throw new InputError('same', '今のパスワードと同じです');
  const bad = checkNewPassword(pw, studentId);
  if (bad) throw new InputError(bad, bad === 'short' ? '新しいパスワードが短すぎます' : '新しいパスワードに自分の ID が入っています');

  const user = auth.user;
  if (!user || !user.email) throw new NetError('auth', 'ログインし直してください');

  // Firebase はパスワードの変更に「最近のログイン」を求めるので、今のパスワードでログインし直す。
  // これで今のパスワードも確かめられる（ちがえば bad-credentials がそのまま投げられ、変更はしない）
  await auth.signIn(user.email, cur);
  await auth.changePassword(pw);

  // 最初のパスワードの保存を消す。失敗しても、パスワードはもう変わっているので成功として終える
  // （先生の一覧に古い「最初のパスワード」が残るだけ。失敗はここで握りつぶす）
  try {
    await repo.clearInitialPassword(studentId);
  } catch {
    // 何もしない
  }
}
