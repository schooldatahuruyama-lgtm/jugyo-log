// 添付の保存・削除の順番。画面や通信の中身は、引数で受け取る部品に任せる。
import { NetError } from './errors.js';

export async function addAttachmentFlow({ repo, files, classId, lessonId, studentId, slot, key, type, mime, dataB64, thumb, now,
  isCancelled = () => false }) {
  const { fileId, bytes } = await files.uploadStudent({ key, classId, lessonId, mime, dataB64 });
  if (isCancelled()) {
    try { await files.trashStudent(fileId); } catch { /* 目録に登録していないファイルの片付けは、失敗してもよい */ }
    return { fileId, cancelled: true };
  }
  try {
    await repo.addAttachment(classId, lessonId, studentId, slot, { type, fileId, bytes }, thumb, now);
  } catch (error) {
    // 通信失敗なら、同じキー・置き場所でやり直せるようファイルを残す。
    if (error?.code !== 'denied') throw error;
    try { await files.trashStudent(fileId); } catch { /* 目録に登録できなかったファイルの片付けは、失敗してもよい */ }
    throw new NetError('slot-taken');
  }
  return { fileId, cancelled: false };
}

export async function settleAttachmentFlow({ repo, files, classId, lessonId, studentId, fileId }) {
  const record = await repo.getRecord(classId, lessonId, studentId);
  const attachments = Array.isArray(record?.attachments) ? record.attachments : [];
  if (typeof fileId !== 'string' || !fileId) return { saved: false, attachments };
  if (attachments.some((attachment) => attachment.fileId === fileId)) {
    return { saved: true, attachments };
  }
  try { await files.trashStudent(fileId); } catch { /* 目録にはないので、ファイルの片付けだけの失敗は取り消さない */ }
  return { saved: false, attachments };
}

export async function removeAttachmentFlow({ repo, files, classId, lessonId, studentId, attachment }) {
  await repo.removeAttachment(classId, lessonId, studentId, attachment.slot);
  try {
    return { trashed: await files.trashStudent(attachment.fileId) };
  } catch {
    // 目録からは外せた。ファイルの片付けに失敗しても取り消さない。
    return { trashed: false };
  }
}
