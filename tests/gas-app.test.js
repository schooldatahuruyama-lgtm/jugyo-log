// 本番用の GAS の決まりを、規則をまねるデータベースと Apps Script の代役で確かめる
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadGas, makeFakes } from './helpers/gas-sandbox.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const CODE = join(root, 'gas/Code.gs');
const DATABASE_URL = 'https://db.example';
const FOLDER_NAME = '授業ログ_資料';
const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
const jwt = (payload) => `${b64url({ alg: 'RS256' })}.${b64url(payload)}.c2lnbmF0dXJl`;
const tokT = jwt({ user_id: 'uidT' });
const tokS = jwt({ user_id: 'uidS' });
const tokOther = jwt({ user_id: 'uidOther' });
const tokU = jwt({ user_id: 'uidU' });
const PHOTO = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x80, 0x7f, 0x00, 0x01]).toString('base64');
const PDF = Buffer.from('%PDF-1.7\nテスト用の資料').toString('base64');
const bad = { ok: false, error: 'bad' };
const auth = { ok: false, error: 'auth' };
const notfound = { ok: false, error: 'notfound' };

function setup(options = {}) {
  const state = {
    teacherList: { uidT: true },
    accounts: { uidS: 's26-001', uidOther: 's26-002' },
    memberOf: { 's26-001': { classA: true }, 's26-002': { classB: true } },
    materials: {},
  };
  const reads = [];
  const db = {
    read(path, uid) {
      reads.push({ path, uid });
      const parts = path.split('/');
      if (parts.length === 2 && (parts[0] === 'teacherList' || parts[0] === 'accounts')) {
        if (parts[1] !== uid) return { status: 401, body: { error: 'Permission denied' } };
        return { status: 200, body: state[parts[0]][uid] ?? null };
      }
      if (parts.length === 4 && parts[0] === 'lessons' && parts[3] === 'materials') {
        const studentId = state.accounts[uid];
        if (state.teacherList[uid] === true || state.memberOf[studentId]?.[parts[1]] === true) {
          return { status: 200, body: state.materials[path] ?? null };
        }
      }
      return { status: 401, body: { error: 'Permission denied' } };
    },
  };
  const fakes = makeFakes({
    databaseURL: DATABASE_URL,
    validTokens: { [tokT]: 'uidT', [tokS]: 'uidS', [tokOther]: 'uidOther', [tokU]: 'uidU' },
    db,
    ...options,
  });
  const gas = loadGas(CODE, fakes);
  const call = (body) => {
    const out = gas.doPost({ postData: { contents: typeof body === 'string' ? body : JSON.stringify(body) } });
    assert.equal(out.getMimeType(), fakes.ContentService.MimeType.JSON);
    return JSON.parse(out.getContent());
  };
  const put = (overrides = {}) => call({
    op: 'putMaterial', token: tokT, key: 'material-0001', mime: 'image/jpeg', name: '板書', dataB64: PHOTO, ...overrides,
  });
  const get = (overrides = {}) => call({
    op: 'getMaterials', token: tokS, classId: 'classA', lessonId: 'lessonA', ids: ['imageA'], ...overrides,
  });
  const getFile = (overrides = {}) => call({
    op: 'getFile', token: tokS, classId: 'classA', lessonId: 'lessonA', materialId: 'imageA', ...overrides,
  });
  const link = (id, fileId, extra = {}) => {
    const path = 'lessons/classA/lessonA/materials';
    state.materials[path] ??= {};
    state.materials[path][id] = { type: 'image', fileId, name: '資料の名前', ...extra };
  };
  return { state, reads, fakes, gas, call, put, get, getFile, link };
}

function countDriveReads(fakes) {
  const ids = [];
  const original = fakes.DriveApp.getFileById;
  fakes.DriveApp.getFileById = (id) => {
    ids.push(id);
    return original(id);
  };
  return ids;
}

test('本番の ping と doGet は app-1 を JSON で返す', () => {
  const { call, gas, fakes } = setup();
  assert.deepEqual(call({ op: 'ping' }), { ok: true, version: 'app-1' });
  const out = gas.doGet();
  assert.equal(out.getMimeType(), fakes.ContentService.MimeType.JSON);
  assert.deepEqual(JSON.parse(out.getContent()), { ok: true, version: 'app-1' });
  assert.equal(fakes.fetched.length, 0);
});

