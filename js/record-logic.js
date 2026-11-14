// 記録の形と、サーバー・下書きの選び方。通信や現在時刻の取得はしない。
import { CONFIG } from './config.js';

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

// 目録の形を確かめ、足した順に並べる。元のファイル名など、余分な項目は返さない。
export function attachmentList(v) {
  return (isObj(v) ? Object.entries(v) : [])
    .filter(([slot, a]) => CONFIG.attachmentSlots.includes(slot) && isObj(a)
      && ['image', 'pdf'].includes(a.type) && typeof a.fileId === 'string' && a.fileId.length >= 1 && a.fileId.length <= 200
      && isNum(a.bytes) && a.bytes >= 0 && isNum(a.addedAt))
    .map(([slot, { type, fileId, bytes, addedAt }]) => ({ slot, type, fileId, bytes, addedAt }))
    .sort((a, b) => (a.addedAt - b.addedAt) || a.slot.localeCompare(b.slot));
}

export function freeSlot(attachments, busy = []) {
  const used = new Set([...attachments.map((a) => a.slot), ...busy]);
  return CONFIG.attachmentSlots.find((slot) => !used.has(slot)) ?? null;
}

export function attachmentLabels(attachments) {
  const counts = { image: 0, pdf: 0 };
  return Object.fromEntries(attachments.map(({ slot, type }) => [slot, `${type === 'image' ? '写真' : 'PDF'} ${++counts[type]}`]));
}
