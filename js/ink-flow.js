// ファイルを保存してから目録を書き、古いファイルを片付ける。画面の操作はしない。
import { CONFIG } from './config.js';
import { isEmptyInk, serializeInk, parseInk, serverInkTime, inkPlaceKind, pictureIndex, splitInkPlace } from './ink-logic.js';
import { NetError } from './errors.js';

async function trash(files, fileId) {
  try { await files.trashStudent(fileId); } catch { /* 目録の保存結果は変えない */ }
}

export async function saveInkFlow({ repo, files, classId, lessonId, studentId, field, ink, key, thumb, editedAt, onUploaded, on }) {
  const kind = inkPlaceKind(field);
  if (kind === null) throw new TypeError('手書きの場所が正しくありません。');
  const picture = kind !== 'field';
  if (picture && typeof on !== 'string') throw new TypeError('書きこみ先の写真が正しくありません。');
  const page = splitInkPlace(field);
  if (page && (on.length < 1 || on.length > 200)) throw new TypeError('書きこみ先の PDF が正しくありません。');
  const currentIndex = (record) => picture ? pictureIndex(record, field, on) : record?.ink?.[field] ?? null;
  const pictureExists = async (record) => {
    if (!picture) return true;
    const place = page?.place ?? field;
    const photo = kind === 'attachment' || kind === 'attachment-page'
      ? record?.attachments?.find((item) => item.slot === place)
      : (await repo.getLesson(classId, lessonId))?.materials?.[place];
    return photo?.type === (page ? 'pdf' : 'image') && photo.fileId === on;
  };
  const record = await repo.getRecord(classId, lessonId, studentId);
  const previous = record?.ink?.[field] ?? null;
  if (!await pictureExists(record)) return { index: null, superseded: true, gone: true, record };
  if (serverInkTime(record, field) >= editedAt) return { index: currentIndex(record), superseded: true, record };
  let index = null;
  if (!isEmptyInk(ink)) {
    const { fileId, bytes } = await files.uploadInk({ key, classId, lessonId, text: serializeInk(ink) });
    onUploaded?.(fileId);
    index = { fileId, bytes, strokes: ink.s.length, updatedAt: editedAt, ...(picture ? { on } : {}) };
  }
  try {
    if (index) {
      const { fileId, bytes, strokes } = index;
      await repo.setInk(classId, lessonId, studentId, field, { fileId, bytes, strokes, ...(picture ? { on } : {}) }, thumb, editedAt);
    } else {
      await repo.removeInk(classId, lessonId, studentId, field, editedAt);
    }
  } catch (e) {
    if (e?.code !== 'denied') throw e;
    // 読み直せなければファイルを残す。応答だけが失われた保存は成功として扱う。
    const latest = await repo.getRecord(classId, lessonId, studentId);
    const current = latest?.ink?.[field] ?? null;
    const saved = index ? current?.fileId === index.fileId && current.updatedAt === editedAt && (!picture || current.on === on)
      : !current && latest?.inkCleared?.[field] === editedAt;
    if (!saved) {
      if (index) await trash(files, index.fileId);
      if (!await pictureExists(latest)) return { index: null, superseded: true, gone: true, record: latest };
      if (serverInkTime(latest, field) >= editedAt) return { index: currentIndex(latest), superseded: true, record: latest };
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

// 手書き・書きこみを読みこめなかった理由を、画面に出す短い文にする。
export function inkLoadReason(error) {
  if (!(error instanceof NetError)) return 'この端末では開けませんでした';
  switch (error.code) {
    case 'network': return '通信できませんでした';
    case 'auth': return 'ログインが切れています';
    case 'denied': return '見ることが許されていません';
    case 'toobig': return 'ファイルが大きすぎます';
    case 'bad-data': return '中身を読めませんでした';
    case 'notfound': return '見つかりませんでした';
    default: return '保存の仕組みが断りました';
  }
}

function sameDraft(current, draft) {
  return current && current.editedAt === draft.editedAt && current.key === draft.key && current.on === draft.on
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
        if (saved.superseded || saved.gone) result[unchanged ? 'dropped' : 'kept'] += 1;
        else result.sent += 1;
      });
    } catch {
      // 規則に断られた場合も消さずに残し、次の下書きを試す。
      result.kept += 1;
    }
  }
  return result;
}