test('whoami は先生と生徒を区別し、対応のないアカウントを断る', () => {
  const { call, reads } = setup();
  assert.deepEqual(call({ op: 'whoami', token: tokT }), { ok: true, role: 'teacher' });
  assert.deepEqual(call({ op: 'whoami', token: tokS }), { ok: true, role: 'student', studentId: 's26-001' });
  assert.deepEqual(call({ op: 'whoami', token: tokU }), auth);
  assert.deepEqual(reads, [
    { path: 'teacherList/uidT', uid: 'uidT' },
    { path: 'teacherList/uidS', uid: 'uidS' },
    { path: 'accounts/uidS', uid: 'uidS' },
    { path: 'teacherList/uidU', uid: 'uidU' },
    { path: 'accounts/uidU', uid: 'uidU' },
  ]);
});

test('本人確認は true の先生か、形の正しい生徒 ID だけを認める', () => {
  for (const value of ['true', 1, {}, false]) {
    const { call, state } = setup();
    state.teacherList.uidT = value;
    assert.deepEqual(call({ op: 'whoami', token: tokT }), auth);
  }
  for (const value of ['s26-01', 's26-0001', 's26-001\n', '', 123, {}]) {
    const { call, state } = setup();
    state.accounts.uidS = value;
    assert.deepEqual(call({ op: 'whoami', token: tokS }), auth);
  }
});

test('トークンと user_id の形が違えば、問い合わせずに auth', () => {
  const { call, fakes } = setup();
  const invalid = [
    undefined, 123, 'abc', 'a.!!!.c', `${tokT}&x=1`, `${tokT}\n`, 'a'.repeat(4097),
    `${b64url({})}.${Buffer.from('not json').toString('base64url')}.c`,
    jwt({ sub: 'uidT' }), jwt({ user_id: 123 }),
    ...['', '../uidT', 'uidT?x', 'uidT\n', 'a'.repeat(129)].map((user_id) => jwt({ user_id })),
  ];
  for (const token of invalid) assert.deepEqual(call({ op: 'whoami', token }), auth);
  assert.equal(fakes.fetched.length, 0);
});

test('形だけ正しいにせのトークンでも、データベースの代役が断る', () => {
  const { call, reads, fakes } = setup();
  assert.deepEqual(call({ op: 'whoami', token: jwt({ user_id: 'uidT', fake: true }) }), auth);
  assert.equal(reads.length, 0);
  assert.equal(fakes.fetched.length, 2);
});

test('ペイロードの user_id と本人が違えば、代役の規則が断る', () => {
  const { call } = setup({ validTokens: { [tokT]: 'uidS' } });
  assert.deepEqual(call({ op: 'whoami', token: tokT }), auth);
});

test('本人確認はトークンの SHA-256 をキーに、役割だけを 60 秒覚える', () => {
  const { call, fakes } = setup();
  const cache = fakes.CacheService.getScriptCache();
  const entries = [];
  const original = cache.put;
  cache.put = (key, value, seconds) => {
    entries.push({ key, value, seconds });
    return original(key, value, seconds);
  };
  for (const token of [tokT, tokS]) {
    assert.equal(call({ op: 'whoami', token }).ok, true);
    const count = fakes.fetched.length;
    assert.equal(call({ op: 'whoami', token }).ok, true);
    assert.equal(fakes.fetched.length, count);
  }
  assert.deepEqual(entries, [tokT, tokS].map((token, i) => ({
    key: `auth_${createHash('sha256').update(token).digest('base64')}`,
    value: i === 0 ? 't' : 's:s26-001', seconds: 60,
  })));
  cache.remove(entries[1].key);
  const count = fakes.fetched.length;
  call({ op: 'whoami', token: tokS });
  assert.equal(fakes.fetched.length, count + 2);
});

test('putMaterial は生徒を denied にし、Drive にファイルを作らない', () => {
  const { put, fakes } = setup();
  assert.deepEqual(put({ token: tokS }), { ok: false, error: 'denied' });
  assert.equal(fakes.files.length, 0);
  assert.equal(fakes.DriveApp.getRootFolder().getFoldersByName(FOLDER_NAME).hasNext(), false);
});

