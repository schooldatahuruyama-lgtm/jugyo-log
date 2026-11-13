# 実装指示書: 段階 1a-1 Task 3

- 計画: `docs/superpowers/plans/2026-11-13-jugyo-log-stage1a-1.md` の Task 3
- 設計: `docs/superpowers/specs/2026-11-12-jugyo-log-design.md`、`docs/superpowers/specs/2026-11-13-jugyo-log-1a-data.md`（データの形）
- 完了の条件: 下の Step をすべて行い、`npm test` がすべて成功する。`git add`・`git commit` はしない（コミットは Claude Code が行う）。
- 変更してよいのは、下の「Files」にあるファイルだけ。ほかの変更が必要だと思ったら、変えずに報告に書く。

## Global Constraints

- 作業フォルダは `C:\Users\yan12\Documents\keita\AI開発\授業ログアプリ`。この外は編集しない（`..\スライドアプリ` は、コードを写すために読むだけ）。
- 進め方は `CLAUDE.md` のとおり。タスクごとに、指示書を `.ai-tasks/YYYYMMDD-HHMMSS_<内容>.md` に書く → 実装（通常はサブエージェント。コミットはしない）→ `npm test` と差分の確認 → Codex レビュー → Claude Code がコミット。
- 外部パッケージをインストールしない。Firebase の SDK を入れない。外部の配信元から実行時に読み込まない（フォントも `assets/fonts/` に置く）。
- Firebase は Spark プランのまま。課金の設定を前提にしない。
- `js/views/` と `js/main.js` のほかのモジュールは、`window`・`document`・`fetch`・`localStorage`・`crypto`・`Date.now` を直接使わず、引数で受け取る。
- データベースの場所（`classes/…` などの文字）を書いてよいのは `js/repo.js` と `js/dev/` だけ。Firebase の URL を書いてよいのは `js/net.js` と `js/auth.js` だけ。
- データベースの形と規則は「データの形」3 章・4 章のとおり。勝手に項目を足さない。
- 生徒用のメールアドレスは `studentEmail(生徒ID, 何回目, 'jugyolog.invalid')` だけで作る。最初の発行は 1 回目（`g1`）。
- 生徒の本名、学校のメールアドレスを保存しない・画面に入力させない。名簿に出すのは出席番号と生徒 ID だけ。
- パスワードを、`initialPw` のほかの場所（データベース、端末の保存、コンソールの出力、エラーの文）に残さない。リポジトリに秘密を入れない。
- 画面に出す文字は `textContent`（`el()` の `text`）で入れる。`innerHTML` を使わない。
- 基準の端末は iPad の Safari（横 1180px・縦 820px、および縦向き）。ボタンは 44×44px 以上。状態は色だけで伝えず、文字を添える。
- 画面の文とコードのコメントは日本語。やさしい言葉を使う（生徒が読む画面は、中学生が読める文にする）。
- 書き方（命名、コメントの量、`createXxx({ … })` で依存を受け取る形）は、スライドアプリと `js/check-steps.js` に合わせる。
- `check.html`・`js/check-logic.js`・`js/check-steps.js`・`gas/check/` は変えない（Task 1 で `js/ids.js` が `check-logic.js` から `studentEmail` を取りこむだけ）。


## Review Focus

仕様には書かれているが、ふつうのテストでは通ってしまいやすい点。それぞれ、下の担当タスクにテストを入れてある。

1. **発行の途中で失敗したとき**（アカウントは作れたが、データベースへの記録に失敗）。やり直すと `EMAIL_EXISTS` になる。回数を 1 つ進めて発行し直し、生徒 ID は 1 人に 1 つのままであること（Task 4）。
2. **1 時間 100 件の上限**（`TOO_MANY_ATTEMPTS_TRY_LATER`）。そこで止まり、済んだ分は残り、あとで続きから発行できること（Task 4）。
3. **出し直したあとの古いアカウント**。古いパスワードでログインしても、生徒として入れないこと（`accounts` の対応がない → ログイン画面に戻す）（Task 3）。
4. **ID の入力のゆれ**。前後の空白、大文字（`S26-017`）、全角の英数字とハイフン（`ｓ２６－０１７`）でもログインできること。形が違う ID では通信をしないこと（Task 1・Task 3）。
5. **出席番号の重なり・空欄・1〜99 のほかの数**を名簿に保存しないこと。別のクラス（同じ年度）にすでにいる生徒 ID を割り当てようとしたら知らせること（Task 4）。


---

### Task 3: アプリの枠・ログイン・練習モード

