/**
 * 授業ログ 本番用の GAS ウェブアプリ
 *
 * 先生の資料を Drive に保存し、呼んだ人が読める授業の資料だけを取り出す。
 * 本人確認と授業の読み取りには、呼んだ人の Firebase ID トークンを使う。
 * ファイルの共有の設定は変えない。公開の手順は docs/setup/gas.md にある。
 * スクリプト プロパティ DATABASE_URL に、データベースの URL を入れておくこと。
 */

var VERSION = 'app-1';
var FOLDER_NAME = '授業ログ_資料';
var IMAGE_MAX_B64 = 1400000;
var PDF_MAX_B64 = 14000000;
var TOTAL_MAX_B64 = 6000000;
var AUTH_CACHE_SECONDS = 60;

var KEY_RE = /^[A-Za-z0-9-]{8,64}$/;
var ID_RE = /^[A-Za-z0-9_-]{1,200}$/;
var MATERIAL_ID_RE = /^[A-Za-z0-9]{1,40}$/;
var STUDENT_ID_RE = /^s\d{2}-\d{3}$/;
var TOKEN_RE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
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

// $ は最後の改行の直前にも合うため、文字列全体が合ったことまで確かめる
function matches_(value, pattern) {
  if (typeof value !== 'string') return false;
  var match = value.match(pattern);
  return match !== null && match[0] === value;
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
  if (op !== 'whoami' && op !== 'putMaterial' && op !== 'getMaterials' && op !== 'getFile' && op !== 'trashFile') {
    return fail_('bad');
  }

  var base = databaseUrl_();
  if (!base) return fail_('config');
  var user = verify_(req.token, base);
  if (!user) return fail_('auth');

  if (op === 'whoami') {
    if (user.role === 'teacher') return { ok: true, role: 'teacher' };
    return { ok: true, role: 'student', studentId: user.studentId };
  }
  if (op === 'putMaterial' || op === 'trashFile') {
    if (user.role !== 'teacher') return fail_('denied');
    return op === 'putMaterial' ? putMaterial_(req) : trashFile_(req);
  }
  return op === 'getMaterials' ? getMaterials_(req, base) : getFile_(req, base);
}

// ---- 本人確認 ----

function databaseUrl_() {
  var base = PropertiesService.getScriptProperties().getProperty('DATABASE_URL');
  if (!base) return '';
  return String(base).trim().replace(/\/+$/, '');
}

function verify_(token, base) {
  if (typeof token !== 'string' || token.length > 4096 || !matches_(token, TOKEN_RE)) return null;
  var uid = uidFromToken_(token);
  if (!uid) return null;

  var cache = CacheService.getScriptCache();
  var cacheKey = 'auth_' + Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, token));
  var cached = cache.get(cacheKey);
  if (cached === 't') return { role: 'teacher' };
  if (typeof cached === 'string' && cached.slice(0, 2) === 's:' && matches_(cached.slice(2), STUDENT_ID_RE)) {
    return { role: 'student', studentId: cached.slice(2) };
  }

  var res = UrlFetchApp.fetch(base + '/teacherList/' + uid + '.json?auth=' + token, { muteHttpExceptions: true });
  if (res.getResponseCode() === 200 && JSON.parse(res.getContentText()) === true) {
    cache.put(cacheKey, 't', AUTH_CACHE_SECONDS);
    return { role: 'teacher' };
  }
  res = UrlFetchApp.fetch(base + '/accounts/' + uid + '.json?auth=' + token, { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) return null;
  var studentId = JSON.parse(res.getContentText());
  if (!matches_(studentId, STUDENT_ID_RE)) return null;
  cache.put(cacheKey, 's:' + studentId, AUTH_CACHE_SECONDS);
  return { role: 'student', studentId: studentId };
}

// 署名は Firebase が確かめる。ここでは URL に使う user_id の形だけを確かめる
function uidFromToken_(token) {
  try {
    var part = token.split('.')[1];
    while (part.length % 4 !== 0) part += '=';
    var text = Utilities.newBlob(Utilities.base64DecodeWebSafe(part)).getDataAsString();
    var payload = JSON.parse(text);
    var uid = payload && payload.user_id;
    return matches_(uid, UID_RE) ? uid : null;
  } catch (err) {
    return null;
  }
}

// ---- Drive ----

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

// 共有された同じ名前のフォルダを使わないよう、Drive の直下だけを探す
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

function isTeacherFile_(file) {
  return !file.isTrashed() && file.getDescription() === 'teacher';
}

function findFile_(fileId, folder) {
  if (!folder || !matches_(fileId, ID_RE)) return null;
  var file;
  try {
    file = DriveApp.getFileById(fileId);
  } catch (err) {
    return null;
  }
  return isInFolder_(file, folder) && isTeacherFile_(file) ? file : null;
}

