# 実装指示書: 段階 1b-1 Task 2

あなた（Codex）は、この指示書に沿ってコードを書きます。進め方は `AGENTS.md` の「実装を頼まれたとき」のとおりです。

- 計画: `docs/superpowers/plans/2026-11-14-jugyo-log-stage1b-1.md` の Task 2（下に、そのまま写してあります）
- 設計: `docs/superpowers/specs/2026-11-12-jugyo-log-design.md`（5.3・7.3）、`docs/superpowers/specs/2026-11-13-jugyo-log-1a-data.md`（データの形）
- 目的: 要件定義書（`docs/requirements.md`）の「生徒の添付」（生徒が自分の授業記録に写真・PDF を追加する）と「公開範囲」（本人と先生だけが見られる）を作る。
- 進め方: 下の Step を順に行う。テストを先に書き、失敗するのを確かめてから実装する。
- 完了の条件: Step をすべて行い、`npm test` がすべて成功する。新しく書いた `.js` は `node --check` で構文を確かめる。
- `git add`・`git commit`・ブランチの操作はしない（「コミット」の Step は行わない。Claude Code が行う）。
- 変えてよいのは、下の「Files」にあるファイルだけ。ほかの変更が必要だと思ったら、変えずに報告に書く。
- ブラウザでの確認は行わなくてよい（Claude Code が行う）。
- 終わったら、変更したファイル・`npm test` の結果・指示書と違う点・気になった点を、日本語の Markdown で報告する。

## Global Constraints

- 作業フォルダは `C:\Users\yan12\Documents\keita\AI開発\授業ログアプリ`。この外は読まない・編集しない。
- 外部パッケージをインストールしない。Firebase の SDK を入れない。外部の配信元から実行時に読み込まない。Firebase は Spark プランのまま。
- `js/views/` と `js/main.js` のほかのモジュールは、`window`・`document`・`fetch`・`localStorage`・`caches`・`Date.now`・`setTimeout` を直接使わず、引数で受け取る（`js/image.js` の `compressImage` と `js/pdf.js` は、ブラウザのものを使ってよい）。
- データベースの場所を書いてよいのは `js/repo.js`・`js/dev/`・`js/rules-probe.js` だけ。GAS の呼び方（op の名前と本文の形）を書いてよいのは `js/gas.js`・`js/files.js`・`js/dev/` だけ。
- GAS を呼ぶ通信の形（`text/plain` の POST、トークンは本文、成否は JSON の `ok`）は変えない。
- **生徒のファイルを開けるのは、持ち主の生徒と先生だけ。GAS は、呼んだ人が書きかえられる情報（データベースの記録の中の `fileId` など）を根拠にしない。** 根拠にするのは、GAS が保存のときにファイルの説明に書いた持ち主と、トークンで確かめた本人。
- Drive に保存したファイルを、だれとも共有しない（`setSharing`・`addViewer` などを呼ばない）。
- 生徒の本名、学校のメールアドレスを保存しない・入力させない。**生徒のファイルの名前（もとのファイル名）は保存しない**（名前に本名が入っていることがあるため）。画面では「写真 1」「PDF 2」のように出す。
- パスワード・トークンを、`console`・エラーの文・保存・Drive のファイルの説明に出さない。
- 先生は、生徒の記録と添付を書かない・消さない。
- 画面に出す文字は `textContent` で入れる。`innerHTML` を使わない。Blob の URL は使い終わったら外す。
- 基準の端末は iPad の Safari（横 1180×820 と縦 820×1180）。ボタンは 44×44px 以上。状態は色だけで伝えず、文字を添える。
- 画面の文とコードのコメントは日本語。生徒が読む文は、短く、やさしい言葉で書く。
- 書き方は、今ある `gas/Code.gs`・`js/material-flow.js`・`js/files.js`・`js/repo.js`・`js/views/student-lesson.js`・`js/views/parts/material-pane.js` に合わせる。
- `git add`・`git commit`・ブランチの操作はしない。指示書の「Files」のほかのファイルは変えない。変える必要があると思ったら、変えずに報告に書く。
- `check.html`・`js/check-*.js`・`gas/check/` は変えない。

