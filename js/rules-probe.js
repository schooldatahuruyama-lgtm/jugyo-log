// 規則の確認: 本物の Firebase の規則が、生徒に読ませてはいけないものを読ませていないかを確かめる
// （docs/superpowers/specs/2026-11-13-jugyo-log-1a-data.md の 4 章。1a-2 までの範囲）。
// 通信の道具は引数で受け取る。画面や fetch は知らない。
// 規則そのものを試すので、データベースの場所をここに直接書く（repo.js の例外。確かめる場所の一覧）。
// パスワードとトークンは、結果・console・例外の文に出さない。
import { NetError } from './errors.js';
import { CONFIG } from './config.js';
import { newId, studentEmail } from './ids.js';

export const PROBE_ID = 's00-999';
export const PROBE_CLASS_NAME = '（規則の確認用）';
export const PREPARE_LABEL = '準備';
export const CLEANUP_LABEL = '片付け';

const failRow = (label) => ({ label, expect: 'ok', got: 'error', pass: false });
// 1 ピクセルの確認用画像。Drive に実物のファイルは作らない。
const PROBE_THUMB = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

// 1 つの試しを行い、'ok'・'denied'・'error' にする
async function attempt(fn) {
  try {
    await fn();
    return 'ok';
  } catch (e) {
    if (e instanceof NetError && e.code === 'denied') return 'denied';
    return 'error';
  }
}

