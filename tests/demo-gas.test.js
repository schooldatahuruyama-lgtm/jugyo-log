// 練習用 GAS の権限と、同じキーで保存し直したときの動きを確かめる
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDemoGas } from '../js/dev/demo-gas.js';
import { createDemoBackend } from '../js/dev/demo.js';
import { createMemoryNet } from '../js/dev/memory-net.js';
import { createFiles } from '../js/files.js';
import { createFileCache } from '../js/file-cache.js';
import { NetError } from '../js/errors.js';

const upload = { key: 'test-key-1', mime: 'image/jpeg', name: '板書', dataB64: 'AQID' };
const refs = { classId: 'c1', lessonId: 'l1' };

test('練習用のまとめ: 先生だけが呼べる。先頭の疑問 3 人と見本の印を返す', async () => {
  const { gas, setUser } = make();
  const request = { title: '確認用の授業', terms: [], entries: Array.from({ length: 4 }, (_, i) => ({
    no: `${i + 1}番`, level: i + 1, learned: '', question: `確認用の疑問${i + 1}`, memo: '',
  })) };
  const result = await gas.call('summarize', request);
  assert.equal(result.model, 'demo');
  assert.ok(result.summary.overview.startsWith('（練習モードの見本です）'));
  assert.deepEqual(result.summary.questionGroups.map((g) => g.numbers), [['1番'], ['2番'], ['3番']]);
  assert.deepEqual(result.summary.followUp.map((g) => g.number), ['1番', '2番']);
  await rejectsCode(gas.call('summarize', { ...request, entries: [] }), 'bad');
  setUser('student');
  await rejectsCode(gas.call('summarize', request), 'denied');
});
const rejectsCode = (p, code) => assert.rejects(p, (e) => e instanceof NetError && e.code === code);
const inkText = '{"v":1,"h":400,"s":[{"c":0,"w":0,"p":[0,0,1,1]}]}';
const inkUpload = { key: 'ink-test-1', ...refs, mime: 'application/json', dataB64: Buffer.from(inkText).toString('base64') };
function make() {
  let user = { uid: 'teacher' };
  const net = createMemoryNet({ now: () => 1000, initial: {
    teacherList: { teacher: true }, accounts: { student: 's26-001', outsider: 's26-002' },
    memberOf: { 's26-001': { c1: true } },
  } });
  const gas = createDemoGas({ net, getUser: () => user });
  return { gas, net, setUser: (uid) => { user = uid ? { uid } : null; } };
}

test('先生は保存でき、同じ key を同時に頼んでも 1 個になる', async () => {
  const { gas } = make();
  const [a, b] = await Promise.all([gas.call('putMaterial', upload), gas.call('putMaterial', upload)]);
  assert.deepEqual(a, { ok: true, id: a.id, existed: false, bytes: 3 });
  assert.deepEqual(b, { ...a, existed: true });
  assert.notEqual((await gas.call('putMaterial', { ...upload, key: 'test-key-2' })).id, a.id);
});

test('ping と whoami は本物と同じ形。未ログイン・対応のないアカウントは auth', async () => {
  const { gas, setUser } = make();
  assert.deepEqual(await gas.call('ping'), { ok: true, version: 'app-5' });
  assert.deepEqual(await gas.call('whoami'), { ok: true, role: 'teacher' });
  setUser('student');
  assert.deepEqual(await gas.call('whoami'), { ok: true, role: 'student', studentId: 's26-001' });
  setUser('unregistered');
  await rejectsCode(gas.call('whoami'), 'auth');
  setUser(null);
  await rejectsCode(gas.call('whoami'), 'auth');
  assert.equal((await gas.call('ping')).ok, true);
});

test('生徒は保存・削除できず、組の外からは授業の資料を読めない', async () => {
  const { gas, net, setUser } = make();
  const { id } = await gas.call('putMaterial', upload);
  await net.set('lessons/c1/l1/materials/m1', { type: 'image', fileId: id, name: '板書' });
  setUser('student');
  await rejectsCode(gas.call('putMaterial', upload), 'denied');
  await rejectsCode(gas.call('trashFile', { fileId: id }), 'denied');
  assert.deepEqual(await gas.call('getMaterials', { ...refs, ids: ['m1'] }), {
    ok: true, files: { m1: { mime: 'image/jpeg', dataB64: 'AQID' } }, missing: [],
  });
  setUser('outsider');
  await rejectsCode(gas.call('getMaterials', { ...refs, ids: ['m1'], fileId: id }), 'notfound');
  await rejectsCode(gas.call('getFile', { ...refs, materialId: 'm1', fileId: id }), 'notfound');
  setUser('student');
  await net.remove('memberOf/s26-001/c1');
  await rejectsCode(gas.call('getMaterials', { ...refs, ids: ['m1'] }), 'notfound');
});

