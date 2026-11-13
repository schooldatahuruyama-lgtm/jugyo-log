# 実装指示書: 段階 1a-1 Task 4

- 計画: `docs/superpowers/plans/2026-11-13-jugyo-log-stage1a-1.md` の Task 4
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

### Task 4: クラス・ID の発行・名簿・ID 一覧の印刷

**Files:**
- Create: `js/roster-logic.js`、`js/issue.js`、`js/views/teacher-roster.js`、`js/views/teacher-sheet.js`、`css/print.css`
- Modify: `js/views/teacher-classes.js`（クラスの一覧・作成・名前の変更、ID の発行）、`css/app.css`、`index.html`（`print.css` を足す）
- Test: `tests/roster-logic.test.js`、`tests/issue.test.js`

**Interfaces:**
- Consumes: Task 1〜3 の全部。
- Produces:
  - `js/roster-logic.js`（通信をしない）:
    - `checkRows(rows, { maxNumber, elsewhere }) → [{ index, code }]`。`rows = [{ studentId, number }]`（`number` は入力のままの文字）。`elsewhere = { [studentId]: クラス名 }`（同じ年度の、ほかのクラスにいる生徒）。code は `'bad-id' | 'dup-id' | 'no-number' | 'bad-number' | 'dup-number' | 'elsewhere'`。
    - `diffMembers(prev, next) → { set: { [studentId]: number }, remove: string[] }`。`prev`・`next` は `[{ studentId, number }]`。変わっていないものは `set` に入れない。
    - `unassigned(students, membersOfYear) → string[]`（その年度のどのクラスにもいない生徒 ID。ID 順）。
    - `carryOver(prevMembers) → [{ studentId, number: '' }]`（前の年度のクラスの生徒 ID を、出席番号を空にして引きつぐ。ID 順）。
    - `sheetRows(members, passwords) → [{ number, studentId, password }]`（`passwords` に無い ID の `password` は `null`）。
    - `schoolYear(dateMs) → number`（4 月はじまり。2027 年 3 月 31 日 → 2026）。
    - `entryYY(year) → number`（年度の下 2 桁）。
  - `js/issue.js`: `createIssuer({ auth, repo, random, domain, firstGeneration, maxTries })` →
    - `issueOne(studentId, { generation, oldUid = null }) → { generation, password }`（`generation` から試し、`'email-exists'` なら 1 つ進める。`maxTries` 回でだめなら `NetError('unknown')`。成功したら `repo.linkAccount`）。
    - `issueMany(studentIds, { onProgress }) → { done: string[], left: string[], reason: null | 'rate' | 'network' | 'unknown' }`（1 人ずつ順に。失敗したら、そこで止めて残りを `left` に入れる）。

- [ ] **Step 1: `tests/roster-logic.test.js` を書く**

  ```js
  test('checkRows: 出席番号の重なり・空欄・範囲の外・ほかのクラス', () => {
    const rows = [
      { studentId: 's26-001', number: '1' },
      { studentId: 's26-002', number: '1' },      // 重なり → 2 行とも dup-number
      { studentId: 's26-003', number: '' },       // no-number
      { studentId: 's26-004', number: '100' },    // bad-number
      { studentId: 's26-005', number: '１２' },    // 全角の数は 12 として受けつける
      { studentId: 's26-006', number: '3.5' },    // bad-number
      { studentId: 's26-007', number: '7' },      // elsewhere
      { studentId: 'x', number: '8' },            // bad-id
    ];
    const errs = checkRows(rows, { maxNumber: 99, elsewhere: { 's26-007': '2年B組' } });
    assert.deepEqual(errs.map((e) => [e.index, e.code]),
      [[0, 'dup-number'], [1, 'dup-number'], [2, 'no-number'], [3, 'bad-number'], [5, 'bad-number'], [6, 'elsewhere'], [7, 'bad-id']]);
  });
  ```

  ほかのテスト: 同じ生徒 ID が 2 行 → 両方 `dup-id`。`diffMembers`（足す・番号だけ変える・外す・変えない）。`unassigned`。`carryOver`。`sheetRows`。`schoolYear`（3 月 31 日と 4 月 1 日の境）。

