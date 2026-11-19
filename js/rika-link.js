// 理科クエストの入口には、認証情報のない HTTPS のアドレスだけを使う。
export function rikaEntryUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}
