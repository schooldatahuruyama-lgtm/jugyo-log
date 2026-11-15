# Codex 実装報告

## 変更したファイル

| ファイル | 内容 |
|---|---|
| `js/ink-flow.js`（新規） | 保存・読みこみ・下書き再送と、失敗時のファイル処理を実装。 |
| `js/ink-drafts.js`（新規） | 手書き下書きの保存・取得・一覧・削除を実装。 |
| `js/config.js` | 手書きの欄と画像キーを追加。 |
| `js/repo.js` | 目録の検証・取得・保存・削除を追加。 |
| `js/files.js` | JSON のアップロードと取り置きを使った読みこみを追加。 |
| `js/dev/demo-gas.js` | 手書き JSON の検証・サイズ制限に対応。 |
| `gas/Code.gs` | 手書き JSON に対応し、版を `app-3` に更新。 |
| `docs/setup/rules.json` | 手書き目録・小さい画像の検証規則を追加。 |
| `js/rules-probe.js` | 手書きの確認を7項目追加。 |
| `js/main.js` | `ctx.inkDrafts` とログアウト時の消去を追加。 |
| `tests/ink-flow.test.js`（新規） | 保存順序・失敗処理・再送中の変更を検証。 |
| `tests/ink-drafts.test.js`（新規） | 下書き操作・破損値・保存先の例外を検証。 |
| `tests/repo.test.js` | 目録の境界値と画像の維持・削除を検証。 |
| `tests/files.test.js` | JSON 保存・読みこみ・取り置きを検証。 |
| `tests/gas-app.test.js` | JSON 検証・サイズ境界・権限・重複防止を検証。 |
| `tests/demo-gas.test.js` | 練習モードの手書き保存と権限を検証。 |
| `tests/rules-probe.test.js` | 70項目と、応答消失時を含む片付けを検証。 |
| `tests/rules-shape.test.js` | 手書きの規則と境界値を検証。 |
| `README.md` | 確認項目数・GAS の版・保存方式を更新。 |
| `docs/setup/gas.md` | 手書き JSON の仕様と公開後の確認内容を追記。 |
| `docs/superpowers/specs/2026-11-13-jugyo-log-1a-data.md` | データ形・保存順序・下書き・規則の説明を更新。 |

## テスト結果

- `npm test`：**926件すべて成功、失敗0件**。
- `node --check`：作成・変更した JavaScript **16ファイルすべて成功**。
- `docs/setup/rules.json`：JSON として読み取り成功。
- 規則の確認：**70項目**。片付け後に手書き目録・画像が残らないことをテストで確認。
- `git diff --check`：問題なし。

## 指示書と違う点・判断したこと・残った問題

- 指定範囲外の変更なし。`js/ink-logic.js`・画面ファイルは変更していません。
- 再送中の下書き変更は、編集時刻・保存用キー・線の内容を比較して判定します。
- 練習モードの不正 JSON は、既存の GAS クライアントと同じく `NetError('unknown')` に変換します。
- 本番 GAS・Firebase への公開と実接続での確認は未実施です。