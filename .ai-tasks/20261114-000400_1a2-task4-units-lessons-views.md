# 実装指示書: 段階 1a-2 Task 4

あなた（Codex）は、この指示書に沿ってコードを書きます。進め方は `AGENTS.md` の「実装を頼まれたとき」のとおりです。

- 計画: `docs/superpowers/plans/2026-11-14-jugyo-log-stage1a-2.md` の Task 4（下に、そのまま写してあります）
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

### Task 4: 単元と授業の画面

**Files:**
- Create: `js/views/teacher-units.js`、`js/views/teacher-lessons.js`、`js/views/parts/teacher-nav.js`
- Modify: `js/router.js`、`tests/router.test.js`、`js/views/teacher-classes.js`（上部の帯を `teacher-nav.js` に置きかえる）、`css/app.css`、`tests/rules-check.test.js`（下の Step 0）

**Interfaces:**
- Consumes: Task 1 の `repo` と `lesson-logic`、`schoolYear`（`js/roster-logic.js`）、`newId`、`CONFIG`。
- Produces:
  - `js/router.js` に足す画面:

    | name | ハッシュ | 画面のファイル | だれ |
    |---|---|---|---|
    | `t-units` | `#/t/units` | `teacher-units` | teacher |
    | `t-lessons` | `#/t/lessons` | `teacher-lessons` | teacher |
    | `t-lesson` | `#/t/lesson/<classId>/<lessonId>` | `teacher-lesson`（Task 5） | teacher |

    `classId`・`lessonId` は `/^[A-Za-z0-9]+$/` だけを受けつける。
  - `js/views/parts/teacher-nav.js`: `teacherNav(ctx, current) → HTMLElement`。先生の画面の上部の帯（「授業ログ　先生」、メニュー「クラス」「単元」「授業」、右に「ログアウト」）。`current` は `'classes' | 'units' | 'lessons'` で、今の画面のメニューに印（色と `aria-current="page"`）を付ける。メニューは `ctx.navigate` で移る。ログアウトは確かめてから `ctx.signOutAll()` → `ctx.navigate('login', {}, { confirmed: true })`（今の `teacher-classes.js` のログアウトと同じ動き）。

- [ ] **Step 0: 今 1 件だけ失敗しているテストを直す**

  Task 3 で `js/gas-config.js` に `appUrl`（本番用の GAS の URL。今は空の文字）を足したため、`tests/rules-check.test.js` の「設定ファイルの形が決まりどおりで、値は文字列」が失敗している。このテストを、`GAS` のキーが `appUrl` と `url` の 2 つで、どちらも文字であること、を確かめる形に直す（`js/gas-config.js` は変えない）。ほかのテストは変えない。

- [ ] **Step 1: `tests/router.test.js` にテストを足す**（3 つの画面の行き来、`#/t/lesson/a`・`#/t/lesson/a/b/c`・`#/t/lesson/a%2Fb/c` は `not-found`）

- [ ] **Step 2: 画面を書く（設計書 7.5 の「単元」「授業」）**

  - `teacher-units.js`（`#/t/units`）: 年度を選ぶ（はじめは `schoolYear(ctx.now())`。クラスのある年度と今の年度を選べる）。その年度の単元を `order` 順に並べ、行ごとに「名前を変える」「上へ」「下へ」。「単元を作る」（名前 1〜40 文字。`checkUnitName`）。並べ替えは `moveInOrder` → `repo.setUnitOrders`。単元の削除は作らない（授業が指しているため。名前を変えて使う）。
  - `teacher-lessons.js`（`#/t/lessons`）:
    - 年度とクラスを選ぶ（はじめは、今の年度の最初のクラス。選んだものは `sessionStorage` ではなく、ハッシュにも残さない。画面を開き直したら最初に戻ってよい）。クラスが無ければ「先にクラスを作ってください」と出す。
    - 選んだクラスの授業を、日付の新しい順に並べる。行: 日付（`11/12（木）` の形）・授業名・単元名・資料の数（「板書 2・資料 1」）。行を押すと `t-lesson` へ。
    - 「授業を作る」: 日付（はじめは今日。`<input type="date">`）、授業名、単元（その年度の単元から選ぶ。「（なし）」も選べる）、対象のクラス（その年度のクラスのチェック。はじめは、今選んでいるクラスだけにチェック）。`checkLesson` でまちがいがあれば文を出す。「作る」で、チェックしたクラスごとに別の `lessonId`（`newId`）で `repo.createLessons` を 1 回呼ぶ。作ったあと、今選んでいるクラスの一覧を読み直す。
    - 「消す」: 行の右。押すと、まず `repo.countRecords` を読み、1 件でもあれば「生徒の記録がある授業は消せません。」と出して消さない。0 件なら確かめる（「この授業と、置いてある資料の一覧を消します。」）。消すときは、その授業の資料のうち、ほかの授業が指していないファイル（`repo.listAllLessons` と `fileRefs` で数える）を `ctx.files.trash` でゴミ箱に入れ、そのあと `repo.deleteLesson`。ファイルの片付けに失敗しても授業は消し、「一部のファイルを片付けられませんでした（Drive に残っています）。」と知らせる。
  - 失敗の文は、今ある画面と同じ言い方（「つながりません。もう一度ためしてください。」など）。読みこみ中・保存中はボタンを押せなくする。

- [ ] **Step 3: `npm test` がすべて通ることを確かめる。`node --check` で画面のファイルの構文を確かめる**

- [ ] **Step 4: コミット**（`feat: 単元と授業の画面を追加`）
