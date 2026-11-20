# 実装指示書（修正 1）: 「先生の資料」の高さの上限の残りを消す

あなた（Codex）は、この指示書に沿ってコードを直します。進め方は `AGENTS.md` の「実装を頼まれたとき」のとおりです。もとの指示書は `.ai-tasks/20261120-173000_lesson-columns-same-height.md`。

## 目的

もとの指示書（Claude Code が書いたもの）に抜けがあった。`css/app.css` には、「先生の資料」の高さの上限が、ほかに 3 か所残っている。とくに先生が 1 人の記録を見る画面（`.teacher-record-page`）では、上限だけが残り、枠の中のスクロールが消えたので、中身が枠の下にはみ出す。これを直す。

## 変える内容（`css/app.css` だけ）

1. 次の決まりを、行ごと消す（先生が記録を見る画面の上限）。

   ```css
   .teacher-record-page .student-lesson-teacher { max-height: calc(100vh - 300px); max-height: calc(100dvh - 300px); }
   ```

2. 次のブロックを、まるごと消す（上限が無くなったので、打ち消しは要らない）。

   ```css
   @media (orientation: portrait) {
     .student-lesson-teacher { max-height: none; overflow-y: visible; }
   }
   ```

3. 次のブロックの中の 2 行目だけを消す。1 行目（`grid-template-columns`）は残す。

   ```css
   @media (orientation: portrait), (max-width: 899px) {
     .teacher-record-page .student-lesson-columns { grid-template-columns: minmax(0, 1fr); }
     .teacher-record-page .student-lesson-teacher { max-height: none; overflow-y: visible; }
   }
   ```

- 消したあと、空の行が 2 つ以上続かないようにする。ほかの決まりは変えない。

## 端の場合

- 不正な入力: 入力は扱わない（見た目だけの変更）。
- 重複と境界: 先生が記録を見る画面でも、2 列のときは 2 つの枠が同じ高さになり、中身は枠からはみ出さない。1 列のときは、それぞれ中身の高さになる。
- 違反や失敗の見せ方: 変えない。

## テスト

- `tests/lesson-columns-css.test.js` に足す: `css/app.css` の全体で、セレクタに `.student-lesson-teacher` または `.student-lesson-mine` を含むどの決まり（`{ … }` のブロック）にも、`max-height` と `overflow-y` が無いこと（`.teacher-record-page` の付いたもの、`@media` の中のものも含む）。
- `npm test` がすべて成功すること。

## 守ること

- `git add`・`git commit` はしない。パッケージを足さない。
- 変えてよいのは `css/app.css` と `tests/lesson-columns-css.test.js` だけ。
- このフォルダの外は読まない・変えない。

## 報告

変更したファイル、テストの結果、指示書と違う点・自分で決めた点・確かめられなかった点を、日本語の Markdown で報告する。
