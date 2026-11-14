# Codex 実装報告

## 変更したファイル

| ファイル | 変更内容 |
|---|---|
| `js/record-logic.js` | 記録の正規化、下書きとの新旧判定、理解度の判定を追加。 |
| `js/student-list-logic.js` | 日付・単元別の分類、スワイプ判定、画像位置の計算を追加。 |
| `js/drafts.js` | 下書きの保存・取得・一覧・削除と、ストレージ例外への対応を追加。 |
| `js/repo.js` | 記録の取得・保存、印の取得を追加。記録と印は1回の更新で保存。 |
| `js/config.js` | 文字数、自動保存・再試行間隔、スワイプの設定を追加。 |
| `js/lesson-logic.js` | 既存の `dateLabel` を移動。 |
| `js/views/teacher-lessons.js` | 共通化した `dateLabel` を使用。 |
| `tests/record-logic.test.js` | 正規化・文字数の境界・下書きの新旧判定を検証。 |
| `tests/student-list-logic.test.js` | 週・年の境界、単元順、不正な日付、スワイプを検証。 |
| `tests/drafts.test.js` | 下書き操作、破損データ、保存先の例外を検証。 |
| `tests/repo.test.js` | 一括保存、理解度未選択、不正なID、通信失敗を検証。 |
| `tests/lesson-logic.test.js` | 日付・曜日の表示と不正な日付を検証。 |

## テスト結果

- 実装前にテストを実行し、未実装による失敗を確認。
- 実装後の `npm test`：**524件成功、0件失敗**。
- `node --check`：新規・変更したJavaScript全12ファイルで成功。
- `git diff --check`：成功。

## 指示書と違う点・判断したこと・残った問題

なし。`dateLabel` の表示は従来どおり、不正な日付は「日付なし」です。

指定された12ファイルだけを変更しました。ブラウザ確認・コミット・パッケージ追加は行っていません。