test('先生の保存先は直下の資料フォルダ、名前は m_key、説明は teacher', () => {
  const { put, fakes } = setup();
  const result = put();
  assert.deepEqual(result, { ok: true, id: fakes.files[0].getId(), existed: false, bytes: 8 });
  assert.equal(fakes.files.length, 1);
  const file = fakes.files[0];
  assert.equal(file.getName(), 'm_material-0001');
  assert.equal(file.getDescription(), 'teacher');
  assert.equal(file.getMimeType(), 'image/jpeg');
  assert.equal(file.getParents().next().getName(), FOLDER_NAME);
  assert.equal(file.getParents().next().getParents().next(), fakes.DriveApp.getRootFolder());
});

test('保存の応答を失って同じ key で再送しても、同じ ID と保存済みのバイト数が返る', () => {
  const { put, fakes } = setup();
  const first = put();
  const retry = put({ dataB64: Buffer.from('別の長さ').toString('base64') });
  assert.deepEqual(retry, { ...first, existed: true });
  assert.equal(fakes.files.length, 1);
});

test('同じ名前でも、ゴミ箱の中や説明が違うファイルは使い回さない', () => {
  const { put, fakes } = setup();
  put();
  fakes.files[0].setTrashed(true);
  put();
  fakes.files[1].setDescription('student');
  const result = put();
  assert.equal(result.existed, false);
  assert.equal(fakes.files.length, 3);
  assert.equal(result.id, fakes.files[2].getId());
});

test('資料フォルダは直下だけで探し、無ければロックの中で 1 つ作る', () => {
  const { put, fakes } = setup();
  const rootFolder = fakes.DriveApp.getRootFolder();
  const other = rootFolder.createFolder('ほかの人から').createFolder(FOLDER_NAME);
  const lock = fakes.LockService.getScriptLock();
  let locked = false;
  let creates = 0;
  lock.waitLock = () => { assert.equal(locked, false); locked = true; };
  lock.releaseLock = () => { assert.equal(locked, true); locked = false; };
  const original = rootFolder.createFolder;
  rootFolder.createFolder = (name) => {
    assert.equal(locked, true);
    creates++;
    return original(name);
  };
  assert.equal(put().ok, true);
  assert.equal(put({ key: 'material-0002' }).ok, true);
  assert.equal(creates, 1);
  assert.equal(locked, false);
  assert.notEqual(fakes.files[0].getParents().next(), other);
});

test('検索・作成・説明の設定は同じロックの中で行い、再送でもロックを外す', () => {
  const { put, fakes } = setup();
  const folder = fakes.DriveApp.getRootFolder().createFolder(FOLDER_NAME);
  const lock = fakes.LockService.getScriptLock();
  const events = [];
  const wrap = (obj, name, fn) => {
    const original = obj[name];
    obj[name] = (...args) => {
      events.push(name);
      const result = original(...args);
      return fn ? fn(result) : result;
    };
  };
  wrap(lock, 'waitLock');
  wrap(lock, 'releaseLock');
  wrap(folder, 'getFilesByName');
  wrap(folder, 'createFile', (file) => { wrap(file, 'setDescription'); return file; });
  assert.equal(put().ok, true);
  assert.deepEqual(events, ['waitLock', 'getFilesByName', 'createFile', 'setDescription', 'releaseLock']);
  events.length = 0;
  assert.equal(put().existed, true);
  assert.deepEqual(events, ['waitLock', 'getFilesByName', 'releaseLock']);
});

test('ロックを取れなければ server で、ファイルを作らない', () => {
  const { put, fakes } = setup();
  fakes.DriveApp.getRootFolder().createFolder(FOLDER_NAME);
  fakes.LockService.getScriptLock().waitLock = () => { throw new Error('ロックを取れない'); };
  assert.deepEqual(put(), { ok: false, error: 'server' });
  assert.equal(fakes.files.length, 0);
});

test('説明の設定に失敗したらゴミ箱に入れ、ロックを外して server', () => {
  const { put, fakes } = setup();
  const folder = fakes.DriveApp.getRootFolder().createFolder(FOLDER_NAME);
  const original = folder.createFile;
  folder.createFile = (blob) => {
    const file = original(blob);
    file.setDescription = () => { throw new Error('説明を書けない'); };
    return file;
  };
  let releases = 0;
  fakes.LockService.getScriptLock().releaseLock = () => { releases++; };
  assert.deepEqual(put(), { ok: false, error: 'server' });
  assert.equal(fakes.files.length, 1);
  assert.equal(fakes.files[0].isTrashed(), true);
  assert.equal(releases, 1);
});

