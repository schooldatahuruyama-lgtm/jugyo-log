// 規則の確認: 本物の Firebase の規則が、生徒に読ませてはいけないものを読ませていないかを確かめる
// （docs/superpowers/specs/2026-11-13-jugyo-log-1a-data.md の 4 章。添付・手書き・重要用語・先生の返事を含む）。
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

const PROBE_OTHER_UID = 'rules-probe-other-uid';
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
// 単元・授業・資料: listUnits・createUnit・createLessons・addMaterial も使う
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
  let missingMaterialId = newId(random, CONFIG.idLength);
  while (missingMaterialId === materialId) missingMaterialId = newId(random, CONFIG.idLength);
  let pdfMaterialId = newId(random, CONFIG.idLength);
  while ([materialId, missingMaterialId].includes(pdfMaterialId)) pdfMaterialId = newId(random, CONFIG.idLength);
  const unitId = newId(random, CONFIG.idLength);
  let missingLessonId = newId(random, CONFIG.idLength);
  while (missingLessonId === inLessonId) missingLessonId = newId(random, CONFIG.idLength);
  const targets = [
    { classId: inId, lessonId: inLessonId, order: 0 },
    { classId: outId, lessonId: outLessonId, order: 0 },
  ];

  let issueTried = false; // 発行を試みたか（応答が無くても、反映されているかもしれない）
  let issued = null;      // { generation }（発行の応答が届いたら）
  let studentUid = null;  // 確認用の生徒の uid（分かったら）
  let studentNet = null;
  let classesMade = false;
  let unitTried = false;
  let leftoversFailed = false;
  const recordCleanup = new Map(); // 書けた場所と、応答が失われて書けたかもしれない場所
  const rows = [];

  try {
    // 1. 確認用の生徒を発行してログインし、前回の記録を消してから今回の準備をする
    if (!await removeRika(PROBE_OTHER_UID)) leftoversFailed = true;
    const students = await teacherRepo.listStudents();
    const mine = students.find((s) => s.id === sid) || null;
    // students/<id>/createdAt は、すでにあれば書けない規則なので、無いときだけ書く
    if (!mine) await teacherNet.set(`students/${sid}/createdAt`, now());
    const g = await teacherRepo.getGeneration(sid);
    const generation = typeof g === 'number' && Number.isFinite(g) ? g + 1 : CONFIG.firstGeneration;
    const oldUid = mine && mine.uid ? mine.uid : null;
    // 発行で uid が変わる前に消す。失敗したら台帳の uid を残し、次回も同じ場所を片付ける。
    if (oldUid && !await removeRika(oldUid)) {
      leftoversFailed = true;
      throw new NetError('denied', '前回の理科クエストの記録を片付けられませんでした');
    }
    issueTried = true;
    const r = await issuer.issueOne(sid, { generation, oldUid });
    issued = { generation: r.generation };
    if (typeof r.uid === 'string' && r.uid) studentUid = r.uid;
    const student = await makeStudent(studentEmail(sid, r.generation, CONFIG.emailDomain), r.password);
    studentUid = student.uid;
    studentNet = student.net;
    try {
      await removeLeftovers();
    } catch (e) {
      leftoversFailed = true;
      throw e;
    }

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
    await teacherRepo.addMaterial(targets, pdfMaterialId, {
      kind: 'handout', type: 'pdf', fileId: 'probe-pdf', name: PROBE_CLASS_NAME, bytes: 42,
    }, null, now());

    // 2. 表を順に試す。記録の確認は、accounts・memberOf の書きかえより前に行う
    const net = studentNet;
    const uid = studentUid;
    const memoOnly = { memo: 'あ'.repeat(2000), learned: '', question: '', updatedAt: now() };
    const record = { memo: '確認用のメモ', learned: '', question: '', updatedAt: now() };
    const ownRecord = `records/${inId}/${inLessonId}/${sid}`;
    const attachment = { type: 'image', fileId: 'probe', bytes: 42, addedAt: now() };
    const ownThumbs = `recThumbs/${inId}/${inLessonId}/${sid}`;
    const otherThumbs = `recThumbs/${inId}/${inLessonId}/s00-998`;
    const ownTerms = `terms/${sid}/${inId}`;
    const writeTerm = (slot, text) => trackWrite({ [ownTerms]: null },
      () => net.set(`${ownTerms}/${inLessonId}/${slot}`, text));
    const writeAttachment = (slot, value) => {
      const path = `${ownRecord}/attachments/${slot}`;
      return trackWrite({ [path]: null }, () => net.set(path, value));
    };
    const writeRecThumb = (path, key = 'a1') => trackWrite({ [path]: null }, () => net.set(`${path}/${key}`, PROBE_THUMB));
    const ink = { fileId: 'probe-ink', bytes: 42, strokes: 1, updatedAt: now() };
    const writeInk = (field, value, studentId = sid) => {
      const path = `records/${inId}/${inLessonId}/${studentId}/ink/${field}`;
      return trackWrite({ [path]: null }, () => net.set(path, value));
    };
    const writePageInk = (place, page, value) => {
      const path = `${ownRecord}/inkPages/${place}/${page}`;
      return trackWrite({ [path]: null }, () => net.set(path, value));
    };
    const inkThumbs = `inkThumbs/${inId}/${inLessonId}`;
    const writeInkCleared = (field, time = ink.updatedAt + 3) => {
      const path = `${ownRecord}/inkCleared/${field}`;
      return trackWrite({ [path]: null }, () => net.set(path, time));
    };
    const writeInkThumb = (field, studentId = sid) => {
      const path = `${inkThumbs}/${field}/${studentId}`;
      return trackWrite({ [path]: null }, () => net.set(path, PROBE_THUMB));
    };
    const ownReply = `replies/${inId}/${inLessonId}/${sid}`;
    const ownReplyMark = `replyMarks/${sid}/${inId}/${inLessonId}`;
    const reply = { text: 'あ'.repeat(CONFIG.reply.textMax), updatedAt: now() };
    const aiPath = `aiSummaries/${inId}/${inLessonId}`;
    const aiSummary = { v: 1, createdAt: now(), overview: '規則の確認用のまとめ' };
    const rikaState = `rika/state/${uid}`;
    const rikaLog = `rika/log/${uid}/probe_01`;
    const rikaValue = { v: 1, updatedAt: now(), json: '{}' };

    const checks = [
      ['先生として aiSummaries を書く', 'ok', () => teacherNet.set(aiPath, aiSummary)],
      ['先生として aiSummaries を読む', 'ok', () => teacherNet.get(aiPath)],
      ['先生として overview のない aiSummaries を書く', 'denied', () => teacherNet.set(aiPath, { v: 1, createdAt: aiSummary.createdAt })],
      ['生徒として入っているクラスの aiSummaries を読む', 'denied', () => net.get(aiPath)],
      ['生徒として入っているクラスの aiSummaries を書く', 'denied', () => net.set(aiPath, aiSummary)],
      ['自分の rika/state に正しい形を書く', 'ok', () => net.set(rikaState, rikaValue)],
      ['自分の rika/state を読む', 'ok', () => net.get(rikaState)],
      ['json のない rika/state を書く', 'denied', () => net.set(rikaState, { v: 1, updatedAt: rikaValue.updatedAt })],
      ['知らない項目（extra）のある rika/state を書く', 'denied', () => net.set(rikaState, { ...rikaValue, extra: true })],
      ['json が 500001 文字の rika/state を書く', 'denied', () => net.set(rikaState, { ...rikaValue, json: 'あ'.repeat(500001) })],
      ['自分の rika/log にかたまりを書く', 'ok', () => net.set(rikaLog, '[]')],
      ['すでにある自分の rika/log のかたまりを同じ内容で書き直す', 'denied', () => net.set(rikaLog, '[]')],
      ['自分の rika/log のかたまりを消す', 'denied', () => net.remove(rikaLog)],
      // net はパスをそのまま URL に使うため、使えない文字「.」ではなく短すぎる ID で試す。
      ['id が 7 文字の rika/log を書く', 'denied', () => net.set(`rika/log/${uid}/probe_1`, '[]')],
      ['ほかの人（確認用の uid）の rika/state を読む', 'denied', () => net.get(`rika/state/${PROBE_OTHER_UID}`)],
      ['ほかの人（確認用の uid）の rika/state を書く', 'denied', () => net.set(`rika/state/${PROBE_OTHER_UID}`, rikaValue)],
      ['ほかの人（確認用の uid）の rika/log に書く', 'denied', () => net.set(`rika/log/${PROBE_OTHER_UID}/probe_01`, '[]')],
      ['rika/state 全体を読む', 'denied', () => net.get('rika/state')],
      ['先生として確認用の生徒の rika/state を読む', 'ok', () => teacherNet.get(rikaState)],
      ['先生として確認用の生徒の rika/log を読む', 'ok', () => teacherNet.get(`rika/log/${uid}`)],
      ['先生として確認用の生徒の rika/state を書きかえる', 'denied', () => teacherNet.set(rikaState, { ...rikaValue, updatedAt: rikaValue.updatedAt + 1 })],
      ['rika/state/（確認用の生徒の uid）を読む（ログインなし）', 'denied', () => net.getPublic(rikaState)],
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
      ['自分の records を書く（メモだけ・2000 文字）', 'ok', () => writeRecord(net, inId, inLessonId, sid, memoOnly, true)],
      ['自分の records を読む', 'ok', () => net.get(ownRecord)],
      ['自分の records と marks を一緒に書く（level: 3）', 'ok', () => writeRecord(net, inId, inLessonId, sid, { ...record, level: 3 }, true)],
      ['marks/s00-999/（入っているクラス）を読む', 'ok', () => net.get(`marks/${sid}/${inId}`)],
      ['records/（入っているクラス）全体を読む', 'denied', () => net.get(`records/${inId}`)],
      ['records/（入っているクラス）/（授業）全体を読む', 'denied', () => net.get(`records/${inId}/${inLessonId}`)],
      ['ほかの生徒（s00-998）の records を読む', 'denied', () => net.get(`records/${inId}/${inLessonId}/s00-998`)],
      ['ほかの生徒（s00-998）の records を書く', 'denied', () => writeRecord(net, inId, inLessonId, 's00-998', record)],
      ['入っていないクラスの授業に records を書く', 'denied', () => writeRecord(net, outId, outLessonId, sid, record)],
      ['存在しない授業に records を書く', 'denied', () => writeRecord(net, inId, missingLessonId, sid, record)],
      ['memo が 2001 文字の records を書く', 'denied', () => writeRecord(net, inId, inLessonId, sid, { ...record, memo: 'あ'.repeat(2001) })],
      ['level が 5 の records を書く', 'denied', () => writeRecord(net, inId, inLessonId, sid, { ...record, level: 5 })],
      ['知らない項目（extra）のある records を書く', 'denied', () => writeRecord(net, inId, inLessonId, sid, { ...record, extra: true })],
      ['ほかの生徒（s00-998）の marks を書く', 'denied', () => {
        const path = `marks/s00-998/${inId}/${inLessonId}`;
        return trackWrite({ [path]: null }, () => net.set(path, 3));
      }],
      ['先生として確認用の生徒の records を書く', 'denied', () => writeRecord(teacherNet, inId, inLessonId, sid, record)],
      ['自分の attachments/a1 を書く', 'ok', () => writeAttachment('a1', attachment)],
      ['自分の attachments/a7 を書く', 'denied', () => writeAttachment('a7', attachment)],
      ['type が video の attachments/a2 を書く', 'denied', () => writeAttachment('a2', { ...attachment, type: 'video' })],
      ['自分の recThumbs/a1 を書く', 'ok', () => writeRecThumb(ownThumbs)],
      ['自分の recThumbs を読む', 'ok', () => net.get(ownThumbs)],
      ['ほかの生徒（s00-998）の recThumbs を読む', 'denied', () => net.get(otherThumbs)],
      ['ほかの生徒（s00-998）の recThumbs/a1 を書く', 'denied', () => writeRecThumb(otherThumbs)],
      ['先生として確認用の生徒の recThumbs を読む', 'ok', () => teacherNet.get(ownThumbs)],
      ['すでにある attachments/a1 を同じ fileId で書き直す', 'ok', () => writeAttachment('a1', { ...attachment, bytes: 43 })],
      ['すでにある attachments/a1 を別の fileId で書きかえる', 'denied', () => writeAttachment('a1', { ...attachment, fileId: 'probe-changed' })],
      ['自分の recThumbs に文字を直接書く', 'denied', () => trackWrite({ [ownThumbs]: null }, () => net.set(ownThumbs, PROBE_THUMB))],
      ['自分の ink/memo を書く', 'ok', () => writeInk('memo', ink)],
      ['自分の ink/other を書く', 'denied', () => writeInk('other', ink)],
      ['strokes がない ink/memo を書く', 'denied', () => writeInk('memo', { fileId: ink.fileId, bytes: ink.bytes, updatedAt: ink.updatedAt + 1 })],
      ['strokes が 0 の ink/memo を書く', 'denied', () => writeInk('memo', { ...ink, strokes: 0, updatedAt: ink.updatedAt + 2 })],
      ['ほかの生徒（s00-998）の ink/memo を書く', 'denied', () => writeInk('memo', ink, 's00-998')],
      ['自分の inkThumbs/learned を書く', 'ok', () => writeInkThumb('learned')],
      ['自分の inkThumbs/memo を書く', 'denied', () => writeInkThumb('memo')],
      ['ほかの生徒（s00-998）の inkThumbs/learned を書く', 'denied', () => writeInkThumb('learned', 's00-998')],
      ['inkThumbs/（入っているクラス）/（授業）/learned 全体を読む', 'denied', () => net.get(`${inkThumbs}/learned`)],
      ['先生として inkThumbs/（入っているクラス）/（授業）/learned を読む', 'ok', () => teacherNet.get(`${inkThumbs}/learned`)],
      ['自分の terms/t1 を書く', 'ok', () => writeTerm('t1', '光の反射')],
      ['自分の terms/（入っているクラス）を読む', 'ok', () => net.get(ownTerms)],
      ['自分の terms/t9 を書く', 'denied', () => writeTerm('t9', '鏡の実験')],
      ['21 文字の用語を terms/t1 に書く', 'denied', () => writeTerm('t1', 'あ'.repeat(21))],
      ['ほかの生徒（s00-998）の terms を読む', 'denied', () => net.get('terms/s00-998')],
      ['lessons/（入っているクラス）/（授業）/terms/（用語）を書く', 'denied', () => net.set(`lessons/${inId}/${inLessonId}/terms/${materialId}`, '光の反射')],
      // 返事の規則を個別に試すため、ここだけ本文と目印を別々に書く。片付けは先生として一緒に行う。
      ['先生として確認用の生徒の replies に文を書く', 'ok', () => teacherNet.set(ownReply, reply)],
      ['先生として確認用の生徒の replies に見ましたの印を書く', 'ok', () => teacherNet.set(ownReply, { seen: true, updatedAt: reply.updatedAt })],
      ['先生として updatedAt だけの replies を書く', 'denied', () => teacherNet.set(ownReply, { updatedAt: reply.updatedAt })],
      ['先生として text が 401 文字の replies を書く', 'denied', () => teacherNet.set(ownReply, { ...reply, text: 'あ'.repeat(CONFIG.reply.textMax + 1) })],
      ['先生として seen が false の replies を書く', 'denied', () => teacherNet.set(ownReply, { ...reply, seen: false })],
      ['先生として確認用の生徒の replyMarks に数を書く', 'ok', () => teacherNet.set(ownReplyMark, reply.updatedAt)],
      ['自分の replies を読む', 'ok', () => net.get(ownReply)],
      ['自分の replies を書く', 'denied', () => net.set(ownReply, reply)],
      ['自分の replyMarks を読む', 'ok', () => net.get(`replyMarks/${sid}/${inId}`)],
      ['自分の replyMarks を書く', 'denied', () => net.set(ownReplyMark, reply.updatedAt)],
      ['ほかの生徒（s00-998）の replies を読む', 'denied', () => net.get(`replies/${inId}/${inLessonId}/s00-998`)],
      ['replies/（入っているクラス）/（授業）全体を読む', 'denied', () => net.get(`replies/${inId}/${inLessonId}`)],
      ['classes/（入っているクラス）/name を書く', 'denied', () => net.set(`classes/${inId}/name`, '書きかえ')],
      ['memberOf/s00-999/（入っていないクラス）に true を書く', 'denied', () => net.set(`memberOf/${sid}/${outId}`, true)],
      ['accounts/（自分の uid）を別の ID に書きかえる', 'denied', () => net.set(`accounts/${uid}`, 's00-998')],
      ['gen/s00-999 を書く', 'denied', () => net.set(`gen/${sid}`, r.generation + 1)],
      ['initialPw/s00-999 に文字を書く', 'denied', () => net.set(`initialPw/${sid}`, 'kakikae')],
      ['initialPw/s00-999 を消す', 'ok', () => net.remove(`initialPw/${sid}`)],
      ['先生として records/（入っているクラス）/（授業）を読む', 'ok', () => teacherNet.get(`records/${inId}/${inLessonId}`)],
      ['先生として marks/s00-999 を読む', 'ok', () => teacherNet.get(`marks/${sid}`)],
      ['自分の ink/memo を前より古い時刻で書く', 'denied', () => writeInk('memo', { ...ink, updatedAt: ink.updatedAt - 1 })],
      ['自分の inkCleared/memo に目録より古い時刻を書く', 'denied', () => writeInkCleared('memo', ink.updatedAt - 1)],
      ['自分の inkCleared/memo に数を書く', 'ok', () => writeInkCleared('memo')],
      ['自分の inkCleared/other に数を書く', 'denied', () => writeInkCleared('other')],
      ['自分の写真と同じ on で ink/a1 を書く', 'ok', () => writeInk('a1', { ...ink, on: attachment.fileId })],
      ['自分の写真と違う on で ink/a1 を書く', 'denied', () => writeInk('a1', { ...ink, on: 'probe-other', updatedAt: ink.updatedAt + 1 })],
      ['写真がない ink/a2 を書く', 'denied', () => writeInk('a2', { ...ink, on: attachment.fileId })],
      ['on を付けて ink/memo を書く', 'denied', () => writeInk('memo', { ...ink, on: attachment.fileId, updatedAt: ink.updatedAt + 4 })],
      ['授業の写真の資料と同じ on で ink/（資料）を書く', 'ok', () => writeInk(materialId, { ...ink, on: 'probe' })],
      ['授業にない資料の ink を書く', 'denied', () => writeInk(missingMaterialId, { ...ink, on: 'probe' })],
      ['自分の PDF と同じ on で inkPages/a2/p1 を書く', 'ok', async () => {
        await writeAttachment('a2', { ...attachment, type: 'pdf', fileId: 'probe-pdf' });
        await writePageInk('a2', 'p1', { ...ink, on: 'probe-pdf' });
      }],
      ['自分の PDF と違う on で inkPages/a2/p1 を書く', 'denied', () => writePageInk('a2', 'p1', { ...ink, on: 'probe-other', updatedAt: ink.updatedAt + 1 })],
      ['ページ名が不正な inkPages/a2/p0 を書く', 'denied', () => writePageInk('a2', 'p0', { ...ink, on: 'probe-pdf' })],
      ['写真の置き場所に inkPages/a1/p1 を書く', 'denied', () => writePageInk('a1', 'p1', { ...ink, on: attachment.fileId })],
      ['PDF の置き場所に写真の ink/a2 を書く', 'denied', () => writeInk('a2', { ...ink, on: 'probe-pdf', updatedAt: ink.updatedAt + 1 })],
      ['自分の inkPages/a2/p1 を前より古い時刻で書く', 'denied', () => writePageInk('a2', 'p1', { ...ink, on: 'probe-pdf', updatedAt: ink.updatedAt - 1 })],
      ['授業の PDF の資料と同じ on で inkPages/（資料）/p1 を書く', 'ok', () => writePageInk(pdfMaterialId, 'p1', { ...ink, on: 'probe-pdf' })],
    ];
    for (const [label, expect, fn] of checks) {
      const got = await attempt(fn);
      rows.push({ label, expect, got, pass: got === expect });
    }
  } catch {
    // 準備（発行・ログインなど）の失敗。例外の中身は出さない（パスワードを含めないため）
    rows.push(failRow(PREPARE_LABEL));
  }

  // 3. 生徒として記録・印・小さい画像・用語を消してから、先生として片付ける（途中で失敗しても）。
  // students/s00-999 と gen/s00-999 は残す。
  // (a) 分かっている場所の削除と (b) uid を読み直しての accounts の削除は、別々に試みる
  const okRecords = await removeRecords();
  const okA = await removeKnown(okRecords);
  const okB = await removeAccount();
  // 拒否された場合も、応答が失われた場合も、確認専用の uid の記録を消す。
  const okOtherRika = await removeRika(PROBE_OTHER_UID);
  if (leftoversFailed || !okRecords || !okA || !okB || !okOtherRika) rows.push(failRow(CLEANUP_LABEL));
  return rows;

  // 通常の保存は記録と印を同時に書く。拒否の確認だけは、ほかの規則に隠されないよう 1 か所ずつ試す。
  function writeRecord(net, classId, lessonId, studentId, value, paired = false) {
    const path = `records/${classId}/${lessonId}/${studentId}`;
    const mark = `marks/${studentId}/${classId}/${lessonId}`;
    const cleanup = paired ? { [path]: null, [mark]: null } : { [path]: null };
    return trackWrite(cleanup, () => paired
      ? net.update('', { [path]: value, [mark]: value.level ?? null })
      : net.set(path, value));
  }

  async function trackWrite(cleanup, fn) {
    // 同じ場所・同じ組は 1 回だけ消す。単独の書きこみと、同時に書いた組は分ける。
    const key = JSON.stringify(Object.keys(cleanup).sort());
    try {
      await fn();
    } catch (e) {
      // denied は反映されていない。通信失敗は、反映後に応答だけ失われた可能性がある。
      if (!(e instanceof NetError && e.code === 'denied')) {
        recordCleanup.set(key, cleanup);
      }
      throw e;
    }
    recordCleanup.set(key, cleanup);
  }

  async function removeRecords() {
    let ok = true;
    for (const patch of recordCleanup.values()) {
      // 禁止の場所の削除に失敗しても、ほかの記録の片付けは続ける。
      if (await attempt(() => studentNet.update('', patch)) !== 'ok') ok = false;
    }
    return ok;
  }

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
    let recordsRemoved = true;
    if (old.length > 0 || ofIds.length > 0) patch[`memberOf/${sid}`] = null;
    for (const id of ofIds) patch[`members/${id}/${sid}`] = null;
    for (const c of old) {
      patch[`classes/${c.id}`] = null;
      patch[`members/${c.id}`] = null;
      patch[`thumbs/${c.id}`] = null;
      patch[`replies/${c.id}`] = null;
      patch[`aiSummaries/${c.id}`] = null;
      patch[`replyMarks/${sid}/${c.id}`] = null;
      // lessons は授業 1 件から下だけを書ける規則なので、クラスの場所をまるごと消さない
      const lessons = await teacherNet.get(`lessons/${c.id}`, { shallow: true });
      const lessonIds = lessons !== null && typeof lessons === 'object' && !Array.isArray(lessons) ? Object.keys(lessons) : [];
      const studentPatch = { [`marks/${sid}/${c.id}`]: null, [`terms/${sid}/${c.id}`]: null };
      for (const lessonId of lessonIds) {
        patch[`lessons/${c.id}/${lessonId}`] = null;
        studentPatch[`records/${c.id}/${lessonId}/${sid}`] = null;
        studentPatch[`recThumbs/${c.id}/${lessonId}/${sid}`] = null;
        for (const field of CONFIG.inkThumbFields) studentPatch[`inkThumbs/${c.id}/${lessonId}/${field}/${sid}`] = null;
      }
      if (ofIds.includes(c.id) && of[c.id] === true
        && await attempt(() => studentNet.update('', studentPatch)) !== 'ok') recordsRemoved = false;
      delete patch[`members/${c.id}/${sid}`]; // 親（members/<ID>）を消すので、子の指定は外す（同じ update で親子を並べない）
    }
    // クラス本体が先に消えた場合も、所属が残っているうちに自分の用語を片付ける。
    for (const id of ofIds) {
      if (of[id] === true && !old.some((c) => c.id === id)
        && await attempt(() => studentNet.update('', { [`terms/${sid}/${id}`]: null })) !== 'ok') recordsRemoved = false;
    }
    for (const u of units) patch[`units/${u.id}`] = null;
    // 消せなかった記録を次の回に片付けられるよう、クラス・授業・所属を残す。
    if (!recordsRemoved) throw new NetError('denied', '前回の記録を片付けられませんでした');
    await teacherNet.update('', patch);
  }

  // (a) 確認用のクラス 2 つ・授業・資料・単元・members・memberOf・initialPw を消し、gen を戻す。済めば true
  async function removeKnown(recordsRemoved) {
    try {
      const patch = {};
      // 拒否のはずの書きこみが通った場合や、応答だけ失われた場合も、先生として返事と目印を消す。
      if (classesMade) {
        for (const { classId } of targets) {
          patch[`replies/${classId}`] = null;
          patch[`aiSummaries/${classId}`] = null;
          patch[`replyMarks/${sid}/${classId}`] = null;
        }
      }
      // 生徒の片付けに失敗したときは、次の回に必要なクラス・授業・所属を残す。
      if (classesMade && recordsRemoved) {
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

  // 理科クエストの記録は生徒から消せないので、先生として uid ごとに片付ける。
  async function removeRika(uid) {
    return await attempt(() => teacherNet.update('', {
      [`rika/state/${uid}`]: null, [`rika/log/${uid}`]: null,
    })) === 'ok';
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
      // 理科クエストの削除が拒否されても、アカウントの片付けは続ける。
      const okRika = uid ? await removeRika(uid) : true;
      await teacherNet.update('', patch);
      return okRika;
    } catch {
      return false;
    }
  }
}