test('ファイル ID はデータベースで決め、PDF と無い画像は missing。無い単体資料は notfound', async () => {
  const { gas, net } = make();
  const { id } = await gas.call('putMaterial', upload);
  const pdf = await gas.call('putMaterial', { ...upload, key: 'test-pdf-1', mime: 'application/pdf' });
  await net.set('lessons/c1/l1/materials', {
    m1: { type: 'image', fileId: id, name: '板書' },
    p1: { type: 'pdf', fileId: pdf.id, name: '配布資料' },
    gone: { type: 'image', fileId: 'missing-file', name: '無い資料' },
  });
  const images = await gas.call('getMaterials', { ...refs, ids: ['m1', 'p1', 'gone', 'none'], fileId: 'ignored' });
  assert.deepEqual(images.missing, ['p1', 'gone', 'none']);
  assert.deepEqual(Object.keys(images.files), ['m1']);
  assert.deepEqual(await gas.call('getFile', { ...refs, materialId: 'p1', fileId: id }), {
    ok: true, mime: 'application/pdf', name: '配布資料', dataB64: 'AQID',
  });
  await rejectsCode(gas.call('getFile', { ...refs, materialId: 'gone' }), 'notfound');
  assert.deepEqual(await gas.call('trashFile', { fileId: id }), { ok: true, trashed: true });
  assert.deepEqual(await gas.call('trashFile', { fileId: id }), { ok: true, trashed: false });
  assert.deepEqual((await gas.call('getMaterials', { ...refs, ids: ['m1'] })).missing, ['m1']);
  await rejectsCode(gas.call('getFile', { ...refs, materialId: 'm1' }), 'notfound');
  const reloaded = createDemoGas({ net, getUser: () => ({ uid: 'teacher' }) });
  await rejectsCode(reloaded.call('getFile', { ...refs, materialId: 'p1' }), 'notfound');
});

test('不正な引数・上限超過は本物の GAS クライアントと同じエラー', async () => {
  const { gas } = make();
  for (const change of [{ key: 'short' }, { mime: 'text/html' }, { name: '改行\n入り' }, { dataB64: '?' }]) {
    await rejectsCode(gas.call('putMaterial', { ...upload, ...change }), 'unknown');
  }
  await rejectsCode(gas.call('putMaterial', { ...upload, dataB64: 'A'.repeat(1400004) }), 'toobig');
  await rejectsCode(gas.call('getMaterials', { ...refs, ids: Array(13).fill('m1') }), 'unknown');
  await rejectsCode(gas.call('getFile', { ...refs, materialId: '../m1' }), 'unknown');
  await rejectsCode(gas.call('unknown'), 'unknown');
});

test('再読み込み後の保存で、古い資料が別のファイルを指さない', async () => {
  const { net } = make();
  const getUser = () => ({ uid: 'teacher' });
  const before = createDemoGas({ net, getUser, random: () => 0 });
  const old = await before.call('putMaterial', upload);
  await net.set('lessons/c1/l1/materials/m1', { type: 'image', fileId: old.id, name: '板書' });
  const after = createDemoGas({ net, getUser, random: () => 0.5 });
  const saved = await after.call('putMaterial', { ...upload, key: 'test-key-2' });
  assert.notEqual(saved.id, old.id);
  await rejectsCode(after.call('getFile', { ...refs, materialId: 'm1' }), 'notfound');
});

test('上限ちょうどの画像と PDF を保存でき、4 文字超えたら toobig', async () => {
  const { gas } = make();
  for (const [mime, max] of [['image/jpeg', 1400000], ['application/pdf', 14000000]]) {
    const payload = { ...upload, key: `test-limit-${max}`, mime, dataB64: 'A'.repeat(max) };
    assert.equal((await gas.call('putMaterial', payload)).bytes, max / 4 * 3);
    await rejectsCode(gas.call('putMaterial', { ...payload, dataB64: payload.dataB64 + 'AAAA' }), 'toobig');
  }
});

