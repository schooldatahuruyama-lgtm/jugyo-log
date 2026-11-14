// 残った下書きを 1 件ずつ送り直す。新しいサーバーの記録は上書きしない。
import { pickInitial } from './record-logic.js';

export async function resendDrafts({ repo, drafts, studentId, max, queue }) {
  const result = { sent: 0, kept: 0, dropped: 0 };
  for (const draft of drafts.list(studentId)) {
    const { classId, lessonId } = draft;
    try {
      const server = await repo.getRecord(classId, lessonId, studentId);
      await queue.run(`${classId}/${lessonId}`, async () => {
        // 通信中や順番を待つ間に変わった下書きは、送信も削除もしない。
        const current = drafts.get(studentId, classId, lessonId);
        if (!current || current.editedAt !== draft.editedAt) {
          result.kept += 1;
          return;
        }
        const { record, fromDraft } = pickInitial(server, draft, { max });
        if (fromDraft) {
          await repo.saveRecord(classId, lessonId, studentId, record, draft.editedAt);
          const latest = drafts.get(studentId, classId, lessonId);
          if (latest && latest.editedAt === draft.editedAt) drafts.remove(studentId, classId, lessonId);
          result.sent += 1;
        } else {
          drafts.remove(studentId, classId, lessonId);
          result.dropped += 1;
        }
      });
    } catch {
      // 規則に断られた場合も消さずに残し、ほかの授業の処理を続ける。
      result.kept += 1;
    }
  }
  return result;
}

export function pendingLessons(drafts, studentId, classId) {
  return new Set(drafts.list(studentId).filter((draft) => draft.classId === classId).map((draft) => draft.lessonId));
}