test('putMaterial は key・mime・name・base64 の不正を bad にする', () => {
  const { put, fakes } = setup();
  const invalid = [
    ...['a', 'a'.repeat(65), 'abc_defgh', 'abcdefgh\n', 123, undefined].map((key) => ({ key })),
    ...['image/png', undefined].map((mime) => ({ mime })),
    ...['', 'a'.repeat(81), '板\n書', '板\r書', '板\u2028書', '板\u2029書', 123, undefined].map((name) => ({ name })),
    ...['', '***', 'A', 123, undefined].map((dataB64) => ({ dataB64 })),
  ];
  for (const value of invalid) assert.deepEqual(put(value), bad);
  assert.equal(fakes.files.length, 0);
  assert.equal(put({ key: 'a'.repeat(64), name: 'あ'.repeat(80) }).ok, true);
});

test('画像と PDF はそれぞれの文字数上限をこえたら toobig', () => {
  const { put, fakes } = setup();
  for (const [mime, max] of [['image/jpeg', 1400000], ['application/pdf', 14000000]]) {
    assert.deepEqual(put({ mime, dataB64: 'A'.repeat(max + 1) }), { ok: false, error: 'toobig' });
  }
  assert.equal(fakes.files.length, 0);
});

test('画像の文字数が上限ちょうどなら保存できる', () => {
  const { put } = setup();
  const result = put({ dataB64: 'A'.repeat(1400000) });
  assert.equal(result.ok, true);
  assert.equal(result.bytes, 1050000);
});

test('その組の生徒と先生は、データベースで指定された画像を取り出せる', () => {
  const { put, get, link, reads, fakes } = setup();
  const result = put();
  link('imageA', result.id);
  const expected = { ok: true, files: { imageA: { mime: 'image/jpeg', dataB64: PHOTO } }, missing: [] };
  assert.deepEqual(get({ fileId: 'untrusted-file' }), expected);
  assert.deepEqual(get({ token: tokT }), expected);
  assert.deepEqual(reads.slice(-1), [{ path: 'lessons/classA/lessonA/materials', uid: 'uidT' }]);
  assert.equal(fakes.fetched.includes(`${DATABASE_URL}/lessons/classA/lessonA/materials.json?auth=${tokS}`), true);
});

test('入っていない組では getMaterials と getFile が notfound、Drive は一度も読まない', () => {
  const { put, get, getFile, link, fakes } = setup();
  link('imageA', put().id);
  const ids = countDriveReads(fakes);
  assert.deepEqual(get({ token: tokOther }), notfound);
  assert.deepEqual(getFile({ token: tokOther }), notfound);
  assert.deepEqual(ids, []);
});

test('本人確認を覚えていても資料は毎回読み、所属が外れたら Drive を読まない', () => {
  const { put, get, link, state, fakes } = setup();
  link('imageA', put().id);
  assert.equal(get().ok, true);
  const count = fakes.fetched.length;
  assert.equal(get().ok, true);
  assert.equal(fakes.fetched.length, count + 1);
  assert.equal(fakes.fetched.at(-1).startsWith(`${DATABASE_URL}/lessons/classA/lessonA/materials.json?`), true);
  delete state.memberOf['s26-001'].classA;
  const ids = countDriveReads(fakes);
  assert.deepEqual(get(), notfound);
  assert.equal(fakes.fetched.length, count + 2);
  assert.deepEqual(ids, []);
});

test('getMaterials は PDF と見つからない資料を missing にする', () => {
  const { put, get, link, fakes } = setup();
  link('pdfA', put({ mime: 'application/pdf', dataB64: PDF }).id, { type: 'pdf' });
  const ids = countDriveReads(fakes);
  assert.deepEqual(get({ ids: ['pdfA', 'unknown'] }), { ok: true, files: {}, missing: ['pdfA', 'unknown'] });
  assert.deepEqual(ids, []);
});

