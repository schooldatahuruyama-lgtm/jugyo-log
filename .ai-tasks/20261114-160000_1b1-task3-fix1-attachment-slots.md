# 実装指示書: 段階 1b-1 Task 3 の修正 1（添付の目録の読みまちがいと、置き場所の上書きを防ぐ）

あなた（Codex）は、この指示書に沿ってコードを直します。進め方は `AGENTS.md` の「実装を頼まれたとき」のとおりです。

## 目的

Codex レビュー `.ai-review/20261114-193501_round1.md` の指摘 1・2（High）・3（Medium）を直す。指摘 1 は、Claude Code もブラウザで確かめた（生徒が授業を開き直すと、足した添付が「（まだありません）」になる。先生の画面にも出ない）。

## 変えるファイル

`js/views/parts/attachment-pane.js`、`js/views/student-lesson.js`、`js/views/teacher-record.js`、`js/views/teacher-review.js`、`js/attachment-flow.js`、`tests/attachment-flow.test.js`、`docs/setup/rules.json`、`tests/rules-shape.test.js`、`js/rules-probe.js`、`tests/rules-probe.test.js`、`docs/superpowers/specs/2026-11-13-jugyo-log-1a-data.md`（4 章に下の規則を 1 行足す）、`README.md`・`docs/reports/stage1b-1-check.md`（規則の確認の項目数を 54 から 57 に直し、足した 3 行を表に足す）。ほかのファイルは変えない。

### 1. 目録を 2 回変換しない（指摘 1）

`repo.getRecord`・`repo.listRecords` の `attachments` は、もう `attachmentList` の結果（配列）になっている。画面でもう一度 `attachmentList` に渡すと、空になる。

- `js/views/student-lesson.js`・`js/views/teacher-record.js`: repo が返した配列を、そのまま `attachmentPane` に渡す（無ければ `[]`）。
- `js/views/teacher-review.js`: 「添付 N」の数は、配列の長さから取る。

### 2. 使っている置き場所を、規則で上書きできなくする（指摘 2・3 の土台）

`docs/setup/rules.json` の `records/$classId/$lessonId/$sid/attachments/$aid` の `.validate` に、次の条件を足す:

- **その置き場所にすでに目録があるときは、同じ `fileId` のものだけを受けつける**（`!data.exists() || newData.child('fileId').val() === data.child('fileId').val()`）。別のファイルに入れかえるには、先に消す。消すこと（`null`）は今までどおりできる。

こうすると、遅れて届いた古い登録が、あとから足した別の添付を上書きできない（規則が断る）。同じファイルのやり直し（応答だけが失われたとき）は通る。

### 3. `js/attachment-flow.js`

- `addAttachmentFlow({ …今の引数, isCancelled = () => false })`:
  1. `files.uploadStudent` → `{ fileId, bytes }`。
  2. **`isCancelled()` が `true` なら**（ページを離れた・「やめる」を押した）、目録に登録せず、`files.trashStudent(fileId)` を試して（失敗しても例外にしない）、`{ fileId, cancelled: true }` を返す。
  3. `repo.addAttachment`。**`denied` で失敗したら**（その置き場所が、別の添付で使われていた）、`files.trashStudent(fileId)` を試して（失敗しても例外にしない）、`code` が `'slot-taken'` の `NetError` を投げる。ほかの失敗は、例外をそのまま投げる（同じ `key`・同じ `slot` でやり直せる）。
  4. 成功は `{ fileId, cancelled: false }`。
- `discardAttachmentFlow({ repo, files, classId, lessonId, studentId, slot, fileId }) → { cleaned: boolean }`（「やめる」のときの片付け）:
  - `fileId` が無い（アップロードの応答を受け取れていない）ときは、何もせず `{ cleaned: true }`。
  - `repo.getRecord` で今の目録を読み、その `slot` の `fileId` が同じなら `repo.removeAttachment`（応答だけが失われて、実は登録されていた場合）。そのあと `files.trashStudent(fileId)`。
  - 読む・消すのに失敗したら、例外にせず `{ cleaned: false }`（呼んだ側は、その添付を画面に残して、もう一度「やめる」「やり直す」を選べるようにする）。`trashStudent` だけの失敗は `{ cleaned: true }`（目録には無い。Drive に残ったファイルは、だれにも共有されていない）。

