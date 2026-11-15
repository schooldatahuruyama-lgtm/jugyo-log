// 先生の返事の形と文字数。通信や現在時刻の取得はしない。
import { CONFIG } from './config.js';

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

export function cleanReply(value) {
  if (!isObj(value)) return null;
  const text = typeof value.text === 'string' ? value.text.replace(/\r\n?/g, '\n').trim() : '';
  const seen = value.seen === true;
  return text === '' && !seen ? null : { text, seen };
}

export function checkReply(value) {
  const text = typeof value?.text === 'string' ? value.text : '';
  if (text.length > CONFIG.reply.textMax) return { ok: false, error: 'too-long' };
  if (text === '' && value?.seen !== true) return { ok: false, error: 'empty' };
  return { ok: true };
}

export function toReply(value) {
  if (!isObj(value) || !isNum(value.updatedAt)) return null;
  if (typeof value.text === 'string' && value.text.length > CONFIG.reply.textMax) return null;
  const reply = cleanReply(value);
  return reply && checkReply(reply).ok ? { ...reply, updatedAt: value.updatedAt } : null;
}

// 入力中の長い文は切らず、保存時と同じ整形で変更の有無を比べる。
export function replyEditState(value, saved, busy = false) {
  const count = typeof value?.text === 'string' ? value.text.length : 0;
  const reply = cleanReply(value);
  const previous = cleanReply(saved);
  const dirty = (reply?.text ?? '') !== (previous?.text ?? '') || (reply?.seen ?? false) !== (previous?.seen ?? false);
  const tooLong = count > CONFIG.reply.textMax;
  return { count, dirty, tooLong, canSave: !busy && dirty && !tooLong && reply !== null && checkReply(reply).ok };
}

export function replyMarkLabel(value) {
  const reply = cleanReply(value);
  return reply?.text ? '💬 返事ずみ' : reply?.seen ? '✓ 見ました' : '';
}

export function replyDateLabel(value) {
  if (!isNum(value)) return '';
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? `${date.getMonth() + 1}/${date.getDate()}` : '';
}
