// 生徒 ID・ログイン ID・パスワード・データの ID を作る・確かめる（通信はしない）
// random は 0 以上 1 未満を返す関数（Math.random など）を引数で受け取る。
import { CONFIG } from './config.js';

export { studentEmail } from './check-logic.js';

// パスワードに使う文字（まぎらわしい l・o・0・1 を除く）
export const PASSWORD_CHARS = 'abcdefghijkmnpqrstuvwxyz23456789';

// newId に使う文字（英大文字・英小文字・数字）
const ID_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

// 生徒 ID の形。例: 's26-017'
const STUDENT_ID = /^s\d{2}-\d{3}$/;

// 0 以上 n 未満の整数を random から作る
function pick(random, n) {
  const i = Math.floor(random() * n);
  return Math.min(Math.max(i, 0), n - 1);
}

// 年度の下 2 けた（0〜99）と連番（1〜999）から生徒 ID を作る。例: (26, 17) → 's26-017'
export function formatStudentId(yy, seq) {
  if (!Number.isInteger(yy) || yy < 0 || yy > 99) throw new RangeError('年度は 0〜99 の整数です');
  if (!Number.isInteger(seq) || seq < 1 || seq > 999) throw new RangeError('連番は 1〜999 の整数です');
  return `s${String(yy).padStart(2, '0')}-${String(seq).padStart(3, '0')}`;
}

// 生徒 ID の形かどうか（そろえる前の入力は通さない）
export function isStudentId(s) {
  return typeof s === 'string' && STUDENT_ID.test(s);
}

// ログイン画面の入力をそろえる。
// @ を含む（先生のメールアドレス）なら前後の空白だけ取る。
// そうでなければ、全角を半角にし（NFKC）、空白を取り、小文字にし、ハイフンに似た記号を '-' にする。
export function normalizeLoginId(input) {
  if (typeof input !== 'string') return '';
  if (input.includes('@')) return input.trim();
  return input
    .normalize('NFKC')
    .replace(/\s+/g, '')
    .toLowerCase()
    .replace(/[ー－―‐−]/g, '-');
}

// 最初のパスワードを作る（CONFIG.initialPasswordLength 文字。まぎらわしい文字を使わない）
export function initialPassword(random) {
  let s = '';
  for (let i = 0; i < CONFIG.initialPasswordLength; i++) s += PASSWORD_CHARS[pick(random, PASSWORD_CHARS.length)];
  return s;
}

// 生徒が決めた新しいパスワードを確かめる。
// 短すぎれば 'short'、生徒 ID を含めば（ハイフンや大文字小文字を問わず）'has-id'、よければ null
export function checkNewPassword(password, studentId) {
  const pw = String(password ?? '');
  if (pw.length < CONFIG.minPasswordLength) return 'short';
  const flat = (s) => s.toLowerCase().replace(/-/g, '');
  const id = flat(String(studentId ?? ''));
  if (id && flat(pw).includes(id)) return 'has-id';
  return null;
}

// 英数字だけの ID を作る（length 文字）
export function newId(random, length = CONFIG.idLength) {
  let s = '';
  for (let i = 0; i < length; i++) s += ID_CHARS[pick(random, ID_CHARS.length)];
  return s;
}