**Files:**
- Create: `css/base.css`、`css/app.css`、`assets/fonts/`（`..\スライドアプリ\assets\fonts\` の 3 ファイルをコピー）、`js/main.js`、`js/router.js`、`js/ui.js`、`js/session.js`、`js/dev/demo.js`、`js/views/login.js`、`js/views/student-home.js`、`js/views/teacher-classes.js`（この時点では見出しと「ログアウト」だけ）
- Modify: `index.html`（仮のページを、アプリの入り口に置きかえる。`check.html` へのリンクは残さない）
- Test: `tests/router.test.js`、`tests/session.test.js`、`tests/demo.test.js`

**Interfaces:**
- Consumes: Task 1・2 の `createAuth`・`createNet`・`createRepo`・`createMemoryNet`・`normalizeLoginId`・`isStudentId`・`studentEmail`・`CONFIG`・`NetError`。
- Produces:
  - `js/router.js`: `parseRoute(hash) → { name, params }`、`routeHash(name, params) → string`、`viewFile(name) → string`、`roleFor(name) → 'public' | 'student' | 'teacher'`。

    | name | ハッシュ | 画面のファイル | だれ |
    |---|---|---|---|
    | `login` | `#/login` | `login` | public |
    | `home` | `#/`・空 | `student-home` | student |
    | `password` | `#/password` | `password`（Task 5） | student |
    | `t-classes` | `#/t` | `teacher-classes` | teacher |
    | `t-roster` | `#/t/class/<classId>` | `teacher-roster`（Task 4） | teacher |
    | `t-sheet` | `#/t/class/<classId>/sheet` | `teacher-sheet`（Task 4） | teacher |
    | `t-rules` | `#/t/rules` | `teacher-rules`（Task 6） | teacher |
    | `not-found` | そのほか | （`main.js` が文を出す） | public |

  - `js/session.js`:
    - `signIn({ input, password, auth, repo, domain }) → { role: 'teacher' } | { role: 'student', studentId }`。失敗は `NetError`。
    - `resolveSession({ auth, repo }) → { role: 'none' } | { role: 'teacher', uid } | { role: 'student', uid, studentId } | { role: 'offline' }`（保存してあるログインから、今だれなのかを決める）。
  - `js/ui.js`: `el(tag, props, ...children)`、`confirmDialog(opts)`、`closeAllDialogs()`、`toast(message)`、`statusChip(kind, label)`（スライドアプリから写す。集計の棒などは写さない）。
  - `js/dev/demo.js`: `isDemoAllowed(hostname, search) → boolean`、`createDemoBackend({ storage, now, random }) → { net, auth, reset() }`。`auth` は Task 1 の `createAuth` と同じメソッドを持つ。
  - 画面のモジュールは、どれも `export function mount(root, ctx) → cleanup`。`ctx = { auth, repo, session, navigate(name, params), now, random, demo }`。

- [ ] **Step 1: `tests/router.test.js` を書く**

  上の表の 1 行ずつ、`parseRoute` と `routeHash` が行き来すること。`#/t/class/a/b/c`・`#/t/class/`・`#/t/class/a%2Fb`・`#/x` は `not-found`。`classId` は `/^[A-Za-z0-9]+$/` だけを受けつける。

- [ ] **Step 2: `tests/session.test.js` を書く**

  `auth` と `repo` は手書きの代役を使う。

  ```js
  test('生徒: ID から何回目かを読み、そのメールアドレスでログインする', async () => {
    const calls = [];
    const auth = fakeAuth({ onSignIn: (email) => { calls.push(email); return { uid: 'u2', email }; } });
    const repo = { getGeneration: async () => 2, getMyStudentId: async () => 's26-017', isTeacher: async () => false };
    const r = await signIn({ input: ' Ｓ26-017 ', password: 'pw', auth, repo, domain: 'jugyolog.invalid' });
    assert.deepEqual(r, { role: 'student', studentId: 's26-017' });
    assert.deepEqual(calls, ['s26-017.g2@jugyolog.invalid']);
  });
  ```

  ほかのテスト:
  - 形の違う ID（`'abc'`）は、`getGeneration` も `signIn` も呼ばずに `NetError('bad-credentials')`。
  - `getGeneration` が `null`（その ID は発行されていない）→ `'bad-credentials'`（「ID がない」と「パスワードが違う」を区別しない）。
  - ログインはできたが `getMyStudentId` が `null`、または入力した ID と違う → `auth.signOut()` を呼んでから `'bad-credentials'`（**出し直したあとの古いアカウント**）。
  - `@` を含む入力は先生: `auth.signIn(input, password)` → `repo.isTeacher(uid)` が `false` なら `signOut` して `'not-teacher'`。
  - `resolveSession`: `auth.restore()` が `null` → `{ role: 'none' }`。先生 → `{ role: 'teacher', uid }`。生徒 → `{ role: 'student', uid, studentId }`。どちらでもない → `signOut` して `{ role: 'none' }`。`restore` や `repo` が `NetError('network')` → `{ role: 'offline' }`（ログアウトしない）。