## この計画で決めたこと（Claude の判断）

| 項目 | 決めたこと |
|---|---|
| 個数 | 1 回の授業につき 6 個まで（設計書のとおり）。置き場所を `a1`〜`a6` の 6 つに決め、データベースの規則でも 7 個目を断る |
| 足し方 | 「＋ 写真・PDF」のボタン 1 つ。iPad では、写真を撮る・写真から選ぶ・ファイルから選ぶ、が出る。1 回に 1 つずつ足す |
| 大きさ | 写真は、送る前に長辺 1600px に縮める。PDF は 10MB まで |
| 写真と PDF のほか | 「写真か PDF だけを足せます。」と出して、足さない |
| 名前 | もとのファイル名は保存しない。「写真 1」「PDF 2」のように、種類と順番で出す |
| 並び順 | 足した順（古いものが先） |
| 送っている間 | その添付に「送っています…」と出す。メモや振り返りは、そのまま書ける |
| 送れなかったとき | その添付に「送れませんでした」と「やり直す」「やめる」を出す。選んだファイルは、ページを開いている間だけ持っておく |
| 送っている途中・送れないままページを離れるとき | 「まだ送れていない写真・PDF があります。離れると、送れていない分は消えます。」と確かめる |
| 消す | 「この写真を消しますか？　消すと元にもどせません。」と確かめてから消す。目録から外し、Drive のファイルはゴミ箱に入れる |
| 小さい画像 | 足すときに端末で作り、データベースに置く。開いたときに GAS を呼ばずに並べられる。本体は、押したときに取り出す（1 回取り出したら端末に取っておく） |
| 先生の画面 | 1 人の記録の画面に、同じ小さい画像を並べ、押すと大きく表示する。一覧の行には「添付 2」のように個数を出す。先生は足せない・消せない |
| 一覧の印 | 変えない（理解度を選んであれば「記録あり」） |
| 文字の記録の保存 | 今は記録をまるごと置きかえているので、添付の目録を消さないように、項目ごとに書く形に変える（生徒から見える動きは変わらない） |

## Review Focus

1. **ほかの生徒のファイルを開こうとする**（自分の記録の目録に他人の `fileId` を書く、GAS に他人の `fileId` を送る）。GAS は説明の持ち主を見て断り、中身を返さないこと（Task 1）。
2. **保存の応答だけが失われた場合**。同じキーでもう一度送ると、Drive のファイルは 1 個のままで、目録も 2 重にならないこと（Task 1・Task 2）。
3. **文字の記録の保存で、添付の目録が消えないこと**。添付の追加・削除で、文字の記録と `updatedAt` が変わらないこと（Task 2）。
4. **7 個目を足そうとする・同じ置き場所に 2 つ同時に足そうとする**。画面でも規則でも断ること（Task 2・Task 3）。
5. **先生のファイル用の op で生徒のファイルを、生徒のファイル用の op で先生の資料を、開けない・消せないこと**（Task 1）。

---

### Task 2: 添付のデータの出し入れ

**Files:**
- Create: `js/attachment-flow.js`、`tests/attachment-flow.test.js`
- Modify: `docs/setup/rules.json`、`tests/rules-shape.test.js`、`docs/superpowers/specs/2026-11-13-jugyo-log-1a-data.md`（3 章と 4 章に、下の形と規則を書き足す）、`js/record-logic.js`、`tests/record-logic.test.js`、`js/repo.js`、`tests/repo.test.js`、`js/files.js`、`tests/files.test.js`、`js/dev/demo-gas.js`、`tests/demo-gas.test.js`、`js/config.js`

