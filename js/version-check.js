// 版の印と、確かめる間隔の計算（画面と通信は持たない）
export function parseVersion(text) {
  if (typeof text !== 'string') return null;
  const version = text.trim();
  return /^[0-9a-f]{7,40}$/.test(version) ? version : null;
}

export function isNewVersion(current, published) {
  const a = parseVersion(current);
  const b = parseVersion(published);
  return a !== null && b !== null && a !== b;
}

export function shouldCheck(now, lastCheckedAt, intervalMs) {
  if (lastCheckedAt === null) return true;
  if (![now, lastCheckedAt, intervalMs].every(Number.isFinite)) return true;
  const elapsed = now - lastCheckedAt;
  return elapsed < 0 || elapsed >= intervalMs;
}