- [ ] **Step 3: `tests/demo.test.js` を書く**

  - `isDemoAllowed('localhost', '?demo=1')` は `true`。`'schooldatahuruyama-lgtm.github.io'` では `false`。`?demo=0` は `false`。
  - `createDemoBackend` の `auth`: `signIn('teacher@demo', 何でも)` は先生（`teacherList/demo-teacher` が `true` になっている）。`createAccount(email, pw)` のあと `signIn(email, pw)` ができ、違うパスワードは `'bad-credentials'`、同じメールアドレスの 2 回目の `createAccount` は `'email-exists'`。`changePassword` のあとは新しいパスワードだけが通る。
  - `storage` を渡し直して作り直しても、データとログインが残る。`reset()` で全部消える。
  - 練習モードの保存のキーは、どれも `jugyolog:demo:` で始まる。

- [ ] **Step 4: `js/router.js`・`js/session.js`・`js/dev/demo.js`・`js/ui.js` を書き、`npm test` が通ることを確かめる**

- [ ] **Step 5: `index.html`・`css/`・`js/main.js`・`js/views/login.js`・`student-home.js`・`teacher-classes.js` を書く**

  - `index.html`: `<div id="banner"></div><div id="app"></div>` と `<noscript>`、`css/base.css`・`css/app.css`、`<script type="module" src="js/main.js">`。`lang="ja"`、`viewport`、`<title>授業ログ</title>`。
  - `css/base.css`: スライドアプリの `css/base.css` をもとにする（BIZ UDPGothic、色の変数、ボタン、入力欄、ダイアログ、トースト）。先生の資料の青系 `--teacher` と、自分の記録の黄土色系 `--mine` の変数を足す（設計書 7 章）。
  - `js/main.js`: スライドアプリの `js/main.js` の流れを写す（バックエンドを作る → `resolveSession` → ハッシュに合わせて画面を出す → `hashchange` で描き直す → 前の画面の `cleanup` を呼ぶ）。
    - 設定が空なら「Firebase の設定がまだ入っていません。」。
    - `roleFor(name)` と今の役割が合わないとき: ログインしていなければ `login` へ。先生が `home` を開いたら `t-classes` へ。生徒が先生の画面を開いたら `home` へ。
    - `{ role: 'offline' }` のときは「つながりません。もう一度ためす」を出す（ログイン画面に戻さない）。
    - 練習モードのときは、上に「練習モード（データはこのパソコンの中だけ）」と「練習モードのデータを消す」を出す。
  - `login.js`（設計書 7.1）: 「ID またはメールアドレス」「パスワード」「ログイン」。失敗の文は code で決める: `bad-credentials` →「ID かパスワードがちがいます。」／`not-teacher` →「このメールアドレスは、先生として登録されていません。」／`network` →「つながりません。電波を確かめて、もう一度ためしてください。」／そのほか →「ログインできませんでした。」。送信中はボタンを押せなくする。パスワードの欄は、失敗したら空にする。
  - `student-home.js`: 上部に、クラス名と出席番号（`repo.myClasses(studentId)` の 1 番新しい年度）、メニュー（「パスワードを変える」「ログアウト」）。本文は「まだ授業がありません。」。所属が無いときは「まだクラスに入っていません。先生に聞いてください。」。
  - 「ログアウト」は、確かめてから `auth.signOut()` → `login` へ。

- [ ] **Step 6: ブラウザで確かめる（練習モード）**

  スクラッチパッドの `check-server.mjs` で配り、`http://localhost:8791/index.html?demo=1` を iPad の大きさ（1180×820 と 820×1180）で開く。先生でログイン → 「クラス」の見出しが出る → ログアウト → ログイン画面。まちがった入力で文が出る。`#/t` を直接開くとログイン画面に戻る。コンソールにエラーが出ていない。

- [ ] **Step 7: コミット**（`feat: アプリの枠・ログイン・練習モードを追加`）

---

