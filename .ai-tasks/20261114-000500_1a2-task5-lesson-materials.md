# 実装指示書: 段階 1a-2 Task 5

あなた（Codex）は、この指示書に沿ってコードを書きます。進め方は `AGENTS.md` の「実装を頼まれたとき」のとおりです。

- 計画: `docs/superpowers/plans/2026-11-14-jugyo-log-stage1a-2.md` の Task 5（下に、そのまま写してあります）
- 設計: `docs/superpowers/specs/2026-11-12-jugyo-log-design.md`、`docs/superpowers/specs/2026-11-13-jugyo-log-1a-data.md`（データの形）
- 進め方: 下の Step を順に行う。テストを先に書き、失敗するのを確かめてから実装する。
- 完了の条件: Step をすべて行い、`npm test` がすべて成功する。新しく書いた `.js` は `node --check` で構文を確かめる。
- `git add`・`git commit`・ブランチの操作はしない（「コミット」の Step は行わない。Claude Code が行う）。
- 変えてよいのは、下の「Files」にあるファイルだけ。ほかの変更が必要だと思ったら、変えずに報告に書く。
- ブラウザでの確認は行わなくてよい（Claude Code が行う）。
- 終わったら、変更したファイル・`npm test` の結果・指示書と違う点・気になった点を、日本語の Markdown で報告する。

## Global Constraints

- 作業フォルダは `C:\Users\yan12\Documents\keita\AI開発\授業ログアプリ`。この外は読まない・編集しない。
- 外部パッケージをインストールしない。Firebase の SDK を入れない。外部の配信元から実行時に読み込まない。
- Firebase は Spark プランのまま。課金の設定を前提にしない。
- `js/views/` と `js/main.js` のほかのモジュールは、`window`・`document`・`fetch`・`localStorage`・`caches`・`crypto`・`Date.now`・`setTimeout` を直接使わず、引数で受け取る（`js/image.js` の `compressImage` と `js/pdf.js` は、ブラウザの `Image`・`canvas`・pdf.js を使ってよい）。
- データベースの場所（`lessons/…` などの文字）を書いてよいのは `js/repo.js`・`js/dev/`・`js/rules-probe.js` だけ。Firebase の URL を書いてよいのは `js/net.js` と `js/auth.js` だけ。GAS の呼び方（op の名前と本文の形）を書いてよいのは `js/gas.js`・`js/files.js`・`js/dev/` だけ。
- データベースの形と規則は「データの形」3 章・4 章のとおり。この計画で変えるのは、Task 1 に書いた 1 点（`lessons` の全体を先生が読める）だけ。
- GAS を呼ぶ通信は、`method: 'POST'`、`headers: { 'Content-Type': 'text/plain;charset=utf-8' }`、本文は JSON の文字列。ほかのヘッダーを足さない。トークンは本文に入れる。成否は HTTP の状態ではなく、返ってきた JSON の `ok` で見る。
- **GAS は、呼んだ人が送ってきたファイル ID を信じない。** 先生の資料は、`classId`・`lessonId`・`materialId` を受け取り、呼んだ人のトークンでデータベースを読んで `fileId` を決める。保存と削除は先生だけ。
- Drive に保存したファイルを、だれとも共有しない（`setSharing`・`addViewer` などを呼ばない）。
- 生徒の本名、学校のメールアドレスを保存しない・入力させない。ファイルの名前（`name`）は先生の資料の名前だけに使う。
- パスワード・トークンを、`console`・エラーの文・保存（localStorage・Cache）・Drive のファイルの説明に出さない。
- 画面に出す文字は `textContent`（`el()` の `text`）で入れる。`innerHTML` を使わない。画像は `<img>` の `src` に Blob の URL（`URL.createObjectURL`）かデータ URL を入れ、使い終わった Blob の URL は `URL.revokeObjectURL` で外す。
- 基準の端末は iPad の Safari（横 1180×820 と縦 820×1180）。ボタンは 44×44px 以上。状態は色だけで伝えず、文字を添える。
- 画面の文とコードのコメントは日本語。先生の画面も、やさしい言葉で書く。
- 書き方（`createXxx({ … })` で依存を受け取る、`export function mount(root, ctx)` が片付けの関数を返す、`el()`・`confirmDialog`・`toast`・`statusChip` を使う、保存していない変更は `ctx.setLeaveGuard` で守る）は、今ある `js/views/teacher-roster.js`・`js/issue.js`・`js/repo.js` に合わせる。
- `git add`・`git commit`・ブランチの操作はしない（コミットは Claude Code が行う）。指示書の「Files」のほかのファイルは変えない。変える必要があると思ったら、変えずに報告に書く。
- `check.html`・`js/check-*.js`・`gas/check/` は変えない。


## Review Focus

仕様には書かれているが、ふつうのテストでは通ってしまいやすい点。担当のタスクにテストを入れてある。

