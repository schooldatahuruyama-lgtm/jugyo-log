// 先生の資料を GAS から取り出し、同じファイルは端末の取り置きから返す。
import { NetError } from './errors.js';

export function createFiles({ gas, cache, atob = globalThis.atob, Blob = globalThis.Blob }) {
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
    async clearCache() {
      // 消去前に始めた取得は、遅れて返ってきても取り置きに戻さない
      generation += 1;
      await cache.clear();
    },
  };
}
