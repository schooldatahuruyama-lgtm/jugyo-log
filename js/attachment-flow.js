// 添付の保存・削除の順番。画面や通信の中身は、引数で受け取る部品に任せる。
export async function addAttachmentFlow({ repo, files, classId, lessonId, studentId, slot, key, type, mime, dataB64, thumb, now }) {
  const { fileId, bytes } = await files.uploadStudent({ key, classId, lessonId, mime, dataB64 });
  // 登録に失敗してもファイルは残す。同じキー・置き場所でやり直せる。
  await repo.addAttachment(classId, lessonId, studentId, slot, { type, fileId, bytes }, thumb, now);
  return { fileId };
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
