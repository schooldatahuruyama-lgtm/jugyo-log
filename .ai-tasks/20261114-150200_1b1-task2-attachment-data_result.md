# Codex 実装報告

## 変更したファイル

| ファイル | 変更内容 |
|---|---|
| `js/attachment-flow.js` | 添付の追加・削除の順序と失敗時の処理を追加。 |
| `tests/attachment-flow.test.js` | 通信順序、再送、削除失敗を検証。 |
| `js/record-logic.js` | 添付の選別・並び替え、空き場所、表示名を追加。 |
| `tests/record-logic.test.js` | 不正な目録、6 個の上限、表示順を検証。 |
| `js/repo.js` | 記録保存を項目別更新に変更。添付・小さい画像の出し入れを追加。 |
| `tests/repo.test.js` | 添付と文字の相互保持、削除、入力検証を追加。 |
| `js/files.js` | 生徒用の保存・取得・削除と取り置きを追加。 |
| `tests/files.test.js` | 通信内容、取り置き、エラーの伝達を検証。 |
| `js/dev/demo-gas.js` | `app-2` に更新。生徒用の 4 操作、所有者確認、再送処理を追加。 |
| `tests/demo-gas.test.js` | 閲覧・削除権限、重複防止、容量制限、先生用操作との分離を検証。 |
| `js/config.js` | `attachmentSlots` を追加。 |
| `docs/setup/rules.json` | 添付の検証規則と `recThumbs` の読み書き規則を追加。 |
| `tests/rules-shape.test.js` | 新しい規則と公開範囲を検証。 |
| `docs/superpowers/specs/2026-11-13-jugyo-log-1a-data.md` | 3・4 章に添付のデータ形式、保存方法、規則を追記。 |

## テスト結果

- テストを先に追加し、未実装による失敗を確認してから実装しました。
- **`npm test`：745 件すべて成功、失敗 0 件。** Task 1 のテストも成功しています。
- `node --check`：新規・変更した JavaScript 12 ファイルすべて成功。
- `git diff --check`：問題なし。

## 指示書と違う点・判断したこと・残った問題

- 同じ置き場所への書き込みは、具体的な仕様に従い「後のものが残る」実装です。Review Focus の「規則でも同時追加を断る」とは差があり、複数端末から同じ置き場所への競合は規則では拒否しません。
- ブラウザと実 Firebase 上での規則検証は未実施です。
- 指定外ファイルの変更、Git の状態を変える操作、パッケージ追加は行っていません。