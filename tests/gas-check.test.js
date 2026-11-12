// 確認用の GAS（gas/check/Code.gs）の決まりを、代役の Apps Script の中で確かめる
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadGas, makeFakes } from './helpers/gas-sandbox.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const CODE = join(root, 'gas/check/Code.gs');

// ペイロードに user_id を入れた、JWT の形のテスト用の文字列
const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
const jwt = (payload) => `${b64url({ alg: 'RS256' })}.${b64url(payload)}.c2lnbmF0dXJl`;
const tokA = jwt({ user_id: 'uidA', sub: 'uidA' });
const tokB = jwt({ user_id: 'uidB', sub: 'uidB' });

const PHOTO = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x80, 0x7f, 0xfe, 0x01]).toString('base64');

function setup() {
  const fakes = makeFakes({ databaseURL: 'https://db.example', validTokens: { [tokA]: 'uidA', [tokB]: 'uidB' } });
  const gas = loadGas(CODE, fakes);
  const call = (body) => {
    const out = gas.doPost({ postData: { contents: typeof body === 'string' ? body : JSON.stringify(body) } });
    assert.equal(out.getMimeType(), fakes.ContentService.MimeType.JSON);
    return JSON.parse(out.getContent());
  };
  const put = (token, key) => call({ op: 'put', token, key, mime: 'image/jpeg', dataB64: PHOTO });
  return { fakes, gas, call, put };
}

test('ping はトークンなしで返る', () => {
  const { call } = setup();
  assert.deepEqual(call({ op: 'ping' }), { ok: true, version: 'check-1' });
});

test('doGet は公開できたかを見るための返事を返す', () => {
  const { fakes, gas } = setup();
  const out = gas.doGet({});
  assert.equal(out.getMimeType(), fakes.ContentService.MimeType.JSON);
  assert.deepEqual(JSON.parse(out.getContent()), { ok: true, version: 'check-1' });
});

test('put したものを get で取り出せる', () => {
  const { call, put, fakes } = setup();
  const r = put(tokA, 'photo-0001');
  assert.equal(r.ok, true);
  assert.equal(r.existed, false);
  assert.equal(typeof r.id, 'string');
  const g = call({ op: 'get', token: tokA, id: r.id });
  assert.deepEqual(g, { ok: true, mime: 'image/jpeg', dataB64: PHOTO });
  // 保存先と名前と持ち主の決まり
  const f = fakes.files[0];
  assert.equal(f.getName(), 'uidA_photo-0001');
  assert.equal(f.getDescription(), 'uidA');
  const parent = f.getParents().next();
  assert.equal(parent.getName(), '授業ログ_接続確認');
  assert.equal(parent.getParents().next(), fakes.DriveApp.getRootFolder());
});

test('同じ key で 2 回 put してもファイルは 1 個', () => {
  const { put, fakes } = setup();
  const r1 = put(tokA, 'photo-0001');
  const r2 = put(tokA, 'photo-0001');
  assert.equal(r1.existed, false);
  assert.equal(r2.ok, true);
  assert.equal(r2.existed, true);
  assert.equal(r2.id, r1.id);
  assert.equal(fakes.files.length, 1);
});

test('同じ key でも、ほかの人のものとは別のファイルになる', () => {
  const { put, fakes } = setup();
  const a = put(tokA, 'photo-0001');
  const b = put(tokB, 'photo-0001');
  assert.equal(b.existed, false);
  assert.notEqual(a.id, b.id);
  assert.equal(fakes.files.length, 2);
});

test('put は、既存の検索から作成・説明の設定までをロックの中で行う', () => {
  const { put, fakes } = setup();
  put(tokB, 'photo-0000'); // フォルダを作らせておく
  const folder = fakes.files[0].getParents().next();
  const lock = fakes.LockService.getScriptLock();
  const events = [];
  const wrap = (obj, name, fn) => {
    const orig = obj[name];
    obj[name] = (...args) => {
      events.push(name);
      const r = orig(...args);
      return fn ? fn(r) : r;
    };
  };
  wrap(lock, 'waitLock');
  wrap(lock, 'releaseLock');
  wrap(folder, 'getFilesByName');
  wrap(folder, 'createFile', (file) => {
    wrap(file, 'setDescription');
    return file;
  });
  assert.equal(put(tokA, 'photo-0001').ok, true);
  assert.deepEqual(events, ['waitLock', 'getFilesByName', 'createFile', 'setDescription', 'releaseLock']);
  // すでにあるときも、検索はロックの中で、ロックは外される
  events.length = 0;
  assert.equal(put(tokA, 'photo-0001').existed, true);
  assert.deepEqual(events, ['waitLock', 'getFilesByName', 'releaseLock']);
});

