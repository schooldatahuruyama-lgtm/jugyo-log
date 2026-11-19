// 接続確認の行き先。設定の値は呼び出し元から受け取り、ここには書きうつさない。
import { gasEndpoint } from './gas-endpoint.js';

function httpsUrl(value) {
  if (typeof value !== 'string' || !value.startsWith('https://')) {
    throw new TypeError('行き先は https:// のアドレスにしてください');
  }
  let url;
  try { url = new URL(value); } catch { throw new TypeError('行き先のアドレスが正しくありません'); }
  if (url.protocol !== 'https:' || !url.hostname) throw new TypeError('行き先のアドレスが正しくありません');
  return url;
}

// 一覧を作るときに確かめる。余分な設定や認証情報は行き先に持ちこまない。
export function validateReachTargets(targets) {
  if (!Array.isArray(targets)) return [];
  return targets.map((target) => {
    const value = target && target.url;
    // 手元で動かす中つぎだけ、HTTP のループバックアドレスを許す。
    const localRelay = target && target.name === '先生が置いた中つぎ'
      && typeof value === 'string' && /^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?\//.test(value);
    const url = localRelay ? new URL(value) : httpsUrl(value);
    if (url.username || url.password || url.search || url.hash) {
      throw new TypeError('行き先のアドレスには認証情報・クエリ・フラグメントを付けないでください');
    }
    if (typeof target.name !== 'string' || !target.name) throw new TypeError('行き先の名前がありません');
    return { name: target.name, url: target.url, ...(typeof target.note === 'string' && target.note ? { note: target.note } : {}) };
  });
}

export function createReachTargets({ firebase, origin, href = origin, relayUrl }) {
  const databaseUrl = firebase && firebase.databaseURL;
  const database = typeof databaseUrl === 'string' && databaseUrl.startsWith('https://') ? httpsUrl(databaseUrl) : null;
  // URL が英大文字や全角文字を変換する前のホスト名で、ID の文字を確かめる。
  const hostname = database && databaseUrl.match(/^https:\/\/(?:[^/?#\\]*@)?([^/:?#\\]+)/)?.[1];
  const projectId = hostname && hostname.split('.')[0].match(/^([a-z0-9-]+)-default-rtdb$/)?.[1];
  const versionUrl = typeof href === 'string' && href.startsWith('https://') ? new URL('version.txt', href).href : null;
  const relay = gasEndpoint({ relayUrl, target: 'check', directUrl: '' });
  const targets = [
    ...(database ? [{ name: 'Firebase のデータベース（比べるため。届くはず）', url: database.origin + '/check/ping.json' }] : []),
    ...(versionUrl ? [{ name: 'このアプリの置き場所（比べるため。届くはず）', url: versionUrl }] : []),
    ...(relay ? [{ name: '先生が置いた中つぎ', url: relay.replace(/\/gas\/check$/, '/ping') }] : []),
    { name: '今の保存の仕組み（script.google.com）', url: 'https://script.google.com/robots.txt' },
    { name: '今の保存の仕組みの返事（script.googleusercontent.com）', url: 'https://script.googleusercontent.com/robots.txt' },
    { name: '動画: YouTube の再生の枠（www.youtube-nocookie.com）', url: 'https://www.youtube-nocookie.com/robots.txt' },
    { name: '動画: YouTube（www.youtube.com）', url: 'https://www.youtube.com/robots.txt' },
    { name: 'Google ドライブ（drive.google.com）', url: 'https://drive.google.com/robots.txt' },
    { name: 'ドライブのファイルの本体（drive.usercontent.google.com）', url: 'https://drive.usercontent.google.com/' },
    { name: 'Google の API（www.googleapis.com）', url: 'https://www.googleapis.com/' },
    { name: 'Firebase のファイル置き場（firebasestorage.googleapis.com）', url: 'https://firebasestorage.googleapis.com/' },
    { name: 'Google のファイル置き場（storage.googleapis.com）', url: 'https://storage.googleapis.com/' },
    ...(projectId ? [{ name: 'Firebase のホスティング（web.app）', url: `https://${projectId}.web.app/` }] : []),
    { name: '中つぎの候補: Cloudflare Workers（workers.dev）', url: 'https://workers.dev/', note: 'workers.cloudflare.com へ転送されます' },
    { name: '中つぎの候補: Cloudflare Pages（pages.dev）', url: 'https://pages.dev/', note: 'pages.cloudflare.com へ転送されます' },
    { name: '中つぎの候補: Vercel（vercel.app）', url: 'https://vercel.app/', note: 'vercel.com へ転送されます' },
    { name: '中つぎの候補: Netlify（netlify.app）', url: 'https://netlify.app/robots.txt' },
  ];
  return validateReachTargets(targets);
}
