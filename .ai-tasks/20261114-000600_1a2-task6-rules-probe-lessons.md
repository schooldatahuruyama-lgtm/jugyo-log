# 実装指示書: 段階 1a-2 Task 6

あなた（Codex）は、この指示書に沿ってコードを書きます。進め方は `AGENTS.md` の「実装を頼まれたとき」のとおりです。

- 計画: `docs/superpowers/plans/2026-11-14-jugyo-log-stage1a-2.md` の Task 6（下に、そのまま写してあります）
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

### Task 6: 規則の確認の追加と、手順書

**Files:**
- Modify: `js/rules-probe.js`、`tests/rules-probe.test.js`、`README.md`、`docs/setup/firebase.md`（「9. 本番の規則を貼る」に、規則を直したときは貼り直す、と書き足す）
- Create: `docs/reports/stage1a-2-check.md`

**Interfaces:**
- Consumes: 今ある `runRulesProbe`（準備 → 確かめ → 片付け）。Task 1 の `repo.createLessons`・`repo.addMaterial`・`repo.createUnit`。
- Produces: `runRulesProbe` の確かめに、下の行を足す。準備では、先生として、確認用のクラス 2 つ（入っているクラス・入っていないクラス）にそれぞれ授業を 1 つ作り（`repo.createLessons`）、資料を 1 つ置き（`repo.addMaterial`。`fileId` は `'probe'`、サムネイルは短いデータ URL）、単元を 1 つ作る（年度 0）。片付けでは、その `lessons`・`thumbs`・`units` も消す。前回の残りの片付け（年度 0 のクラス）でも、そのクラスの `lessons`・`thumbs` と、年度 0 の `units` を消す。

  | 試すこと（確認用の生徒として） | 期待 |
  |---|---|
  | 入っているクラスの `lessons/<classId>` を読む | ok |
  | 入っていないクラスの `lessons/<classId>` を読む | denied |
  | `lessons` 全体を読む | denied |
  | 入っているクラスの `thumbs/<classId>/<lessonId>` を読む | ok |
  | 入っていないクラスの `thumbs/<classId>/<lessonId>` を読む | denied |
  | `units` を読む | ok |
  | 入っているクラスの `lessons/<classId>/<lessonId>/title` を書く | denied |
  | 入っているクラスの `lessons/<classId>/<lessonId>/materials/<id>/fileId` を書く | denied |
  | 入っているクラスの `thumbs/<classId>/<lessonId>/<id>` を書く | denied |
  | `units/<id>/name` を書く | denied |

- [ ] **Step 1: `tests/rules-probe.test.js` にテストを足す**（足した 10 行が、代役の答えどおりに `pass` になる・ならない。片付けで `lessons`・`thumbs`・`units` が消える。書きこみが通ってしまった場合も、片付けで元に戻る）

- [ ] **Step 2: `js/rules-probe.js` を直し、`npm test` がすべて通ることを確かめる**

- [ ] **Step 3: `README.md` に 1a-2 の使い方（単元 → 授業 → 資料）と、先生の作業（規則の貼り直し、本番用の GAS の公開）を足す。`docs/reports/stage1a-2-check.md` に、下の「最後の確認」の項目を「未確認」で書く**

- [ ] **Step 4: コミット**（`feat: 規則の確認に授業と資料を追加`）
