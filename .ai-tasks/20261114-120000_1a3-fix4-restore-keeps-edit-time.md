# 実装指示書: 段階 1a-3 の修正 4（下書きを開き直して送り直すとき、書いた時刻を変えない）

あなた（Codex）は、この指示書に沿ってコードを直します。進め方は `AGENTS.md` の「実装を頼まれたとき」のとおりです。

## 目的

Codex レビュー `.ai-review/20261114-104636_round2.md` の指摘 1（High）を直す。

授業ページが下書きを使って始まるとき、今は `saver.edit(record)` が、その下書きの時刻を「今」に置きかえる。生徒は何も書き足していないのに、記録の `updatedAt` が新しくなり、ほかの端末に残っている、もっとあとで書いた下書きが「古い」と判定されて捨てられることがある。

## 変えるファイル

`js/record-saver.js`、`tests/record-saver.test.js`、`js/views/student-lesson.js`。ほかのファイルは変えない。

- `js/record-saver.js`: `edit(record, { editedAt } = {})`。`editedAt` が有限の数なら、その値をその内容の時刻として使う（`saveDraft` と `save` に渡す値も、それ）。渡されなければ、今までどおり `now()`。ほかの動きは変えない。
- `js/views/student-lesson.js`: 下書きから始めるとき（`initial.fromDraft`）は、`saver.edit(record, { editedAt: draft.editedAt })` と、下書きの時刻を引きつぐ。生徒が実際に入力・ボタンを押したときは、今までどおり引数なし（今の時刻）。

## 端の場合

- 不正な入力: `editedAt` が数でない・`NaN`・無限のときは、渡されなかったものとして `now()` を使う。
- 重複と境界: 引きついだ時刻で送ったあとに生徒が書き足したら、その `edit` は今の時刻になる。同じ下書きを 2 回開き直しても、時刻は変わらない。
- 違反や失敗の見せ方: 今ある表示のまま（「前に保存できなかった内容を、もう一度送ります。」と、保存の状態）。

## 追加・変更するテスト（`tests/record-saver.test.js`）

- `edit(record, { editedAt: 1000 })` を、時計が 3000 のときに呼ぶ → `saveDraft` と `save` に渡る時刻は 1000。
- そのあと引数なしの `edit` → 渡る時刻は、そのときの `now()`。
- `editedAt` が `'1000'`・`NaN`・`Infinity` → `now()` の値が渡る。
- **「時刻 1000 の下書き A を 3000 に開き直して送る → サーバーの `updatedAt` は 1000 → 時刻 2000 の下書き B と `pickInitial` で比べると、B が選ばれる」**（`record-logic` の `pickInitial` を使う）。

## 守ること

- `git add`・`git commit` はしない。データベースの形と規則は変えない。

## 完了の条件

- `npm test` がすべて成功する。変えた `.js` は `node --check` で構文を確かめる。

## 報告

変更したファイル、テストの結果、指示書と違う点を、日本語の Markdown で報告する。
