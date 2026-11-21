// ファイルを先に消し、授業の記録、生徒の台帳の順に片付ける。画面には依存しない。
import { fileIdsOf } from './graduate-logic.js';
import { NetError } from './errors.js';

export async function removeCohort({ repo, cohort, now }) {
  try { await repo.removeStudents(cohort.active, now); }
  catch (e) {
    if (e?.code === 'denied') throw new NetError('changed');
    throw e;
  }
  return cohort.active.length;
}

export async function restoreCohort({ repo, cohort }) {
  await repo.restoreStudents(cohort.restorable);
  return cohort.restorable.length;
}

export async function purgeCohort({ repo, files, cohort, batch = 20, allowUnknown = false, onProgress = () => {}, signal }) {
  function check() {
    if (signal?.aborted) {
      const error = new Error('中止しました。');
      error.name = 'AbortError';
      throw error;
    }
  }
  async function communicate(fn, file = false) {
    check();
    try { return await fn(); }
    catch (e) {
      if (e?.name === 'AbortError') throw e;
      throw new NetError(file ? 'files' : e?.code || 'network');
    }
  }
  const students = cohort.purgeable;
  if (!students.length) { check(); return { students: 0, files: 0, unknownFiles: 0 }; }
  const ids = students.map((s) => s.id);
  const targets = new Set(ids);
  // 台帳を消した直後の再開では uid を照合できないため、すでに付いた印は書き直さない。
  await communicate(() => repo.markPurging(students.filter((s) => !s.purging).map((s) => s.id)));
  const size = Number.isInteger(batch) && batch > 0 ? Math.min(batch, 20) : 20;
  const memberships = await communicate(() => repo.listMemberOf());
  const classes = (await communicate(() => repo.listClasses())).filter((c) => c.year >= cohort.year);
  const eligible = new Set(classes.map((c) => c.id));
  const memberClasses = new Set(ids.flatMap((id) => memberships[id] ?? []));
  const indexedClasses = new Set();
  for (const id of ids) {
    const classIds = await communicate(() => repo.listStudentIndex(id));
    classIds.forEach((classId) => indexedClasses.add(classId));
  }
  const progress = { phase: 'scan', doneClasses: 0, totalClasses: classes.length,
    doneLessons: 0, totalLessons: 0, doneStudents: 0, totalStudents: students.length };
  onProgress({ ...progress });
  const lessons = [];
  for (const { id: classId } of classes) {
    const list = await communicate(() => repo.listLessons(classId));
    const scanned = [];
    for (const lesson of list) {
      const recordIds = await communicate(() => repo.listRecordIds(classId, lesson.id));
      scanned.push({ classId, lessonId: lesson.id, hasRecords: recordIds.some((id) => targets.has(id)) });
    }
    if (memberClasses.has(classId) || indexedClasses.has(classId) || scanned.some((lesson) => lesson.hasRecords)) {
      // 名簿から外れた生徒の最後の記録を消しても、再開時に返事だけの授業が取り残されない順にする。
      lessons.push(...scanned.filter((lesson) => !lesson.hasRecords), ...scanned.filter((lesson) => lesson.hasRecords));
    }
    progress.doneClasses += 1;
    onProgress({ ...progress });
  }
  progress.phase = 'lessons';
  progress.totalLessons = lessons.length;
  onProgress({ ...progress });
  let trashed = 0, unknownFiles = 0;
  for (const { classId, lessonId, hasRecords } of lessons) {
    const records = hasRecords ? await communicate(() => repo.listRecords(classId, lessonId)) : {};
    // GAS の studentIds の上限は 60 人。持ち主を確かめる対象も分ける。
    const seen = new Set();
    for (let s = 0; s < ids.length; s += 60) {
      const owners = ids.slice(s, s + 60);
      const fileIds = [...new Set(owners.flatMap((id) => fileIdsOf(records[id])))].filter((id) => !seen.has(id));
      for (let i = 0; i < fileIds.length; i += size) {
        const part = fileIds.slice(i, i + size);
        const result = await communicate(() => files.trashStudents(part, owners), true);
        if (result.skipped > 0) throw new NetError('skipped');
        if (result.unknown > 0) {
          if (allowUnknown !== true) {
            const error = new NetError('unknown-files');
            error.count = result.unknown;
            throw error;
          }
          unknownFiles += result.unknown;
        }
        trashed += result.trashed;
        part.forEach((id) => seen.add(id));
      }
    }
    await communicate(() => repo.purgeLessonRecords(classId, lessonId, ids));
    progress.doneLessons += 1;
    onProgress({ ...progress });
  }
  progress.phase = 'students';
  onProgress({ ...progress });
  for (const { id, uid } of students) {
    await communicate(() => repo.purgeStudent({ id, uid, classIds: (memberships[id] ?? []).filter((cid) => eligible.has(cid)) }, signal));
    progress.doneStudents += 1;
    onProgress({ ...progress });
  }
  return { students: students.length, files: trashed, unknownFiles };
}
