# 実装指示書: 段階 1b-1 Task 3 の修正 2（「やめる」を単純にして、食い違いの道をなくす）

あなた（Codex）は、この指示書に沿ってコードを直します。進め方は `AGENTS.md` の「実装を頼まれたとき」のとおりです。

## 目的

Codex レビュー `.ai-review/20261114-194957_round2.md` の指摘 1（High）・2・3（Medium）を直す。

3 つとも、「送っている途中の取りやめ」と「取りやめのときに、目録から消す片付け」が、ほかの操作と重なったときに起きる。そこで、**作りを単純にする**（Claude Code の判断）:

- **送っている途中は「やめる」を出さない。**「やめる」が出るのは、送るのに失敗して止まっているときだけ。
- **「やめる」は、目録から何も消さない。** サーバーの目録を読み、その添付がもう保存されていたら、保存済みの添付として並べる（生徒は、ふつうの「消す」で消せる）。保存されていなければ、送ったファイルをゴミ箱に入れて、画面から外す。

## 変えるファイル

`js/attachment-flow.js`、`tests/attachment-flow.test.js`、`js/views/parts/attachment-pane.js`。ほかのファイルは変えない。

### 1. `js/attachment-flow.js`

- `discardAttachmentFlow` を消し、代わりに `settleAttachmentFlow({ repo, files, classId, lessonId, studentId, fileId }) → { saved: boolean, attachments }` を作る。
  - `repo.getRecord` で今の目録を読む（失敗したら、例外をそのまま投げる。呼んだ側は、その添付を画面に残す）。`attachments` は、読んだ目録（無ければ `[]`）。
  - `fileId` が文字で、目録の中に同じ `fileId` の添付があれば `{ saved: true, attachments }`（何も消さない）。
  - 目録に無く、`fileId` が文字なら、`files.trashStudent(fileId)` を試して（失敗しても例外にしない）`{ saved: false, attachments }`。`fileId` が無ければ、何もせず `{ saved: false, attachments }`。
  - **`repo.removeAttachment` は呼ばない。**
- `addAttachmentFlow` は今のまま（`isCancelled` は、ページを離れたときにだけ使う。`'slot-taken'` もそのまま）。

### 2. `js/views/parts/attachment-pane.js`

- 送っている途中の添付には、「送っています…」だけを出す（「やめる」を出さない）。「片付けています…」の状態と、送っている途中の取りやめの印は、なくす。`isCancelled` は「この部品が `destroy()` された」だけにする。
- 失敗して止まっている添付の「やめる」: `settleAttachmentFlow` を呼ぶ（呼んでいる間は、その添付のボタンを押せなくする）。
  - 結果の `attachments` で、保存済みの並びを作り直す。
  - `saved: true` なら、その添付は保存済みとして並び、「この写真は、もう保存されていました。」（PDF なら「この PDF は、…」）と `toast` を出す。`saved: false` なら、画面から外す。
  - 例外（読めなかった）なら、「確かめられませんでした。もう一度ためしてください。」と出して、その添付を残す（置き場所を空きに戻さない）。
- 「やり直す」は今のまま（同じ `key`・同じ `slot`）。
- **目録を読み直したとき（`'slot-taken'` のあと・「やめる」のあと）は、送っている途中・失敗して止まっている添付のうち、読み直した目録に同じ `fileId` があるものを、保存済みの 1 つにまとめる**（同じ添付が 2 つ並ばないように）。`fileId` がまだ分からないもの（アップロードの応答の前）は、そのまま残す。
- `destroy()` のあとは、画面を書きかえない（今のまま）。
- `busy` は、送っている途中・失敗して止まっているものがあれば `true`（今のまま）。

## 端の場合

- 不正な入力: `fileId` が文字でない → ゴミ箱の通信をせず、`saved: false`。読んだ記録が `null`（まだ記録が無い）→ 目録は `[]`。
- 重複と境界: 「やめる」を続けて押しても、通信は 1 回。読み直した目録が 6 個で、失敗して止まっている添付の置き場所がもう使われていたら、「やり直す」を出さず、「写真・PDF は 6 個までです。」と「やめる」だけを出す（今ある `'slot-taken'` の扱いに合わせる）。同じ `fileId` が、保存済みと未完了の両方にあれば、保存済みの 1 つだけにする。
- 違反や失敗の見せ方: 確かめられないときは文を出して残す。保存されていたときは、そう知らせて並べる（黙って消さない・黙って残さない）。

## 追加・変更するテスト（`tests/attachment-flow.test.js`）

- `settleAttachmentFlow`: 目録に同じ `fileId` → `saved: true`、`trashStudent` も `removeAttachment` も呼ばない。目録に無い → `trashStudent` を呼び `saved: false`。`trashStudent` が失敗しても例外にならない。`fileId` なし → 通信は `getRecord` だけ。`getRecord` が失敗 → 例外で、`trashStudent` を呼ばない。記録が `null` → `attachments: []`。
- **`removeAttachment` を、どの場合も呼ばない**（代役に入れて、呼ばれたら失敗にする）。
- `discardAttachmentFlow` のテストは消す。
- 画面のテストのファイルは足さない。直した流れ（失敗 →「やめる」→ 保存されていた場合は並ぶ・いなかった場合は外れる、読み直しで同じ添付が 2 つ並ばない）を、代役の `ctx` を使った手元の実行で確かめ、結果を報告に書く。

## 守ること

- `git add`・`git commit` はしない。規則とデータの形は変えない。

## 完了の条件

- `npm test` がすべて成功する。変えた `.js` は `node --check` で構文を確かめる。

## 報告

変更したファイル、テストの結果、指示書と違う点を、日本語の Markdown で報告する。
