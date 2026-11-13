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
const rejectsCode = (p, code) => assert.rejects(p, (e) => e instanceof NetError && e.code === code);
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
  assert.deepEqual(await gas.call('ping'), { ok: true, version: 'app-1' });
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