**Interfaces:**
- Consumes: Task 1 の op の表（`js/dev/demo-gas.js` は、同じ op と返し方を端末の中でまねる。版は `'app-2'`）。
- Produces:
  - データの形: `records/<classId>/<lessonId>/<生徒ID>/attachments/<a1〜a6>`: `{ type: 'image' | 'pdf', fileId, bytes, addedAt }`。`recThumbs/<classId>/<lessonId>/<生徒ID>/<a1〜a6>`: 小さい画像のデータ URL。
  - `docs/setup/rules.json`:
    - `records/$classId/$lessonId/$sid` の下に `attachments` を足す: `$aid` は `/^a[1-6]$/` に合うものだけ。中身は `type`（`'image'` か `'pdf'`）・`fileId`（1〜200 文字の文字）・`bytes`（0 以上の数）・`addedAt`（数）が全部あり、ほかの項目は受けつけない。今ある `$other: false` はそのまま（`attachments` のほかの知らない項目は断る）。
    - `recThumbs` を足す: `$classId` の `.read` は先生。`$lessonId/$sid` の `.read` は本人、`.write` は本人（その組の一員で、その授業があるとき。`records` の `.write` と同じ式）。`$aid` は `/^a[1-6]$/` に合い、20000 文字までの文字。
    - ほかの場所は変えない。
  - `js/config.js`: `attachmentSlots: ['a1', 'a2', 'a3', 'a4', 'a5', 'a6']`。
  - `js/record-logic.js`:
    - `attachmentList(v) → [{ slot, type, fileId, bytes, addedAt }]`（形のおかしいもの・`a1`〜`a6` でないキーは入れない。`addedAt` の古い順、同じなら `slot` 順。`v` が `null`・配列でも落ちない）
    - `freeSlot(attachments, busy = []) → slot | null`（`attachments` は `attachmentList` の結果。使っていない最初の置き場所。`busy`（送っている途中の置き場所）も使っているものとして数える。空きが無ければ `null`）
    - `attachmentLabels(attachments) → { [slot]: '写真 1' | 'PDF 1' … }`（並び順で、種類ごとに 1 から数える）
  - `js/repo.js`:
    - `saveRecord` を、**項目ごとの書きこみ**に変える: 1 回の `net.update('', …)` で、`records/<c>/<l>/<sid>/memo`・`/learned`・`/question`・`/updatedAt`・`/level`（`null` なら消す）と、`marks/<sid>/<c>/<l>` を書く。`attachments` にはさわらない。
    - `getRecord`・`listRecords` の結果に `attachments`（`attachmentList` の結果）を足す。
    - `addAttachment(classId, lessonId, studentId, slot, { type, fileId, bytes }, thumb, now) → void`（1 回の update で、`records/…/attachments/<slot>` に `{ type, fileId, bytes, addedAt: now }` を置き、`thumb` が文字なら `recThumbs/…/<slot>` を置く。文字の記録と `updatedAt` にはさわらない）
    - `removeAttachment(classId, lessonId, studentId, slot) → void`（1 回の update で、目録と小さい画像を消す）
    - `getRecThumbs(classId, lessonId, studentId) → { [slot]: dataURL }`（文字のものだけ）
  - `js/files.js`:
    - `uploadStudent({ key, classId, lessonId, mime, dataB64 }) → { fileId, bytes }`（`putStudentFile`）
    - `loadStudentFile(fileId) → Blob`（取り置きにあればそれを返す。無ければ `getStudentFile`。取り置きに入れる）
    - `trashStudent(fileId) → boolean`（`trashStudentFile` のあと、取り置きからも消す。戻り値は `trashed`）
  - `js/attachment-flow.js`（通信の順番だけ。画面と DOM を知らない）:
    - `addAttachmentFlow({ repo, files, classId, lessonId, studentId, slot, key, type, mime, dataB64, thumb, now }) → { fileId }`。順番: (1) `files.uploadStudent` → (2) `repo.addAttachment`。(2) が失敗したら例外をそのまま投げる（同じ `key`・同じ `slot` でやり直せば、ファイルも目録も増えない）。
    - `removeAttachmentFlow({ repo, files, classId, lessonId, studentId, attachment }) → { trashed: boolean }`。順番: (1) `repo.removeAttachment` → (2) `files.trashStudent(attachment.fileId)`。(1) の失敗は例外。(2) の失敗は例外にせず `{ trashed: false }`（目録からは消えている。Drive に残ったファイルは、だれにも共有されていない）。