test('put でロックを取れないときは server で、ファイルを作らない', () => {
  const { put, fakes } = setup();
  put(tokB, 'photo-0000'); // フォルダを作らせておく
  const lock = fakes.LockService.getScriptLock();
  let released = 0;
  lock.waitLock = () => {
    throw new Error('Lock timeout');
  };
  lock.releaseLock = () => {
    released++;
  };
  assert.deepEqual(put(tokA, 'photo-0001'), { ok: false, error: 'server' });
  assert.equal(fakes.files.length, 1);
  assert.equal(released, 0);
});

test('説明の設定に失敗したら、作ったファイルをゴミ箱に入れて server', () => {
  const { put, fakes } = setup();
  put(tokB, 'photo-0000'); // フォルダを作らせておく
  const folder = fakes.files[0].getParents().next();
  const lock = fakes.LockService.getScriptLock();
  let released = 0;
  const origRelease = lock.releaseLock;
  lock.releaseLock = () => {
    released++;
    return origRelease();
  };
  const origCreate = folder.createFile;
  folder.createFile = (blob) => {
    const file = origCreate(blob);
    file.setDescription = () => {
      throw new Error('説明を書けない');
    };
    return file;
  };
  assert.deepEqual(put(tokA, 'photo-0001'), { ok: false, error: 'server' });
  const left = fakes.files.filter((f) => !f.isTrashed());
  assert.equal(left.length, 1);
  assert.equal(left[0].getDescription(), 'uidB');
  assert.equal(fakes.files.length, 2);
  assert.equal(fakes.files[1].isTrashed(), true);
  assert.equal(released, 1);
});

test('保存用のフォルダは 1 つだけ作られる', () => {
  const { put, fakes } = setup();
  put(tokA, 'photo-0001');
  put(tokB, 'photo-0002');
  const it = fakes.DriveApp.getFoldersByName('授業ログ_接続確認');
  let n = 0;
  while (it.hasNext()) {
    it.next();
    n++;
  }
  assert.equal(n, 1);
});

test('直下でない同じ名前のフォルダには保存しない', () => {
  const { put, fakes } = setup();
  // 共有されてきたフォルダの代わり（Drive の直下ではない所にある、同じ名前のフォルダ）
  const other = fakes.DriveApp.getRootFolder().createFolder('ほかの人から').createFolder('授業ログ_接続確認');
  put(tokA, 'photo-0001');
  const parent = fakes.files[0].getParents().next();
  assert.notEqual(parent, other);
  assert.equal(parent.getParents().next(), fakes.DriveApp.getRootFolder());
});

test('ほかの人のファイルは get できない', () => {
  const { call, put } = setup();
  const r = put(tokA, 'photo-0001');
  assert.deepEqual(call({ op: 'get', token: tokB, id: r.id }), { ok: false, error: 'notfound' });
});

test('フォルダの外のファイルは get できない', () => {
  const { call, put, fakes } = setup();
  put(tokA, 'photo-0001'); // フォルダを作らせておく
  const outside = fakes.DriveApp.createFile(fakes.Utilities.newBlob(fakes.Utilities.base64Decode(PHOTO), 'image/jpeg', 'uidA_photo-0002'));
  outside.setDescription('uidA'); // 説明が本人と同じでも、フォルダの外なら断る
  assert.deepEqual(call({ op: 'get', token: tokA, id: outside.getId() }), { ok: false, error: 'notfound' });
});

test('無い id は notfound、形のおかしい id は bad', () => {
  const { call } = setup();
  assert.deepEqual(call({ op: 'get', token: tokA, id: 'nothing-here' }), { ok: false, error: 'notfound' });
  assert.deepEqual(call({ op: 'get', token: tokA, id: '../x' }), { ok: false, error: 'bad' });
  assert.deepEqual(call({ op: 'get', token: tokA }), { ok: false, error: 'bad' });
});