test('練習モードが gas を返し、files を通して保存と取得ができる', async () => {
  const stored = new Map();
  const storage = { getItem: (k) => stored.get(k) ?? null, setItem: (k, v) => stored.set(k, v), removeItem: (k) => stored.delete(k) };
  const backend = createDemoBackend({ storage, now: () => 1000, random: () => 0.5 });
  await backend.auth.signIn('teacher@example.invalid', 'test-only');
  const files = createFiles({ gas: backend.gas, cache: createFileCache({}) });
  const saved = await files.upload(upload);
  await backend.net.set('lessons/c1/l1/materials/m1', { type: 'image', fileId: saved.fileId, name: '板書' });
  const result = await files.loadImages('c1', 'l1', [{ id: 'm1', type: 'image', fileId: saved.fileId }]);
  assert.equal(result.m1.size, 3);
  assert.equal([...stored.values()].join('').includes(upload.dataB64), false);
  backend.auth.signOut();
  await rejectsCode(backend.gas.call('whoami'), 'auth');
});

const studentUpload = { key: 'student-key-1', ...refs, mime: 'image/jpeg', dataB64: 'AQID' };
async function makeStudent() {
  const setup = make();
  await setup.net.set('lessons/c1/l1', { createdAt: 100 });
  setup.setUser('student');
  return setup;
}

test('練習の手書き: 同時に同じキーで送っても 1 個。本人と先生だけ読み、まとめ読みは対象外', async () => {
  const { gas, setUser } = await makeStudent();
  const [saved, again] = await Promise.all([gas.call('putStudentFile', inkUpload), gas.call('putStudentFile', inkUpload)]);
  assert.deepEqual(again, { ...saved, existed: true });
  assert.equal(saved.bytes, inkText.length);
  const files = createFiles({ gas, cache: createFileCache({}) });
  assert.equal(await files.loadInk(saved.id), inkText);
  for (const user of ['student', 'teacher']) {
    setUser(user);
    assert.deepEqual(await gas.call('getStudentFile', { fileId: saved.id }), { ok: true, mime: 'application/json', dataB64: inkUpload.dataB64 });
    assert.deepEqual(await gas.call('getStudentFiles', { fileIds: [saved.id] }), { ok: true, files: {}, missing: [saved.id] });
  }
  await rejectsCode(gas.call('trashStudentFile', { fileId: saved.id }), 'denied');
  await rejectsCode(gas.call('putMaterial', { ...inkUpload, name: '手書き' }), 'unknown');
  setUser('outsider');
  await rejectsCode(gas.call('getStudentFile', { fileId: saved.id }), 'notfound');
  assert.deepEqual(await gas.call('trashStudentFile', { fileId: saved.id }), { ok: true, trashed: false });
  setUser('student');
  assert.equal(await files.trashStudent(saved.id), true);
  await rejectsCode(files.loadInk(saved.id), 'notfound');
});

test('練習の手書き: JSON の形と版を確かめ、400000 文字の境界を本番と合わせる', async () => {
  const { gas } = await makeStudent();
  for (const text of ['{', 'null', '[]', '1', '"text"', '{}', '{"v":2}', '{"v":"1"}']) {
    await rejectsCode(gas.call('putStudentFile', { ...inkUpload, dataB64: Buffer.from(text).toString('base64') }), 'unknown');
  }
  const text = '{"v":1}' + ' '.repeat(300000 - 7);
  const dataB64 = Buffer.from(text).toString('base64');
  assert.equal(dataB64.length, 400000);
  assert.equal((await gas.call('putStudentFile', { ...inkUpload, dataB64 })).bytes, 300000);
  await rejectsCode(gas.call('putStudentFile', { ...inkUpload, dataB64: dataB64 + 'AAAA' }), 'toobig');
});

test('練習の手書き: キー・授業・所属・所有者の確認を維持する', async () => {
  const { gas, net, setUser } = await makeStudent();
  for (const [change, code] of [[{ key: 'bad' }, 'unknown'], [{ lessonId: 'bad/id' }, 'unknown'],
    [{ lessonId: 'missing' }, 'notfound'], [{ classId: 'outside' }, 'notfound']]) {
    await rejectsCode(gas.call('putStudentFile', { ...inkUpload, ...change }), code);
  }
  await gas.call('putStudentFile', inkUpload);
  await net.set('memberOf/s26-002/c1', true);
  setUser('outsider');
  await rejectsCode(gas.call('putStudentFile', inkUpload), 'denied');
  setUser('student');
  await net.set('lessons/c1/l2', { createdAt: 1 });
  await rejectsCode(gas.call('putStudentFile', { ...inkUpload, lessonId: 'l2' }), 'denied');
});

test('生徒の保存: 同じキーを同時に送っても 1 個で、名前は取り出しに含まない', async () => {
  const { gas } = await makeStudent();
  const [a, b] = await Promise.all([gas.call('putStudentFile', studentUpload), gas.call('putStudentFile', studentUpload)]);
  assert.deepEqual(a, { ok: true, id: a.id, existed: false, bytes: 3 });
  assert.deepEqual(b, { ...a, existed: true });
  assert.deepEqual(await gas.call('getStudentFile', { fileId: a.id }), { ok: true, mime: 'image/jpeg', dataB64: 'AQID' });
  assert.notEqual((await gas.call('putStudentFile', { ...studentUpload, key: 'student-key-2' })).id, a.id);
});

