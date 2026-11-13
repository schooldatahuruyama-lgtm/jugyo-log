// 生徒のログイン用アカウントを発行する（1 人ずつ・まとめて・パスワードの出し直し）
// auth（createAccount）と repo（getGeneration・linkAccount）と random は引数で受け取る。
// 作ったパスワードは linkAccount（initialPw）に渡すのと、呼んだ画面に返すことだけに使う。
// 例外の文や onProgress の引数には入れない。
import { NetError } from './errors.js';
import { initialPassword, studentEmail } from './ids.js';

// 失敗の code を、まとめて発行したときの止まった理由にする
function reasonFor(e) {
  const code = e && e.code;
  if (code === 'rate') return 'rate';
  if (code === 'network') return 'network';
  return 'unknown';
}

// 進行中の出し直し（生徒 ID → 終わったら解決する Promise）。同じ ID の出し直しを 1 つずつ行うため、
// createIssuer の外（モジュールの変数）で持つ。画面を作り直しても共有される
const reissueChains = new Map();

export function createIssuer({ auth, repo, random, domain, firstGeneration, maxTries }) {
  // 1 人分を発行する。generation（何回目か）から試し、そのメールアドレスがもう使われていれば
  // （記録の途中で失敗したときなど）1 つ進める。maxTries 回でだめなら NetError('unknown')。
  // 作れたら repo.linkAccount で生徒 ID に結びつける（oldUid があれば古いアカウントを切り離す）。
  // 戻り値 { generation, password, uid }: uid は新しいアカウント（画面は読み直さずに、これで書きかえる）
  async function issueOne(studentId, { generation, oldUid = null }) {
    for (let i = 0; i < maxTries; i++) {
      const g = generation + i;
      const password = initialPassword(random);
      let uid;
      try {
        ({ uid } = await auth.createAccount(studentEmail(studentId, g, domain), password));
      } catch (e) {
        if (e && e.code === 'email-exists') continue;
        throw e;
      }
      await repo.linkAccount(studentId, { uid, generation: g, password }, oldUid);
      return { generation: g, password, uid };
    }
    throw new NetError('unknown', `${studentId} のアカウントを作れませんでした（使われている回数が多すぎます）`);
  }

  // 何人かを 1 人ずつ順に発行する。回数は gen の次から（gen が無ければ firstGeneration から）。
  // 失敗したらそこで止め、その人から後ろを left に入れる。
  // onProgress(済んだ数, 全体の数) は 1 人終わるごとに呼ぶ。
  // shouldStop() が true を返したら（画面を離れたときなど）、次の人に進まずに止まる（reason は 'stopped'）
  async function issueMany(studentIds, { onProgress, shouldStop } = {}) {
    const done = [];
    const total = studentIds.length;
    for (let i = 0; i < total; i++) {
      if (shouldStop && shouldStop()) return { done, left: studentIds.slice(i), reason: 'stopped' };
      const id = studentIds[i];
      try {
        const g = await repo.getGeneration(id);
        const generation = typeof g === 'number' && Number.isFinite(g) ? g + 1 : firstGeneration;
        await issueOne(id, { generation });
      } catch (e) {
        return { done, left: studentIds.slice(i), reason: reasonFor(e) };
      }
      done.push(id);
      if (onProgress) onProgress(done.length, total);
    }
    return { done, left: [], reason: null };
  }

  // 出し直しの本体。始めるたびに、台帳の今の uid と gen を読み直す（画面が覚えている値は使わない。
  // 応答だけが失われたあとや、画面を作り直したあとでも、直前のアカウントを確実に切り離すため）
  async function reissueNow(studentId) {
    const [list, g] = await Promise.all([repo.listStudents(), repo.getGeneration(studentId)]);
    const s = list.find((x) => x.id === studentId);
    if (!s || typeof s.uid !== 'string' || !s.uid) {
      // 未発行の ID は「続きを発行する」で扱う
      throw new NetError('unknown', `${studentId} は、まだ発行が済んでいません`);
    }
    const generation = typeof g === 'number' && Number.isFinite(g) ? g + 1 : firstGeneration;
    return issueOne(studentId, { generation, oldUid: s.uid });
  }

  // パスワードを出し直す（新しいアカウントを作り、古いアカウントを切り離す）。
  // 同じ ID の出し直しが進行中なら、それが終わる（成功でも失敗でも）のを待ってから始める。
  // 戻り値は issueOne と同じ { generation, password, uid }
  function reissueOne(studentId) {
    const before = reissueChains.get(studentId) || Promise.resolve();
    const run = before.then(() => reissueNow(studentId));
    const tail = run.then(() => {}, () => {});
    reissueChains.set(studentId, tail);
    tail.then(() => { if (reissueChains.get(studentId) === tail) reissueChains.delete(studentId); });
    return run;
  }

  return { issueOne, issueMany, reissueOne };
}
