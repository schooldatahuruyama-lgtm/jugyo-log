# 実装指示書: 段階 1a-1 Task 5

- 計画: `docs/superpowers/plans/2026-11-13-jugyo-log-stage1a-1.md` の Task 5
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

### Task 5: 生徒のパスワードの変更

**Files:**
- Create: `js/views/password.js`、`js/password-flow.js`
- Test: `tests/password-flow.test.js`

**Interfaces:**
- Consumes: `auth.signIn`・`auth.changePassword`・`auth.user`、`repo.clearInitialPassword`、`checkNewPassword`。
- Produces: `js/password-flow.js`: `changeMyPassword({ auth, repo, studentId, current, next, again }) → void`。失敗は `NetError`、または `{ code: 'short' | 'has-id' | 'mismatch' | 'same' }` を持つ `Error`（名前は `InputError`。`js/errors.js` に足す）。

- [ ] **Step 1: `tests/password-flow.test.js` を書く**

  - `next !== again` → `'mismatch'`。`next === current` → `'same'`。`checkNewPassword` の結果 → `'short'`・`'has-id'`。**どれも通信をしない。**
  - ふつうの流れの順番: `auth.signIn(auth.user.email, current)` → `auth.changePassword(next)` → `repo.clearInitialPassword(studentId)`。
  - 今のパスワードが違う（`signIn` が `'bad-credentials'`）→ そのまま投げる。`changePassword` を呼ばない。
  - `clearInitialPassword` が失敗しても、変更は成功として終える（パスワードは変わっている。先生の一覧に古い「最初のパスワード」が残るだけ）。失敗を握りつぶしたことをコメントに書く。

- [ ] **Step 2: `js/password-flow.js` と `js/views/password.js` を書く**

  画面: 「今のパスワード」「新しいパスワード」「新しいパスワード（もう一度）」「変える」「やめる」。決まり（「8 文字以上」「自分の ID を入れない」）を、はじめから文で出しておく。成功したら「パスワードを変えました。」と出して `home` へ。失敗の文: `short` →「8 文字以上にしてください。」／`has-id` →「自分の ID を入れないでください。」／`mismatch` →「2 つの新しいパスワードがちがいます。」／`same` →「今のパスワードと同じです。」／`bad-credentials` →「今のパスワードがちがいます。」。

- [ ] **Step 3: `npm test` とブラウザ（練習モード）で確かめる**

  生徒でログイン → パスワードを変える → ログアウト → 新しいパスワードで入れる → 先生の名簿で、その生徒が「変更済み」になり、ID の一覧では「（変更済み）」と出る。

- [ ] **Step 4: コミット**（`feat: 生徒のパスワードの変更を追加`）

---

