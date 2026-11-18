# Codex 実装報告

## 変更したファイル

- `gas/Code.gs`：`app-4` に更新。先生専用の `summarize`、入力検証、API 通信、返答の整形を追加。
- `js/ai-summary-logic.js`：送信データ作成、まとめの整形、更新判定、コピー用文章を追加。
- `js/ai-summary-flow.js`：120 秒・再送なしの AI 呼び出しを追加。
- `js/gas.js`：呼び出し単位の試行回数・時間制限と、AI エラーコードを追加。
- `js/repo.js`：まとめの保存・取得と、授業削除時の同時削除を追加。
- `docs/setup/rules.json`：先生だけが読み書きできる規則を追加。
- `js/rules-probe.js`：確認を 5 行追加し、確認用データの片付けに対応。
- `js/dev/demo-gas.js`：外部通信しない見本のまとめを追加。
- `tests/ai-summary-logic.test.js`：対象選択、境界値、整形、更新判定、呼び出しを検証。
- `tests/gas-code.test.js`：GAS の入力・権限・API エラー・送信本文を検証。
- `tests/gas.test.js`：再送禁止、時間制限、既存動作の維持を検証。
- `tests/gas-app.test.js`：版名の期待値を更新。
- `tests/repo.test.js`：保存・取得・上書き・削除を検証。
- `tests/rules-shape.test.js`：追加規則の権限と値の制約を検証。
- `tests/rules-probe.test.js`：107 行の確認、失敗検出、片付けを検証。
- `tests/demo-gas.test.js`：練習モードのまとめと権限を検証。
- `README.md`：版名と確認項目数を更新。
- `docs/superpowers/specs/2026-11-13-jugyo-log-1a-data.md`：保存形式と確認項目を追記。

## テスト結果

- `npm test`：**1,478 件すべて成功、失敗 0 件**。
- 変更・追加した JavaScript 14 ファイル：`node --check` 成功。
- GAS の構文検査、規則 JSON の読み込み、`git diff --check`：成功。
- 規則の確認：**107 行**。中継処理の既存テストも成功。

## 指示書と違う点・判断したこと・残った問題

- `count`・`latest` は、実際に送る先頭 60 人までを基準にしました。
- 構造化出力と拒否応答の扱いは、[OpenAI 公式資料](https://developers.openai.com/api/docs/guides/structured-outputs)で確認しました。
- 本番の OpenAI API 通信・Firebase 規則の実地確認は未実施です。
- `docs/setup/gas.md` に旧版 `app-3` の記載が残っています。指示書の変更対象外のため、変更していません。