1. **生徒が、入っていないクラスの資料を取り出そうとする**（`classId`・`lessonId`・`materialId` を自分で作って GAS を呼ぶ）。データベースが断るので、GAS は `notfound` を返し、Drive を読まないこと（Task 2）。
2. **保存の応答だけが失われた場合**。同じキーでもう一度送ると、Drive のファイルは 1 個のままで、同じ ID が返ること。アプリは、やり直しで資料を 2 重に登録しないこと（Task 2・Task 3・Task 5）。
3. **1 つのファイルを複数の授業から指している場合の削除**。1 つの授業から外しても、ほかの授業が指している間は Drive のファイルを消さないこと。最後の 1 つを外したときだけ消すこと（Task 1・Task 5）。
4. **同時の呼び出し**。1 台の端末から GAS への呼び出しが、同時に 2 本走らないこと。失敗したら、間（ばらつきあり）をあけてやり直し、決めた回数でやめること（Task 3）。
5. **生徒の記録がある授業の削除**。記録が 1 件でもある授業は消せないこと。記録の件数は、中身を読まずに数えること（Task 1・Task 4）。


---

### Task 5: 授業の編集と資料

**Files:**
- Create: `js/views/teacher-lesson.js`、`js/views/parts/viewer.js`、`js/pdf.js`、`js/material-flow.js`、`tests/material-flow.test.js`
- Modify: `js/image.js`（`dataUrlToBase64` を足す）、`tests/image.test.js`、`css/app.css`

**Interfaces:**
- Consumes: Task 1 の `repo` と `lesson-logic`、Task 3 の `ctx.files`、`compressImage`・`compressCanvas`・`fitSize`（`js/image.js`）、`js/lib/pdfjs/`。
- Produces:
  - `js/image.js`: `dataUrlToBase64(dataUrl) → string`（`data:image/jpeg;base64,` のあとの部分。形が違えば例外）。
  - `js/pdf.js`（ブラウザ用。pdf.js は、初めて使うときに `import('./lib/pdfjs/pdf.min.mjs')` で読みこむ。`workerSrc`・`cMapUrl`・`standardFontDataUrl`・`wasmUrl` は `new URL('./lib/pdfjs/…', import.meta.url)` で自分のサイトの中を指す）:
    - `openPdf(data) → { pageCount, renderPage(pageNo, maxEdge) → HTMLCanvasElement, close() }`（`data` は `ArrayBuffer`。パスワードつき・こわれた PDF は、`code: 'broken'` を持つ `Error`。部品を読みこめなければ `code: 'load-failed'`）
  - `js/material-flow.js`（通信の順番だけを受け持つ。画面と DOM を知らない）:
    - `addMaterialFlow({ repo, files, key, materialId, kind, type, name, mime, dataB64, thumb, targets, now }) → { fileId }`。順番: (1) `files.upload({ key, mime, name, dataB64 })` → `{ fileId, bytes }`、(2) `repo.addMaterial(targets, materialId, { kind, type, fileId, name, bytes }, thumb, now)`。(2) が失敗したら例外をそのまま投げる（ファイルは Drive に残る。**同じ `key`・同じ `materialId` でやり直せば、ファイルは増えず、資料も 2 重にならない**）。
    - `removeMaterialFlow({ repo, files, classId, lessonId, material, now }) → { trashed: boolean }`。順番: (1) `repo.removeMaterial`、(2) `repo.listAllLessons()` → `fileRefs` が 0 件なら `files.trash(material.fileId)`。(2) の失敗（読めない・ゴミ箱に入れられない）は例外にせず、`{ trashed: false }` を返す。
  - `js/views/parts/viewer.js`: `openViewer({ title, kind: 'image' | 'pdf', load }) → { close() }`。画面いっぱいの表示（`<dialog>`）。`load()` は Blob を返す Promise。画像は、はじめは全体が入る大きさで出し、「＋」「－」で拡大・縮小（100%〜400%）、指やマウスで動かせる。PDF は 1 ページずつ `renderPage(n, 1600)` で出し、「前のページ」「次のページ」「3 / 12」。読みこみ中は「読みこんでいます…」、失敗は「開けませんでした。もう一度ためしてください。」と「もう一度」。「閉じる」と Esc で閉じ、Blob の URL と PDF を片付ける。1a-3 の生徒の画面でも使う。

- [ ] **Step 1: `tests/material-flow.test.js` と `tests/image.test.js` にテストを書く**

  - `addMaterialFlow`: `files.upload` → `repo.addMaterial` の順に呼ぶ。`addMaterial` に渡す資料は `{ kind, type, fileId, name, bytes }`（`fileId` と `bytes` は `upload` の結果）。`targets` と `thumb` はそのまま渡す。
  - `upload` が失敗 → `addMaterial` を呼ばない。
  - **`addMaterial` が 1 回目に失敗し、同じ引数でやり直す** → `upload` は同じ `key` で 2 回呼ばれ（GAS が同じ ID を返す前提）、`addMaterial` は同じ `materialId` で呼ばれる（資料が 2 つにならない）。
  - `removeMaterialFlow`: ほかの授業が同じ `fileId` を指していれば `files.trash` を呼ばない（`trashed: false`）。指していなければ呼ぶ（`trashed: true`）。**`repo.removeMaterial` を先に行い、そのあとで数える**（自分の分を数えない）。`listAllLessons` や `trash` の失敗は `{ trashed: false }`。
  - `dataUrlToBase64('data:image/jpeg;base64,AAAA') === 'AAAA'`。`data:` で始まらない・`;base64,` が無い → 例外。

