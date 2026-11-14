# Codex 実装報告

## 変更したファイル

- `js/term-logic.js`：用語の整形・検証・重複除去・検索・頻出集計・候補生成を追加。
- `tests/term-logic.test.js`：全関数の通常動作、境界値、不正入力を検証。
- `js/config.js`：用語の文字数・個数・置き場所の定数を追加。
- `js/repo.js`：先生・生徒の用語の読み書きと、授業取得時の `terms` を追加。
- `tests/repo.test.js`：通信回数、不正入力、エラー伝播、既存操作での用語保持を検証。
- `docs/setup/rules.json`：指定された `terms` の規則を追加。
- `tests/rules-shape.test.js`：用語の読み書き権限・所属・授業の存在・文字数制限を検証。
- `js/rules-probe.js`：確認を63項目に拡張し、今回・前回の用語の片付けを追加。
- `tests/rules-probe.test.js`：追加6項目、通信失敗、片付けを検証。
- `docs/superpowers/specs/2026-11-13-jugyo-log-1a-data.md`：3章・4章にデータ構造と規則を追記。

## テスト結果

- 実装前に追加テストの失敗を確認。
- **`npm test`：838件成功、失敗0件。**
- 変更・新規作成したJavaScript全8ファイルの `node --check`：成功。
- `git diff --check`：成功。

## 指示書と違う点・判断したこと・残った問題

- 指定範囲外の変更なし。
- `freeTermSlot` は、保存済みの空文字や不正値を上書きしないよう、使用中として扱います。
- Firebase実環境での規則確認は未実施です。規則の形と確認処理は自動テストで検証しました。