// teacherRepo: listClasses・getGeneration・listStudents・createClass・saveMembers を使う
// 単元・授業・資料: listUnits・listLessons・createUnit・createLessons・addMaterial も使う
// teacherNet: 先生としての net（students を置く・片付け）
// issuer: createIssuer の結果（issueOne。戻り値の uid は無くてもよい）
// makeStudent(email, password) → { net, uid }: 確認用の生徒としてログインした net
// teacherUid: 先生の uid（teacherList/<先生の uid> を読めないことを確かめる）
// 戻り値: [{ label, expect: 'ok'|'denied', got: 'ok'|'denied'|'error', pass }]。例外は投げない。
// 準備に失敗したら「準備」の行、片付けに失敗したら最後に「片付け」の行が入る
export async function runRulesProbe({ teacherRepo, teacherNet, issuer, makeStudent, random, now, teacherUid }) {
  const sid = PROBE_ID;
  const inId = newId(random, CONFIG.idLength);   // s00-999 が入っているクラス
  let outId = newId(random, CONFIG.idLength);    // 入っていないクラス
  while (outId === inId) outId = newId(random, CONFIG.idLength);
  const inLessonId = newId(random, CONFIG.idLength);
  const outLessonId = newId(random, CONFIG.idLength);
  const materialId = newId(random, CONFIG.idLength);
  const unitId = newId(random, CONFIG.idLength);
  const targets = [
    { classId: inId, lessonId: inLessonId, order: 0 },
    { classId: outId, lessonId: outLessonId, order: 0 },
  ];

  let issueTried = false; // 発行を試みたか（応答が無くても、反映されているかもしれない）
  let issued = null;      // { generation }（発行の応答が届いたら）
  let studentUid = null;  // 確認用の生徒の uid（分かったら）
  let classesMade = false;
  let unitTried = false;
  const rows = [];

  try {
    // 1. 先生として準備する
    await removeLeftovers();
    const students = await teacherRepo.listStudents();
    const mine = students.find((s) => s.id === sid) || null;
    // students/<id>/createdAt は、すでにあれば書けない規則なので、無いときだけ書く
    if (!mine) await teacherNet.set(`students/${sid}/createdAt`, now());
    const g = await teacherRepo.getGeneration(sid);
    const generation = typeof g === 'number' && Number.isFinite(g) ? g + 1 : CONFIG.firstGeneration;
    const oldUid = mine && mine.uid ? mine.uid : null;
    issueTried = true;
    const r = await issuer.issueOne(sid, { generation, oldUid });
    issued = { generation: r.generation };
    if (typeof r.uid === 'string' && r.uid) studentUid = r.uid;

    classesMade = true; // 途中で失敗しても片付けで消すため、作る前に印を付ける
    await teacherRepo.createClass(inId, { year: 0, name: PROBE_CLASS_NAME }, now());
    await teacherRepo.createClass(outId, { year: 0, name: PROBE_CLASS_NAME }, now());
    await teacherRepo.saveMembers(inId, { set: { [sid]: 1 } });
    unitTried = true; // 応答が失われても、作ろうとした単元を片付ける
    await teacherRepo.createUnit(unitId, { year: 0, name: PROBE_CLASS_NAME, order: 0 });
    await teacherRepo.createLessons(targets.map(({ classId, lessonId }) => ({
      classId, lessonId, date: '2000-01-01', title: PROBE_CLASS_NAME, unitId,
    })), now());
    await teacherRepo.addMaterial(targets, materialId, {
      kind: 'board', type: 'image', fileId: 'probe', name: PROBE_CLASS_NAME, bytes: 42,
    }, PROBE_THUMB, now());

    // 2. 確認用の生徒としてログインし、表を順に試す
    const student = await makeStudent(studentEmail(sid, r.generation, CONFIG.emailDomain), r.password);
    studentUid = student.uid;
    const net = student.net;
    const uid = student.uid;

    const checks = [
      ['gen/s00-999 を読む（ログインなし）', 'ok', () => net.getPublic(`gen/${sid}`)],
      ['gen 全体を読む（ログインなし）', 'denied', () => net.getPublic('gen')],
      ['accounts/（自分の uid）を読む', 'ok', () => net.get(`accounts/${uid}`)],
      ['accounts 全体を読む', 'denied', () => net.get('accounts')],
      ['teacherList/（先生の uid）を読む', 'denied', () => net.get(`teacherList/${teacherUid}`)],
      ['students を読む', 'denied', () => net.get('students')],
      ['initialPw/s00-999 を読む', 'denied', () => net.get(`initialPw/${sid}`)],
      ['入っているクラスの classes/（ID）を読む', 'ok', () => net.get(`classes/${inId}`)],
      ['入っていないクラスの classes/（ID）を読む', 'denied', () => net.get(`classes/${outId}`)],
      ['classes 全体を読む', 'denied', () => net.get('classes')],
      ['members/（入っているクラス）/s00-999 を読む', 'ok', () => net.get(`members/${inId}/${sid}`)],
      ['members/（入っているクラス）全体を読む', 'denied', () => net.get(`members/${inId}`)],
      ['memberOf/s00-999 を読む', 'ok', () => net.get(`memberOf/${sid}`)],
      // memberOf・accounts の書きかえが通っても結果が変わらないよう、その確かめより前に試す
      ['入っているクラスの lessons/（ID）を読む', 'ok', () => net.get(`lessons/${inId}`)],
      ['入っていないクラスの lessons/（ID）を読む', 'denied', () => net.get(`lessons/${outId}`)],
      ['lessons 全体を読む', 'denied', () => net.get('lessons')],
      ['thumbs/（入っているクラス）/（授業）を読む', 'ok', () => net.get(`thumbs/${inId}/${inLessonId}`)],
      ['thumbs/（入っていないクラス）/（授業）を読む', 'denied', () => net.get(`thumbs/${outId}/${outLessonId}`)],
      ['units を読む', 'ok', () => net.get('units')],
      ['lessons/（入っているクラス）/（授業）/title を書く', 'denied', () => net.set(`lessons/${inId}/${inLessonId}/title`, '書きかえ')],
      ['lessons/（入っているクラス）/（授業）/materials/（資料）/fileId を書く', 'denied', () => net.set(`lessons/${inId}/${inLessonId}/materials/${materialId}/fileId`, 'probe-changed')],
      ['thumbs/（入っているクラス）/（授業）/（資料）を書きかえる', 'denied', () => net.set(`thumbs/${inId}/${inLessonId}/${materialId}`, 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBTAA7')],
      ['units/（単元）/name を書く', 'denied', () => net.set(`units/${unitId}/name`, '書きかえ')],
      ['classes/（入っているクラス）/name を書く', 'denied', () => net.set(`classes/${inId}/name`, '書きかえ')],
      ['memberOf/s00-999/（入っていないクラス）に true を書く', 'denied', () => net.set(`memberOf/${sid}/${outId}`, true)],
      ['accounts/（自分の uid）を別の ID に書きかえる', 'denied', () => net.set(`accounts/${uid}`, 's00-998')],
      ['gen/s00-999 を書く', 'denied', () => net.set(`gen/${sid}`, r.generation + 1)],
      ['initialPw/s00-999 に文字を書く', 'denied', () => net.set(`initialPw/${sid}`, 'kakikae')],
      ['initialPw/s00-999 を消す', 'ok', () => net.remove(`initialPw/${sid}`)],
    ];
    for (const [label, expect, fn] of checks) {
      const got = await attempt(fn);
      rows.push({ label, expect, got, pass: got === expect });
    }
  } catch {
    // 準備（発行・ログインなど）の失敗。例外の中身は出さない（パスワードを含めないため）
    rows.push(failRow(PREPARE_LABEL));
  }

  // 3. 先生として片付ける（途中で失敗しても）。students/s00-999 と gen/s00-999 は残す。
  // (a) 分かっている場所の削除と (b) uid を読み直しての accounts の削除は、別々に試みる
  const okA = await removeKnown();
  const okB = await removeAccount();
  if (!okA || !okB) rows.push(failRow(CLEANUP_LABEL));
  return rows;

  // 前回の残りを消す。確かめの中で変わらないもので見つける（名前は書きかえが通ってしまうことがあるので見ない）:
  // - 年度 0 のクラス（先生が作るクラスは 2000〜2099 年度なので、年度 0 は確認用だけ）と、その members・lessons・thumbs
  // - 年度 0 の単元（名前を書きかえられていても消す）
  // - memberOf/s00-999 の下のクラス ID（classes に無くても）の members/<ID>/s00-999 と、memberOf/s00-999
  async function removeLeftovers() {
    const old = (await teacherRepo.listClasses()).filter((c) => c.year === 0);
    const units = await teacherRepo.listUnits(0);
    const of = await teacherNet.get(`memberOf/${sid}`);
    const ofIds = of !== null && typeof of === 'object' && !Array.isArray(of) ? Object.keys(of) : [];
    if (old.length === 0 && ofIds.length === 0 && units.length === 0) return;
    const patch = {};
    if (old.length > 0 || ofIds.length > 0) patch[`memberOf/${sid}`] = null;
    for (const id of ofIds) patch[`members/${id}/${sid}`] = null;
    for (const c of old) {
      patch[`classes/${c.id}`] = null;
      patch[`members/${c.id}`] = null;
      patch[`thumbs/${c.id}`] = null;
      // lessons は授業 1 件から下だけを書ける規則なので、クラスの場所をまるごと消さない
      for (const l of await teacherRepo.listLessons(c.id)) patch[`lessons/${c.id}/${l.id}`] = null;
      delete patch[`members/${c.id}/${sid}`]; // 親（members/<ID>）を消すので、子の指定は外す（同じ update で親子を並べない）
    }
    for (const u of units) patch[`units/${u.id}`] = null;
    await teacherNet.update('', patch);
  }

  // (a) 確認用のクラス 2 つ・授業・資料・単元・members・memberOf・initialPw を消し、gen を戻す。済めば true
  async function removeKnown() {
    try {
      const patch = {};
      if (classesMade) {
        for (const { classId: id, lessonId } of targets) {
          patch[`classes/${id}`] = null;
          patch[`members/${id}`] = null;
          patch[`lessons/${id}/${lessonId}`] = null;
          patch[`thumbs/${id}`] = null;
        }
        patch[`memberOf/${sid}`] = null;
      }
      if (unitTried) patch[`units/${unitId}`] = null;
      if (issueTried) patch[`initialPw/${sid}`] = null;
      if (issued) patch[`gen/${sid}`] = issued.generation; // 書きかえの確かめの前の値に戻す
      if (Object.keys(patch).length > 0) await teacherNet.update('', patch);
      return true;
    } catch {
      return false;
    }
  }

  // (b) 確認用の生徒のアカウントの対応（accounts/<uid>）を消す。
  // uid が分からなければ、台帳（students/s00-999/uid）を読み直す。発行の応答が失われても、
  // 反映されていれば台帳に今回の uid がある。済めば true
  async function removeAccount() {
    if (!issueTried) return true;
    try {
      let uid = studentUid;
      if (!uid) {
        const s = (await teacherRepo.listStudents()).find((x) => x.id === sid);
        uid = s && s.uid ? s.uid : null;
      }
      const patch = { [`initialPw/${sid}`]: null };
      if (uid) patch[`accounts/${uid}`] = null;
      await teacherNet.update('', patch);
      return true;
    } catch {
      return false;
    }
  }
}