test('フォルダ外・ゴミ箱・説明の違うファイルは missing で、getFile は notfound', () => {
  const { put, get, getFile, link, fakes } = setup();
  link('trashed', put().id);
  fakes.files[0].setTrashed(true);
  link('wrong', put({ key: 'material-0002' }).id);
  fakes.files[1].setDescription('student');
  const outside = fakes.DriveApp.createFile(fakes.Utilities.newBlob([1], 'image/jpeg', '外の資料'));
  outside.setDescription('teacher');
  link('outside', outside.getId());
  const requested = ['outside', 'trashed', 'wrong'];
  assert.deepEqual(get({ ids: requested }), { ok: true, files: {}, missing: requested });
  for (const materialId of requested) assert.deepEqual(getFile({ materialId }), notfound);
});

test('存在しない・形の違う fileId は返さず、不正な fileId で Drive を呼ばない', () => {
  const { get, getFile, link, fakes } = setup();
  const ids = countDriveReads(fakes);
  for (const fileId of [undefined, 123, '../file', 'a'.repeat(201), 'file\n']) {
    link('imageA', fileId);
    assert.deepEqual(get(), { ok: true, files: {}, missing: ['imageA'] });
    assert.deepEqual(getFile(), notfound);
  }
  assert.deepEqual(ids, []);
  fakes.DriveApp.getRootFolder().createFolder(FOLDER_NAME);
  link('imageA', 'missing-file');
  assert.deepEqual(get(), { ok: true, files: {}, missing: ['imageA'] });
  assert.deepEqual(getFile(), notfound);
});

test('取り出しの ID と ids の形が違えば bad で、資料も Drive も読まない', () => {
  const { get, getFile, reads, fakes } = setup();
  const ids = countDriveReads(fakes);
  for (const value of [[], Array(13).fill('imageA'), 'imageA', [123], ['a_b'], ['imageA\n'], undefined]) {
    assert.deepEqual(get({ ids: value }), bad);
  }
  for (const field of ['classId', 'lessonId']) {
    for (const value of ['', 'a/b', 'a'.repeat(41), 123, undefined]) {
      assert.deepEqual(get({ [field]: value }), bad);
      assert.deepEqual(getFile({ [field]: value }), bad);
    }
  }
  for (const value of ['', 'a-b', 'a'.repeat(41), 123, undefined]) {
    assert.deepEqual(getFile({ materialId: value }), bad);
  }
  assert.equal(reads.some(({ path }) => path.startsWith('lessons/')), false);
  assert.deepEqual(ids, []);
});

test('12 個の資料をまとめて取り出せる', () => {
  const { put, get, link } = setup();
  const fileId = put().id;
  const ids = Array.from({ length: 12 }, (_, i) => `image${i}`);
  for (const id of ids) link(id, fileId);
  const result = get({ ids });
  assert.equal(result.ok, true);
  assert.deepEqual(result.missing, []);
  assert.deepEqual(Object.keys(result.files), ids);
});

test('合計 6000000 文字までは返し、こえる資料と残りは missing にする', () => {
  const { put, get, link, fakes } = setup();
  const dataB64 = 'A'.repeat(1000000);
  const fileId = put({ dataB64 }).id;
  const requested = Array.from({ length: 7 }, (_, i) => `image${i}`);
  for (const id of requested) link(id, fileId);
  link('small', put({ key: 'material-small' }).id);
  const ids = countDriveReads(fakes);
  const result = get({ ids: [...requested, 'small'] });
  assert.equal(result.ok, true);
  assert.deepEqual(Object.keys(result.files), requested.slice(0, 6));
  assert.equal(Object.values(result.files).reduce((sum, file) => sum + file.dataB64.length, 0), 6000000);
  assert.deepEqual(result.missing, ['image6', 'small']);
  assert.equal(ids.includes(fakes.files[1].getId()), false);
});

test('getFile は PDF の mime と本体、データベースの名前を返す', () => {
  const { put, getFile, link } = setup();
  const result = put({ mime: 'application/pdf', name: '保存時の名前', dataB64: PDF });
  assert.equal(result.bytes, Buffer.from(PDF, 'base64').length);
  link('pdfA', result.id, { type: 'pdf', name: '配布資料.pdf' });
  assert.deepEqual(getFile({ materialId: 'pdfA', fileId: 'untrusted-file' }), {
    ok: true, mime: 'application/pdf', name: '配布資料.pdf', dataB64: PDF,
  });
});