test('生徒の保存: 先生と対応のない人は denied、所属と授業がなければ notfound', async () => {
  const { gas, net, setUser } = await makeStudent();
  for (const uid of ['teacher', 'unregistered']) {
    setUser(uid);
    await rejectsCode(gas.call('putStudentFile', studentUpload), 'denied');
  }
  setUser('outsider');
  await rejectsCode(gas.call('putStudentFile', studentUpload), 'notfound');
  setUser('student');
  await rejectsCode(gas.call('putStudentFile', { ...studentUpload, lessonId: 'missing' }), 'notfound');
  await net.remove('lessons/c1/l1/createdAt');
  await rejectsCode(gas.call('putStudentFile', studentUpload), 'notfound');
  await net.set('lessons/c1/l1/createdAt', 0);
  assert.equal((await gas.call('putStudentFile', studentUpload)).existed, false);
  setUser(null);
  await rejectsCode(gas.call('putStudentFile', studentUpload), 'auth');
});

test('生徒の保存: 同じキーでも持ち主と授業が違えば denied、先生用とは別に保存する', async () => {
  const { gas, net, setUser } = await makeStudent();
  const saved = await gas.call('putStudentFile', studentUpload);
  await net.set('lessons/c1/l2/createdAt', 100);
  await rejectsCode(gas.call('putStudentFile', { ...studentUpload, lessonId: 'l2' }), 'denied');
  await net.set('memberOf/s26-002/c1', true);
  setUser('outsider');
  await rejectsCode(gas.call('putStudentFile', { ...studentUpload, studentId: 's26-001' }), 'denied');
  setUser('teacher');
  const material = await gas.call('putMaterial', { ...upload, key: studentUpload.key });
  assert.notEqual(material.id, saved.id);
  assert.deepEqual(await gas.call('getStudentFile', { fileId: saved.id }), { ok: true, mime: 'image/jpeg', dataB64: 'AQID' });
});

test('生徒の取得: 本人と先生だけが読め、目録や本文に持ち主を書きかえても他人は読めない', async () => {
  const { gas, net, setUser } = await makeStudent();
  const { id } = await gas.call('putStudentFile', studentUpload);
  for (const uid of ['teacher', 'student']) {
    setUser(uid);
    assert.deepEqual(await gas.call('getStudentFile', { fileId: id }), { ok: true, mime: 'image/jpeg', dataB64: 'AQID' });
  }
  await net.set('records/c1/l1/s26-002/attachments/a1', { fileId: id });
  setUser('outsider');
  await rejectsCode(gas.call('getStudentFile', { fileId: id, studentId: 's26-001' }), 'notfound');
  assert.deepEqual(await gas.call('getStudentFiles', { fileIds: [id] }), { ok: true, files: {}, missing: [id] });
  setUser('student');
  await net.remove('memberOf/s26-001/c1');
  assert.equal((await gas.call('getStudentFile', { fileId: id })).dataB64, 'AQID');
});

test('生徒の一括取得: 本人の画像だけを返し、PDF・他人の画像・無いものは missing', async () => {
  const { gas, net, setUser } = await makeStudent();
  const a = await gas.call('putStudentFile', studentUpload);
  const b = await gas.call('putStudentFile', { ...studentUpload, key: 'student-key-2' });
  const pdf = await gas.call('putStudentFile', { ...studentUpload, key: 'student-pdf-1', mime: 'application/pdf' });
  await net.set('memberOf/s26-002/c1', true);
  setUser('outsider');
  const other = await gas.call('putStudentFile', { ...studentUpload, key: 'student-other' });
  setUser('student');
  const fileIds = [a.id, b.id, other.id, pdf.id, 'missing-file'];
  const data = { mime: 'image/jpeg', dataB64: 'AQID' };
  assert.deepEqual(await gas.call('getStudentFiles', { fileIds }), { ok: true, files: { [a.id]: data, [b.id]: data }, missing: [other.id, pdf.id, 'missing-file'] });
  setUser('teacher');
  assert.deepEqual(await gas.call('getStudentFiles', { fileIds }), { ok: true, files: { [a.id]: data, [b.id]: data, [other.id]: data }, missing: [pdf.id, 'missing-file'] });
});

