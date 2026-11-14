# 実装指示書: 段階 1b-1 Task 1

あなた（Codex）は、この指示書に沿ってコードを書きます。進め方は `AGENTS.md` の「実装を頼まれたとき」のとおりです。

- 計画: `docs/superpowers/plans/2026-11-14-jugyo-log-stage1b-1.md` の Task 1（下に、そのまま写してあります）
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

## 引きつぐこと

いま、別のタスク（Task 2）が js/ と docs/setup/rules.json を作業中。このタスクでは gas/・tests/gas-app.test.js・tests/helpers/gas-sandbox.js・docs/setup/gas.md のほかは変えない。npm test で、ほかのタスクの作業中のテストが失敗していたら、自分の変更と関係ないことを確かめて、報告に書く。