### 4. `js/views/parts/attachment-pane.js`

- 足すとき: `addAttachmentFlow` に `isCancelled`（この部品が `destroy()` された、またはその添付で「やめる」が押された）を渡す。
- `'slot-taken'` で失敗したら、`repo.getRecord` で目録を読み直して並べ直し、その添付は**新しい `key` と、読み直したあとの空いている置き場所**でやり直せるようにする（「送れませんでした」と「やり直す」「やめる」。空きが無ければ「写真・PDF は 6 個までです。」と出して、やり直しは出さない）。
- 「やめる」: 送っている途中なら、取りやめの印を付けて（`isCancelled` が `true` になる）、その場所に「片付けています…」と出す。失敗して止まっているものなら、`discardAttachmentFlow` を呼ぶ。`cleaned: false` なら、「片付けられませんでした。もう一度ためしてください。」と出して、その添付を残す（置き場所を空きに戻さない）。`cleaned: true` で、はじめて場所を空ける。
- `destroy()` のあとに終わった通信で、画面を書きかえない（今ある `alive` の確かめ）。登録の前なら、上の `isCancelled` で登録されない。
- `busy` は、送っている途中・失敗して止まっている・片付けている途中のものがあれば `true`。

### 5. `js/rules-probe.js`（54 → 57 項目）

次の 3 行を、今ある添付の行のあとに足す。片付けは今のまま（生徒として記録と `recThumbs` を消す）。

| 試すこと（確認用の生徒として） | 期待 |
|---|---|
| すでにある `attachments/a1` を、同じ `fileId` で書き直す | ok |
| すでにある `attachments/a1` を、別の `fileId` で書きかえる | denied |
| `recThumbs/…/<自分>` に、文字を直接書く | denied |

## 端の場合

- 不正な入力: repo の `attachments` が配列でない（`undefined` など）ときは `[]` として扱う。`discardAttachmentFlow` の `fileId` が文字でないときは、何もせず `{ cleaned: true }`。
- 重複と境界: 同じ `fileId` の書き直しは通る（やり直し）。6 個うまっていて `'slot-taken'` になったら、やり直しを出さない。「やめる」を続けて押しても、片付けは 1 回。`destroy()` を 2 回呼んでも落ちない。
- 違反や失敗の見せ方: 置き場所が使われていたときは、その添付に「送れませんでした」と「やり直す」「やめる」。片付けられないときは「片付けられませんでした。もう一度ためしてください。」。黙って上書きしない・黙って消さない。

## 追加・変更するテスト

- `tests/attachment-flow.test.js`:
  - `isCancelled` が `true` → `addAttachment` を呼ばず、`trashStudent` を呼び、`cancelled: true`。`trashStudent` が失敗しても例外にならない。
  - `addAttachment` が `denied` → `trashStudent` を呼び、`code: 'slot-taken'` の例外。`network` の失敗 → `trashStudent` を呼ばず、例外はそのまま。
  - `discardAttachmentFlow`: `fileId` なし → 通信なしで `cleaned: true`。目録に同じ `fileId` → `removeAttachment` と `trashStudent`。目録が別の `fileId`・無い → `removeAttachment` を呼ばず、`trashStudent` だけ。`getRecord` が失敗 → `cleaned: false`。`trashStudent` だけ失敗 → `cleaned: true`。
- `tests/rules-shape.test.js`: `$aid` の `.validate` に、`data.exists()` と `fileId` を比べる条件が入っている。
- `tests/rules-probe.test.js`: 足した 3 行が、代役の答えどおりに `pass` になる・ならない。合計 57 行。
- 画面のテストのファイルは足さない。直した流れ（添付を保存 → 画面を作り直す → 添付が並ぶ → もう 1 つ足すと、空いている次の置き場所を使う）を、代役の `ctx` を使った手元の実行で確かめ、結果を報告に書く。

## 守ること

- `git add`・`git commit` はしない。
- 生徒のファイルの名前を保存しない。先生の画面に、足す・消すの操作を出さない。

## 完了の条件

- `npm test` がすべて成功する。変えた `.js` は `node --check` で構文を確かめる。

## 報告

変更したファイル、テストの結果、指示書と違う点を、日本語の Markdown で報告する。