**端の場合:**
- 不正な入力: 目録の 1 件が、オブジェクトでない・`type` が知らない値・`fileId` が文字でない・`a7` などのキー → `attachmentList` に入れない（落ちない）。`slot` が `a1`〜`a6` でない `addAttachment`・`removeAttachment` は、通信の前に例外。`thumb` が文字でなければ、小さい画像を書かない。
- 重複と境界: 6 個あるときの `freeSlot` は `null`。5 個と、送っている途中 1 個でも `null`。同じ `slot` に 2 回 `addAttachment` すると、あとのものが残る（呼ぶ側が `freeSlot` で防ぐ）。`addedAt` が同じ 2 件は `slot` 順。
- 違反や失敗の見せ方: このタスクに画面は無い。通信の失敗は `NetError` のまま投げる（`toobig`・`denied`・`notfound`・`network`）。`removeAttachmentFlow` は、Drive に残ったかどうかを `trashed` で返す。

- [ ] **Step 1: テストを書く（失敗することを確かめる）**

  - 規則の形: `rules.records.$classId.$lessonId.$sid.attachments.$aid` の `.validate` が `a[1-6]` の正規表現と 4 つの項目を見ている。`rules.recThumbs` の読み書きの式が上のとおり（`teacherList`・`accounts`・`memberOf`・`lessons` を含む）。`.read` が `true` の場所は、今までどおり `check/ping` と `gen/$sid` だけ。
  - `attachmentList`・`freeSlot`・`attachmentLabels`（写真 2 つと PDF 1 つ → `写真 1`・`PDF 1`・`写真 2` が、足した順に付く）。
  - **`saveRecord` のあとも `attachments` が残っている**（先に `addAttachment` しておく）。書きこみは 1 回で、`records/…/attachments` の場所を書いていない。`level: null` で `level` と `marks` が消える。
  - **`addAttachment` のあとも `memo`・`updatedAt` が変わらない。** 書きこみは 1 回。`thumb` が `null` なら `recThumbs` を書かない。`slot: 'a7'` は例外で、通信をしない。
  - `removeAttachment` で、目録と小さい画像が消え、ほかの置き場所は残る。
  - `getRecord`・`listRecords` の結果に `attachments` が入る（無ければ `[]`）。
  - `files.uploadStudent`・`loadStudentFile`（取り置きにあれば GAS を呼ばない）・`trashStudent`（取り置きから消える）。
  - `demo-gas`: Task 1 の表のとおり（持ち主だけ・先生は読める・ほかの生徒は `notfound`・同じ `key` は 1 個・先生は保存と削除が `denied`）。
  - `addAttachmentFlow`: `uploadStudent` → `addAttachment` の順。`uploadStudent` が失敗 → `addAttachment` を呼ばない。`addAttachment` が 1 回失敗してやり直す → 同じ `key`・同じ `slot`。
  - `removeAttachmentFlow`: `removeAttachment` を先に。`trashStudent` が失敗・`false` → `{ trashed: false }`（例外にしない）。`removeAttachment` が失敗 → 例外で、`trashStudent` を呼ばない。

- [ ] **Step 2: 実装して `npm test` がすべて通ることを確かめる**

- [ ] **Step 3: コミット**（`feat: 生徒の添付のデータの出し入れを追加`）

## 引きつぐこと

いま、別のタスク（Task 1）が gas/Code.gs と tests/gas-app.test.js を作業中。このタスクでは、それらを変えない。npm test で、そのテストが失敗していたら、自分の変更と関係ないことを確かめて、報告に書く。
