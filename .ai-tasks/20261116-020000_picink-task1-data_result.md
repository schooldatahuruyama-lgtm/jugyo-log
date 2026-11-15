# Codex 実装報告

## 変更したファイル

| ファイル | 変更内容 |
|---|---|
| `js/config.js` | 写真用の最小高さ 100 を追加。 |
| `js/ink-logic.js` | 写真用手書き、場所の判定、写真に対応する目録の取得を追加。 |
| `js/repo.js` | 3 種類の場所と `on` に対応。添付と書きこみの同時削除を追加。 |
| `js/ink-flow.js` | 写真の存在確認、競合処理、`gone`、下書き再送に対応。 |
| `js/attachment-flow.js` | 削除時刻の計算と書きこみファイルの片付けを追加。 |
| `js/ink-drafts.js` | 写真の場所と `on` の保存・選別に対応。 |
| `js/rules-probe.js` | 写真への書きこみの確認を 6 項目追加。 |
| `js/views/parts/attachment-pane.js` | 指定の 1 行で `ctx.now()` を渡すよう変更。 |
| `docs/setup/rules.json` | 写真の存在・`on` の一致・削除時刻の規則を追加。 |
| `README.md` | 規則確認の項目数を 83 に更新。 |
| `docs/superpowers/specs/2026-11-13-jugyo-log-1a-data.md` | データ形式、保存・削除・下書き、資料削除後の扱いを追記。 |
| `tests/ink-logic.test.js` | 写真の高さ・形式・場所判定を検証。 |
| `tests/repo.test.js` | `on` の保存・選別と同時削除を検証。 |
| `tests/ink-flow.test.js` | 写真の保存・競合・再送と練習モードでの保存・読み直しを検証。 |
| `tests/attachment-flow.test.js` | 削除時刻とファイルの片付けを検証。 |
| `tests/ink-drafts.test.js` | 写真の下書きと不正値の扱いを検証。 |
| `tests/review-logic.test.js` | 写真の書きこみを一覧・コピーの手書き件数に含めないことを検証。 |
| `tests/rules-shape.test.js` | 写真の参照先、`on`、時刻の規則を検証。 |
| `tests/rules-probe.test.js` | 追加 6 項目の許可・拒否、通信失敗、片付けを検証。 |

## テスト結果

- `npm test`：**1,026 件すべて成功、失敗 0 件**。
- 変更した JavaScript **16 ファイル**の `node --check`：成功。
- `docs/setup/rules.json` の JSON 読み取り：成功。
- `git diff --check`：成功。
- 規則の確認：**77 → 83 項目**。追加した 6 項目すべてを実装。

## 指示書と違う点・判断したこと・残った問題

- 資料 ID は画面の生成方法に合わせ、**英数字 12 文字**で判定しました。GAS の許容範囲は英数字 1〜40 文字です。資料の項目名は指示書どおり `type`・`fileId` でした。
- 写真の `h` が不正な場合は 600 に補正します。下書きの変更判定にも `on` を加えました。
- `js/dev/` と GAS は既存処理で対応でき、変更不要でした。
- 本番 Firebase での規則確認は未実施です。公開後に 83 項目の実確認が必要です。
- 指示範囲外の変更、Git の状態を変える操作、パッケージ追加は行っていません。