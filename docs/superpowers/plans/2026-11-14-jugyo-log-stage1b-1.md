# 授業ログ 段階 1b-1（生徒の写真・PDF の添付） Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 生徒が、授業ページの「自分の記録」に、写真と PDF を 6 個まで足せる。足したものは小さく並び、押すと大きく表示でき、消せる。本人と先生だけが開ける。先生は、生徒の記録の画面で同じものを見られる。

**Architecture:** ファイル本体は、本番用の GAS を通して先生の Drive の「授業ログ_生徒」フォルダに置く。GAS は、保存のときに「持ち主の生徒 ID」をファイルの説明に書き、取り出し・削除のときは、**呼んだ人が送ってきたファイル ID ではなく、その説明の持ち主**と、トークンから分かる生徒 ID を比べて決める。目録は `records/<classId>/<lessonId>/<生徒ID>/attachments/<a1〜a6>`、小さい画像は `recThumbs/<classId>/<lessonId>/<生徒ID>/<a1〜a6>` に置く（先生が全員分の記録を読むときに、画像で重くならないように分ける）。

**Tech Stack:** HTML / CSS / JavaScript（ES モジュール、外部パッケージなし）、Node.js 18 以上の `node --test`、Firebase Realtime Database（REST）、Google Apps Script のウェブアプリ、pdf.js、GitHub Pages。

**Spec:** `docs/superpowers/specs/2026-11-12-jugyo-log-design.md`（設計書）の 5.3・7.3 の「自分の写真・PDF」・8 章の最後の項目、`docs/superpowers/specs/2026-11-13-jugyo-log-1a-data.md`（データの形）の 3〜5 章。

**この計画の範囲:** 設計書の段階 1b のうち、生徒の写真・PDF の添付。手書き（メモと振り返り）は、次の計画（1b-2）で作る。

**実装の担当:** コードは Codex が書く（`tools/codex-implement.ps1`）。

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

### Task 1: 本番用の GAS に、生徒のファイルの出し入れを足す

**Files:**
- Modify: `gas/Code.gs`、`tests/gas-app.test.js`、`tests/helpers/gas-sandbox.js`（要るときだけ）、`docs/setup/gas.md`（「コードを直したあとの公開し直し」に、今回の版 `app-2` のことを 1 行足す）

**Interfaces:**
- Produces: `VERSION` を `'app-2'` にする。op を 4 つ足す（今ある op の動きは変えない）。

  | op | 受け取るもの | だれ | 返すもの |
  |---|---|---|---|
  | `putStudentFile` | `token`・`key`・`classId`・`lessonId`・`mime`・`dataB64` | その組の一員の生徒だけ（先生は `denied`） | `{ ok, id, existed, bytes }` |
  | `getStudentFile` | `token`・`fileId` | 持ち主の生徒と先生 | `{ ok, mime, dataB64 }` |
  | `getStudentFiles` | `token`・`fileIds`（1〜6 個） | 持ち主の生徒と先生 | `{ ok, files: { [fileId]: { mime, dataB64 } }, missing: [fileId] }` |
  | `trashStudentFile` | `token`・`fileId` | 持ち主の生徒だけ（先生は `denied`） | `{ ok, trashed: boolean }` |

  決まり:
  - フォルダは Drive の直下の「授業ログ_生徒」（無ければロックをかけて作る。先生の資料の「授業ログ_資料」とは別）。探し方・作り方は、今ある `folder_()` と同じ（共有された同じ名前のフォルダを使わない）。
  - **保存（`putStudentFile`）**: `key` は今ある `KEY_RE`。`classId`・`lessonId` は今ある `MATERIAL_ID_RE`。`mime` は `'image/jpeg'` か `'application/pdf'`。大きさの上限は先生の資料と同じ（こえたら `toobig`）。呼んだ人が生徒であること（先生・だれでもない人は `denied`）。**呼んだ人のトークンで** `<DATABASE_URL>/lessons/<classId>/<lessonId>/createdAt.json?auth=<token>` を読み、200 で本文が `null` でないことを確かめる（その組の一員で、授業がある）。だめなら `notfound`（Drive に何も作らない）。ファイル名は `s_<key>`、説明は `student:<生徒ID>:<classId>:<lessonId>`（あとで別の保存先へ引っ越すための目録を兼ねる）。同じ名前で、説明が**同じ文字**のファイルがすでにあれば、作らずにその ID を返す（`existed: true`）。同じ名前で説明が違うファイルがあれば `denied`（他人のキーを当てても、上書きも取り出しもできない）。検索から作成・説明の設定までをスクリプトのロックで守る（説明を書けなければゴミ箱に入れて `server`）。
  - **取り出し（`getStudentFile`・`getStudentFiles`）**: `fileId` は今ある `ID_RE`。そのファイルが「授業ログ_生徒」の中にあり・ゴミ箱に無く・説明が `student:<生徒ID>:…` の形のときだけ対象にする。呼んだ人が先生なら返す。生徒なら、説明の生徒 ID が呼んだ人の生徒 ID と同じときだけ返す。そうでないものは、`getStudentFile` では `notfound`、`getStudentFiles` では `missing`（**持ち主でないことと、無いことを区別しない**）。`getStudentFiles` は画像だけを返し（PDF は `missing`）、`dataB64` の合計が今ある `TOTAL_MAX_B64` をこえそうなら、残りを `missing` に入れる。`fileIds` が配列でない・空・7 個以上・形の違うものを含む → `bad`。
  - **削除（`trashStudentFile`）**: 上と同じ条件で、持ち主の生徒のファイルならゴミ箱に入れて `{ ok, trashed: true }`。すでにゴミ箱・見つからない・持ち主でない → `{ ok, trashed: false }`。先生が呼んだら `denied`。
  - 今ある `getFile`・`getMaterials`・`trashFile` は、「授業ログ_資料」の中の、説明が `teacher` のファイルだけを扱う（今のまま）。生徒のファイルの ID を渡されても、返さない・消さない。逆に、生徒のファイル用の op は、先生の資料の ID を渡されても、返さない・消さない。

