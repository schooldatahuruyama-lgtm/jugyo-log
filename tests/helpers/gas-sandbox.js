// GAS のファイル（.gs）を Node の vm の中で動かすための道具と、Apps Script の代役一式
// 代役は、本物の Apps Script の呼び方と返り値の形に合わせてある（メモリの中だけで動く）
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createHash } from 'node:crypto';

const GLOBAL_NAMES = [
  'DriveApp',
  'UrlFetchApp',
  'ContentService',
  'PropertiesService',
  'CacheService',
  'LockService',
  'Utilities',
];

// file の中身を vm で動かし、fakes をグローバルとして見せ、doPost と doGet を返す
export function loadGas(file, fakes) {
  const code = readFileSync(file, 'utf8');
  const globals = {};
  for (const name of GLOBAL_NAMES) globals[name] = fakes[name];
  const context = vm.createContext(globals);
  vm.runInContext(code, context, { filename: String(file) });
  return { doPost: context.doPost, doGet: context.doGet };
}

// ---- バイト列（Apps Script のバイトは -128〜127 の数） ----

const toSigned = (buf) => Array.from(buf, (b) => (b > 127 ? b - 256 : b));
const toBuffer = (bytes) => Buffer.from(bytes.map((b) => b & 255));

function makeIterator(items) {
  let i = 0;
  return {
    hasNext: () => i < items.length,
    next: () => {
      if (i >= items.length) throw new Error('もう次はありません');
      return items[i++];
    },
  };
}

function makeBlob(data, contentType, name) {
  let bytes;
  if (typeof data === 'string') bytes = toSigned(Buffer.from(data, 'utf8'));
  else if (Array.isArray(data)) bytes = data.slice();
  else throw new Error('newBlob: data はバイト列か文字列');
  let type = contentType ?? null;
  let blobName = name ?? null;
  return {
    getBytes: () => bytes.slice(),
    getContentType: () => type,
    setContentType: (t) => {
      type = t;
    },
    getName: () => blobName,
    setName: (n) => {
      blobName = n;
    },
    getDataAsString: () => toBuffer(bytes).toString('utf8'),
  };
}

// ---- 代役一式 ----

