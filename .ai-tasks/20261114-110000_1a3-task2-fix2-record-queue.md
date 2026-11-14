# 実装指示書: 段階 1a-3 Task 2 の修正 2（記録の書きこみを、授業ごとに 1 本ずつ順に行う）

あなた（Codex）は、この指示書に沿ってコードを直します。進め方は `AGENTS.md` の「実装を頼まれたとき」のとおりです。

## 目的

Codex レビュー `.ai-review/20261114-102556_round2.md` の指摘 1（High）を直す。

一覧の画面が始めた「下書きの送り直し」の通信が遅れている間に、生徒が授業を開いて書き足し、その自動保存が先に成功すると、あとから届いた古い送り直しが、新しい記録を上書きしてしまう。これを防ぐために、同じ生徒・同じ授業の記録の書きこみ（送り直しと自動保存）を、1 本ずつ順に行う。

## 変える・作るファイル

- 作る: `js/record-queue.js`、`tests/record-queue.test.js`
- 変える: `js/record-flow.js`、`tests/record-flow.test.js`、`js/main.js`、`js/views/student-home.js`、`js/views/student-lesson.js`

ほかのファイルは変えない。

### 1. `js/record-queue.js`

`createRecordQueue() → { run(key, fn) → Promise }`

- `key` は文字（`<classId>/<lessonId>` の形で呼ぶ）。同じ `key` の `fn` は、前のものが終わって（成功でも失敗でも）から、呼ばれた順に 1 つずつ実行する。違う `key` は待たない。
- `run` は、`fn()` の結果（または例外）をそのまま返す。前の `fn` が失敗しても、次の `fn` は実行する。
- `fn` が同期の関数でも、例外を投げても、列が止まらない。
- 列が空になった `key` は、中の表から消す（増え続けない）。
- ブラウザのもの（`window`・`setTimeout` など）は使わない。

### 2. `js/record-flow.js` の `resendDrafts`

- 引数に `queue`（`createRecordQueue` の戻り値）を足す: `resendDrafts({ repo, drafts, studentId, now, max, queue })`。
- 1 件ごとに、**送る所（下書きの読み直し → `repo.saveRecord` → 下書きを消す）を `queue.run(`${classId}/${lessonId}`, …)` の中で行う。** 列の中で下書きを読み直し、無い・`editedAt` が一覧のときと違えば、送らずに `kept`（今の決まりのまま）。
  - こうすると、授業のページの自動保存が先に成功して下書きが消えていれば、送り直しは送られない。送り直しが先に通信を始めていれば、授業のページの自動保存はそのあとに送られるので、新しい内容が残る。
- `repo.getRecord`（サーバーと比べるための読みこみ）は、列の外で行ってよい。
- サーバーのほうが新しくて下書きを捨てる所も、同じ列の中で、下書きを読み直してから消す。
- `now` は今までどおり（時刻の数）。

### 3. `js/main.js`

- `createRecordQueue()` を 1 つ作り、`ctx.recordQueue` として画面に渡す（画面を移っても同じものを使う）。

### 4. `js/views/student-home.js`

- `resendDrafts` に `queue: ctx.recordQueue` を渡す。ほかは変えない。

### 5. `js/views/student-lesson.js`

- 自動保存の `save` の中の `ctx.repo.saveRecord(…)` を、`ctx.recordQueue.run(`${classId}/${lessonId}`, () => …)` の中で行う。**`ctx.now()` は、列の順番が来て、送る直前に取る**（待っている間の古い時刻を `updatedAt` にしない）。ほかは変えない。

## 端の場合

- 不正な入力: `fn` が関数でないときは、`TypeError` で断る（列には入れない）。`key` が文字でないときも同じ。
- 重複と境界: 同じ `key` に 3 つ続けて入れても、1 → 2 → 3 の順に 1 つずつ。1 つ目が失敗しても 2 つ目を実行する。列が空になったあとに入れた `fn` は、すぐ実行する。違う `key` どうしは同時に実行してよい。
- 違反や失敗の見せ方: `run` は `fn` の例外をそのまま返すので、今ある表示（保存の状態の「保存できませんでした」、一覧の「まだ保存できていない記録が N 件あります。」）がそのまま出る。黙って捨てない。

## 追加・変更するテスト

- `tests/record-queue.test.js`: 同じ `key` は順番に 1 つずつ（前のが終わるまで次を呼ばない）。違う `key` は待たない。失敗のあとも次を実行する。結果と例外をそのまま返す。同期の例外でも止まらない。`fn` が関数でない → `TypeError`。
- `tests/record-flow.test.js`:
  - **送り直しの `saveRecord` が遅れている間に、同じ列へ新しい保存（授業のページの自動保存の代わり）を入れる → サーバーの最後の中身は、新しい保存のもの。**
  - 送り直しが列の順番を待っている間に、下書きが消される（自動保存が先に成功した）→ 送り直しは `saveRecord` を呼ばない（`kept`）。
  - 今あるテストは、`queue: createRecordQueue()` を渡して通るようにする。

## 守ること

- `git add`・`git commit` はしない。
- データベースの形と規則は変えない。
- `js/views/` と `js/main.js` のほかのモジュールは、ブラウザのものを直接使わない。

## 完了の条件

- `npm test` がすべて成功する。変えた・作った `.js` は `node --check` で構文を確かめる。

## 報告

変更したファイル、テストの結果、指示書と違う点を、日本語の Markdown で報告する。
