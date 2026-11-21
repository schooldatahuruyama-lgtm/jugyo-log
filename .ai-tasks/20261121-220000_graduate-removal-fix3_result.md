# Codex 実装報告

## 変更したファイル

- `js/graduate-logic.js`
  `exclude` を追加。指定IDを台帳・`removed` の両方から除外し、配列以外は空として扱います。
- `js/views/teacher-graduates.js`
  `exclude: [PROBE_ID]` を渡し、確認用の生徒を表示・完全削除の対象から除外しました。
- `js/views/teacher-classes.js`
  `exclude: [PROBE_ID]` を渡し、確認用の生徒を期限超過の知らせから除外しました。
- `tests/graduate-logic.test.js`
  重複、不正入力、削除情報だけが残る場合、同じ年度の別の生徒が残る場合を追加しました。
- `tests/graduate-screen.test.js`
  確認用の生徒だけなら空表示になること、期限超過後も表示・通知・完全削除をしないことを追加しました。

## テスト結果

- `npm test`：**1,968件すべて成功**。失敗・スキップともに0件。
- 読み込み失敗はなく、直列実行での再確認は不要でした。
- `git diff --check`：問題なし。

## 指示書と違う点・判断したこと・残った問題

- 指示書との差異なし。名簿画面は変更していません。
- 実ブラウザー・公開環境での確認は未実施です。