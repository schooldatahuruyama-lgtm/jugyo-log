// 規則の確認（js/rules-probe.js）を確かめる。先生の repo・net、発行、確認用の生徒の net は、
// 呼び出しを記録する代役を使う（本物の規則は、先生の画面の「規則の確認」で確かめる）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runRulesProbe } from '../js/rules-probe.js';
import { NetError } from '../js/errors.js';
import { createRepo } from '../js/repo.js';
import { createMemoryNet } from '../js/dev/memory-net.js';

const PASSWORD = 'secretpw';     // 代役の発行が返すパスワード（結果に出てはいけない）
const TOKEN = 'token-xyz-123';   // 代役の生徒のトークン（結果に出てはいけない）
const STUDENT_UID = 'stu-uid';
const TEACHER_UID = 'teacher-uid';

// 決まった順に数を返す random（newId が毎回ちがう ID を作れるように）
function seqRandom() {
  let i = 0;
  return () => { i = (i + 0.137) % 1; return i; };
}

// 先生の repo の代役。students の台帳と、作ったクラス・名簿を記録する。
// listStudentsFails(n): n 回目の listStudents を失敗させるなら true
function fakeTeacherRepo({ generation = null, students = [], classes = [], units = [], lessons = [],
  listStudentsFails = () => false, failPrepare = () => false } = {}) {
  const state = {
    generation,
    students: students.map((s) => ({ ...s })),
    existing: classes.map((c) => ({ ...c })), // 前からあるクラス（listClasses で返す）
    classes: [],     // 今回作ったクラス [{ id, year, name, createdAt }]
    members: [],     // [{ classId, set, remove }]
    existingUnits: units.map((u) => ({ ...u })),
    existingLessons: lessons.map((l) => ({ ...l })),
    units: [],
    lessons: [],
    materials: [],
    listStudentsCalls: 0,
  };
  return {
    state,
    async getGeneration(id) { return id === 's00-999' ? state.generation : null; },
    async listStudents() {
      state.listStudentsCalls += 1;
      if (listStudentsFails(state.listStudentsCalls)) throw new NetError('network', 'つながりません');
      return state.students.map((s) => ({ ...s }));
    },
    async listClasses() { return [...state.existing, ...state.classes].map((c) => ({ ...c })); },
    async createClass(id, { year, name }, now) { state.classes.push({ id, year, name, createdAt: now }); },
    async saveMembers(classId, { set = {}, remove = [] }) { state.members.push({ classId, set, remove }); },
    async listUnits(year) { return [...state.existingUnits, ...state.units].filter((u) => u.year === year); },
    async listLessons(classId) { return [...state.existingLessons, ...state.lessons].filter((l) => l.classId === classId); },
    async createUnit(id, unit) {
      state.units.push({ id, ...unit });
      if (failPrepare('createUnit')) throw new NetError('network', 'つながりません');
    },
    async createLessons(items, now) {
      state.lessons.push(...items.map(({ lessonId, ...l }) => ({ id: lessonId, ...l, createdAt: now, updatedAt: now })));
      if (failPrepare('createLessons')) throw new NetError('network', 'つながりません');
    },
    async addMaterial(targets, materialId, material, thumb, now) {
      state.materials.push(...targets.map((t) => ({ ...t, materialId, material: { ...material }, thumb, now })));
      if (failPrepare('addMaterial')) throw new NetError('network', 'つながりません');
    },
  };
}

// 先生の net の代役（片付けの書きこみを記録する）。failUpdate(patch) が true ならその update を失敗させる
// data: { 場所: 値 }（get で返す。無ければ null）
function fakeTeacherNet({ failUpdate = () => false, data = {}, answer = () => undefined } = {}) {
  const calls = [];
  return {
    calls,
    async get(path, options) {
      calls.push(['get', path, options]);
      const a = answer('get', path) ?? 'ok';
      if (a instanceof Error) throw a;
      if (a === 'denied') throw new NetError('denied', '権限がありません');
      return path in data ? data[path] : null;
    },
    async set(path, value) {
      calls.push(['set', path, value]);
      const a = answer('set', path, value) ?? (path.startsWith('records/') ? 'denied' : 'ok');
      if (a instanceof Error) throw a;
      if (a === 'denied') throw new NetError('denied', '権限がありません');
    },
    async update(path, patch) {
      calls.push(['update', path, patch]);
      // 本番の規則は授業 1 件から下にだけ書きこみを許す。クラス単位の削除は通らない。
      if (Object.keys(patch).some((p) => /^lessons\/[^/]+$/.test(p))) throw new NetError('denied', '権限がありません');
      if (failUpdate(patch)) throw new NetError('network', 'つながりません');
    },
    async remove(path) { calls.push(['remove', path]); },
  };
}

// 発行の代役。issueOne を記録し、台帳の uid と回数を進める。
// throwAfterLink: データベースに反映したあとで、通信の失敗として例外を投げる（応答だけが失われた）
// returnUid: 戻り値に uid を入れる（あとで足される予定の形）
function fakeIssuer(repo, { throwAfterLink = false, returnUid = false } = {}) {
  const calls = [];
  return {
    calls,
    async issueOne(studentId, { generation, oldUid = null }) {
      calls.push({ studentId, generation, oldUid });
      const s = repo.state.students.find((x) => x.id === studentId);
      if (s) s.uid = STUDENT_UID; else repo.state.students.push({ id: studentId, uid: STUDENT_UID, createdAt: 1 });
      repo.state.generation = generation;
      if (throwAfterLink) throw new NetError('network', '時間内に返事がありませんでした');
      return returnUid ? { generation, password: PASSWORD, uid: STUDENT_UID } : { generation, password: PASSWORD };
    },
  };
}

// 規則が正しいときの答え（'ok' か 'denied'）
function correctAnswer(method, path, repo, value) {
  const inId = repo.state.members[0] && repo.state.members[0].classId;
  if (method === 'getPublic') return path === 'gen/s00-999' ? 'ok' : 'denied';
  if (method === 'get') {
    const okPaths = [`accounts/${STUDENT_UID}`, `classes/${inId}`, `members/${inId}/s00-999`, 'memberOf/s00-999'];
    const lesson = repo.state.lessons.find((l) => l.classId === inId);
    if (lesson) okPaths.push(`lessons/${inId}`, `thumbs/${inId}/${lesson.id}`, 'units',
      `records/${inId}/${lesson.id}/s00-999`, `marks/s00-999/${inId}`, `recThumbs/${inId}/${lesson.id}/s00-999`);
    return okPaths.includes(path) ? 'ok' : 'denied';
  }
  if (method === 'remove') return path === 'initialPw/s00-999' ? 'ok' : 'denied';
  if (method === 'update' && path === '') {
    if (Object.values(value).every((v) => v === null)) return 'ok';
    const lesson = repo.state.lessons.find((l) => l.classId === inId);
    const record = value[`records/${inId}/${lesson?.id}/s00-999`];
    if (record && record.memo.length <= 2000 && (!('level' in record) || record.level === 3)
      && !('extra' in record)) return 'ok';
  }
  if (method === 'set') {
    const lesson = repo.state.lessons.find((l) => l.classId === inId);
    if (path === `records/${inId}/${lesson?.id}/s00-999/attachments/a1`
      && value.type === 'image' && value.fileId === 'probe') return 'ok';
    if (path === `recThumbs/${inId}/${lesson?.id}/s00-999/a1`) return 'ok';
  }
  return 'denied';
}

// 確認用の生徒の net の代役。answer(method, path, value) が 'ok'・'denied'・Error を返す
function fakeStudentNet(answer) {
  const calls = [];
  const run = async (method, path, value) => {
    calls.push(value === undefined ? [method, path] : [method, path, value]);
    const a = answer(method, path, value);
    if (a instanceof Error) throw a;
    if (a === 'denied') throw new NetError('denied', '権限がありません');
    return method.startsWith('get') ? { any: 1 } : undefined;
  };
  return {
    calls,
    token: TOKEN,
    get: (p) => run('get', p),
    getPublic: (p) => run('getPublic', p),
    set: (p, v) => run('set', p, v),
    update: (p, v) => run('update', p, v),
    remove: (p) => run('remove', p),
  };
}

