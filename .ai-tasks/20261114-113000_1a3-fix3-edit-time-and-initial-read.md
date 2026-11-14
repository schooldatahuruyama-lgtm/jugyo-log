# 実装指示書: 段階 1a-3 の修正 3（記録の時刻を「書いた時刻」にする、授業ページのはじめの読みこみを列の中で行う）

あなた（Codex）は、この指示書に沿ってコードを直します。進め方は `AGENTS.md` の「実装を頼まれたとき」のとおりです。

## 目的

Codex レビュー `.ai-review/20261114-103718_round1.md` の指摘 1・2（どちらも High）を直す。あわせて、Claude Code がブラウザの確認で見つけた 1 点（下の 4）を直す。

## 考え方

- **記録の `updatedAt` は、「サーバーへ送った時刻」ではなく「その内容を書いた時刻（下書きの `editedAt` と同じ値）」にする。** こうすると、古い内容 A があとから送られても、A の `updatedAt` は、あとで書いた下書き B の `editedAt` より必ず古い。B が送れないまま開き直しても、B が「新しい」と判定されて残る（指摘 2）。
- **授業ページのはじめの読みこみ（サーバーの記録と下書きの組）を、送り直しと同じ列（`ctx.recordQueue`）の中で行う。** 送り直しは「送る → 下書きを消す」を列の中で行うので、授業ページは「送り直しの前（下書きがまだある）」か「送り直しのあと（サーバーが新しい）」のどちらかを、そろった組で読める（指摘 1）。

## 変えるファイル

`js/record-saver.js`、`tests/record-saver.test.js`、`js/record-flow.js`、`tests/record-flow.test.js`、`js/views/student-lesson.js`、`js/views/student-home.js`。ほかのファイルは変えない。

### 1. `js/record-saver.js`

- `edit(record)` で取った時刻（`now()`）を、その内容の `editedAt` として覚える（`saveDraft(record, editedAt)` に渡している値と同じもの）。
- `save` の呼び方を `save(record, editedAt)` にする（その内容を書いた時刻を 2 つ目の引数で渡す）。やり直しのときも、同じ内容なら同じ `editedAt` を渡す。
- ほかの動き（待つ・1 本ずつ・やり直し・`flush`・`dispose`）は変えない。

### 2. `js/record-flow.js` の `resendDrafts`

- 引数の `now` をやめる。`repo.saveRecord(classId, lessonId, studentId, record, draft.editedAt)` と、下書きを書いた時刻を `updatedAt` として送る。
- ほかの動き（列の中で下書きを読み直す・変わっていれば送らない）は変えない。

### 3. `js/views/student-lesson.js`

- 自動保存の `save` を `(value, editedAt) => ctx.recordQueue.run(key, () => ctx.repo.saveRecord(classId, lessonId, studentId, value, editedAt))` の形にし、保存できたら、画面が持っている `updatedAt` を `Math.max(updatedAt, editedAt)` にする。`ctx.now()` を `updatedAt` に使わない。
- はじめの読みこみ: `ctx.repo.getLesson` は今までどおり列の外で読む。**`ctx.repo.getRecord` と `ctx.drafts.get` は、`ctx.recordQueue.run(key, …)` の 1 つの関数の中で、続けて読む**（`getRecord` を待ったあと、すぐ同じ関数の中で `drafts.get`）。その 2 つの結果を `pickInitial` に渡す。授業の読みこみと記録の読みこみは、今までどおり同時に進めてよい。失敗の扱い（`denied` は「この授業は見つかりません。」、通信の失敗は「つながりません。…」）は変えない。
- `key` は `` `${classId}/${lessonId}` ``（今の保存と同じ）。
- 画面に戻ってきたときの読み直し（`refreshRecord`）は変えない。

### 4. `js/views/student-lesson.js` の、写真を読めなかったときの見た目

今は、写真の本体を読めなかったとき、先に出していた小さい画像（サムネイル）まで消して「写真」の文字にしている。小さい画像が出ていたなら、それを残したまま「読みこめませんでした」と「もう一度」を出す（押して大きく表示することは、今までどおりできない）。小さい画像が無いときだけ「写真」の文字を出す。

### 5. `js/views/student-home.js`

- `resendDrafts` の呼び出しから `now` を外す。ほかは変えない。

## 端の場合

- 不正な入力: `editedAt` が数でない下書きは、今までどおり `drafts` が返さない（`null`）。`save` に渡す `editedAt` は、必ず `edit` のときに取った数。
- 重複と境界: 同じ内容のやり直しでは、同じ `editedAt` を送る（`updatedAt` が進まない）。下書きの `editedAt` とサーバーの `updatedAt` が同じときは、今までどおりサーバーを使う（同じ内容なので、どちらでも同じ）。はじめの読みこみが列の順番を待っている間に画面を離れたら、結果を捨てる（今ある `alive` の確かめ）。
- 違反や失敗の見せ方: 今ある表示のまま（保存の状態、「この授業は見つかりません。」、「つながりません。…」、「読みこめませんでした」と「もう一度」）。黙って古い内容に戻さない。

## 追加・変更するテスト

- `tests/record-saver.test.js`:
  - `save` の 2 つ目の引数は、その内容を `edit` した時刻（`saveDraft` に渡した値と同じ）。送る時刻ではない（`edit` のあとに時計を進めてから送っても、`edit` の時刻が渡る）。
  - 送っている途中に `edit` した場合、2 回目の `save` には 2 回目の `edit` の時刻が渡る。
  - やり直しでは、同じ `editedAt` が渡る。
- `tests/record-flow.test.js`:
  - `saveRecord` の `now` に、下書きの `editedAt` が渡る。
  - **「A を書く → B を書く（下書きは B・時刻 t2）→ A だけがサーバーに入る（`updatedAt` は A を書いた時刻 t1）→ 開き直す」で、`pickInitial(サーバーの A, 下書きの B)` が B を選ぶ**（`record-logic` の `pickInitial` を使って確かめる）。
  - 今あるテストは、`now` を渡さない形に直して通す。

## 守ること

- `git add`・`git commit` はしない。
- データベースの形と規則は変えない（`updatedAt` は数のまま）。
- `js/views/` と `js/main.js` のほかのモジュールは、ブラウザのものを直接使わない。

## 完了の条件

- `npm test` がすべて成功する。変えた `.js` は `node --check` で構文を確かめる。

## 報告

変更したファイル、テストの結果、指示書と違う点を、日本語の Markdown で報告する。
