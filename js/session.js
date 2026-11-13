// ログインと、今だれがログインしているかを決める（画面に依存しない）
// auth は js/auth.js の createAuth（または練習モードの auth）、repo は js/repo.js の createRepo。
// 「ID がない」と「パスワードが違う」は区別せず、どちらも 'bad-credentials' にする（ID を当てられないように）。
import { NetError } from './errors.js';
import { normalizeLoginId, isStudentId, studentEmail } from './ids.js';

const badCredentials = () => new NetError('bad-credentials', 'ID かパスワードが違います');

// 取りやめたログイン（画面を離れたあとに届いた応答）を表す。画面には出さない
const cancelled = () => new NetError('auth', 'ログインを取りやめました');

// auth ごとに「最後にログインの通信を始めた試み」を覚える。
// 同じ人がログインし直した場合（uid が同じ）でも、古い試みが新しいログインを外さないようにするため
const lastAttempt = new WeakMap();

// 自分が入れたログインだけを外す。待っている間に、別の試み（別の人でも同じ人でも）が
// ログインし直していたら、さわらない
function signOutIfMine(auth, uid, attempt) {
  if (lastAttempt.get(auth) !== attempt) return;
  const now = auth.user;
  if (now && now.uid === uid) auth.signOut();
}

// ログインのあとの確認で失敗したら、ログアウトしてから失敗を伝える（中途半端なログインを残さない）
async function checkAfterSignIn(auth, uid, attempt, fn) {
  try {
    return await fn();
  } catch (e) {
    signOutIfMine(auth, uid, attempt);
    throw e;
  }
}

// ログイン画面の入力でログインする。
// @ を含めば先生（メールアドレス）、含まなければ生徒 ID として扱う。
// 戻り値: { role: 'teacher' } または { role: 'student', studentId }。失敗は NetError。
// isCurrent: このログインの試みがまだ生きているか（画面を離れたら false を返す関数）。
// 待ったあとは毎回これを確かめ、生きていなければログインの状態を変えずに（自分が入れた分だけ外して）やめる。
// 古い画面の遅い応答が、あとから入った別の人のログインを上書きしたり外したりしないようにするため
export async function signIn({ input, password, auth, repo, domain, isCurrent = () => true }) {
  const id = normalizeLoginId(input);
  const attempt = {}; // この試みの印
  // ログインの通信を送る（送る直前に、この試みを「最後の試み」として覚える）
  const doSignIn = (email) => {
    lastAttempt.set(auth, attempt);
    return auth.signIn(email, password);
  };
  // ログインの通信のあと: 生きていなければ、自分が入れた分だけ外してやめる
  const afterSignIn = (user) => {
    if (isCurrent()) return;
    signOutIfMine(auth, user.uid, attempt);
    throw cancelled();
  };

  if (id.includes('@')) {
    const user = await doSignIn(id);
    afterSignIn(user);
    const ok = await checkAfterSignIn(auth, user.uid, attempt, () => repo.isTeacher(user.uid));
    afterSignIn(user);
    if (!ok) {
      signOutIfMine(auth, user.uid, attempt);
      throw new NetError('not-teacher', '先生として登録されていません');
    }
    return { role: 'teacher' };
  }

  // 形の違う ID では通信をしない
  if (!isStudentId(id)) throw badCredentials();
  const generation = await repo.getGeneration(id);
  if (!isCurrent()) throw cancelled(); // 離れた画面の試みは、ログインの通信を送らない
  if (generation === null) throw badCredentials();
  const user = await doSignIn(studentEmail(id, generation, domain));
  afterSignIn(user);
  // 出し直したあとの古いアカウントは、accounts の対応が無い（または別の ID）。生徒として入れない
  const mine = await checkAfterSignIn(auth, user.uid, attempt, () => repo.getMyStudentId(user.uid));
  afterSignIn(user);
  if (mine !== id) {
    signOutIfMine(auth, user.uid, attempt);
    throw badCredentials();
  }
  return { role: 'student', studentId: id };
}

// 保存してあるログインから、今だれなのかを決める。
// { role: 'none' } / { role: 'teacher', uid } / { role: 'student', uid, studentId } / { role: 'offline' }
// 確かめられない（通信の失敗など）ときは offline にし、ログアウトしない（電波が戻れば、そのまま使える）
export async function resolveSession({ auth, repo }) {
  let user;
  try {
    user = await auth.restore();
  } catch {
    return { role: 'offline' }; // restore は、ログインの無効が確定したときは null を返す。投げるのは一時的な失敗
  }
  if (!user) return { role: 'none' };
  const uid = user.uid;
  try {
    if (await repo.isTeacher(uid)) return { role: 'teacher', uid };
    const studentId = await repo.getMyStudentId(uid);
    if (studentId !== null && isStudentId(studentId)) return { role: 'student', uid, studentId };
  } catch (e) {
    // 規則に断られた（denied）ときは、だれでもないアカウントとして扱う。それ以外は確かめられなかっただけ
    if (!(e instanceof NetError && e.code === 'denied')) return { role: 'offline' };
  }
  // 先生でも生徒でもない（出し直したあとの古いアカウントなど）
  auth.signOut();
  return { role: 'none' };
}
