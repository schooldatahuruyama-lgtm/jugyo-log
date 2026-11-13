// 授業を消してから、参照のないファイルを片付ける。画面と DOM は扱わない。
// 先生 1 人で使う前提。2 つの端末で同時に授業を消し、同じファイルを別の授業に付ける競合までは防がない。
import { NetError } from './errors.js';
import { materialList, fileRefs } from './lesson-logic.js';

export async function deleteLessonFlow({ repo, files, classId, lesson }) {
  if (await repo.countRecords(classId, lesson.id) > 0) return { deleted: false, reason: 'has-records' };
  const fileIds = new Set(materialList(lesson.materials).map((m) => m.fileId));
  try {
    await repo.deleteLesson(classId, lesson.id);
  } catch (error) {
    if (error instanceof NetError && error.code === 'denied') return { deleted: false, reason: 'has-records' };
    throw error;
  }
  if (fileIds.size === 0) return { deleted: true, leftover: 0 };

  let allLessons;
  try {
    allLessons = await repo.listAllLessons();
  } catch {
    // 授業は消せた。参照を確かめられないファイルは、すべて残す。
    return { deleted: true, leftover: fileIds.size };
  }
  let leftover = 0;
  for (const fileId of fileIds) {
    if (fileRefs(allLessons, fileId).length > 0) continue;
    try { await files.trash(fileId); } catch { leftover += 1; }
  }
  return { deleted: true, leftover };
}