export function makeFakes({ databaseURL, validTokens = {} } = {}) {
  const files = []; // 作られたファイル（フォルダの外のものも含む。ゴミ箱に入れても残る）
  const fetched = []; // UrlFetchApp.fetch に渡された URL
  const folders = [];
  let nextId = 1;
  const newId = (prefix) => `${prefix}${String(nextId++).padStart(6, '0')}AbC-_x`;

  function makeFile(blob, parent) {
    const id = newId('file');
    const bytes = blob.getBytes();
    const mime = blob.getContentType();
    const name = blob.getName();
    let description = null;
    let trashed = false;
    const file = {
      getId: () => id,
      getName: () => name,
      getMimeType: () => mime,
      getDescription: () => description,
      setDescription: (d) => {
        description = d;
        return file;
      },
      getBlob: () => makeBlob(bytes, mime, name),
      getParents: () => makeIterator([parent]),
      setTrashed: (t) => {
        trashed = Boolean(t);
        return file;
      },
      isTrashed: () => trashed,
      getSize: () => bytes.length,
    };
    files.push(file);
    return file;
  }

  function makeFolder(name, parent) {
    const id = newId('folder');
    const folder = {
      getId: () => id,
      getName: () => name,
      getParents: () => makeIterator(parent ? [parent] : []),
      getFiles: () => makeIterator(files.filter((f) => f.getParents().next() === folder)),
      getFilesByName: (n) =>
        makeIterator(files.filter((f) => f.getParents().next() === folder && f.getName() === n)),
      getFoldersByName: (n) =>
        makeIterator(folders.filter((f) => f.getParents().hasNext() && f.getParents().next() === folder && f.getName() === n)),
      createFile: (blob) => makeFile(blob, folder),
      createFolder: (n) => {
        const child = makeFolder(n, folder);
        folders.push(child);
        return child;
      },
    };
    return folder;
  }

  const root = makeFolder('マイドライブ', null);

  const DriveApp = {
    getRootFolder: () => root,
    // 本物と同じく、Drive 全体から同じ名前のフォルダを探す
    getFoldersByName: (n) => makeIterator(folders.filter((f) => f.getName() === n)),
    createFolder: (n) => root.createFolder(n),
    createFile: (blob) => makeFile(blob, root),
    getFileById: (id) => {
      const f = files.find((x) => x.getId() === id);
      if (!f) throw new Error('No item with the given ID could be found.');
      return f;
    },
    getStorageLimit: () => 16106127360,
    getStorageUsed: () => files.reduce((sum, f) => sum + f.getSize(), 0),
  };

  // Firebase の REST の代役: /check/<uid>.json?auth=<token> は、
  // token が validTokens にあり、その uid が URL の uid と同じときだけ 200（規則 auth.uid === $uid と同じ）
  const UrlFetchApp = {
    fetch: (url, params) => {
      fetched.push(url);
      let code = 401;
      const prefix = `${databaseURL}/check/`;
      if (params?.muteHttpExceptions !== true) throw new Error('muteHttpExceptions を付けていない');
      if (url.startsWith(prefix)) {
        const rest = url.slice(prefix.length);
        const m = /^([^/?#]+)\.json\?auth=([^&#]+)$/.exec(rest);
        if (m && Object.hasOwn(validTokens, m[2]) && validTokens[m[2]] === m[1]) code = 200;
      }
      return {
        getResponseCode: () => code,
        getContentText: () => (code === 200 ? 'null' : '{"error":"Permission denied"}'),
      };
    },
  };

  const ContentService = {
    MimeType: { JSON: 'JSON', TEXT: 'TEXT' },
    createTextOutput: (text) => {
      let mime = 'TEXT';
      const out = {
        getContent: () => text,
        getMimeType: () => mime,
        setMimeType: (m) => {
          mime = m;
          return out;
        },
      };
      return out;
    },
  };

  const props = { DATABASE_URL: databaseURL };
  const PropertiesService = {
    getScriptProperties: () => ({
      getProperty: (k) => (Object.hasOwn(props, k) && props[k] !== undefined ? props[k] : null),
    }),
  };

  const cacheStore = new Map();
  const scriptCache = {
    get: (k) => {
      const hit = cacheStore.get(k);
      if (!hit || hit.until < Date.now()) return null;
      return hit.value;
    },
    put: (k, v, seconds = 600) => {
      if (typeof k !== 'string' || k.length > 250) throw new Error('キーが長すぎる');
      cacheStore.set(k, { value: String(v), until: Date.now() + seconds * 1000 });
    },
    remove: (k) => cacheStore.delete(k),
  };
  const CacheService = { getScriptCache: () => scriptCache };

  const lock = {
    waitLock: () => {},
    tryLock: () => true,
    releaseLock: () => {},
    hasLock: () => true,
  };
  const LockService = { getScriptLock: () => lock };

  const STD = /^[A-Za-z0-9+/]*={0,2}$/;
  const WEB = /^[A-Za-z0-9_-]*={0,2}$/;
  const Utilities = {
    DigestAlgorithm: { SHA_256: 'SHA_256' },
    newBlob: (data, contentType, name) => makeBlob(data, contentType, name),
    base64Encode: (data) =>
      (typeof data === 'string' ? Buffer.from(data, 'utf8') : toBuffer(data)).toString('base64'),
    base64Decode: (s) => {
      if (typeof s !== 'string' || s.length % 4 !== 0 || !STD.test(s)) throw new Error('Could not decode string.');
      return toSigned(Buffer.from(s, 'base64'));
    },
    base64DecodeWebSafe: (s) => {
      if (typeof s !== 'string' || s.length % 4 !== 0 || !WEB.test(s)) throw new Error('Could not decode string.');
      return toSigned(Buffer.from(s, 'base64url'));
    },
    computeDigest: (alg, text) => {
      if (alg !== 'SHA_256') throw new Error('この代役は SHA_256 だけ');
      return toSigned(createHash('sha256').update(String(text), 'utf8').digest());
    },
  };

  return {
    DriveApp,
    UrlFetchApp,
    ContentService,
    PropertiesService,
    CacheService,
    LockService,
    Utilities,
    files,
    fetched,
  };
}
