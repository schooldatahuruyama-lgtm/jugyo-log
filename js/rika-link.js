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

// 先生の進み具合の画面を、そのクラスを選んで開く。
export function rikaProgressUrl(baseUrl, classId) {
  const entry = rikaEntryUrl(baseUrl);
  if (entry === null || typeof classId !== 'string' || !/^[A-Za-z0-9]+$/.test(classId)) return null;
  const url = new URL(entry);
  url.searchParams.set('teacher', '1');
  url.searchParams.set('class', classId);
  url.hash = '';
  return url.href;
}