- [ ] **Step 2: `tests/issue.test.js` を書く**

  - ふつうの発行: `auth.createAccount('s26-001.g1@jugyolog.invalid', <8 文字>)` → `repo.linkAccount('s26-001', { uid, generation: 1, password }, null)`。返す `password` は `createAccount` に渡したものと同じ。
  - **記録に失敗したあとのやり直し**: 1 回目は `linkAccount` が `NetError('network')` で失敗 → `issueOne` は例外。2 回目の `issueOne('s26-001', { generation: 1 })` では `createAccount` が `g1` で `'email-exists'` → `g2` で成功 → `linkAccount` の `generation` は 2。
  - `'email-exists'` が `maxTries` 回つづいたら `NetError('unknown')`。`linkAccount` を呼ばない。
  - 出し直し: `issueOne('s26-001', { generation: 2, oldUid: 'u1' })` → `linkAccount` の 3 つ目の引数が `'u1'`。
  - **上限**: `issueMany(['a','b','c'])` で 2 人目の `createAccount` が `'rate'` → `{ done: ['a'], left: ['b','c'], reason: 'rate' }`。3 人目は試さない。
  - `onProgress` は 1 人終わるごとに `(済んだ数, 全体の数)` で呼ばれる。
  - 作ったパスワードが、例外の文や `onProgress` の引数に入っていない。

- [ ] **Step 3: `js/roster-logic.js`・`js/issue.js` を書き、`npm test` が通ることを確かめる**

- [ ] **Step 4: 画面を書く（設計書 7.5 の「クラス」「名簿」）**

  - `teacher-classes.js`（`#/t`）:
    - クラスの一覧（年度ごとに区切る。新しい年度が上）。行を押すと名簿（`t-roster`）へ。「名前を変える」。
    - 「クラスを作る」: 年度（はじめは `schoolYear(now)`）と名前（40 文字まで。空は不可）。ID は `newId(random, CONFIG.idLength)`。
    - 「生徒 ID を発行する」: 入学年度（はじめは今の年度）と人数（1〜200）を入れる → `repo.reserveIds` → `issueMany`。進みぐあい（「12 / 40 人」）を出す。`reason: 'rate'` のときは「一度に作れる数の上限に当たりました。1 時間ほどあとで『続きを発行する』を押してください。」。`network` のときは「つながりません。『続きを発行する』を押してください。」。
    - 「続きを発行する」: `listStudents()` のうち `uid` が無い ID があるときだけ出す（「まだ発行が済んでいない ID が 28 件あります」）。
    - 発行の途中で画面を離れようとしたら、確かめる。
  - `teacher-roster.js`（`#/t/class/<classId>`）:
    - 表: 出席番号（入力欄）・生徒 ID・状態（「最初のパスワードのまま」／「変更済み」）・「パスワードを出し直す」・「外す」。
    - 「生徒を足す」: その年度のどのクラスにもいない ID（`unassigned`）を、チェックで選んで足す。
    - 「前のクラスから引きつぐ」: 前の年度のクラスを選ぶと、その生徒 ID が出席番号の空いた行として足される（すでに表にある ID は足さない）。
    - 「保存する」: `checkRows` でまちがいがあれば、その行に文を出して保存しない（`dup-number` →「出席番号が重なっています」など）。なければ `diffMembers` → `repo.saveMembers`。保存していない変更があるまま離れようとしたら、確かめる。
    - 「パスワードを出し直す」: 確かめる（「s26-017 のパスワードを出し直します。今のパスワードでは入れなくなります。記録は残ります。」）→ `issueOne(id, { generation: 今の回数 + 1, oldUid: 今の uid })` → 新しいパスワードを、その場で 1 回だけ画面に出す（一覧の印刷にも出る）。
    - 「ID の一覧を印刷する」→ `t-sheet` へ。
  - `teacher-sheet.js`（`#/t/class/<classId>/sheet`）: 設計書 5.4 の一覧。クラス名、表（出席番号・名前を手で書く欄（空）・生徒 ID・最初のパスワード）、ログインのしかた（アプリの URL。`location.origin + location.pathname`）。パスワードが `null` の行は「（変更済み）」。「印刷する」は `window.print()`。`css/print.css`（`@media print`）で、ボタンと上部の帯を消し、1 人分ずつ切りはなせる罫線にする。

- [ ] **Step 5: ブラウザで確かめる（練習モード）**

  クラスを 2 つ作る → ID を 5 人分発行 → 1 つ目の名簿に 3 人を足して保存 → 2 つ目の名簿の「生徒を足す」に残りの 2 人だけが出る → 出席番号を重ねて保存すると止まる → ID の一覧を開く（印刷の見た目は、ブラウザの印刷プレビューの代わりに `print` のメディアを当てて見る）→ 1 人のパスワードを出し直す → ログアウトし、その生徒の新しいパスワードでログインできる・古いパスワードでは入れない。iPad の大きさ（横・縦）で表がはみ出さない。コンソールにエラーが出ていない。

- [ ] **Step 6: コミット**（`feat: クラス・ID の発行・名簿・ID 一覧の印刷を追加`）

---

