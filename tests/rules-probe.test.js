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
function fakeTeacherNet({ failUpdate = () => false, data = {} } = {}) {
  const calls = [];
  return {
    calls,
    async get(path) { calls.push(['get', path]); return path in data ? data[path] : null; },
    async set(path, value) { calls.push(['set', path, value]); },
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
function correctAnswer(method, path, repo) {
  const inId = repo.state.members[0] && repo.state.members[0].classId;
  if (method === 'getPublic') return path === 'gen/s00-999' ? 'ok' : 'denied';
  if (method === 'get') {
    const okPaths = [`accounts/${STUDENT_UID}`, `classes/${inId}`, `members/${inId}/s00-999`, 'memberOf/s00-999'];
    const lesson = repo.state.lessons.find((l) => l.classId === inId);
    if (lesson) okPaths.push(`lessons/${inId}`, `thumbs/${inId}/${lesson.id}`, 'units');
    return okPaths.includes(path) ? 'ok' : 'denied';
  }
  if (method === 'remove') return path === 'initialPw/s00-999' ? 'ok' : 'denied';
  return 'denied'; // set
}

// 確認用の生徒の net の代役。answer(method, path) が 'ok'・'denied'・Error を返す
function fakeStudentNet(answer) {
  const calls = [];
  const run = async (method, path, value) => {
    calls.push(value === undefined ? [method, path] : [method, path, value]);
    const a = answer(method, path);
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

// 一式を組み立てる。override(method, path, repo) が undefined でなければ、正しい答えの代わりに使う
function setup({
  generation = null, students = [], classes = [], override = () => undefined, makeStudentFails = false,
  updateFails = false, failUpdate = null, listStudentsFails = () => false, throwAfterLink = false, returnUid = false,
  teacherData = {}, units = [], lessons = [], failPrepare = () => false,
} = {}) {
  const teacherRepo = fakeTeacherRepo({ generation, students, classes, units, lessons, listStudentsFails, failPrepare });
  // updateFails: 片付けの書きこみ（null を含むもの）をすべて失敗させる
  const teacherNet = fakeTeacherNet({
    failUpdate: failUpdate || ((patch) => updateFails && Object.values(patch).includes(null)),
    data: teacherData,
  });
  const issuer = fakeIssuer(teacherRepo, { throwAfterLink, returnUid });
  let studentNet = null;
  const signIns = [];
  const makeStudent = async (email, password) => {
    signIns.push({ email, password });
    if (makeStudentFails) throw new NetError('bad-credentials', 'ID かパスワードが違います');
    studentNet = fakeStudentNet((m, p) => {
      const o = override(m, p, teacherRepo);
      return o === undefined ? correctAnswer(m, p, teacherRepo) : o;
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

const LABEL_COUNT = 29;

test('runRulesProbe: 規則が正しければ、全部の行が pass: true（29 行）', async () => {
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
    'denied', 'denied', 'denied', 'denied', 'denied', 'ok',
  ]);
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
  const calls = s.studentNet().calls.map((c) => c.slice(0, 2));
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
    ['set', `classes/${inId}/name`],
    ['set', `memberOf/s00-999/${outId}`],
    ['set', `accounts/${STUDENT_UID}`],
    ['set', 'gen/s00-999'],
    ['set', 'initialPw/s00-999'],
    ['remove', 'initialPw/s00-999'],
  ]);
  const sets = s.studentNet().calls.filter(([m, p]) => m === 'set' && !/^(lessons|thumbs|units)\//.test(p));
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
  const [a, b] = s.teacherRepo.state.classes.map((c) => c.id);
  for (const p of [`classes/${a}`, `classes/${b}`, `members/${a}`, `members/${b}`, 'memberOf/s00-999', 'initialPw/s00-999']) {
    assert.equal(patch[p], null, p);
  }
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
      assert.equal(s.signIns.length, 0);
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
  const [a, b] = s.teacherRepo.state.classes.map((c) => c.id);
  for (const p of [`classes/${a}`, `classes/${b}`, `members/${a}`, `members/${b}`, 'memberOf/s00-999', 'initialPw/s00-999']) {
    assert.equal(patch[p], null, p);
  }
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
  // 発行より前に消している（発行は 1 回）
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

test('runRulesProbe: 前回の年度 0 の単元だけが残っていても、発行より前に消す', async () => {
  const s = setup({ units: [
    { id: 'OLDUNIT00001', year: 0, name: '書きかえ' },
    { id: 'REALUNIT0001', year: 2026, name: '（規則の確認用）' },
  ] });
  s.args.issuer = { async issueOne(...args) {
    const first = firstCleanup(s.teacherNet);
    assert.ok(first);
    assert.equal(first[2]['units/OLDUNIT00001'], null);
    assert.ok(!('units/REALUNIT0001' in first[2]));
    return s.issuer.issueOne(...args);
  } };
  const rows = await runRulesProbe(s.args);
  assert.equal(rows.length, LABEL_COUNT);
  assert.ok(rows.every((r) => r.pass));
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
  for (const path of ['members', 'memberOf', 'accounts', 'initialPw']) assert.equal(await mem.get(path), null, path);
  assert.equal(await mem.get('gen/s00-999'), 1);
  assert.equal(await mem.get('students/s00-999/createdAt'), 1000);
});
