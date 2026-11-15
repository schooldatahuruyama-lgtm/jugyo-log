# Codex 実装報告

## 変更したファイル

| ファイル | 変更内容 |
|---|---|
| `js/ink-logic.js` | ページ名の判定・生成・分解、`hasPageInk` を追加。 |
| `js/repo.js` | ページ目録の読み書き、平らな名前への変換、添付削除時の一括更新に対応。 |
| `js/ink-flow.js` | PDF の存在・種類・`on` を確認してページを保存。 |
| `js/attachment-flow.js` | 全ページの時刻を比較し、削除後に書きこみファイルを片付ける処理を追加。 |
| `js/ink-drafts.js` | ページの下書きと `on` の検証に対応。 |
| `js/rules-probe.js` | PDF の確認 7 項目と準備・片付けを追加。 |
| `docs/setup/rules.json` | `inkPages`・`inkPagesCleared` の規則を追加。既存規則は変更なし。 |
| `tests/ink-logic.test.js` | ページ番号の境界・不正値・目録検索を確認。 |
| `tests/repo.test.js` | 保存先、読み取り時の選別、一括削除を確認。 |
| `tests/ink-flow.test.js` | 保存・競合・消失・再送・練習モードを確認。 |
| `tests/attachment-flow.test.js` | 削除時刻・ページ一覧・ファイルの片付けを確認。 |
| `tests/ink-drafts.test.js` | ページの下書きの保存・取得・一覧・削除を確認。 |
| `tests/rules-shape.test.js` | PDF・ページ名・時刻・必須項目の規則を確認。 |
| `tests/rules-probe.test.js` | 追加 7 項目の判定、通信失敗、片付けを確認。 |
| `README.md` | 確認項目数と PDF の保存方式を追記。 |
| `docs/superpowers/specs/2026-11-13-jugyo-log-1a-data.md` | データ構造・保存・削除・下書き・規則を追記。 |

## テスト結果

- `npm test`：**1071 件成功、失敗 0 件**。
- `node --check`：変更した JavaScript **13 ファイルすべて成功**。
- `docs/setup/rules.json`：JSON として読み取り成功。
- `git diff --check`：成功。
- 規則の確認表：**83 行 → 90 行**。

## 指示書と違う点・判断したこと・残った問題

- `js/dev/` と `resendInkDrafts` は既存処理で動作したため変更不要でした。テストで確認済みです。
- ページの `on` は規則に合わせて 1〜200 文字、`pages` 指定時は有限の `clearedAt` を必須にしました。
- 本番 Firebase での規則確認は未実施です。90 項目の判定はローカルの代役で確認しました。
- 画面・`gas/Code.gs` の変更、パッケージ追加、Git の状態を変える操作は行っていません。