test('生徒の削除: 他人は false、先生は denied、本人だけが消せて再送は false', async () => {
  const { gas, setUser } = await makeStudent();
  const { id } = await gas.call('putStudentFile', studentUpload);
  setUser('outsider');
  assert.deepEqual(await gas.call('trashStudentFile', { fileId: id }), { ok: true, trashed: false });
  setUser('teacher');
  await rejectsCode(gas.call('trashStudentFile', { fileId: id }), 'denied');
  setUser('student');
  assert.equal((await gas.call('getStudentFile', { fileId: id })).dataB64, 'AQID');
  assert.deepEqual(await gas.call('trashStudentFile', { fileId: id }), { ok: true, trashed: true });
  assert.deepEqual(await gas.call('trashStudentFile', { fileId: id }), { ok: true, trashed: false });
  await rejectsCode(gas.call('getStudentFile', { fileId: id }), 'notfound');
  assert.deepEqual(await gas.call('getStudentFiles', { fileIds: [id] }), { ok: true, files: {}, missing: [id] });
});

test('先生と生徒の op は、互いのファイルを読めず消せない', async () => {
  const { gas, net, setUser } = await makeStudent();
  const student = await gas.call('putStudentFile', studentUpload);
  setUser('teacher');
  const material = await gas.call('putMaterial', upload);
  await net.set('lessons/c1/l1/materials/m1', { type: 'image', fileId: student.id, name: '板書' });
  await rejectsCode(gas.call('getFile', { ...refs, materialId: 'm1' }), 'notfound');
  assert.deepEqual(await gas.call('getMaterials', { ...refs, ids: ['m1'] }), { ok: true, files: {}, missing: ['m1'] });
  assert.deepEqual(await gas.call('trashFile', { fileId: student.id }), { ok: true, trashed: false });
  await rejectsCode(gas.call('getStudentFile', { fileId: material.id }), 'notfound');
  setUser('student');
  assert.deepEqual(await gas.call('trashStudentFile', { fileId: material.id }), { ok: true, trashed: false });
  assert.deepEqual(await gas.call('getStudentFiles', { fileIds: [material.id] }), { ok: true, files: {}, missing: [material.id] });
  assert.equal((await gas.call('getStudentFile', { fileId: student.id })).dataB64, 'AQID');
  await net.set('lessons/c1/l1/materials/m2', { type: 'image', fileId: material.id, name: '板書' });
  assert.equal((await gas.call('getFile', { ...refs, materialId: 'm2' })).dataB64, 'AQID');
});

test('生徒の op: 不正な引数と容量超過を断り、上限ちょうどは通す', async () => {
  const { gas } = await makeStudent();
  for (const change of [{ key: 'short' }, { classId: '../c1' }, { lessonId: '' }, { mime: 'image/png' }, { dataB64: '?' }, { dataB64: 3 }]) {
    await rejectsCode(gas.call('putStudentFile', { ...studentUpload, ...change }), 'unknown');
  }
  for (const fileId of ['', '../x', 'x'.repeat(201), null]) {
    await rejectsCode(gas.call('getStudentFile', { fileId }), 'unknown');
    await rejectsCode(gas.call('trashStudentFile', { fileId }), 'unknown');
  }
  for (const fileIds of [null, [], 'file', Array(7).fill('file'), ['file', '../x']]) {
    await rejectsCode(gas.call('getStudentFiles', { fileIds }), 'unknown');
  }
  for (const [mime, max] of [['image/jpeg', 1400000], ['application/pdf', 14000000]]) {
    const payload = { ...studentUpload, key: `student-limit-${max}`, mime, dataB64: 'A'.repeat(max) };
    assert.equal((await gas.call('putStudentFile', payload)).bytes, max / 4 * 3);
    await rejectsCode(gas.call('putStudentFile', { ...payload, dataB64: payload.dataB64 + 'AAAA' }), 'toobig');
  }
});

test('生徒の一括取得: 6 個まで受け、合計上限をこえる画像と残りを missing にする', async () => {
  const { gas } = await makeStudent();
  const fileIds = [];
  for (let i = 0; i < 6; i++) {
    fileIds.push((await gas.call('putStudentFile', { ...studentUpload, key: `student-batch-${i}`, dataB64: 'A'.repeat(1000000) })).id);
  }
  assert.equal(Object.keys((await gas.call('getStudentFiles', { fileIds })).files).length, 6);
  const large = await gas.call('putStudentFile', { ...studentUpload, key: 'student-large', dataB64: 'A'.repeat(1400000) });
  const ids = [large.id, large.id, large.id, large.id, fileIds[0], fileIds[1]];
  assert.deepEqual((await gas.call('getStudentFiles', { fileIds: ids })).missing, fileIds.slice(0, 2));
});