**端の場合:**
- 不正な入力: `key`・`classId`・`lessonId`・`fileId`・`mime` の形が違う、`dataB64` が文字でない・base64 として読めない → `bad`。大きすぎ → `toobig`。トークンがにせもの → `auth`。`DATABASE_URL` が無い → `config`。
- 重複と境界: 同じ `key` で 2 回 → ファイルは 1 個・同じ `id`。別の生徒が同じ `key` を送る → `denied`（1 人目のファイルはそのまま）。`fileIds` が 6 個は通る・7 個は `bad`。同じ `fileId` を 2 回消す → 2 回目は `trashed: false`。
- 違反や失敗の見せ方: GAS は、決めた `error` の文字（`bad`・`auth`・`denied`・`notfound`・`toobig`・`server`・`config`）を JSON で返す。例外は `server`。エラーの文にトークン・ファイルの中身を入れない。画面での見せ方は Task 3。

- [ ] **Step 1: `tests/gas-app.test.js` にテストを足す（失敗することを確かめる）**

  - `doGet`・`ping` は `version: 'app-2'`（今あるテストの期待も直す）。
  - `putStudentFile`: その組の生徒 → 「授業ログ_生徒」に 1 個でき、説明は `student:s26-001:c1:l1`。**同じ `key` でもう一度 → 1 個のまま・同じ `id`・`existed: true`。** 別の生徒が同じ `key` → `denied` で、ファイルは増えず、説明も変わらない。先生 → `denied`。入っていない組・無い授業 → `notfound` で、Drive に何もできていない。`mime` が `image/png` → `bad`。大きすぎ → `toobig`。
  - `getStudentFile`: 持ち主 → 返る。先生 → 返る。**ほかの生徒 → `notfound`**（`dataB64` が応答に無い）。先生の資料の ID → `notfound`。ゴミ箱のファイル・フォルダの外のファイル・説明が `student:` でないファイル → `notfound`。
  - `getStudentFiles`: 自分の画像 2 個と他人の画像 1 個を頼む → 自分の 2 個だけ返り、他人の分は `missing`。PDF は `missing`。7 個 → `bad`。
  - `trashStudentFile`: 持ち主 → ゴミ箱に入り `trashed: true`。もう一度 → `false`。ほかの生徒 → `false` で、ゴミ箱に入っていない。先生 → `denied`。
  - **今ある `getFile`・`getMaterials`・`trashFile` に生徒のファイルの ID を渡しても、返らない・ゴミ箱に入らない。**
  - 今あるテストが、版の文字のほかは変わらず通る。

