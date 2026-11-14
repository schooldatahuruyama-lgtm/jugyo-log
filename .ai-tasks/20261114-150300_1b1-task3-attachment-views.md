# 実装指示書: 段階 1b-1 Task 3

あなた（Codex）は、この指示書に沿ってコードを書きます。進め方は `AGENTS.md` の「実装を頼まれたとき」のとおりです。

- 計画: `docs/superpowers/plans/2026-11-14-jugyo-log-stage1b-1.md` の Task 3（下に、そのまま写してあります）
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

## 引きつぐこと

Task 1・Task 2 は済んでいる（gas/Code.gs、js/repo.js・js/files.js・js/record-logic.js・js/attachment-flow.js・docs/setup/rules.json）。それらは、いまレビュー中なので、このタスクでは読むだけにして、変えない。
