# Codex 実装報告

## 変更したファイル

- `docs/setup/rules.json`：削除時の UID と台帳の UID の一致検査を追加。
- `js/graduate-flow.js`：`denied` を `changed` に変換。印の索引から削除対象クラスを追加。
- `js/repo.js`：`listStudentIndex` を追加。出し直し時に旧 UID の理科クエスト記録を削除。
- `js/views/teacher-graduates.js`：`changed` 時に一覧を再取得し、指定の案内を表示。
- `js/views/teacher-roster.js`：出し直しの確認文に、理科クエスト記録の削除を明記。
- `js/rules-probe.js`：台帳と異なる UID の書き込みが拒否される確認を追加。
- `README.md`：出し直し・残るデータの説明を追加。規則の確認件数を159項目に更新。
- `tests/rules-shape.test.js`：UID 一致・未発行・削除中断後の再開を検証。
- `tests/rules-probe.test.js`：追加した確認項目と規則の代役を更新。
- `tests/graduate-flow.test.js`：返事だけのクラス、消えたクラス、索引取得失敗を検証。
- `tests/graduate-screen.test.js`：競合後の案内・再試行・確認文を検証。
- `tests/repo.test.js`：索引の重複・不正値、旧 UID の削除条件を検証。

## テスト結果

**`npm test`：1,960件すべて成功、失敗0件。**

ファイル読み込みの失敗はなく、直列実行での再確認は不要でした。`git diff --check` も成功しました。

## 指示書と違う点・判断したこと・残った問題

- 台帳削除直後の再開では UID を照合できないため、すでに `purging` が付いた生徒への再書き込みを省きました。再開できることをテスト済みです。
- `purgeStudent` の最初の更新は `removed` に触れないため、変更していません。
- 実 Firebase・GAS・実ブラウザでの確認は未実施です。規則式の代役と DOM テストで検証しました。