- [ ] **Step 2: `gas/Code.gs` を直し、`npm test` がすべて通ることを確かめる。`docs/setup/gas.md` に 1 行足す**

- [ ] **Step 3: コミット**（`feat: 本番用の GAS に生徒のファイルの出し入れを追加`）

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

---

### Task 3: 添付の画面と、規則の確認

**Files:**
- Create: `js/views/parts/attachment-pane.js`、`docs/reports/stage1b-1-check.md`
- Modify: `js/views/student-lesson.js`、`js/views/teacher-record.js`、`js/views/teacher-review.js`（行に個数を出すだけ）、`css/app.css`、`js/rules-probe.js`、`tests/rules-probe.test.js`、`README.md`

**Interfaces:**
- Consumes: Task 2 の全部、`compressImage`・`compressCanvas`・`dataUrlToBase64`（`js/image.js`）、`openPdf`（`js/pdf.js`）、`openViewer`、`newId`、`CONFIG`。PDF を base64 にする所と、PDF の小さい画像を作る所は、`js/views/teacher-lesson.js` の今の書き方に合わせる。
- Produces:
  - `js/views/parts/attachment-pane.js`: `attachmentPane({ ctx, classId, lessonId, studentId, attachments, readOnly }) → { node, busy, destroy() }`。
    - `attachments` は `attachmentList` の結果（はじめの中身）。小さい画像は `repo.getRecThumbs` で読む（読めなくても、種類の文字で並べる）。
    - 並べるもの: 小さい画像（無ければ「写真」「PDF」の文字）と、`attachmentLabels` の名前。押すと `openViewer`（`load` は `ctx.files.loadStudentFile(fileId)`）。
    - `readOnly` でないとき: 「＋ 写真・PDF」（`<input type="file" accept="image/*,application/pdf">`。6 個あるとき・空きが無いときは押せなくし、「写真・PDF は 6 個までです。」と出す）と、それぞれの「消す」。
    - 足す: 種類は `file.type` で決める（`image/` で始まれば写真、`application/pdf` なら PDF、ほかは「写真か PDF だけを足せます。」）。写真は `compressImage`（`CONFIG.image`）、小さい画像は `CONFIG.thumb`。PDF は `CONFIG.pdfMaxBytes` まで（こえたら「PDF は 10MB までです。」）。`slot` は `freeSlot(今の目録, 送っている途中の置き場所)`、`key` は `newId(ctx.random, 24)`。**やり直しのときは、同じ `key` と `slot` を使う。**`addAttachmentFlow` を呼ぶ。送っている間は、その場所に「送っています…」。
    - 失敗: その場所に「送れませんでした」と「やり直す」「やめる」。`toobig` は「ファイルが大きすぎます。」、読みこめない写真は「この写真は読みこめませんでした。」（やり直しは出さない）。
    - 消す: `confirmDialog`（「この写真を消しますか？」／「この PDF を消しますか？」、本文「消すと元にもどせません。」、危険の色）→ `removeAttachmentFlow`。失敗は「消せませんでした。もう一度ためしてください。」。
    - `busy` は、送っている途中・送れないままのものがあるか（getter）。
    - `destroy()` で、待ち受け・Blob の URL・開いているビューアーを片付ける。
  - `js/views/student-lesson.js`: 「自分の記録」の、メモと振り返りの間に「自分の写真・PDF」として `attachmentPane`（`readOnly: false`）を置く。離れるときの確かめに、`pane.busy` なら「まだ送れていない写真・PDF があります。離れると、送れていない分は消えます。」を足す（文字の保存の確かめのあと）。画面に戻ってきたときの読み直しでは、添付は読み直さない。
  - `js/views/teacher-record.js`: 「この生徒の記録」の、メモと理解度の間に「写真・PDF」として `attachmentPane`（`readOnly: true`）。無ければ「（まだありません）」。
  - `js/views/teacher-review.js`: 添付が 1 個以上ある生徒の行に「添付 N」と出す。
  - `js/rules-probe.js`: 確かめに 8 行足す（46 → 54 項目）。片付けでは、生徒として `recThumbs` の自分の分も消す（記録を消すと目録も消える）。

    | 試すこと（書いていなければ、確認用の生徒として） | 期待 |
    |---|---|
    | 自分の `records/…/attachments/a1` を書く | ok |
    | 自分の `records/…/attachments/a7` を書く | denied |
    | `type` が `'video'` の `attachments/a2` を書く | denied |
    | 自分の `recThumbs/…/a1` を書く | ok |
    | 自分の `recThumbs/…/<自分>` を読む | ok |
    | ほかの生徒 ID（`s00-998`）の `recThumbs` を読む | denied |
    | ほかの生徒 ID の `recThumbs/…/a1` を書く | denied |
    | 先生として、確認用の生徒の `recThumbs` を読む | ok |

