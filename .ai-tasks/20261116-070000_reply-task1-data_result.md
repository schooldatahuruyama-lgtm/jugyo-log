# Codex 実装報告

## 変更したファイル

- `js/config.js`：返事の上限 400 文字を追加。
- `js/reply-logic.js`（新規）：返事の整形・検証・読み取り時の選別を実装。
- `js/repo.js`：指定の 5 関数と、授業削除時の返事・目印の一括削除を実装。
- `docs/setup/rules.json`：返事・目印の権限と検証規則を追加。既存規則は変更なし。
- `js/rules-probe.js`：確認を **12 行追加し、合計 102 行**に更新。確認用データの片付けも追加。
- `tests/reply-logic.test.js`（新規）：整形、不正値、400・401 文字の境界を確認。
- `tests/repo.test.js`：読み書き、削除、通信失敗、練習モードでの共有・保存を確認。
- `tests/rules-shape.test.js`：権限・データ形式の検証を追加。
- `tests/rules-probe.test.js`：追加行の成否判定、通信失敗、片付けを確認。
- `README.md`：返事の仕様と確認項目数を更新。
- `docs/superpowers/specs/2026-11-13-jugyo-log-1a-data.md`：データ形式・権限・削除方法を追記。

## テスト結果

- `npm test`：**1,164 件すべて成功**。失敗・スキップなし。
- `node --check`：変更・追加した JavaScript **8 ファイルすべて成功**。
- `rules.json`：JSON として読み込み成功。追加前の規則が変わっていないことも確認。
- `git diff --check`：成功。

## 指示書と違う点・判断したこと・残った問題

- 練習モードは既存の共通処理で対応できるため、`js/dev/` は変更せず、切り替え・再読み込みをテストしました。
- 更新時刻は既存コードに合わせて有限の数に限定し、不正値は `TypeError` にしました。
- 本物の Firebase での規則確認は未実施です。
- 画面・`gas/Code.gs` は未変更。パッケージ追加、`git add`・`git commit`・ブランチ操作は行っていません。