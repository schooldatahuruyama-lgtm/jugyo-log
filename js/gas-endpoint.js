// 中つぎが設定されていれば中つぎの道を、無ければ今のアドレスを返す。
export function gasEndpoint({ relayUrl, target, directUrl }) {
  if (typeof relayUrl !== 'string' || relayUrl === '') return directUrl;
  if (target !== 'app' && target !== 'check') throw new TypeError('送り先は app か check にしてください');
  // 手元の確認だけ HTTP を許す。似た名前の外部ホストは受けつけない。
  const local = /^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?(?:\/|$)/.test(relayUrl);
  if (!relayUrl.startsWith('https://') && !local) throw new TypeError('中つぎは https:// のアドレスにしてください');
  return relayUrl.replace(/\/+$/, '') + '/gas/' + target;
}
