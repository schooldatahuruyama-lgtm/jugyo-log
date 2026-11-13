// 資料の保存・削除の順番。画面や通信の中身は、引数で受け取る部品に任せる。
import { fileRefs } from './lesson-logic.js';

export async function addMaterialFlow({ repo, files, key, materialId, kind, type, name, mime, dataB64, thumb, targets, now }) {
  const { fileId, bytes } = await files.upload({ key, mime, name, dataB64 });
  // 登録に失敗してもファイルは残す。同じキー・資料 ID でやり直せる。
  await repo.addMaterial(targets, materialId, { kind, type, fileId, name, bytes }, thumb, now);
  return { fileId };
}

export async function removeMaterialFlow({ repo, files, classId, lessonId, material, now }) {
  await repo.removeMaterial(classId, lessonId, material.id, now);
  try {
    const lessons = await repo.listAllLessons();
    if (fileRefs(lessons, material.fileId).length > 0) return { trashed: false };
    await files.trash(material.fileId);
    return { trashed: true };
  } catch {
    // 授業からは外せた。参照の確認やファイルの片付けが失敗しても取り消さない。
    return { trashed: false };
  }
}
