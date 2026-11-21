// 先生の資料と生徒の添付を GAS から取り出し、同じファイルは端末の取り置きから返す。
import { NetError } from './errors.js';

export function createFiles({ gas, cache, atob = globalThis.atob, btoa = globalThis.btoa, Blob = globalThis.Blob }) {
  let generation = 0;

  function toBlob({ mime, dataB64 }) {
    try {
      const binary = atob(dataB64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return new Blob([bytes], { type: mime });
    } catch {
      throw new NetError('unknown');
    }
  }

  async function loadStudentFile(fileId) {
    const current = generation;
    const cached = await cache.get(fileId);
    if (cached) return cached;
    const response = await gas.call('getStudentFile', { fileId });
    const blob = toBlob(response);
    if (current === generation) await cache.put(fileId, blob);
    return blob;
  }

  return {
    async upload({ key, mime, name, dataB64 }) {
      const result = await gas.call('putMaterial', { key, mime, name, dataB64 });
      return { fileId: result.id, bytes: result.bytes };
    },
    async loadImages(classId, lessonId, materials) {
      const current = generation;
      const result = {};
      const needed = [];
      for (const material of materials) {
        if (material.type !== 'image') continue;
        const blob = await cache.get(material.fileId);
        if (blob) result[material.id] = blob;
        else needed.push(material);
      }
      for (let i = 0; i < needed.length; i += 12) {
        const batch = needed.slice(i, i + 12);
        const response = await gas.call('getMaterials', { classId, lessonId, ids: batch.map((m) => m.id) });
        for (const material of batch) {
          const data = response.files?.[material.id];
          if (!data || response.missing?.includes(material.id)) continue;
          let blob;
          try { blob = toBlob(data); } catch { continue; }
          result[material.id] = blob;
          if (current === generation) await cache.put(material.fileId, blob);
        }
      }
      return result;
    },
    async loadFile(classId, lessonId, material) {
      const current = generation;
      const cached = await cache.get(material.fileId);
      if (cached) return cached;
      const response = await gas.call('getFile', { classId, lessonId, materialId: material.id });
      const blob = toBlob(response);
      if (current === generation) await cache.put(material.fileId, blob);
      return blob;
    },
    async trash(fileId) {
      await gas.call('trashFile', { fileId });
      await cache.remove(fileId);
    },
    async uploadStudent({ key, classId, lessonId, mime, dataB64 }) {
      const result = await gas.call('putStudentFile', { key, classId, lessonId, mime, dataB64 });
      return { fileId: result.id, bytes: result.bytes };
    },
    loadStudentFile,
    async uploadInk({ key, classId, lessonId, text }) {
      const result = await gas.call('putStudentFile', { key, classId, lessonId, mime: 'application/json', dataB64: btoa(text) });
      return { fileId: result.id, bytes: result.bytes };
    },
    async loadInk(fileId) {
      const blob = await loadStudentFile(fileId);
      if (typeof blob.text === 'function') return blob.text();
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error ?? new Error('手書きを読みこめませんでした。'));
        reader.onabort = () => reject(new Error('手書きの読みこみを中止しました。'));
        reader.readAsText(blob);
      });
    },
    async trashStudent(fileId) {
      const result = await gas.call('trashStudentFile', { fileId });
      await cache.remove(fileId);
      return result.trashed;
    },
    async trashStudents(fileIds, studentIds) {
      if (!fileIds.length) return { trashed: 0, missing: 0, skipped: 0, unknown: 0 };
      generation += 1;
      try {
        const { trashed, missing, skipped, unknown: value } = await gas.call('trashStudentFiles', { fileIds, studentIds });
        const unknown = Number.isInteger(value) && value >= 0 ? value : 0;
        if (![trashed, missing, skipped].every((n) => Number.isInteger(n) && n >= 0)
          || trashed + missing + skipped + unknown !== fileIds.length) throw new NetError('unknown');
        return { trashed, missing, skipped, unknown };
      } finally {
        // 応答だけ失われたときにも、消した可能性のあるファイルを取り置きに残さない。
        generation += 1;
        for (const id of fileIds) await cache.remove(id);
      }
    },
    async clearCache() {
      // 消去前に始めた取得は、遅れて返ってきても取り置きに戻さない
      generation += 1;
      await cache.clear();
    },
  };
}
