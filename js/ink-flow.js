// ファイルを保存してから目録を書き、古いファイルを片付ける。画面の操作はしない。
import { CONFIG } from './config.js';
import { isEmptyInk, serializeInk, parseInk, serverInkTime } from './ink-logic.js';
import { NetError } from './errors.js';

async function trash(files, fileId) {
  try { await files.trashStudent(fileId); } catch { /* 目録の保存結果は変えない */ }
}

export async function saveInkFlow({ repo, files, classId, lessonId, studentId, field, ink, key, thumb, editedAt, onUploaded }) {
  if (!CONFIG.inkFields.includes(field)) throw new TypeError('手書きの欄が正しくありません。');
  const record = await repo.getRecord(classId, lessonId, studentId);
  const previous = record?.ink?.[field] ?? null;
  if (serverInkTime(record, field) >= editedAt) return { index: previous, superseded: true, record };
  let index = null;
  if (!isEmptyInk(ink)) {
    const { fileId, bytes } = await files.uploadInk({ key, classId, lessonId, text: serializeInk(ink) });
    onUploaded?.(fileId);
    index = { fileId, bytes, strokes: ink.s.length, updatedAt: editedAt };
  }
  try {
    if (index) {
      const { fileId, bytes, strokes } = index;
      await repo.setInk(classId, lessonId, studentId, field, { fileId, bytes, strokes }, thumb, editedAt);
    } else {
      await repo.removeInk(classId, lessonId, studentId, field, editedAt);
    }
  } catch (e) {
    if (e?.code !== 'denied') throw e;
    // 読み直せなければファイルを残す。応答だけが失われた保存は成功として扱う。
    const latest = await repo.getRecord(classId, lessonId, studentId);
    const current = latest?.ink?.[field] ?? null;
    const saved = index ? current?.fileId === index.fileId && current.updatedAt === editedAt
      : !current && latest?.inkCleared?.[field] === editedAt;
    if (!saved) {
      if (index) await trash(files, index.fileId);
      if (serverInkTime(latest, field) >= editedAt) return { index: current, superseded: true, record: latest };
      throw e;
    }
  }
  if (previous && previous.fileId !== index?.fileId) await trash(files, previous.fileId);
  return { index, superseded: false };
}

export async function loadInkFlow({ files, fileId }) {
  const ink = parseInk(await files.loadInk(fileId));
  if (ink === null) throw new NetError('bad-data');
  return ink;
}

function sameDraft(current, draft) {
  return current && current.editedAt === draft.editedAt && current.key === draft.key
    && serializeInk(current.ink) === serializeInk(draft.ink);
}

export async function resendInkDrafts({ repo, files, inkDrafts, studentId, queue, makeThumb }) {
  const result = { sent: 0, kept: 0, dropped: 0 };
  for (const draft of inkDrafts.list(studentId)) {
    const { classId, lessonId, field } = draft;
    const current = () => inkDrafts.get(studentId, classId, lessonId, field);
    const remove = () => inkDrafts.remove(studentId, classId, lessonId, field);
    try {
      await queue.run(`${classId}/${lessonId}`, async () => {
        // 順番を待つ間に変わった下書きは送信も削除もしない。
        if (!sameDraft(current(), draft)) { result.kept += 1; return; }
        let thumb;
        if (typeof makeThumb === 'function' && CONFIG.inkThumbFields.includes(field)) {
          try { thumb = makeThumb(draft.ink); } catch { thumb = null; }
        }
        const saved = await saveInkFlow({ repo, files, studentId, ...draft, thumb });
        const unchanged = sameDraft(current(), draft);
        if (unchanged) remove();
        if (saved.superseded) result[unchanged ? 'dropped' : 'kept'] += 1;
        else result.sent += 1;
      });
    } catch {
      // 規則に断られた場合も消さずに残し、次の下書きを試す。
      result.kept += 1;
    }
  }
  return result;
}