**端の場合:**
- 不正な入力: 写真でも PDF でもないファイル → 「写真か PDF だけを足せます。」。こわれた写真・読めない形式 → 「この写真は読みこめませんでした。」。10MB をこえる PDF → 「PDF は 10MB までです。」。こわれた PDF は、小さい画像なしで足す（開くときに、ビューアーが「開けませんでした」と出す）。形のおかしい目録は `attachmentList` が落とす。
- 重複と境界: 6 個あると「＋ 写真・PDF」を押せない。5 個と送っている途中 1 個でも押せない。「＋」を続けて押しても、1 回の選択につき 1 つ。「やり直す」を続けて押しても、通信は 1 本。「消す」を続けて押しても、確かめは 1 回。同じファイルを 2 回選べる（選んだあと、入力欄を空に戻す）。
- 違反や失敗の見せ方: 上の文を、その添付の場所か「＋」の下に出す（`role="alert"`）。送れていないものがあるまま離れるときは、確かめのダイアログ。消せなかったときは文を出し、添付は並んだまま。先生の画面には、足す・消すの操作を出さない。

- [ ] **Step 1: `tests/rules-probe.test.js` にテストを足し、`js/rules-probe.js` を直す（足した 8 行、片付けで `recThumbs` が消える、合計 54 行）**

- [ ] **Step 2: `attachment-pane.js` を書き、3 つの画面に入れる。`css/app.css` に見た目を足す**

- [ ] **Step 3: `README.md` に 1b-1 の使い方と、先生の作業（規則の貼り直し、本番用 GAS の公開し直し）を足す。`docs/reports/stage1b-1-check.md` に、下の「最後の確認」の項目を「未確認」で書く。`npm test` と `node --check` を確かめる**

- [ ] **Step 4: コミット**（`feat: 生徒の写真・PDF の添付の画面を追加`）

---

### 最後の確認（Claude Code と先生が行う。Codex には渡さない）

- [ ] 練習モード（`?demo=1`）のブラウザで、iPad の横・縦の大きさで確かめる:
  1. 生徒として、写真を 1 枚足す → 小さく並ぶ → 押すと大きく表示できる。
  2. PDF を 1 つ足す → 並ぶ → 大きく表示してページを送れる。
  3. 6 個まで足すと「＋」が押せなくなる。1 つ消すと、また足せる。
  4. 写真でも PDF でもないファイルを選ぶと、文が出て足されない。
  5. メモを書いて保存しても、添付が消えない。開き直しても、添付とメモが残っている。
  6. 先生として、その生徒の記録に同じ添付が見え、大きく表示できる。足す・消すの操作が無い。一覧の行に「添付 N」が出る。
  7. ほかの生徒としてログインすると、その添付が見えない。
  8. コンソールにエラーが出ていない。
- [ ] 先生の作業（Claude Code が、先生のブラウザで行う）: 規則を貼り直して公開する。本番用の GAS に新しい `gas/Code.gs` を貼り、新しい版として公開し直す（URL は変わらない）。`ping` が `app-2` を返す。
- [ ] 公開して、本物で確かめ、`docs/reports/stage1b-1-check.md` に書く:
  1. 規則の確認が 54 項目すべて ○。
  2. 接続確認ページ（`check.html`）がすべて合格。
  3. Drive の実機の確認（先生の写真 1 枚と PDF 1 つの、アップロード・表示・削除。確認用のファイルは残さない）。
  4. ログインなしで、生徒のファイル用の 4 つの op を呼ぶと、どれも `auth` で断られる。
  5. （先生が行う）生徒の ID でログインし、学校の iPad で写真を撮って足せる。Drive の「授業ログ_生徒」にファイルができ、共有されていない。足すのにかかる時間。
  6. （先生が行う）ほかの生徒の ID では、その写真が見えない。先生の「記録」では見える。
