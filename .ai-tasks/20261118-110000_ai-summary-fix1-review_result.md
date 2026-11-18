# Codex 実装報告

## 変更したファイル

- `js/ai-summary-logic.js`：ID・メール・番号の伏せ字処理を追加。保存した対応表だけで生徒を引くよう修正。
- `js/repo.js`：`labels` の保存・読み込みと、不正な組の除外に対応。
- `js/main.js`：既存の GAS 接続を使う `ctx.ai.summarize` を追加。
- `js/views/teacher-review.js`：独自の GAS 接続を削除。返事だけが残る生徒もリンク対象に対応。
- `js/views/parts/ai-summary-box.js`：説明・確認文、対応表の保存・復元、AI が使えない場合の表示を修正。
- `README.md`：送信する情報と伏せ字処理の説明を更新。
- `tests/ai-summary-logic.test.js`：伏せ字・全角・文字数の境界・対応表の検証を追加。
- `tests/repo.test.js`：対応表の保存・読み込み・置き換えの検証を追加。
- `tests/ai-summary-box.test.js`：確認文、番号変更後のリンク、古いまとめの表示を検証。
- `tests/ai-summary-screen.test.js`：画面連携、送信内容、GAS の順番待ちの共用を検証。

## テスト結果

- `npm test`：**1534 件すべて成功**。失敗・スキップなし。
- `node --check`：変更した JavaScript **9 ファイルすべて成功**。

## 指示書と違う点・判断したこと・残った問題

なし。