- [ ] **Step 2: `js/material-flow.js`・`js/image.js`・`js/pdf.js`・`js/views/parts/viewer.js` を書く**

- [ ] **Step 3: `js/views/teacher-lesson.js` を書く（`#/t/lesson/<classId>/<lessonId>`。設計書 7.5 の「授業の資料」）**

  - 上部: `teacherNav(ctx, 'lessons')`。その下に「‹ 授業の一覧へ」。
  - 授業の情報: 日付・授業名・単元を直せる欄と「保存する」（`checkLesson` → `repo.updateLesson`）。保存していない変更は `ctx.setLeaveGuard` で守る。
  - 資料の一覧: `materialList` の順に、サムネイル（`repo.getThumbs` の画像。無ければ種類の文字）・種類（「板書」「配布資料」）・名前・「上へ」「下へ」・「消す」。サムネイルか名前を押すと `openViewer`（画像は `ctx.files.loadImages` の 1 枚、PDF は `ctx.files.loadFile`）。
  - 「写真を足す」: `<input type="file" accept="image/*">`（iPad では、カメラ・写真・ファイルから選べる）。「PDF を足す」: `<input type="file" accept="application/pdf">`。選んだあと、足す前の欄を出す:
    - 種類（「板書」「配布資料」。写真のはじめは「板書」、PDF のはじめは「配布資料」）
    - 名前（はじめは、写真なら「板書」または「資料」、PDF ならファイル名から `.pdf` を取ったもの。1〜80 文字）
    - 「同じ資料を、ほかのクラスの授業にも付ける」: 同じ年度のほかのクラスの授業のうち、**日付が同じもの**をチェックで選べる（はじめは、どれもチェックなし）。
    - 「足す」「やめる」
  - 「足す」を押したら:
    - 写真: `compressImage(file, { maxEdge: CONFIG.image.maxEdge, maxBytes: CONFIG.image.maxChars })` → `dataUrlToBase64`。サムネイルは `compressImage(file, { maxEdge: CONFIG.thumb.maxEdge, maxBytes: CONFIG.thumb.maxChars })` のデータ URL。`mime` は `image/jpeg`。
    - PDF: `file.size` が `CONFIG.pdfMaxBytes` をこえたら「PDF は 10MB までです。」。`file.arrayBuffer()` を base64 にする（大きいので、8KB ずつに分けて文字にする。`String.fromCharCode(...全部)` のような、一度に広げる書き方をしない）。サムネイルは `openPdf` → `renderPage(1, CONFIG.thumb.maxEdge)` → `compressCanvas(canvas, { maxBytes: CONFIG.thumb.maxChars })`（作れなければ `null`。サムネイルなしで足す）。`mime` は `application/pdf`。
    - `key` は `newId(ctx.random, 24)`、`materialId` は `newId(ctx.random, CONFIG.idLength)`。**やり直しのときは、同じ `key` と `materialId` を使う。**
    - `targets` は、この授業と、チェックした授業。それぞれの `order` は、その授業の `nextOrder`。
    - `addMaterialFlow` を呼ぶ。進みぐあいを文で出す（「写真を小さくしています…」「送っています…（大きい PDF は 1 分ほどかかります）」）。送っている間も、画面のほかの所（一覧を見る・大きく表示する）は使える。足すボタンは、送り終わるまで押せなくする。
    - 失敗したら、その資料の所に「送れませんでした」と「やり直す」「やめる」を出す（選んだファイルと `key`・`materialId` は、画面にいる間は持っておく）。`toobig` は「ファイルが大きすぎます。」、`denied` は「先生としてログインし直してください。」。
    - 1 つの授業の資料は `CONFIG.materialsPerLesson` 個まで。こえるときは「資料は 12 個までです。」。
    - 送っている途中で画面を離れようとしたら、`ctx.setLeaveGuard` で確かめる。
  - 並べ替え: `moveInOrder` → `repo.setMaterialOrders`。
  - 「消す」: 確かめる（「この授業から外します。ほかの授業にも付けてある場合、そちらには残ります。」）→ `removeMaterialFlow`。
  - 授業が見つからない（消された・ID が違う）ときは「この授業は見つかりません。」と「授業の一覧へ」。

- [ ] **Step 4: `npm test` がすべて通ることを確かめる。`node --check` で新しいファイルの構文を確かめる**

- [ ] **Step 5: コミット**（`feat: 授業の編集と資料の追加・表示を追加`）
