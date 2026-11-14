// 記録の形と、サーバー・下書きの選び方。通信や現在時刻の取得はしない。
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isLevel = (v) => Number.isInteger(v) && v >= 1 && v <= 4;

export const LEVELS = [
  { value: 4, label: 'よく分かった' },
  { value: 3, label: '分かった' },
  { value: 2, label: 'あまり分からなかった' },
  { value: 1, label: '全然分からなかった' },
];

export function emptyRecord() {
  return { memo: '', level: null, learned: '', question: '' };
}

export function normalizeRecord(v, { max }) {
  const record = isObj(v) ? v : {};
  const text = (value) => (typeof value === 'string' ? value.slice(0, max) : '');
  return {
    memo: text(record.memo),
    level: isLevel(record.level) ? record.level : null,
    learned: text(record.learned),
    question: text(record.question),
  };
}

export function sameRecord(a, b) {
  return ['memo', 'level', 'learned', 'question'].every((field) => a?.[field] === b?.[field]);
}

export function pickInitial(server, draft, { max }) {
  const updatedAt = isNum(server?.updatedAt) ? server.updatedAt : 0;
  const fromDraft = isObj(draft) && isObj(draft.record) && isNum(draft.editedAt) && draft.editedAt > updatedAt;
  return { record: normalizeRecord(fromDraft ? draft.record : server, { max }), fromDraft, updatedAt };
}

export function tileMark(level) {
  return isLevel(level) ? 'done' : 'todo';
}