// 一式を組み立てる。override(method, path, repo, value) が undefined でなければ、正しい答えの代わりに使う
function setup({
  generation = null, students = [], classes = [], override = () => undefined, makeStudentFails = false,
  updateFails = false, failUpdate = null, listStudentsFails = () => false, throwAfterLink = false, returnUid = false,
  teacherData = {}, units = [], lessons = [], failPrepare = () => false, overrideTeacher = () => undefined,
} = {}) {
  const teacherRepo = fakeTeacherRepo({ generation, students, classes, units, lessons, listStudentsFails, failPrepare });
  // updateFails: 片付けの書きこみ（null を含むもの）をすべて失敗させる
  const teacherNet = fakeTeacherNet({
    failUpdate: failUpdate || ((patch) => updateFails && Object.values(patch).includes(null)),
    data: { ...Object.fromEntries(classes.map((c) => [`lessons/${c.id}`,
      Object.fromEntries(lessons.filter((l) => l.classId === c.id).map((l) => [l.id, true]))])), ...teacherData },
    answer: (m, p, v) => overrideTeacher(m, p, teacherRepo, v),
  });
  const issuer = fakeIssuer(teacherRepo, { throwAfterLink, returnUid });
  let studentNet = null;
  const signIns = [];
  const makeStudent = async (email, password) => {
    signIns.push({ email, password });
    if (makeStudentFails) throw new NetError('bad-credentials', 'ID かパスワードが違います');
    studentNet = fakeStudentNet((m, p, v) => {
      const o = override(m, p, teacherRepo, v);
      return o === undefined ? correctAnswer(m, p, teacherRepo, v) : o;
    });
    return { net: studentNet, uid: STUDENT_UID };
  };
  const args = { teacherRepo, teacherNet, issuer, makeStudent, random: seqRandom(), now: () => 1000, teacherUid: TEACHER_UID };
  return { args, teacherRepo, teacherNet, issuer, signIns, studentNet: () => studentNet };
}

// 片付けの書きこみ（null を含むルートの update）を 1 つにまとめる。送られた（失敗も含む）ものすべて
function cleanupPatch(teacherNet) {
  const cs = teacherNet.calls.filter(([m, p, patch]) => m === 'update' && p === '' && Object.values(patch).includes(null));
  return cs.length === 0 ? null : Object.assign({}, ...cs.map((c) => c[2]));
}

function assertLessonCleanup(s) {
  const patch = cleanupPatch(s.teacherNet);
  for (const l of s.teacherRepo.state.lessons) {
    assert.equal(patch[`lessons/${l.classId}/${l.id}`], null);
    assert.ok(!(`lessons/${l.classId}` in patch), '授業 1 件ずつ消す');
  }
  for (const c of s.teacherRepo.state.classes) assert.equal(patch[`thumbs/${c.id}`], null);
  for (const u of s.teacherRepo.state.units) assert.equal(patch[`units/${u.id}`], null);
}

// 1a-2 で増える 10 行の場所と期待。既存の読み取り 13 行のあと、権限の根拠を書きかえる前に試す。
function lessonChecks(repo) {
  const inId = repo.state.members[0].classId;
  const inside = repo.state.lessons.find((l) => l.classId === inId);
  const outside = repo.state.lessons.find((l) => l.classId !== inId);
  assert.ok(inside, '入っているクラスの授業が準備されていない');
  assert.ok(outside, '入っていないクラスの授業が準備されていない');
  const material = repo.state.materials.find((m) => m.classId === inId);
  assert.ok(material, '確認用の資料が準備されていない');
  const unit = repo.state.units[0];
  assert.ok(unit, '確認用の単元が準備されていない');
  return [
    ['get', `lessons/${inId}`, 'ok'],
    ['get', `lessons/${outside.classId}`, 'denied'],
    ['get', 'lessons', 'denied'],
    ['get', `thumbs/${inId}/${inside.id}`, 'ok'],
    ['get', `thumbs/${outside.classId}/${outside.id}`, 'denied'],
    ['get', 'units', 'ok'],
    ['set', `lessons/${inId}/${inside.id}/title`, 'denied'],
    ['set', `lessons/${inId}/${inside.id}/materials/${material.materialId}/fileId`, 'denied'],
    ['set', `thumbs/${inId}/${inside.id}/${material.materialId}`, 'denied'],
    ['set', `units/${unit.id}/name`, 'denied'],
  ];
}

// 1a-3 の 15 行。拒否を確かめる書きこみは、ほかの規則に隠されないよう 1 か所ずつ試す。
function recordChecks(repo) {
  const inId = repo.state.members[0].classId;
  const inside = repo.state.lessons.find((l) => l.classId === inId);
  const outside = repo.state.lessons.find((l) => l.classId !== inId);
  const own = `records/${inId}/${inside.id}/s00-999`;
  return [
    ['update', '', 'ok', (v) => v[own]?.memo.length === 2000 && !('level' in v[own])],
    ['get', own, 'ok'],
    ['update', '', 'ok', (v) => v[own]?.level === 3],
    ['get', `marks/s00-999/${inId}`, 'ok'],
    ['get', `records/${inId}`, 'denied'],
    ['get', `records/${inId}/${inside.id}`, 'denied'],
    ['get', `records/${inId}/${inside.id}/s00-998`, 'denied'],
    ['set', `records/${inId}/${inside.id}/s00-998`, 'denied'],
    ['set', `records/${outside.classId}/${outside.id}/s00-999`, 'denied'],
    ['set', null, 'denied', (_, p) => p.startsWith(`records/${inId}/`) && p.endsWith('/s00-999') && p !== own],
    ['set', own, 'denied', (v) => v.memo.length === 2001],
    ['set', own, 'denied', (v) => v.level === 5],
    ['set', own, 'denied', (v) => 'extra' in v],
    ['set', `marks/s00-998/${inId}/${inside.id}`, 'denied'],
    ['set', own, 'denied'], // 先生としての書きこみ
  ];
}

function matchesRecordCheck(check, method, path, value) {
  const [m, p, , accepts = () => true] = check;
  return m === method && (p === null || p === path) && accepts(value, path);
}

// 1b-1 の 11 行。生徒の書きかえで権限が変わる前に確かめる。
function attachmentChecks(repo) {
  const cid = repo.state.members[0].classId;
  const lid = repo.state.lessons.find((l) => l.classId === cid).id;
  const own = `records/${cid}/${lid}/s00-999/attachments`;
  const thumbs = `recThumbs/${cid}/${lid}`;
  return [
    ['set', `${own}/a1`, 'ok', (v) => v.fileId === 'probe' && v.bytes === 42],
    ['set', `${own}/a7`, 'denied'],
    ['set', `${own}/a2`, 'denied', (v) => v.type === 'video'],
    ['set', `${thumbs}/s00-999/a1`, 'ok'],
    ['get', `${thumbs}/s00-999`, 'ok'],
    ['get', `${thumbs}/s00-998`, 'denied'],
    ['set', `${thumbs}/s00-998/a1`, 'denied'],
    ['get', `${thumbs}/s00-999`, 'ok'], // 先生として読む
    ['set', `${own}/a1`, 'ok', (v) => v.fileId === 'probe' && v.bytes === 43],
    ['set', `${own}/a1`, 'denied', (v) => v.fileId === 'probe-changed'],
    ['set', `${thumbs}/s00-999`, 'denied', (v) => typeof v === 'string'],
  ];
}

const LABEL_COUNT = 57;

