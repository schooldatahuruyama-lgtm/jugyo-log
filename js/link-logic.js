// 授業のリンクの計算。通信や DOM の操作はしない。
const isObj = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isNum = (value) => typeof value === 'number' && Number.isFinite(value);
const entriesOf = (value) => isObj(value) ? Object.entries(value) : [];

export function cleanLinkUrl(value) {
  if (typeof value !== 'string' || !/^https:\/\//i.test(value.trim())) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) return null;
    return url.href;
  } catch { return null; }
}

export function checkLink({ url, title }, { urlMax, titleMax }) {
  if (typeof url !== 'string' || !url.trim()) return 'no-url';
  if (url.trim().length > urlMax) return 'long-url';
  if (cleanLinkUrl(url) === null) return 'bad-url';
  if (typeof title !== 'string') return 'bad-title';
  if (title.trim().length > titleMax) return 'long-title';
  return null;
}

export function youtubeId(value) {
  const cleaned = cleanLinkUrl(value);
  if (cleaned === null) return null;
  const url = new URL(cleaned);
  let id = null;
  if (['www.youtube.com', 'youtube.com', 'm.youtube.com'].includes(url.hostname)) {
    id = url.pathname === '/watch' ? url.searchParams.get('v')
      : url.pathname.match(/^\/(?:shorts|embed|live)\/([^/]+)\/?$/)?.[1];
  } else if (url.hostname === 'youtu.be') {
    id = url.pathname.split('/')[1];
  } else if (url.hostname === 'www.youtube-nocookie.com') {
    id = url.pathname.match(/^\/embed\/([^/]+)\/?$/)?.[1];
  }
  return typeof id === 'string' && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
}

export function youtubeStart(value) {
  const cleaned = cleanLinkUrl(value);
  if (cleaned === null) return 0;
  const params = new URL(cleaned).searchParams;
  const time = params.get('t') ?? params.get('start') ?? '';
  let seconds;
  if (/^\d+$/.test(time)) seconds = Number(time);
  else {
    const parts = time.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
    if (!parts || !time) return 0;
    seconds = Number(parts[1] || 0) * 3600 + Number(parts[2] || 0) * 60 + Number(parts[3] || 0);
  }
  return Number.isInteger(seconds) && seconds >= 0 && seconds <= 86400 ? seconds : 0;
}

export function embedUrl(url) {
  const id = youtubeId(url);
  if (id === null) return null;
  const start = youtubeStart(url);
  return `https://www.youtube-nocookie.com/embed/${id}?rel=0&playsinline=1${start > 0 ? `&start=${start}` : ''}`;
}

export function linkHost(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

export function linkLabel(link) {
  if (typeof link?.title === 'string' && link.title.trim()) return link.title.trim();
  return embedUrl(link?.url) !== null ? 'YouTube の動画' : linkHost(link?.url);
}

export function linkList(links) {
  return entriesOf(links).filter(([, link]) => isObj(link)).map(([id, link]) => {
    const cleaned = cleanLinkUrl(link.url);
    const ok = cleaned !== null && typeof link.title === 'string' && isNum(link.order) && link.order >= 0;
    return { id, url: ok ? cleaned : '', title: typeof link.title === 'string' ? link.title : '',
      order: isNum(link.order) ? link.order : Number.MAX_SAFE_INTEGER,
      ok, video: ok && embedUrl(cleaned) !== null };
  }).sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export function nextLinkOrder(links) {
  let max = -1;
  for (const [, link] of entriesOf(links)) {
    if (isObj(link) && isNum(link.order) && link.order >= 0) max = Math.max(max, link.order);
  }
  return max + 1;
}
