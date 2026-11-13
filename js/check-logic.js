// 接続確認の計算（通信はしない）。check-steps.js と確認ページから使う。

// ログイン用のメールアドレスに使うドメイン。この順に試す
export const EMAIL_DOMAINS = ['jugyolog.invalid', 'jugyolog.example', 'jugyolog.example.com'];
export const GAS_TIMEOUT_MS = 30000;
export const FIREBASE_TIMEOUT_MS = 10000;
export const PARALLEL_COUNT = 40;

// パスワードに使う文字（まぎらわしい l・o・0・1 を除く）
const PASSWORD_CHARS = 'abcdefghijkmnpqrstuvwxyz23456789';

// 0 以上 n 未満の整数を random から作る
function pick(random, n) {
  const i = Math.floor(random() * n);
  return Math.min(Math.max(i, 0), n - 1);
}

// 生徒 ID と「何回目か」からログイン用のメールアドレスを作る。例: ('s26-017', 1, 'jugyolog.invalid') → 's26-017.g1@jugyolog.invalid'
export function studentEmail(studentId, generation, domain) {
  return `${studentId}.g${generation}@${domain}`;
}

// 確認用の ID を作る。例: 'chk-7f3a9c2d'（random は 0 以上 1 未満を返す関数）
export function checkStudentId(random) {
  let hex = '';
  for (let i = 0; i < 8; i++) hex += pick(random, 16).toString(16);
  return 'chk-' + hex;
}

// 12 文字のパスワードを作る（英小文字と数字。まぎらわしい l・o・0・1 を除く）
export function randomPassword(random) {
  let s = '';
  for (let i = 0; i < 12; i++) s += PASSWORD_CHARS[pick(random, PASSWORD_CHARS.length)];
  return s;
}

// 同時に呼んだ結果をまとめる。runs は [{ ok: boolean, ms: number }]
// 戻り値: { total, ok, ng, medianMs, maxMs }（ok が 0 件のとき medianMs と maxMs は null）
export function summarizeParallel(runs) {
  const okMs = runs.filter((r) => r.ok).map((r) => r.ms).sort((a, b) => a - b);
  const n = okMs.length;
  let medianMs = null;
  let maxMs = null;
  if (n > 0) {
    const mid = Math.floor(n / 2);
    medianMs = n % 2 === 1 ? okMs[mid] : (okMs[mid - 1] + okMs[mid]) / 2;
    maxMs = okMs[n - 1];
  }
  return { total: runs.length, ok: n, ng: runs.length - n, medianMs, maxMs };
}

// バイト数を「12.3GB」「456MB」の形にする（1GB = 1024^3 バイト）
export function formatBytes(n) {
  const GB = 1024 * 1024 * 1024;
  const MB = 1024 * 1024;
  if (n >= GB) {
    const s = (n / GB).toFixed(1);
    return (s.endsWith('.0') ? s.slice(0, -2) : s) + 'GB';
  }
  return Math.round(n / MB) + 'MB';
}

// 結果の一覧を、貼り付け用の文章にする。
// items は [{ label, ok, detail }]（ok は true / false / null（未実施））、info は { when, userAgent, screen, place }
export function reportText(items, info) {
  const lines = [`確認した日時: ${info.when}`];
  for (const item of items) {
    if (item.ok === null || item.ok === undefined) {
      lines.push(`－ ${item.label}：未実施`);
      continue;
    }
    const mark = item.ok ? '○' : '×';
    lines.push(item.detail ? `${mark} ${item.label}：${item.detail}` : `${mark} ${item.label}`);
  }
  lines.push(`ブラウザ: ${info.userAgent}`);
  lines.push(`画面: ${info.screen}`);
  lines.push(`場所: ${info.place}`);
  return lines.join('\n');
}
