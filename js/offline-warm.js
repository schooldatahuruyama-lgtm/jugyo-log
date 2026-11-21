// 新しい授業を順番に読んで取り置く。離れた画面からは読み続けない。
export async function warmLessons({ repo, classId, studentId, lessons, max, isStopped }) {
  let count = 0;
  if (!Number.isFinite(max) || max <= 0) return count;
  try {
    for (const { id } of lessons.slice(0, Math.floor(max))) {
      if (isStopped()) break;
      await repo.getLesson(classId, id);
      if (isStopped()) break;
      await repo.getRecord(classId, id, studentId);
      if (typeof repo.getMyLessonTerms === 'function') {
        if (isStopped()) break;
        await repo.getMyLessonTerms(studentId, classId, id);
      }
      if (typeof repo.getReply === 'function') {
        if (isStopped()) break;
        await repo.getReply(classId, id, studentId);
      }
      count += 1;
    }
  } catch { /* 一つでも読めなければ、そこでやめる */ }
  return count;
}
