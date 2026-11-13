// 本番用 GAS の、端末の中だけで動く代役。保存したファイルはページを閉じると消える。
// call は本物の createGas と同じく、成功の JSON を返し、失敗は NetError にする。
import { NetError } from '../errors.js';
import { newId } from '../ids.js';

const KEY_RE = /^[A-Za-z0-9-]{8,64}$/;
const ID_RE = /^[A-Za-z0-9_-]{1,200}$/;
const MATERIAL_ID_RE = /^[A-Za-z0-9]{1,40}$/;
const STUDENT_ID_RE = /^s\d{2}-\d{3}$/;
const UID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const IMAGE_MAX_B64 = 1400000;
const PDF_MAX_B64 = 14000000;
const TOTAL_MAX_B64 = 6000000;

function matches(value, pattern) {
  if (typeof value !== 'string') return false;
  const match = value.match(pattern);
  return match !== null && match[0] === value;
}

function checkLesson(payload) {
  if (!matches(payload.classId, MATERIAL_ID_RE) || !matches(payload.lessonId, MATERIAL_ID_RE)) {
    throw new NetError('unknown');
  }
}

export function createDemoGas({ net, getUser, random = Math.random }) {
  const files = new Map();
  const keys = new Map();
  // 読み直す前の目録が、あとから保存した別のファイルを指さないようにする
  const pageId = newId(random, 16);
  let nextId = 0;

  async function identify() {
    const uid = getUser()?.uid;
    if (!matches(uid, UID_RE)) throw new NetError('auth');
    if (await net.get(`teacherList/${uid}`) === true) return { role: 'teacher' };
    const studentId = await net.get(`accounts/${uid}`);
    if (!matches(studentId, STUDENT_ID_RE)) throw new NetError('auth');
    return { role: 'student', studentId };
  }

  async function readMaterials(user, { classId, lessonId }) {
    if (user.role !== 'teacher' && await net.get(`memberOf/${user.studentId}/${classId}`) !== true) {
      throw new NetError('notfound');
    }
    try {
      return await net.get(`lessons/${classId}/${lessonId}/materials`) || {};
    } catch (e) {
      if (e instanceof NetError && e.code === 'denied') throw new NetError('notfound');
      throw e;
    }
  }

  function putMaterial({ key, mime, name, dataB64 }) {
    if (!matches(key, KEY_RE) || !['image/jpeg', 'application/pdf'].includes(mime)
      || typeof name !== 'string' || name.length < 1 || name.length > 80 || /[\r\n\u2028\u2029]/.test(name)
      || typeof dataB64 !== 'string' || !dataB64.length) throw new NetError('unknown');
    if (dataB64.length > (mime === 'image/jpeg' ? IMAGE_MAX_B64 : PDF_MAX_B64)) throw new NetError('toobig');
    // 大きな PDF でも、くり返すグループで正規表現のスタックを使い切らない
    if (dataB64.length % 4 !== 0 || !matches(dataB64, /^[A-Za-z0-9+/]+={0,2}$/)) {
      throw new NetError('unknown');
    }
    const previous = keys.get(key);
    if (files.has(previous)) return { ok: true, id: previous, existed: true, bytes: files.get(previous).bytes };
    const bytes = dataB64.length / 4 * 3 - (dataB64.endsWith('==') ? 2 : dataB64.endsWith('=') ? 1 : 0);
    const id = `demo-file-${pageId}-${++nextId}`;
    files.set(id, { mime, dataB64, bytes });
    keys.set(key, id);
    return { ok: true, id, existed: false, bytes };
  }

  async function handle(op, payload) {
    if (op === 'ping') return { ok: true, version: 'app-1' };
    if (!['whoami', 'putMaterial', 'getMaterials', 'getFile', 'trashFile'].includes(op)) throw new NetError('unknown');
    const user = await identify();
    if (op === 'whoami') return { ok: true, ...user };
    if (op === 'putMaterial' || op === 'trashFile') {
      if (user.role !== 'teacher') throw new NetError('denied');
      if (op === 'putMaterial') return putMaterial(payload);
      if (!matches(payload.fileId, ID_RE)) throw new NetError('unknown');
      return { ok: true, trashed: files.delete(payload.fileId) };
    }

    checkLesson(payload);
    if (op === 'getMaterials') {
      const { ids } = payload;
      if (!Array.isArray(ids) || !ids.length || ids.length > 12 || ids.some((id) => !matches(id, MATERIAL_ID_RE))) {
        throw new NetError('unknown');
      }
      const materials = await readMaterials(user, payload);
      const found = {};
      const missing = [];
      let total = 0;
      for (let i = 0; i < ids.length; i++) {
        const id = ids[i];
        const material = Object.hasOwn(materials, id) ? materials[id] : null;
        const file = material?.type === 'image' ? files.get(material.fileId) : null;
        if (!file) { missing.push(id); continue; }
        if (total + file.dataB64.length > TOTAL_MAX_B64) {
          missing.push(...ids.slice(i));
          break;
        }
        found[id] = { mime: file.mime, dataB64: file.dataB64 };
        total += file.dataB64.length;
      }
      return { ok: true, files: found, missing };
    }

    if (!matches(payload.materialId, MATERIAL_ID_RE)) throw new NetError('unknown');
    const materials = await readMaterials(user, payload);
    const material = Object.hasOwn(materials, payload.materialId) ? materials[payload.materialId] : null;
    const file = material ? files.get(material.fileId) : null;
    if (!file) throw new NetError('notfound');
    return { ok: true, mime: file.mime, name: material.name, dataB64: file.dataB64 };
  }

  return {
    async call(op, payload = {}) {
      try {
        return await handle(op, payload);
      } catch (e) {
        const code = e instanceof NetError && ['auth', 'denied', 'notfound', 'toobig', 'unknown'].includes(e.code)
          ? e.code : 'network';
        throw new NetError(code);
      }
    },
  };
}
