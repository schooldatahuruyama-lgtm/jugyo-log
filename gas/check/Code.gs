/**
 * 授業ログ 段階 0（接続確認）用の GAS ウェブアプリ
 *
 * 確認ページ（check.html）から呼ばれ、先生の Drive に確認用の写真を保存し、取り出す。
 * 呼んだ人が本人かどうかは、Firebase の ID トークンで Realtime Database を読めるかで確かめる。
 * ファイルの共有の設定は変えない（開けるのは、この GAS を通したときだけ）。
 *
 * 貼り方と公開のしかたは、リポジトリの docs/setup/gas.md にある。
 * スクリプト プロパティ DATABASE_URL に、Firebase のデータベースの URL を入れておくこと。
 */

var VERSION = 'check-1';
var FOLDER_NAME = '授業ログ_接続確認';
var MAX_B64 = 1400000; // dataB64 の文字数の上限
var AUTH_CACHE_SECONDS = 60; // 本人確認の結果を覚えておく秒数

var KEY_RE = /^[A-Za-z0-9-]{8,64}$/;
var ID_RE = /^[A-Za-z0-9_-]{1,200}$/;
// トークンは base64url の 3 つの部分。& や ? などを含むものは URL に入れない
var TOKEN_RE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
// uid は URL の道筋とファイル名に入るので、/ . ? などを含むものは受け付けない
var UID_RE = /^[A-Za-z0-9_-]{1,128}$/;

function doGet() {
  return reply_({ ok: true, version: VERSION });
}

function doPost(e) {
  try {
    return reply_(handle_(e));
  } catch (err) {
    return reply_({ ok: false, error: 'server' });
  }
}

// ---- 中身 ----

function fail_(code) {
  return { ok: false, error: code };
}

function reply_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function handle_(e) {
  var req;
  try {
    req = JSON.parse(e.postData.contents);
  } catch (err) {
    return fail_('bad');
  }
  if (!req || typeof req !== 'object' || Array.isArray(req)) return fail_('bad');

  var op = req.op;
  if (op === 'ping') return { ok: true, version: VERSION };
  if (op !== 'put' && op !== 'get' && op !== 'quota' && op !== 'cleanup') return fail_('bad');

  var uid = verify_(req.token);
  if (!uid) return fail_('auth');

  if (op === 'put') return put_(uid, req);
  if (op === 'get') return get_(uid, req);
  if (op === 'quota') return { ok: true, limit: DriveApp.getStorageLimit(), used: DriveApp.getStorageUsed() };
  return cleanup_(uid);
}

// ---- 本人確認 ----

// トークンから uid を取り出し、Firebase に問い合わせて本人なら uid を、そうでなければ null を返す
function verify_(token) {
  if (typeof token !== 'string' || token.length > 4096 || !TOKEN_RE.test(token)) return null;
  var uid = uidFromToken_(token);
  if (!uid) return null;

  var cache = CacheService.getScriptCache();
  var cacheKey = 'auth_' + Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, token));
  var cached = cache.get(cacheKey);
  if (cached !== null && cached !== undefined) return cached === uid ? uid : null;

  var base = PropertiesService.getScriptProperties().getProperty('DATABASE_URL');
  if (!base) throw new Error('DATABASE_URL がスクリプト プロパティにありません');
  base = String(base).replace(/\/+$/, '');

  var res = UrlFetchApp.fetch(base + '/check/' + uid + '.json?auth=' + token, { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) return null;

  cache.put(cacheKey, uid, AUTH_CACHE_SECONDS);
  return uid;
}

// JWT の 2 番目の部分を base64url として読み、user_id を返す（署名はここでは確かめない。Firebase が確かめる）
function uidFromToken_(token) {
  try {
    var part = token.split('.')[1];
    while (part.length % 4 !== 0) part += '=';
    var text = Utilities.newBlob(Utilities.base64DecodeWebSafe(part)).getDataAsString();
    var payload = JSON.parse(text);
    var uid = payload && payload.user_id;
    if (typeof uid !== 'string' || !UID_RE.test(uid)) return null;
    return uid;
  } catch (err) {
    return null;
  }
}

// ---- Drive ----

// Drive の直下の「授業ログ_接続確認」フォルダを返す。無ければ、ロックをかけて 1 つだけ作る
function folder_() {
  var found = findFolder_();
  if (found) return found;
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    found = findFolder_();
    if (found) return found;
    return DriveApp.getRootFolder().createFolder(FOLDER_NAME);
  } finally {
    lock.releaseLock();
  }
}

// ほかの人が共有してきた同じ名前のフォルダを使わないよう、直下だけを探す
function findFolder_() {
  var it = DriveApp.getRootFolder().getFoldersByName(FOLDER_NAME);
  return it.hasNext() ? it.next() : null;
}

function isInFolder_(file, folder) {
  var parents = file.getParents();
  var id = folder.getId();
  while (parents.hasNext()) {
    if (parents.next().getId() === id) return true;
  }
  return false;
}

function isMine_(file, uid) {
  return !file.isTrashed() && file.getDescription() === uid;
}

function put_(uid, req) {
  if (typeof req.key !== 'string' || !KEY_RE.test(req.key)) return fail_('bad');
  if (req.mime !== 'image/jpeg') return fail_('bad');
  if (typeof req.dataB64 !== 'string' || req.dataB64.length === 0) return fail_('bad');
  if (req.dataB64.length > MAX_B64) return fail_('toobig');

  var bytes;
  try {
    bytes = Utilities.base64Decode(req.dataB64);
  } catch (err) {
    return fail_('bad');
  }
  if (!bytes || bytes.length === 0) return fail_('bad');

  // フォルダは先に用意する（folder_ の中でもロックを使うので、下のロックと重ねない）
  var folder = folder_();
  var name = uid + '_' + req.key;

  // 同じ key の put が同時に来ても 1 個になるよう、検索から作成・説明の設定までをロックで守る
  // （waitLock が取れずに例外になったときは、doPost の catch で server になる）
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var it = folder.getFilesByName(name);
    while (it.hasNext()) {
      var f = it.next();
      if (isMine_(f, uid)) return { ok: true, id: f.getId(), existed: true };
    }

    var file = folder.createFile(Utilities.newBlob(bytes, 'image/jpeg', name));
    try {
      file.setDescription(uid);
    } catch (err) {
      // 持ち主の説明がないファイルを残さない
      try {
        file.setTrashed(true);
      } catch (ignored) {}
      throw err;
    }
    return { ok: true, id: file.getId(), existed: false };
  } finally {
    lock.releaseLock();
  }
}

function get_(uid, req) {
  if (typeof req.id !== 'string' || !ID_RE.test(req.id)) return fail_('bad');
  var folder = folder_();
  var file;
  try {
    file = DriveApp.getFileById(req.id);
  } catch (err) {
    return fail_('notfound');
  }
  if (!isInFolder_(file, folder) || !isMine_(file, uid)) return fail_('notfound');
  var blob = file.getBlob();
  return { ok: true, mime: blob.getContentType(), dataB64: Utilities.base64Encode(blob.getBytes()) };
}

function cleanup_(uid) {
  var folder = folder_();
  var it = folder.getFiles();
  var removed = 0;
  while (it.hasNext()) {
    var f = it.next();
    if (isMine_(f, uid)) {
      f.setTrashed(true);
      removed++;
    }
  }
  return { ok: true, removed: removed };
}
