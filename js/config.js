// アプリ全体で使う定数
export const CONFIG = {
  // 生徒のログイン用メールアドレスのドメインと、最初の発行の回数（g1）
  emailDomain: 'jugyolog.invalid',
  firstGeneration: 1,
  // newId で作る ID の長さ
  idLength: 12,
  // 最初のパスワードの長さと、生徒が決めるパスワードの最短の長さ
  initialPasswordLength: 8,
  minPasswordLength: 8,
  // 発行し直すときに、回数（g1, g2, …）を進めてよい上限
  maxGenerationTries: 20,
  // ID トークンの期限の何ミリ秒前に取り直すか
  tokenRefreshMarginMs: 300000,
  // 1 回の通信を待つ時間
  requestTimeoutMs: 10000,
  // 出席番号の上限（1〜99）
  maxNumber: 99,
  // 授業名・単元名・先生の資料名の文字数
  lessonTitleMax: 60,
  unitNameMax: 40,
  materialNameMax: 80,
  // 重要用語の文字数・個数と、よく使う用語に出す数
  termMax: 20,
  termsPerLesson: 8,
  myTermSlots: ['t1', 't2', 't3', 't4', 't5', 't6', 't7', 't8'],
  frequentTerms: 8,
  // 自分の記録の文字数と、残り文字数を出し始める位置
  recordTextMax: 2000,
  recordCountFrom: 1800,
  // 自動保存までの待ち時間と、失敗したときにやり直す間隔
  save: { delayMs: 2000, retryMs: [2000, 5000, 15000] },
  // タイルを軽く押した動きと、横にすべらせた動きの境界
  swipe: { tapMax: 10, swipeMin: 30 },
  // 画像と一覧用の小さい画像の長辺・データ URL の文字数
  image: { maxEdge: 1600, maxChars: 400000 },
  thumb: { maxEdge: 320, maxChars: 20000 },
  pdfMaxBytes: 10485760,
  materialsPerLesson: 12,
  attachmentSlots: ['a1', 'a2', 'a3', 'a4', 'a5', 'a6'],
  // GAS の待ち時間・試す回数・やり直す間隔の基準
  gas: { timeoutMs: 60000, maxTries: 3, retryBaseMs: 1500 },
};