test('runRulesProbe: 添付の 11 行は指定の権限・場所・値で試し、逆の答えや通信失敗を合格にしない', async (t) => {
  for (let i = 0; i < 11; i++) {
    for (const failure of [null, '逆の答え', '通信失敗']) {
      await t.test(`添付の行 ${i + 1}: ${failure || '正しい答え'}`, async () => {
        let called = 0;
        const override = (m, p, repo, v) => {
          if (!repo.state.members.length) return undefined;
          const check = attachmentChecks(repo)[i];
          if (!matchesRecordCheck(check, m, p, v)) return undefined;
          called += 1;
          if (m === 'set' && p.includes('/attachments/')) {
            assert.deepEqual(Object.keys(v).sort(), ['addedAt', 'bytes', 'fileId', 'type']);
            assert.equal(v.fileId, i === 9 ? 'probe-changed' : 'probe');
            assert.equal(v.addedAt, 1000);
            assert.ok(v.bytes >= 0);
          }
          if (m === 'set' && p.startsWith('recThumbs/')) assert.match(v, /^data:image\//);
          return failure === '通信失敗' ? new NetError('network', 'つながりません')
            : failure === '逆の答え' ? (check[2] === 'ok' ? 'denied' : 'ok') : undefined;
        };
        const s = setup(i === 7 ? { overrideTeacher: override } : { override });
        const rows = await runRulesProbe(s.args);
        assert.equal(rows.length, LABEL_COUNT);
        assert.equal(called, 1);
        const row = rows[38 + i];
        assert.equal(row.expect, attachmentChecks(s.teacherRepo)[i][2]);
        assert.equal(row.got, failure === '通信失敗' ? 'error'
          : failure === '逆の答え' ? (row.expect === 'ok' ? 'denied' : 'ok') : row.expect);
        assert.equal(row.pass, failure === null);
        assert.equal(rows.filter((r) => !r.pass).length, failure ? 1 : 0);
        assertLessonCleanup(s);
      });
    }
  }
});

test('runRulesProbe: 添付の応答が失われても、生徒として小さい画像を消してから授業を消す', async () => {
  const s = recordCleanupSetup({ loseRecordReply: true });
  const rows = await runRulesProbe(s.args);
  assert.equal(rows[38].got, 'error');
  assert.equal(rows[41].got, 'error');
  for (const path of ['records', 'recThumbs']) assert.equal(await s.mem.get(path), null);
  const removeThumbs = s.events.findIndex(([who, m, , v]) => who === '生徒' && m === 'update'
    && Object.keys(v).some((p) => p.startsWith('recThumbs/')) && Object.values(v).every((x) => x === null));
  const removeLessons = s.events.findIndex(([who, m, , v]) => who === '先生' && m === 'update'
    && Object.entries(v).some(([p, x]) => p.startsWith('lessons/') && x === null));
  assert.ok(removeThumbs >= 0 && removeThumbs < removeLessons);
  assert.ok(!s.events.some(([who, m, , v]) => who === '先生' && m === 'update'
    && Object.keys(v).some((p) => p.startsWith('recThumbs/'))));
});

test('runRulesProbe: 小さい画像を片付けられないときは、片付けの失敗を出す', async () => {
  const s = recordCleanupSetup({ failCleanup: (patch) => Object.keys(patch).some((p) => p.startsWith('recThumbs/')) });
  const rows = await runRulesProbe(s.args);
  assert.equal(rows.length, LABEL_COUNT + 1);
  assert.deepEqual(rows.at(-1), { label: '片付け', expect: 'ok', got: 'error', pass: false });
  assert.notEqual(await s.mem.get('recThumbs'), null);
  assert.equal(await s.mem.get('accounts'), null);
});

test('runRulesProbe: 規則が正しければ、全部の行が pass: true（57 行）', async () => {
  const s = setup();
  const rows = await runRulesProbe(s.args);
  assert.equal(rows.length, LABEL_COUNT);
  for (const r of rows) {
    assert.equal(r.pass, true, r.label);
    assert.equal(r.got, r.expect, r.label);
    assert.ok(r.expect === 'ok' || r.expect === 'denied');
  }
  // 期待の並び（表の順）
  assert.deepEqual(rows.map((r) => r.expect), [
    'ok', 'denied', 'ok', 'denied', 'denied', 'denied', 'denied', 'ok', 'denied', 'denied',
    'ok', 'denied', 'ok',
    'ok', 'denied', 'denied', 'ok', 'denied', 'ok', 'denied', 'denied', 'denied', 'denied',
    'ok', 'ok', 'ok', 'ok', 'denied', 'denied', 'denied', 'denied', 'denied', 'denied',
    'denied', 'denied', 'denied', 'denied', 'denied',
    'ok', 'denied', 'denied', 'ok', 'ok', 'denied', 'denied', 'ok',
    'ok', 'denied', 'denied',
    'denied', 'denied', 'denied', 'denied', 'denied', 'ok',
    'ok', 'ok',
  ]);
});

test('runRulesProbe: 先生が記録一覧と印を読む 2 行は、拒否や通信失敗を合格にしない', async (t) => {
  for (let i = 0; i < 2; i++) {
    for (const got of ['ok', 'denied', 'error']) {
      await t.test(`先生の読み取り ${i + 1}: ${got}`, async () => {
        const s = setup({ overrideTeacher: (m, p, repo) => {
          const inside = repo.state.lessons[0];
          const path = i === 0 ? `records/${inside?.classId}/${inside?.id}` : 'marks/s00-999';
          if (m !== 'get' || p !== path) return undefined;
          return got === 'error' ? new NetError('network', 'つながりません') : got;
        } });
        const rows = await runRulesProbe(s.args);
        assert.equal(rows.length, LABEL_COUNT);
        const row = rows[55 + i];
        assert.equal(row.expect, 'ok');
        assert.equal(row.got, got);
        assert.equal(row.pass, got === 'ok');
        assert.equal(rows.filter((r) => !r.pass).length, got === 'ok' ? 0 : 1);
        assertLessonCleanup(s);
      });
    }
  }
});

test('runRulesProbe: 記録の追加 15 行は、期待と逆の答えや通信失敗を合格にしない', async (t) => {
  for (let i = 0; i < 15; i++) {
    for (const failure of ['逆の答え', '通信失敗']) {
      await t.test(`記録の行 ${i + 1}: ${failure}`, async () => {
        const override = (m, p, repo, v) => {
          if (repo.state.members.length === 0) return undefined;
          const check = recordChecks(repo)[i];
          if (!matchesRecordCheck(check, m, p, v)) return undefined;
          return failure === '通信失敗' ? new NetError('network', 'つながりません')
            : check[2] === 'ok' ? 'denied' : 'ok';
        };
        const s = setup(i === 14 ? { overrideTeacher: override } : { override });
        const rows = await runRulesProbe(s.args);
        assert.equal(rows.length, LABEL_COUNT);
        const row = rows[23 + i];
        assert.equal(row.expect, recordChecks(s.teacherRepo)[i][2]);
        assert.equal(row.got, failure === '通信失敗' ? 'error' : row.expect === 'ok' ? 'denied' : 'ok');
        assert.equal(row.pass, false);
        assert.equal(rows.filter((r) => !r.pass).length, 1);
        assertLessonCleanup(s);
      });
    }
  }
});

test('runRulesProbe: メモは 2000 文字・level なし、理解度は records と marks を同じ update で書く', async () => {
  const s = setup();
  await runRulesProbe(s.args);
  const cid = s.teacherRepo.state.members[0].classId;
  const lid = s.teacherRepo.state.lessons.find((l) => l.classId === cid).id;
  const own = `records/${cid}/${lid}/s00-999`;
  const mark = `marks/s00-999/${cid}/${lid}`;
  const writes = s.studentNet().calls.filter(([m, p, v]) => m === 'update' && p === '' && v[own]);
  assert.equal(writes.length, 2);
  const memo = writes[0][2];
  assert.deepEqual(Object.keys(memo).sort(), [own, mark].sort());
  assert.deepEqual(Object.keys(memo[own]).sort(), ['learned', 'memo', 'question', 'updatedAt']);
  assert.equal(memo[own].memo.length, 2000);
  assert.equal(memo[own].updatedAt, 1000);
  assert.equal(memo[mark], null);
  assert.equal(writes[1][2][own].level, 3);
  assert.equal(writes[1][2][mark], 3);
  assert.deepEqual(Object.keys(writes[1][2]).sort(), [own, mark].sort());
  const cleanups = s.studentNet().calls.filter(([m, , v]) => m === 'update' && Object.values(v).every((x) => x === null));
  assert.deepEqual(cleanups, [
    ['update', '', { [own]: null, [mark]: null }],
    ['update', '', { [`${own}/attachments/a1`]: null }],
    ['update', '', { [`recThumbs/${cid}/${lid}/s00-999`]: null }],
  ], '同じ組は 1 回だけ消し、拒否された場所は足さない');
  for (const [m, p, , accepts = () => true] of recordChecks(s.teacherRepo).slice(7, 14)) {
    assert.ok(s.studentNet().calls.some(([cm, cp, v]) => cm === m && (p === null || cp === p) && accepts(v, cp)));
  }
  const missing = s.studentNet().calls.find(([m, p, v]) => matchesRecordCheck(recordChecks(s.teacherRepo)[9], m, p, v));
  assert.ok(!s.teacherRepo.state.lessons.some((l) => l.classId === cid && l.id === missing[1].split('/')[2]));
});

// 実際にデータを残す代役。先生は記録を消せず、記録のある授業も消せない。
function recordCleanupSetup({ initial = {}, failStudentCleanup = false, failTeacherCleanup = false,
  allowForbidden = false, loseRecordReply = false, allowRecords = false, allowMarks = false,
  failCleanup = () => false } = {}) {
  const mem = createMemoryNet({ now: () => 1000, initial });
  const events = [];
  const denied = () => { throw new NetError('denied', '権限がありません'); };
  const teacherNet = { ...mem,
    async get(path, options) { events.push(['先生', 'get', path, options]); return mem.get(path, options); },
    async set(path, value) {
      events.push(['先生', 'set', path, value]);
      if (path.startsWith('records/')) denied();
      return mem.set(path, value);
    },
    async update(path, patch) {
      events.push(['先生', 'update', path, patch]);
      for (const [p, v] of Object.entries(patch)) {
        if (p.startsWith('records/')) denied();
        if (p.startsWith('lessons/') && v === null
          && (failTeacherCleanup || await mem.get(p.replace('lessons/', 'records/')))) denied();
      }
      return mem.update(path, patch);
    },
  };
  const teacherRepo = createRepo(teacherNet);
  async function canWrite(path, value) {
    const parts = path.split('/');
    const [kind] = parts;
    if ((kind === 'records' && allowRecords) || (kind === 'marks' && allowMarks)) return true;
    const sid = kind !== 'marks' ? parts[3] : parts[1];
    const cid = kind !== 'marks' ? parts[1] : parts[2];
    const lid = kind !== 'marks' ? parts[2] : parts[3];
    if (!['records', 'marks', 'recThumbs'].includes(kind) || sid !== await mem.get(`accounts/${STUDENT_UID}`)
      || await mem.get(`memberOf/${sid}/${cid}`) !== true) return false;
    if (kind === 'records' && !await mem.get(`lessons/${cid}/${lid}`)) return false;
    if (value === null) return true;
    if (kind === 'marks') return Number.isInteger(value) && value >= 1 && value <= 4;
    if (kind === 'recThumbs') return parts[4] === 'a1' && typeof value === 'string';
    if (parts[4] === 'attachments') {
      const existing = await mem.get(path);
      return /^a[1-6]$/.test(parts[5]) && ['image', 'pdf'].includes(value.type)
        && (!existing || existing.fileId === value.fileId);
    }
    return typeof value.memo === 'string' && value.memo.length <= 2000
      && (!('level' in value) || Number.isInteger(value.level) && value.level >= 1 && value.level <= 4)
      && Object.keys(value).every((k) => ['memo', 'learned', 'question', 'level', 'updatedAt'].includes(k));
  }
  const studentNet = { ...mem,
    async get(path) {
      const parts = path.split('/');
      if (parts[0] === 'records' && (parts.length !== 4 || parts[3] !== 's00-999')) denied();
      if (parts[0] === 'recThumbs' && parts[3] !== 's00-999') denied();
      return mem.get(path);
    },
    async set(path, value) {
      events.push(['生徒', 'set', path, value]);
      if (!(allowForbidden && /^(records|marks)\//.test(path)) && !await canWrite(path, value)) denied();
      await mem.set(path, value);
      if (loseRecordReply && value !== null) throw new NetError('network', 'つながりません');
    },
    async update(path, patch) {
      events.push(['生徒', 'update', path, patch]);
      if (Object.values(patch).every((v) => v === null) && (failStudentCleanup || failCleanup(patch))) denied();
      for (const [p, v] of Object.entries(patch)) if (!await canWrite(p, v)) denied();
      await mem.update(path, patch);
      if (loseRecordReply && Object.values(patch).some((v) => v !== null)) throw new NetError('network', 'つながりません');
    },
  };
  const args = {
    teacherRepo, teacherNet, random: seqRandom(), now: () => 1000, teacherUid: TEACHER_UID,
    issuer: { async issueOne(sid, { generation }) {
      events.push(['発行']);
      await teacherRepo.linkAccount(sid, { uid: STUDENT_UID, generation, password: PASSWORD });
      return { generation, password: PASSWORD, uid: STUDENT_UID };
    } },
    makeStudent: async () => { events.push(['ログイン']); return { uid: STUDENT_UID, net: studentNet }; },
  };
  return { args, mem, events };
}

test('runRulesProbe: 生徒の記録と印を先に消し、そのあと先生が授業を消す。続けて 2 回でも残らない', async () => {
  const s = recordCleanupSetup();
  const first = await runRulesProbe(s.args);
  const second = await runRulesProbe(s.args);
  assert.equal(first.length, LABEL_COUNT);
  assert.deepEqual(second, first);
  assert.ok(first.slice(23, 38).every((r) => r.pass));
  assert.ok(first.slice(38, 49).every((r) => r.pass));
  for (const path of ['records', 'marks', 'recThumbs', 'lessons', 'classes', 'accounts']) assert.equal(await s.mem.get(path), null, path);
  const removeRecords = s.events.findIndex(([who, m, , v]) => who === '生徒' && m === 'update'
    && Object.keys(v).some((p) => p.startsWith('records/')) && Object.values(v).every((x) => x === null));
  const removeLessons = s.events.findIndex(([who, m, , v]) => who === '先生' && m === 'update'
    && Object.entries(v).some(([p, x]) => p.startsWith('lessons/') && x === null));
  assert.ok(removeRecords >= 0 && removeRecords < removeLessons);
  assert.ok(Object.keys(s.events[removeRecords][3]).some((p) => p.startsWith('marks/')));
});

test('runRulesProbe: 先生の記録一覧と印の読み取りは、生徒が書いたあと・消す前に 1 回ずつ行う', async () => {
  const s = recordCleanupSetup();
  const rows = await runRulesProbe(s.args);
  assert.ok(rows.slice(55, 57).every((r) => r.pass));
  const write = s.events.findIndex(([who, m, , v]) => who === '生徒' && m === 'update'
    && Object.entries(v).some(([p, x]) => p.startsWith('records/') && x?.level === 3));
  const own = Object.keys(s.events[write][3]).find((p) => p.startsWith('records/'));
  const readPaths = [own.split('/').slice(0, 3).join('/'), 'marks/s00-999'];
  const cleanup = s.events.findIndex(([who, m, , v]) => who === '生徒' && m === 'update'
    && Object.values(v).every((x) => x === null));
  for (const path of readPaths) {
    const reads = s.events.map(([who, m, p], i) => who === '先生' && m === 'get' && p === path ? i : -1).filter((i) => i >= 0);
    assert.equal(reads.length, 1);
    assert.ok(write < reads[0] && reads[0] < cleanup);
  }
});

function oldRecordData(member = true) {
  return {
    classes: { oldClass: { year: 0, name: '確認用' } },
    lessons: { oldClass: { oldLesson: { title: '確認用' }, oldLesson2: { title: '確認用' } } },
    records: { oldClass: { oldLesson: { 's00-999': { memo: '前回の残り', updatedAt: 1 } } } },
    marks: { 's00-999': { oldClass: { oldLesson: 3, goneLesson: 2 } } },
    recThumbs: { oldClass: { oldLesson: { 's00-999': { a1: '確認用の画像' } } } },
    memberOf: member ? { 's00-999': { oldClass: true } } : null,
  };
}

test('runRulesProbe: 前回の記録はログイン後に生徒として消し、授業は先生の shallow 読みで探す', async () => {
  const s = recordCleanupSetup({ initial: oldRecordData() });
  const rows = await runRulesProbe(s.args);
  assert.equal(rows.length, LABEL_COUNT);
  assert.equal(await s.mem.get('records'), null);
  assert.equal(await s.mem.get('marks'), null);
  assert.equal(await s.mem.get('recThumbs'), null);
  const read = s.events.findIndex(([who, m, p]) => who === '先生' && m === 'get' && p === 'lessons/oldClass');
  assert.deepEqual(s.events[read][3], { shallow: true });
  const remove = s.events.findIndex(([who, m, , v]) => who === '生徒' && m === 'update'
    && v['records/oldClass/oldLesson/s00-999'] === null);
  assert.ok(read < remove && s.events.findIndex(([who]) => who === 'ログイン') < remove);
  assert.deepEqual(s.events[remove][3], {
    'records/oldClass/oldLesson/s00-999': null,
    'records/oldClass/oldLesson2/s00-999': null,
    'recThumbs/oldClass/oldLesson/s00-999': null,
    'recThumbs/oldClass/oldLesson2/s00-999': null,
    'marks/s00-999/oldClass': null,
  });
  const teacherRemove = s.events.findIndex(([who, m, , v]) => who === '先生' && m === 'update' && v['lessons/oldClass/oldLesson'] === null);
  const create = s.events.findIndex(([who, m, p]) => who === '先生' && m === 'set' && p.startsWith('classes/'));
  assert.ok(remove < teacherRemove && teacherRemove < create);
});

test('runRulesProbe: 前回の授業の一覧が空やオブジェクト以外でも続ける', async (t) => {
  for (const value of [null, {}, [], '不正な一覧', 7, false]) {
    await t.test(JSON.stringify(value), async () => {
      const s = setup({ classes: [{ id: 'oldClass', year: 0 }],
        teacherData: { 'lessons/oldClass': value, 'memberOf/s00-999': { oldClass: true } } });
      const rows = await runRulesProbe(s.args);
      assert.equal(rows.length, LABEL_COUNT);
      assert.ok(rows.every((r) => r.pass));
      assert.ok(!s.studentNet().calls.some(([m, , v]) => m === 'update'
        && Object.keys(v).some((p) => p.startsWith('records/oldClass/'))));
    });
  }
});

test('runRulesProbe: 生徒の削除失敗・所属のない前回の記録・先生の削除失敗を結果に出す', async (t) => {
  for (const options of [
    { failStudentCleanup: true }, { failTeacherCleanup: true },
    { initial: oldRecordData(), failStudentCleanup: true }, { initial: oldRecordData(false) },
  ]) {
    await t.test(JSON.stringify(options), async () => {
      const s = recordCleanupSetup(options);
      const rows = await runRulesProbe(s.args);
      assert.deepEqual(rows.at(-1), { label: '片付け', expect: 'ok', got: 'error', pass: false });
      if (options.initial) {
        assert.ok(rows.some((r) => r.label === '準備' && !r.pass));
        assert.equal(Object.keys(await s.mem.get('classes')).length, 1, '失敗後に今回のクラスを作らない');
      }
      assert.equal(await s.mem.get('accounts'), null, 'アカウントの片付けも続ける');
    });
  }
});

test('runRulesProbe: 禁止の書きこみが通った場所も生徒として消し、消せない場合は失敗を出す', async () => {
  const s = recordCleanupSetup({ allowForbidden: true });
  const rows = await runRulesProbe(s.args);
  for (const r of rows.slice(30, 37)) assert.equal(r.pass, false);
  assert.equal(rows.at(-1).label, '片付け');
  const writes = s.events.filter(([who, m, p]) => who === '生徒' && m === 'set' && /^(records|marks)\//.test(p));
  for (const [, , path] of writes) {
    assert.ok(s.events.some(([who, m, , v]) => who === '生徒' && m === 'update' && v[path] === null), path);
  }
  const own = s.events.find(([who, m, , v]) => who === '生徒' && m === 'update'
    && Object.values(v).some((x) => x && x.level === 3))[3];
  const ownPath = Object.keys(own).find((p) => p.startsWith('records/'));
  assert.equal(await s.mem.get(ownPath), null, 'ほかの場所の削除に失敗しても、自分の記録は消す');
});

test('runRulesProbe: 記録を送った応答が失われても、記録と印を片付ける', async () => {
  const s = recordCleanupSetup({ loseRecordReply: true });
  const rows = await runRulesProbe(s.args);
  assert.equal(rows[23].got, 'error');
  assert.equal(rows[25].got, 'error');
  assert.equal(rows.length, LABEL_COUNT);
  assert.equal(await s.mem.get('records'), null);
  assert.equal(await s.mem.get('marks'), null);
});

test('runRulesProbe: records または marks だけがゆるくても、書こうとした場所だけを消し、先生が授業を消せる', async (t) => {
  for (const kind of ['records', 'marks']) {
    for (const loseRecordReply of [false, true]) {
      await t.test(`${kind} だけ許可・応答の喪失 ${loseRecordReply}`, async () => {
        const s = recordCleanupSetup({ allowRecords: kind === 'records', allowMarks: kind === 'marks', loseRecordReply });
        const rows = await runRulesProbe(s.args);
        assert.equal(rows.length, LABEL_COUNT);
        assert.deepEqual(rows.find((r) => r.label === `ほかの生徒（s00-998）の ${kind} を書く`), {
          label: `ほかの生徒（s00-998）の ${kind} を書く`, expect: 'denied',
          got: loseRecordReply ? 'error' : 'ok', pass: false,
        });
        const write = s.events.find(([who, m, p]) => who === '生徒' && m === 'set'
          && p.startsWith(`${kind}/`) && p.split('/').includes('s00-998'));
        assert.ok(write);
        const path = write[2];
        const cleanups = s.events.filter(([who, m, , v]) => who === '生徒' && m === 'update' && v[path] === null);
        assert.deepEqual(cleanups.map((e) => e[3]), [{ [path]: null }]);
        assert.equal(await s.mem.get(path), null);
        for (const p of ['records', 'marks', 'lessons', 'classes', 'accounts']) assert.equal(await s.mem.get(p), null, p);
        assert.ok(!rows.some((r) => r.label === '片付け'));
      });
    }
  }
});

test('runRulesProbe: ほかの生徒の records と marks は別々に片付け、一方が拒否されても他方を消す', async (t) => {
  for (const failedKind of ['records', 'marks']) {
    await t.test(`${failedKind} の削除を拒否`, async () => {
      const s = recordCleanupSetup({ allowRecords: true, allowMarks: true,
        failCleanup: (patch) => Object.keys(patch).some((p) => p.startsWith(`${failedKind}/`) && p.split('/').includes('s00-998')),
      });
      const rows = await runRulesProbe(s.args);
      assert.equal(rows.length, LABEL_COUNT + 1);
      assert.deepEqual(rows.at(-1), { label: '片付け', expect: 'ok', got: 'error', pass: false });
      const writes = s.events.filter(([who, m, p]) => who === '生徒' && m === 'set' && /^(records|marks)\//.test(p));
      for (const [, , path] of writes) {
        const failed = path.startsWith(`${failedKind}/`) && path.split('/').includes('s00-998');
        if (failed) assert.notEqual(await s.mem.get(path), null, path);
        else assert.equal(await s.mem.get(path), null, path);
      }
      for (const kind of ['records', 'marks']) {
        const row = rows.find((r) => r.label === `ほかの生徒（s00-998）の ${kind} を書く`);
        assert.equal(row.got, 'ok');
        assert.equal(row.pass, false);
      }
      assert.equal(await s.mem.get('accounts'), null, '先生の片付けも続ける');
    });
  }
});

test('runRulesProbe: 記録・印・添付の書きこみがすべて拒否されたら、生徒の片付けは通信しない', async () => {
  const s = setup({ override: (m, p) => m === 'update' || m === 'set' && /^(records|recThumbs)\//.test(p) ? 'denied' : undefined });
  const rows = await runRulesProbe(s.args);
  assert.equal(rows.length, LABEL_COUNT);
  assert.equal(rows[23].got, 'denied');
  assert.equal(rows[25].got, 'denied');
  assert.ok(!s.studentNet().calls.some(([m, , v]) => m === 'update' && Object.values(v).every((x) => x === null)));
  assert.ok(!rows.some((r) => r.label === '片付け'));
});

test('runRulesProbe: 準備（students・発行・クラス 2 つ・名簿）と、確認用の生徒のログイン', async () => {
  const s = setup();
  await runRulesProbe(s.args);
  // 台帳に無かったので、students/s00-999 を置く
  assert.ok(s.teacherNet.calls.some(([m, p, v]) =>
    (m === 'set' && p === 'students/s00-999/createdAt' && v === 1000)
    || (m === 'update' && p === '' && v && v['students/s00-999/createdAt'] === 1000)));
  // gen が無いので 1 回目、古い uid は null
  assert.deepEqual(s.issuer.calls, [{ studentId: 's00-999', generation: 1, oldUid: null }]);
  // 確認用のクラスを 2 つ（名前「（規則の確認用）」、年度 0）。ID はちがう
  assert.equal(s.teacherRepo.state.classes.length, 2);
  for (const c of s.teacherRepo.state.classes) {
    assert.equal(c.name, '（規則の確認用）');
    assert.equal(c.year, 0);
    assert.match(c.id, /^[A-Za-z0-9]{12}$/);
  }
  const [a, b] = s.teacherRepo.state.classes;
  assert.notEqual(a.id, b.id);
  // 片方だけに s00-999 を出席番号 1 で入れる
  assert.equal(s.teacherRepo.state.members.length, 1);
  assert.deepEqual(s.teacherRepo.state.members[0].set, { 's00-999': 1 });
  assert.ok([a.id, b.id].includes(s.teacherRepo.state.members[0].classId));
  // 発行のパスワードで、回数に合ったメールアドレスでログインする
  assert.deepEqual(s.signIns, [{ email: 's00-999.g1@jugyolog.invalid', password: PASSWORD }]);
});

test('runRulesProbe: 前の回数と古い uid があれば、回数を 1 つ進め、古い uid を渡す', async () => {
  const s = setup({ generation: 3, students: [{ id: 's00-999', uid: 'old-uid', createdAt: 5 }] });
  await runRulesProbe(s.args);
  assert.deepEqual(s.issuer.calls, [{ studentId: 's00-999', generation: 4, oldUid: 'old-uid' }]);
  assert.equal(s.signIns[0].email, 's00-999.g4@jugyolog.invalid');
  // 台帳にもうあるので、students/s00-999 を置き直さない
  assert.ok(!s.teacherNet.calls.some(([, p, v]) => p === 'students/s00-999/createdAt'
    || (v && typeof v === 'object' && 'students/s00-999/createdAt' in v)));
});

test('runRulesProbe: クラスごとに授業と資料を 1 つ、年度 0 の単元を 1 つ準備する', async () => {
  const s = setup();
  await runRulesProbe(s.args);
  const { units, lessons, materials, classes } = s.teacherRepo.state;
  assert.equal(units.length, 1);
  assert.equal(units[0].year, 0);
  assert.equal(units[0].order, 0);
  assert.ok(units[0].name.length > 0);
  assert.match(units[0].id, /^[A-Za-z0-9]{12}$/);
  assert.equal(lessons.length, 2);
  assert.equal(materials.length, 2);
  for (const c of classes) {
    const l = lessons.find((x) => x.classId === c.id);
    assert.ok(l);
    assert.match(l.id, /^[A-Za-z0-9]{12}$/);
    assert.match(l.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(l.title.length > 0);
    assert.equal(l.unitId, units[0].id);
    assert.equal(l.createdAt, 1000);
    const m = materials.find((x) => x.classId === c.id && x.lessonId === l.id);
    assert.ok(m);
    assert.match(m.materialId, /^[A-Za-z0-9]{12}$/);
    assert.equal(m.material.fileId, 'probe');
    assert.equal(m.material.type, 'image');
    assert.ok(['board', 'handout'].includes(m.material.kind));
    assert.ok(m.material.name.length > 0);
    assert.ok(m.material.bytes > 0);
    assert.equal(m.order, 0);
    assert.equal(m.now, 1000);
    assert.match(m.thumb, /^data:image\/[^;]+;base64,[A-Za-z0-9+/]+=*$/);
    assert.ok(m.thumb.length < 200);
  }
});

test('runRulesProbe: 追加した 10 行は、期待と逆の答えならその行だけ pass: false', async (t) => {
  for (let i = 0; i < 10; i++) {
    await t.test(`追加した行 ${i + 1}`, async () => {
      const s = setup({ override: (m, p, repo) => {
        const [method, path, expect] = lessonChecks(repo)[i];
        return m === method && p === path ? (expect === 'ok' ? 'denied' : 'ok') : undefined;
      } });
      const rows = await runRulesProbe(s.args);
      const expect = lessonChecks(s.teacherRepo)[i][2];
      assert.equal(rows.length, LABEL_COUNT);
      assert.equal(rows[13 + i].expect, expect);
      assert.equal(rows[13 + i].got, expect === 'ok' ? 'denied' : 'ok');
      assert.equal(rows[13 + i].pass, false);
      assert.equal(rows.filter((r) => !r.pass).length, 1);
      assertLessonCleanup(s);
    });
  }
});

test('runRulesProbe: 追加した 10 行の通信失敗を denied と数えず、残りの確認と片付けを続ける', async (t) => {
  for (let i = 0; i < 10; i++) {
    await t.test(`追加した行 ${i + 1}`, async () => {
      const s = setup({ override: (m, p, repo) => {
        const [method, path] = lessonChecks(repo)[i];
        return m === method && p === path ? new NetError('network', 'つながりません') : undefined;
      } });
      const rows = await runRulesProbe(s.args);
      assert.equal(rows.length, LABEL_COUNT);
      assert.equal(rows[13 + i].got, 'error');
      assert.equal(rows[13 + i].pass, false);
      assert.equal(rows.filter((r) => !r.pass).length, 1);
      assertLessonCleanup(s);
    });
  }
});

test('runRulesProbe: 確認用の生徒としてする読み書き（表の順・場所）', async () => {
  const s = setup();
  await runRulesProbe(s.args);
  const [inId, outId] = (() => {
    const m = s.teacherRepo.state.members[0].classId;
    const other = s.teacherRepo.state.classes.map((c) => c.id).find((id) => id !== m);
    return [m, other];
  })();
  const calls = s.studentNet().calls.filter(([m, , v]) =>
    !(m === 'update' && Object.values(v).every((x) => x === null))).map((c) => c.slice(0, 2));
  const recordCalls = recordChecks(s.teacherRepo).slice(0, 14).map((check) => {
    const call = s.studentNet().calls.find(([m, p, v]) => matchesRecordCheck(check, m, p, v));
    assert.ok(call, '記録の確認が指定の場所・値で呼ばれていない');
    return call.slice(0, 2);
  });
  assert.deepEqual(calls, [
    ['getPublic', 'gen/s00-999'],
    ['getPublic', 'gen'],
    ['get', `accounts/${STUDENT_UID}`],
    ['get', 'accounts'],
    ['get', `teacherList/${TEACHER_UID}`],
    ['get', 'students'],
    ['get', 'initialPw/s00-999'],
    ['get', `classes/${inId}`],
    ['get', `classes/${outId}`],
    ['get', 'classes'],
    ['get', `members/${inId}/s00-999`],
    ['get', `members/${inId}`],
    ['get', 'memberOf/s00-999'],
    ...lessonChecks(s.teacherRepo).map(([m, p]) => [m, p]),
    ...recordCalls,
    ...attachmentChecks(s.teacherRepo).slice(0, 7).map(([m, p]) => [m, p]),
    ...attachmentChecks(s.teacherRepo).slice(8).map(([m, p]) => [m, p]),
    ['set', `classes/${inId}/name`],
    ['set', `memberOf/s00-999/${outId}`],
    ['set', `accounts/${STUDENT_UID}`],
    ['set', 'gen/s00-999'],
    ['set', 'initialPw/s00-999'],
    ['remove', 'initialPw/s00-999'],
  ]);
  const sets = s.studentNet().calls.filter(([m, p]) => m === 'set' && !/^(lessons|thumbs|units|records|marks|recThumbs)\//.test(p));
  assert.equal(sets[1][2], true);                       // memberOf に true
  assert.equal(typeof sets[2][2], 'string');            // accounts を別の ID に
  assert.notEqual(sets[2][2], 's00-999');
  assert.equal(typeof sets[3][2], 'number');            // gen は数
  assert.equal(typeof sets[4][2], 'string');            // initialPw に文字
  assert.notEqual(sets[4][2], PASSWORD);
});

test('runRulesProbe: denied のはずの読みが通ると、その行だけ pass: false（got: ok）', async () => {
  const s = setup({ override: (m, p) => (m === 'get' && p === 'students' ? 'ok' : undefined) });
  const rows = await runRulesProbe(s.args);
  const bad = rows.filter((r) => !r.pass);
  assert.equal(bad.length, 1);
  assert.equal(bad[0].expect, 'denied');
  assert.equal(bad[0].got, 'ok');
  assert.equal(rows.indexOf(bad[0]), 5); // students を読む行
});

test('runRulesProbe: NetError(network) は got: error・pass: false（denied と数えない）', async () => {
  const s = setup({ override: (m, p) => (m === 'get' && p === 'classes' ? new NetError('network', 'つながりません') : undefined) });
  const rows = await runRulesProbe(s.args);
  const r = rows[9]; // classes 全体を読む（期待 denied）
  assert.equal(r.expect, 'denied');
  assert.equal(r.got, 'error');
  assert.equal(r.pass, false);
  assert.equal(rows.filter((x) => !x.pass).length, 1);
});

test('runRulesProbe: NetError ではない例外も got: error。ok のはずの行でも pass: false', async () => {
  const s = setup({ override: (m, p) => (m === 'getPublic' && p === 'gen/s00-999' ? new TypeError('こわれた') : undefined) });
  const rows = await runRulesProbe(s.args);
  assert.equal(rows[0].expect, 'ok');
  assert.equal(rows[0].got, 'error');
  assert.equal(rows[0].pass, false);
  assert.ok(cleanupPatch(s.teacherNet));
});

test('runRulesProbe: 片付けで、クラス 2 つ・members・memberOf・accounts・initialPw を消し、gen を戻す', async () => {
  const s = setup();
  const rows = await runRulesProbe(s.args);
  const patch = cleanupPatch(s.teacherNet);
  assert.ok(patch, '片付けが呼ばれていない');
  const [a, b] = s.teacherRepo.state.classes.map((c) => c.id);
  for (const p of [`classes/${a}`, `classes/${b}`, `members/${a}`, `members/${b}`, 'memberOf/s00-999',
    `accounts/${STUDENT_UID}`, 'initialPw/s00-999']) {
    assert.equal(patch[p], null, p);
  }
  // gen/s00-999 は、書きかえの確かめの前の値（発行した回数）に戻す
  assert.equal(patch['gen/s00-999'], 1);
  // students/s00-999 は残す
  assert.ok(!Object.keys(patch).some((k) => k.startsWith('students')));
  // 片付けが済めば「片付け」の行は出さない
  assert.ok(!rows.some((r) => r.label === '片付け'));
  assertLessonCleanup(s);
});

test('runRulesProbe: 途中で例外が出ても（ログインの失敗）、片付けが呼ばれ、「準備」の行を返す', async () => {
  const s = setup({ makeStudentFails: true });
  const rows = await runRulesProbe(s.args);
  assert.deepEqual(rows, [{ label: '準備', expect: 'ok', got: 'error', pass: false }]);
  const patch = cleanupPatch(s.teacherNet);
  assert.ok(patch, '片付けが呼ばれていない');
  assert.equal(s.teacherRepo.state.classes.length, 0, 'ログインしてからクラスを作る');
  assert.equal(patch['initialPw/s00-999'], null);
  // ログインできなくても、台帳の uid から accounts の対応を消す
  assert.equal(patch[`accounts/${STUDENT_UID}`], null);
  assertLessonCleanup(s);
});

test('runRulesProbe: 単元・授業・資料の準備の応答が失われても、作ろうとしたデータを片付ける', async (t) => {
  for (const method of ['createUnit', 'createLessons', 'addMaterial']) {
    await t.test(method, async () => {
      const s = setup({ failPrepare: (m) => m === method });
      const rows = await runRulesProbe(s.args);
      assert.deepEqual(rows, [{ label: '準備', expect: 'ok', got: 'error', pass: false }]);
      assert.equal(s.signIns.length, 1);
      assertLessonCleanup(s);
      assert.equal(cleanupPatch(s.teacherNet)[`accounts/${STUDENT_UID}`], null);
    });
  }
});

test('runRulesProbe: 片付けに失敗したら、結果の最後に「片付け」の行を出す', async () => {
  const s = setup({ updateFails: true });
  const rows = await runRulesProbe(s.args);
  assert.equal(rows.length, LABEL_COUNT + 1);
  const last = rows[rows.length - 1];
  assert.equal(last.label, '片付け');
  assert.equal(last.expect, 'ok');
  assert.equal(last.got, 'error');
  assert.equal(last.pass, false);
});

test('runRulesProbe: 結果に、パスワードとトークンが入っていない', async () => {
  const s = setup({ updateFails: true, override: (m, p) => (m === 'get' && p === 'students' ? 'ok' : undefined) });
  const rows = await runRulesProbe(s.args);
  const text = JSON.stringify(rows);
  assert.ok(!text.includes(PASSWORD));
  assert.ok(!text.includes(TOKEN));
  for (const r of rows) {
    assert.equal(typeof r.label, 'string');
    assert.ok(r.label.length > 0);
    assert.deepEqual(Object.keys(r).sort(), ['expect', 'got', 'label', 'pass']);
  }
});

test('runRulesProbe: 発行が反映されたあとに応答だけ失われても、accounts と initialPw を片付ける', async () => {
  const s = setup({ throwAfterLink: true, students: [{ id: 's00-999', uid: 'old-uid', createdAt: 5 }] });
  const rows = await runRulesProbe(s.args);
  assert.deepEqual(rows, [{ label: '準備', expect: 'ok', got: 'error', pass: false }]);
  const patch = cleanupPatch(s.teacherNet);
  assert.ok(patch, '片付けが呼ばれていない');
  assert.equal(patch[`accounts/${STUDENT_UID}`], null); // 台帳の uid（今回作られたもの）
  assert.equal(patch['initialPw/s00-999'], null);
  assert.equal(s.signIns.length, 0);
});

test('runRulesProbe: uid の読み直しに失敗しても、分かっている場所の削除と gen の戻しは送る', async () => {
  // 準備では読める（1 回目）が、片付けの読み直し（2 回目）で失敗する
  const s = setup({ makeStudentFails: true, listStudentsFails: (n) => n >= 2 });
  const rows = await runRulesProbe(s.args);
  assert.deepEqual(rows.map((r) => r.label), ['準備', '片付け']);
  const last = rows[1];
  assert.deepEqual(last, { label: '片付け', expect: 'ok', got: 'error', pass: false });
  const patch = cleanupPatch(s.teacherNet);
  assert.equal(s.teacherRepo.state.classes.length, 0);
  assert.equal(patch['initialPw/s00-999'], null);
  assert.equal(patch['gen/s00-999'], 1); // gen の戻しも送る
});

test('runRulesProbe: 分かっている場所の削除に失敗しても、accounts の削除は別に行う', async () => {
  const s = setup({ failUpdate: (patch) => Object.keys(patch).some((k) => k.startsWith('classes/')) });
  const rows = await runRulesProbe(s.args);
  assert.equal(rows.length, LABEL_COUNT + 1);
  assert.equal(rows[rows.length - 1].label, '片付け');
  const accountWrite = s.teacherNet.calls.find(([m, p, patch]) => m === 'update' && p === ''
    && patch && Object.prototype.hasOwnProperty.call(patch, `accounts/${STUDENT_UID}`) && patch[`accounts/${STUDENT_UID}`] === null);
  assert.ok(accountWrite, 'accounts の削除が送られていない');
});

test('runRulesProbe: issueOne が uid を返せば、それで accounts を消す（台帳を読み直さない）', async () => {
  const s = setup({ makeStudentFails: true, returnUid: true });
  await runRulesProbe(s.args);
  assert.equal(s.teacherRepo.state.listStudentsCalls, 1); // 準備の 1 回だけ
  assert.equal(cleanupPatch(s.teacherNet)[`accounts/${STUDENT_UID}`], null);
});

test('runRulesProbe: 準備の最初に失敗しても（台帳が読めない）、例外を投げず「準備」の行を返す', async () => {
  const s = setup({ listStudentsFails: () => true });
  const rows = await runRulesProbe(s.args);
  assert.deepEqual(rows, [{ label: '準備', expect: 'ok', got: 'error', pass: false }]);
  assert.equal(s.issuer.calls.length, 0);
});

// 最初の null を含む update（前回の残りの削除）
function firstCleanup(teacherNet) {
  return teacherNet.calls.find(([m, p, patch]) => m === 'update' && p === '' && Object.values(patch).includes(null));
}

test('runRulesProbe: はじめに前回の残り（年度 0 のクラス。名前は見ない）を消す', async () => {
  const s = setup({
    classes: [
      { id: 'OLDPROBE0001', year: 0, name: '（規則の確認用）', createdAt: 1 },
      { id: 'REALCLASS001', year: 2026, name: '2年A組', createdAt: 1 },
      { id: 'RENAMED00001', year: 0, name: 'ほかの名前', createdAt: 1 },
    ],
    lessons: [
      { id: 'OLDLESSON001', classId: 'OLDPROBE0001', title: '書きかえ' },
      { id: 'OLDLESSON002', classId: 'OLDPROBE0001', title: '確認用' },
      { id: 'OLDLESSON003', classId: 'RENAMED00001', title: '確認用' },
      { id: 'REALLESSON01', classId: 'REALCLASS001', title: '残す授業' },
    ],
    units: [
      { id: 'OLDUNIT00001', year: 0, name: '書きかえ' },
      { id: 'REALUNIT0001', year: 2026, name: '残す単元' },
    ],
  });
  const rows = await runRulesProbe(s.args);
  assert.equal(rows.length, LABEL_COUNT);
  const first = firstCleanup(s.teacherNet);
  assert.ok(first);
  const patch = first[2];
  for (const id of ['OLDPROBE0001', 'RENAMED00001']) {
    assert.equal(patch[`classes/${id}`], null, id);
    assert.equal(patch[`members/${id}`], null, id);
    assert.equal(patch[`thumbs/${id}`], null, id);
    assert.ok(!(`lessons/${id}` in patch));
  }
  assert.equal(patch['lessons/OLDPROBE0001/OLDLESSON001'], null);
  assert.equal(patch['lessons/OLDPROBE0001/OLDLESSON002'], null);
  assert.equal(patch['lessons/RENAMED00001/OLDLESSON003'], null);
  assert.equal(patch['units/OLDUNIT00001'], null);
  assert.ok(!Object.keys(patch).some((k) => k.includes('REALUNIT0001')));
  assert.equal(patch['memberOf/s00-999'], null);
  assert.ok(!Object.keys(patch).some((k) => k.includes('REALCLASS001')));
  // 発行は 1 回だけ
  assert.equal(s.issuer.calls.length, 1);
});

test('runRulesProbe: 名前の書きかえが通って片付けに失敗した残りも、次の実行のはじめに消す', async () => {
  // 前回: 名前が書きかえられ、片付けに失敗した。年度 0 のクラス 2 つと、members・memberOf が残っている。
  // memberOf には、classes にもう無いクラス（GONE00000001）も残っている
  const s = setup({
    classes: [
      { id: 'LEFTIN000001', year: 0, name: '書きかえ', createdAt: 1 },
      { id: 'LEFTOUT00001', year: 0, name: '（規則の確認用）', createdAt: 1 },
      { id: 'REALPROBENM1', year: 2026, name: '（規則の確認用）', createdAt: 1 }, // 年度 2026 は消さない
    ],
    teacherData: { 'memberOf/s00-999': { LEFTIN000001: true, GONE00000001: true } },
  });
  await runRulesProbe(s.args);
  const first = firstCleanup(s.teacherNet);
  assert.ok(first);
  const patch = first[2];
  for (const id of ['LEFTIN000001', 'LEFTOUT00001']) {
    assert.equal(patch[`classes/${id}`], null, id);
    assert.equal(patch[`members/${id}`], null, id);
  }
  assert.equal(patch['members/GONE00000001/s00-999'], null);
  assert.equal(patch['memberOf/s00-999'], null);
  assert.ok(!Object.keys(patch).some((k) => k.includes('REALPROBENM1')));
  // 先生として memberOf/s00-999 を読んでいる
  assert.ok(s.teacherNet.calls.some(([m, p]) => m === 'get' && p === 'memberOf/s00-999'));
});

test('runRulesProbe: 前回の残りが無ければ、はじめに削除を送らない', async () => {
  const s = setup();
  await runRulesProbe(s.args);
  const updates = s.teacherNet.calls.filter(([m, p, patch]) => m === 'update' && p === '' && Object.values(patch).includes(null));
  assert.ok(!updates.some(([, , patch]) => Object.keys(patch).length === 1 && 'memberOf/s00-999' in patch));
});

test('runRulesProbe: 前回の年度 0 の単元だけが残っていても、ログインしてから消す', async () => {
  const s = setup({ units: [
    { id: 'OLDUNIT00001', year: 0, name: '書きかえ' },
    { id: 'REALUNIT0001', year: 2026, name: '（規則の確認用）' },
  ] });
  s.args.issuer = { async issueOne(...args) {
    assert.equal(firstCleanup(s.teacherNet), undefined);
    return s.issuer.issueOne(...args);
  } };
  const rows = await runRulesProbe(s.args);
  assert.equal(rows.length, LABEL_COUNT);
  assert.ok(rows.every((r) => r.pass));
  const first = firstCleanup(s.teacherNet);
  assert.equal(first[2]['units/OLDUNIT00001'], null);
  assert.ok(!('units/REALUNIT0001' in first[2]));
});

test('runRulesProbe: 書きこみがすべて通っても、確認用データを消し、通常の授業と資料は残す', async () => {
  const initial = {
    classes: { realClass: { year: 2026, name: '残すクラス' }, oldClass: { year: 0, name: '書きかえ' } },
    lessons: { realClass: { realLesson: { title: '残す授業' } }, oldClass: { oldLesson: { title: '書きかえ' } } },
    thumbs: { realClass: { realLesson: { realMaterial: '残す画像' } }, oldClass: { oldLesson: { oldMaterial: '書きかえ' } } },
    units: { realUnit: { year: 2026, name: '残す単元' }, oldUnit: { year: 0, name: '書きかえ' } },
  };
  const mem = createMemoryNet({ now: () => 1000, initial,
    deny: (op, path, patch) => op === 'update' && Object.keys(patch).some((p) => /^lessons\/[^/]+$/.test(p)),
  });
  const teacherRepo = createRepo(mem);
  const changed = [];
  const rows = await runRulesProbe({
    teacherRepo, teacherNet: mem, random: seqRandom(), now: () => 1000, teacherUid: TEACHER_UID,
    issuer: { async issueOne(sid, { generation }) {
      await teacherRepo.linkAccount(sid, { uid: STUDENT_UID, generation, password: PASSWORD });
      return { generation, password: PASSWORD, uid: STUDENT_UID };
    } },
    makeStudent: async () => ({ uid: STUDENT_UID, net: { ...mem,
      async set(path, value) {
        const before = await mem.get(path);
        await mem.set(path, value);
        if (/^(lessons|thumbs|units)\//.test(path)) changed.push({ before, after: await mem.get(path) });
      },
    } }),
  });
  assert.equal(rows.length, LABEL_COUNT);
  assert.equal(changed.length, 4);
  for (const { before, after } of changed) {
    assert.notEqual(before, null);
    assert.notEqual(after, before);
  }
  for (const r of rows.slice(19, 23)) {
    assert.equal(r.expect, 'denied');
    assert.equal(r.got, 'ok');
    assert.equal(r.pass, false);
  }
  for (const path of ['classes', 'lessons', 'thumbs', 'units']) {
    const key = Object.keys(initial[path])[0];
    assert.deepEqual(await mem.get(path), { [key]: initial[path][key] }, path);
  }
  for (const path of ['members', 'memberOf', 'accounts', 'initialPw', 'records', 'marks']) assert.equal(await mem.get(path), null, path);
  assert.equal(await mem.get('gen/s00-999'), 1);
  assert.equal(await mem.get('students/s00-999/createdAt'), 1000);
});