test('にせもののトークンは断る', () => {
  const { call, put, fakes } = setup();
  const r = put(tokA, 'photo-0001');
  const fake = jwt({ user_id: 'uidA', sub: 'uidA', x: 1 });
  const auth = { ok: false, error: 'auth' };
  assert.deepEqual(put(fake, 'photo-0002'), auth);
  assert.deepEqual(call({ op: 'get', token: fake, id: r.id }), auth);
  assert.deepEqual(call({ op: 'quota', token: fake }), auth);
  assert.deepEqual(call({ op: 'cleanup', token: fake }), auth);
  assert.equal(fakes.files.length, 1);
  assert.equal(fakes.files[0].isTrashed(), false);
});

test('トークンの中の user_id を書きかえても、ほかの人にはなれない', () => {
  const { call, put } = setup();
  const r = put(tokA, 'photo-0001');
  // tokB の署名部分のまま、ペイロードだけ uidA にしたもの（Firebase が断る）
  const [h, , s] = tokB.split('.');
  const forged = `${h}.${b64url({ user_id: 'uidA' })}.${s}`;
  assert.deepEqual(call({ op: 'get', token: forged, id: r.id }), { ok: false, error: 'auth' });
});

test('トークンの形がこわれていても例外にならない', () => {
  const { call } = setup();
  const auth = { ok: false, error: 'auth' };
  assert.deepEqual(call({ op: 'quota', token: 'abc' }), auth);
  assert.deepEqual(call({ op: 'quota', token: 123 }), auth);
  assert.deepEqual(call({ op: 'quota' }), auth);
  assert.deepEqual(call({ op: 'quota', token: 'a.!!!.c' }), auth);
  assert.deepEqual(call({ op: 'quota', token: `${b64url({ alg: 'x' })}.${Buffer.from('not json').toString('base64url')}.c` }), auth);
  assert.deepEqual(call({ op: 'quota', token: jwt({ sub: 'uidA' }) }), auth);
  assert.deepEqual(call({ op: 'quota', token: jwt({ user_id: 123 }) }), auth);
});

test('user_id に / や . や ? があるトークンは、問い合わせずに断る', () => {
  const { call, fakes } = setup();
  for (const uid of ['uidB/../uidA', 'uidA.json?x=', 'uidA?a', '..', 'a/b', '', 'a b', 'uidA#x']) {
    assert.deepEqual(call({ op: 'quota', token: jwt({ user_id: uid }) }), { ok: false, error: 'auth' }, uid);
  }
  // トークン自体に & などが入っていても、URL の形を変えさせない
  assert.deepEqual(call({ op: 'quota', token: `${tokA}&x=1` }), { ok: false, error: 'auth' });
  assert.equal(fakes.fetched.length, 0);
});

test('本人確認の問い合わせの URL は決まりどおり', () => {
  const { call, fakes } = setup();
  call({ op: 'quota', token: tokA });
  assert.deepEqual(fakes.fetched, [`https://db.example/check/uidA.json?auth=${tokA}`]);
});

test('本人確認は 60 秒の間、問い合わせ直さない', () => {
  const { call, fakes } = setup();
  assert.equal(call({ op: 'quota', token: tokA }).ok, true);
  assert.equal(call({ op: 'quota', token: tokA }).ok, true);
  assert.equal(fakes.fetched.length, 1);
});

test('本人確認を覚えておくのは 60 秒だけ', () => {
  const { call, fakes } = setup();
  const cache = fakes.CacheService.getScriptCache();
  const seen = [];
  const orig = cache.put;
  cache.put = (k, v, s) => {
    seen.push(s);
    return orig(k, v, s);
  };
  call({ op: 'quota', token: tokA });
  assert.deepEqual(seen, [60]);
});

test('key の形が正しくないと断る', () => {
  const { put, fakes } = setup();
  for (const key of ['a', '../x', 'x'.repeat(65), 'abc_defgh', 'abcdefg', 123, undefined]) {
    assert.deepEqual(put(tokA, key), { ok: false, error: 'bad' }, String(key));
  }
  assert.equal(put(tokA, 'x'.repeat(64)).ok, true);
  assert.equal(put(tokA, 'abcd-123').ok, true);
  assert.equal(fakes.files.length, 2);
});

test('mime と dataB64 が正しくないと断る', () => {
  const { call } = setup();
  const base = { op: 'put', token: tokA, key: 'photo-0001' };
  const bad = { ok: false, error: 'bad' };
  assert.deepEqual(call({ ...base, mime: 'image/png', dataB64: PHOTO }), bad);
  assert.deepEqual(call({ ...base, dataB64: PHOTO }), bad);
  assert.deepEqual(call({ ...base, mime: 'image/jpeg' }), bad);
  assert.deepEqual(call({ ...base, mime: 'image/jpeg', dataB64: '' }), bad);
  assert.deepEqual(call({ ...base, mime: 'image/jpeg', dataB64: '***' }), bad);
});

