// Google Apps Script のウェブアプリの URL。公開してよい値（確認は GAS 側で行う）。
// appUrl は本番用（gas/Code.gs）、url は確認ページ用（gas/check/）。
export const GAS = {
  relayUrl: 'https://frosty-poetry-c570jugyo-log-relay.schooldata-huruyama.workers.dev', // 学校の回線から保存の仕組みへ届かないときの中つぎ。空なら使わない。末尾の / は付けない
  appUrl: 'https://script.google.com/macros/s/AKfycbxMMvSd3O8xYvOaIvrxT8rISjbn1kDeoYhbzdVR5eJWZDRnvPcBpUEeAOZXPVxAkzXGlg/exec', // 本番用。url は確認ページ用のまま残す
  url: 'https://script.google.com/macros/s/AKfycbyOVU7TAYQ-oChU3okxAWMdlguotB2g7_NsNnSs96T4RT9RBQENlJJykpFkP0oJq3G3/exec',
};