test('getFile はデータベースに無い資料や授業を notfound にする', () => {
  const { getFile, fakes } = setup();
  const ids = countDriveReads(fakes);
  assert.deepEqual(getFile(), notfound);
  assert.deepEqual(getFile({ lessonId: 'unknown' }), notfound);
  assert.deepEqual(ids, []);
});

test('資料を読む HTTP の結果が 200 でなければ notfound で、Drive を読まない', () => {
  const { call, get, getFile, fakes } = setup();
  call({ op: 'whoami', token: tokS });
  const ids = countDriveReads(fakes);
  for (const status of [401, 403, 404, 500]) {
    fakes.UrlFetchApp.fetch = () => ({ getResponseCode: () => status, getContentText: () => '{}' });
    assert.deepEqual(get(), notfound);
    assert.deepEqual(getFile(), notfound);
  }
  assert.deepEqual(ids, []);
});

test('trashFile は生徒を断り、先生は削除でき、再送は trashed: false', () => {
  const { put, call, fakes } = setup();
  const { id: fileId } = put();
  const body = { op: 'trashFile', token: tokT, fileId };
  assert.deepEqual(call({ ...body, token: tokS }), { ok: false, error: 'denied' });
  assert.equal(fakes.files[0].isTrashed(), false);
  assert.deepEqual(call(body), { ok: true, trashed: true });
  assert.equal(fakes.files[0].isTrashed(), true);
  assert.deepEqual(call(body), { ok: true, trashed: false });
});

test('trashFile はフォルダ外・説明が違う・無いファイルを消さない', () => {
  const { put, call, fakes } = setup();
  put();
  fakes.files[0].setDescription('student');
  const outside = fakes.DriveApp.createFile(fakes.Utilities.newBlob([1], 'image/jpeg', '外の資料'));
  outside.setDescription('teacher');
  for (const fileId of [outside.getId(), fakes.files[0].getId(), 'missing-file']) {
    assert.deepEqual(call({ op: 'trashFile', token: tokT, fileId }), { ok: true, trashed: false });
  }
  assert.equal(fakes.files.every((file) => !file.isTrashed()), true);
});

test('trashFile は fileId の形を確かめる', () => {
  const { call, fakes } = setup();
  const ids = countDriveReads(fakes);
  for (const fileId of ['', '../x', 'a'.repeat(201), 'file\n', 123, undefined]) {
    assert.deepEqual(call({ op: 'trashFile', token: tokT, fileId }), bad);
  }
  assert.deepEqual(ids, []);
});

test('DATABASE_URL が空なら ping と doGet のほかは config', () => {
  for (const databaseURL of [undefined, '', '   ']) {
    const { call, gas, fakes } = setup({ databaseURL });
    for (const op of ['whoami', 'putMaterial', 'getMaterials', 'getFile', 'trashFile']) {
      assert.deepEqual(call({ op, token: tokT }), { ok: false, error: 'config' });
    }
    assert.deepEqual(call({ op: 'ping' }), { ok: true, version: 'app-1' });
    assert.deepEqual(JSON.parse(gas.doGet().getContent()), { ok: true, version: 'app-1' });
    assert.equal(fakes.fetched.length, 0);
    assert.equal(fakes.files.length, 0);
  }
});

test('JSON でない本文・配列・知らない op は bad', () => {
  const { call, gas } = setup();
  for (const body of ['<html>', 'null', '123', '[]', {}, { op: 'unknown' }]) assert.deepEqual(call(body), bad);
  for (const event of [undefined, {}, { postData: {} }]) {
    assert.deepEqual(JSON.parse(gas.doPost(event).getContent()), bad);
  }
});

test('例外は server にし、元のエラー文を返さない', () => {
  const { call, fakes } = setup();
  fakes.UrlFetchApp.fetch = () => { throw new Error('外へ出さないエラーの詳細'); };
  assert.deepEqual(call({ op: 'whoami', token: tokT }), { ok: false, error: 'server' });
});

test('本番用 Code.gs はモジュール読み込みと共有設定とログ出力を使わない', () => {
  const src = readFileSync(CODE, 'utf8');
  assert.doesNotMatch(src, /^\s*(import|export)\s/m);
  assert.doesNotMatch(src, /\brequire\s*\(/);
  assert.doesNotMatch(src, /setSharing|addViewer|addEditor|setAccess/);
  assert.doesNotMatch(src, /\b(console|Logger)\s*\./);
});