test('大きすぎるデータは断る', () => {
  const { call, fakes } = setup();
  const r = call({ op: 'put', token: tokA, key: 'photo-0001', mime: 'image/jpeg', dataB64: 'A'.repeat(1400001) });
  assert.deepEqual(r, { ok: false, error: 'toobig' });
  assert.equal(fakes.files.length, 0);
});

test('JSON でない本文は bad', () => {
  const { call, gas } = setup();
  assert.deepEqual(call('<html>'), { ok: false, error: 'bad' });
  assert.deepEqual(call('null'), { ok: false, error: 'bad' });
  assert.deepEqual(call({ op: 'nothing' }), { ok: false, error: 'bad' });
  for (const e of [undefined, {}, { postData: {} }]) {
    assert.deepEqual(JSON.parse(gas.doPost(e).getContent()), { ok: false, error: 'bad' });
  }
});

test('cleanup は自分のファイルだけをゴミ箱に入れる', () => {
  const { call, put, fakes } = setup();
  const a1 = put(tokA, 'photo-0001');
  const a2 = put(tokA, 'photo-0002');
  const b1 = put(tokB, 'photo-0003');
  assert.deepEqual(call({ op: 'cleanup', token: tokA }), { ok: true, removed: 2 });
  const byId = (id) => fakes.files.find((f) => f.getId() === id);
  assert.equal(byId(a1.id).isTrashed(), true);
  assert.equal(byId(a2.id).isTrashed(), true);
  assert.equal(byId(b1.id).isTrashed(), false);
  // ゴミ箱に入れたものは取り出せず、もう一度 cleanup しても数えない
  assert.deepEqual(call({ op: 'get', token: tokA, id: a1.id }), { ok: false, error: 'notfound' });
  assert.deepEqual(call({ op: 'cleanup', token: tokA }), { ok: true, removed: 0 });
  // B のファイルは今までどおり取り出せる
  assert.equal(call({ op: 'get', token: tokB, id: b1.id }).ok, true);
});

test('cleanup のあとに同じ key で put すると、新しいファイルになる', () => {
  const { call, put } = setup();
  const r1 = put(tokA, 'photo-0001');
  call({ op: 'cleanup', token: tokA });
  const r2 = put(tokA, 'photo-0001');
  assert.equal(r2.existed, false);
  assert.notEqual(r2.id, r1.id);
});

test('quota は数値を返す', () => {
  const { call } = setup();
  const r = call({ op: 'quota', token: tokA });
  assert.equal(r.ok, true);
  assert.equal(typeof r.limit, 'number');
  assert.equal(typeof r.used, 'number');
});

test('中で例外が起きても JSON を返す', () => {
  const { call, fakes } = setup();
  const boom = () => {
    throw new Error('Drive が動かない');
  };
  fakes.DriveApp.getRootFolder = boom;
  fakes.DriveApp.getFoldersByName = boom;
  fakes.DriveApp.createFolder = boom;
  fakes.DriveApp.getFileById = boom;
  fakes.DriveApp.getStorageLimit = boom;
  assert.deepEqual(call({ op: 'put', token: tokA, key: 'photo-0001', mime: 'image/jpeg', dataB64: PHOTO }), { ok: false, error: 'server' });
  assert.deepEqual(call({ op: 'quota', token: tokA }), { ok: false, error: 'server' });
});

test('DATABASE_URL が無いときは server', () => {
  const fakes = makeFakes({ databaseURL: undefined, validTokens: { [tokA]: 'uidA' } });
  const gas = loadGas(CODE, fakes);
  const out = gas.doPost({ postData: { contents: JSON.stringify({ op: 'quota', token: tokA }) } });
  assert.deepEqual(JSON.parse(out.getContent()), { ok: false, error: 'server' });
});

test('Code.gs は import・export・require を使わない', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(CODE, 'utf8');
  assert.doesNotMatch(src, /^\s*(import|export)\s/m);
  assert.doesNotMatch(src, /\brequire\s*\(/);
  // 共有の設定は変えない
  assert.doesNotMatch(src, /setSharing|addViewer|addEditor|setAccess/);
});