function putMaterial_(req) {
  if (!matches_(req.key, KEY_RE)) return fail_('bad');
  if (req.mime !== 'image/jpeg' && req.mime !== 'application/pdf') return fail_('bad');
  if (typeof req.name !== 'string' || req.name.length < 1 || req.name.length > 80 || /[\r\n\u2028\u2029]/.test(req.name)) {
    return fail_('bad');
  }
  if (typeof req.dataB64 !== 'string' || req.dataB64.length === 0) return fail_('bad');
  var max = req.mime === 'image/jpeg' ? IMAGE_MAX_B64 : PDF_MAX_B64;
  if (req.dataB64.length > max) return fail_('toobig');

  var bytes;
  try {
    bytes = Utilities.base64Decode(req.dataB64);
  } catch (err) {
    return fail_('bad');
  }
  if (!bytes || bytes.length === 0) return fail_('bad');

  // フォルダの作成でもロックを使うので、保存のロックと重ねない
  var folder = folder_();
  var name = 'm_' + req.key;
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var it = folder.getFilesByName(name);
    while (it.hasNext()) {
      var f = it.next();
      if (isTeacherFile_(f)) return { ok: true, id: f.getId(), existed: true, bytes: f.getSize() };
    }

    var file = folder.createFile(Utilities.newBlob(bytes, req.mime, name));
    try {
      file.setDescription('teacher');
    } catch (err) {
      // 説明のないファイルを残さない
      try {
        file.setTrashed(true);
      } catch (ignored) {}
      throw err;
    }
    return { ok: true, id: file.getId(), existed: false, bytes: bytes.length };
  } finally {
    lock.releaseLock();
  }
}

// ---- 資料の取り出し ----

function validLesson_(req) {
  return matches_(req.classId, MATERIAL_ID_RE) && matches_(req.lessonId, MATERIAL_ID_RE);
}

// 本人確認を覚えていても、授業を読めるかどうかは毎回、呼んだ人のトークンで確かめる
function readMaterials_(req, base) {
  var path = '/lessons/' + req.classId + '/' + req.lessonId + '/materials.json?auth=' + req.token;
  var res = UrlFetchApp.fetch(base + path, { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) return null;
  var materials = JSON.parse(res.getContentText());
  return materials && typeof materials === 'object' && !Array.isArray(materials) ? materials : {};
}

function material_(materials, id) {
  return Object.prototype.hasOwnProperty.call(materials, id) ? materials[id] : null;
}

function getMaterials_(req, base) {
  if (!validLesson_(req) || !Array.isArray(req.ids) || req.ids.length < 1 || req.ids.length > 12) return fail_('bad');
  for (var i = 0; i < req.ids.length; i++) {
    if (!matches_(req.ids[i], MATERIAL_ID_RE)) return fail_('bad');
  }
  var materials = readMaterials_(req, base);
  if (materials === null) return fail_('notfound');

  var folder = findFolder_();
  var files = {};
  var missing = [];
  var total = 0;
  for (var j = 0; j < req.ids.length; j++) {
    var id = req.ids[j];
    var material = material_(materials, id);
    var file = material && material.type === 'image' ? findFile_(material.fileId, folder) : null;
    if (!file) {
      missing.push(id);
      continue;
    }
    var blob = file.getBlob();
    var dataB64 = Utilities.base64Encode(blob.getBytes());
    if (total + dataB64.length > TOTAL_MAX_B64) {
      missing = missing.concat(req.ids.slice(j));
      break;
    }
    files[id] = { mime: blob.getContentType(), dataB64: dataB64 };
    total += dataB64.length;
  }
  return { ok: true, files: files, missing: missing };
}

function getFile_(req, base) {
  if (!validLesson_(req) || !matches_(req.materialId, MATERIAL_ID_RE)) return fail_('bad');
  var materials = readMaterials_(req, base);
  if (materials === null) return fail_('notfound');
  var material = material_(materials, req.materialId);
  if (!material) return fail_('notfound');
  var file = findFile_(material.fileId, findFolder_());
  if (!file) return fail_('notfound');
  var blob = file.getBlob();
  return { ok: true, mime: blob.getContentType(), name: material.name, dataB64: Utilities.base64Encode(blob.getBytes()) };
}

function trashFile_(req) {
  if (!matches_(req.fileId, ID_RE)) return fail_('bad');
  var file = findFile_(req.fileId, findFolder_());
  if (!file) return { ok: true, trashed: false };
  file.setTrashed(true);
  return { ok: true, trashed: true };
}
