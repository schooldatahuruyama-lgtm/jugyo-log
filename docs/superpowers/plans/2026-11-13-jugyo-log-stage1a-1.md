# 授業ログ 段階 1a-1（土台・ログイン・名簿） Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 先生がログインしてクラスを作り、生徒 ID を発行して名簿に割り当て、ID・最初のパスワードの一覧を印刷できる。生徒は配られた ID でログインし、（まだ空の）授業一覧を見て、パスワードを変えられる。

**Architecture:** ビルドなしの HTML・JavaScript（ES モジュール）。1 つの `index.html` の中で、ハッシュ（`#/…`）に合わせて `js/views/` の画面を切りかえる。通信は `js/net.js`（Realtime Database の REST）と `js/auth.js`（Authentication の REST）だけが行い、データベースの場所は `js/repo.js` だけが知る。計算は通信をしないモジュールに置いて `node --test` で確かめる。練習モード（`?demo=1`）は、`net` と `auth` の代わりを端末の中に作る。

**Tech Stack:** HTML / CSS / JavaScript（ES モジュール、外部パッケージなし）、Node.js 18 以上の `node --test`、Firebase Realtime Database・Authentication（REST）、GitHub Pages。

**Spec:** `docs/superpowers/specs/2026-11-12-jugyo-log-design.md`（設計書）の 4 章・5.1・5.4・5.5・7.1・7.5・9 章と、`docs/superpowers/specs/2026-11-13-jugyo-log-1a-data.md`（データの形。以下「データの形」）。実装する人は両方を読む。

**この計画の範囲:** データの形 2 章の「1a-1」だけ。単元・授業・資料・GAS（1a-2）、生徒の授業ページ（1a-3）、記録確認と進級の操作（1a-4）は入れない。生徒の授業一覧は「まだ授業がありません」と出すだけの画面にする。

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

### Task 1: 通信・ログイン・ID の土台

**Files:**
- Create: `js/errors.js`、`js/config.js`、`js/net.js`、`js/auth.js`、`js/ids.js`
- Test: `tests/net.test.js`、`tests/auth.test.js`、`tests/ids.test.js`

**Interfaces:**
- Consumes: `studentEmail(studentId, generation, domain)`（`js/check-logic.js`）。`..\スライドアプリ\js\net.js`・`auth.js`・`errors.js`（写すもと）。
- Produces:
  - `js/errors.js`: `class NetError extends Error`（`code`）。code は `'network' | 'denied' | 'auth' | 'bad-credentials' | 'not-teacher' | 'email-exists' | 'rate' | 'weak-password' | 'reauth' | 'unknown'`。
  - `js/config.js`: `export const CONFIG = { emailDomain: 'jugyolog.invalid', firstGeneration: 1, idLength: 12, initialPasswordLength: 8, minPasswordLength: 8, maxGenerationTries: 20, tokenRefreshMarginMs: 300000, requestTimeoutMs: 10000, maxNumber: 99 }`
  - `js/net.js`: `createNet({ databaseURL, auth, fetch, timeoutMs })` → `{ get(path), getPublic(path), set(path, value), update(path, patch), remove(path), serverTimestamp() }`。`getPublic` はトークンを付けずに読む。`update('', patch)` はルートへの複数パスの書きこみ。**`subscribe` は作らない**（EventSource を使わない）。
  - `js/auth.js`: `createAuth({ apiKey, fetch, storage, now, storageKey = 'jugyolog:auth' })` → `{ signIn(email, password) → { uid, email }, createAccount(email, password) → { uid }, changePassword(newPassword) → void, restore() → user|null, getToken(), forceRefresh(), signOut(), get user }`。
  - `js/ids.js`: `PASSWORD_CHARS`、`formatStudentId(yy, seq) → 's26-017'`、`isStudentId(s) → boolean`、`normalizeLoginId(input) → string`、`initialPassword(random) → string`、`checkNewPassword(password, studentId) → null | 'short' | 'has-id'`、`newId(random, length) → string`、`export { studentEmail } from './check-logic.js'`。

- [ ] **Step 1: `tests/ids.test.js` を書く（失敗することを確かめる）**

```js
test('formatStudentId', () => {
  assert.equal(formatStudentId(26, 17), 's26-017');
  assert.equal(formatStudentId(5, 1), 's05-001');
  assert.throws(() => formatStudentId(26, 1000));   // 連番は 1〜999
  assert.throws(() => formatStudentId(26, 0));
});
test('isStudentId', () => {
  assert.equal(isStudentId('s26-017'), true);
  for (const bad of ['S26-017', 's26-17', 's26017', 'chk-7f3a9c2d', 's26-017 ', '', null]) assert.equal(isStudentId(bad), false);
});
test('normalizeLoginId は空白・大文字・全角をそろえる', () => {
  assert.equal(normalizeLoginId('  S26-017 '), 's26-017');
  assert.equal(normalizeLoginId('ｓ２６－０１７'), 's26-017');
  assert.equal(normalizeLoginId('s26ー017'), 's26-017');   // 長音の記号もハイフンにする
  assert.equal(normalizeLoginId('Teacher@Example.com '), 'Teacher@Example.com'); // @ があれば前後の空白だけ取る
});
test('initialPassword は 8 文字で、まぎらわしい文字を使わない', () => {
  const pw = initialPassword(() => 0.999999);
  assert.equal(pw.length, 8);
  assert.match(initialPassword(Math.random), /^[abcdefghijkmnpqrstuvwxyz23456789]{8}$/);
});
test('checkNewPassword', () => {
  assert.equal(checkNewPassword('abcdefg', 's26-017'), 'short');
  assert.equal(checkNewPassword('xxs26-017xx', 's26-017'), 'has-id');
  assert.equal(checkNewPassword('XXS26017XX', 's26-017'), 'has-id'); // ハイフンなし・大文字でも
  assert.equal(checkNewPassword('sakura-2026', 's26-017'), null);
});
test('newId は英数字だけで指定の長さ', () => {
  assert.match(newId(Math.random, 12), /^[A-Za-z0-9]{12}$/);
});
```

- [ ] **Step 2: `js/errors.js`・`js/config.js`・`js/ids.js` を書き、`npm test` で Step 1 が通ることを確かめる**

  `normalizeLoginId`: `@` を含むなら `trim()` だけ。含まないなら、NFKC にそろえ、空白を取り、小文字にし、`ー`・`－`・`―`・`‐`・`−` を `-` に置きかえる。

- [ ] **Step 3: `tests/net.test.js` を書く（失敗することを確かめる）**

  スライドアプリの `tests/net.test.js` のうち、`get`・`set`・`update`・`remove` と 401・403 の扱いのテストを写し、次を足す。

  - `getPublic('gen/s26-017')` の URL は `https://db.example/gen/s26-017.json`（`?auth=` が付かない）。`auth.getToken` を呼ばない。
  - `getPublic` が 401（本文 `{"error":"Permission denied"}`）なら `NetError('denied')`。
  - `fetch` が `timeoutMs` をすぎても返らないとき、`NetError('network')` になる（`AbortController` で止める。テストでは `timeoutMs: 20` と、解決しない `fetch` を使う）。
  - `update('', { 'a/b': 1, 'c': null })` は `PATCH https://db.example/.json?auth=…` に本文 `{"a/b":1,"c":null}` を送る。

- [ ] **Step 4: `js/net.js` を書く（スライドアプリの `createNet` から `subscribe`・`applyAt`・`isEmpty` を取りのぞき、`getPublic` と時間切れを足す）。`npm test` が通ることを確かめる**

- [ ] **Step 5: `tests/auth.test.js` を書く（失敗することを確かめる）**

  スライドアプリの `tests/auth.test.js` のうち、ログイン・`restore`・`getToken`・`forceRefresh`・`signOut`・世代（古い応答を捨てる）のテストを写し（`signInTeacher` → `signIn`、保存のキー → `jugyolog:auth`、匿名ログインのテストは写さない）、次を足す。

  - `createAccount('a@jugyolog.invalid', 'pw')` は `accounts:signUp` に `{ email, password, returnSecureToken: true }` を送り、`{ uid }` を返す。**今のログイン（`auth.user`、`storage` の中身、`getToken()` の値）は変わらない。**
  - `createAccount` の失敗: `EMAIL_EXISTS` → code `'email-exists'`、`TOO_MANY_ATTEMPTS_TRY_LATER`（`…: 説明` が続く形も）→ `'rate'`、`WEAK_PASSWORD…` → `'weak-password'`。
  - `changePassword('newpass12')` は `accounts:update` に `{ idToken: <今のトークン>, password: 'newpass12', returnSecureToken: true }` を送り、返ってきた新しいトークンに入れかえる（`storage` の `refreshToken` も新しくなる）。`CREDENTIAL_TOO_OLD_LOGIN_AGAIN` → `'reauth'`。
  - `storage` に入るのは `{ uid, email, refreshToken }` だけ（パスワードと ID トークンが入っていない）。

- [ ] **Step 6: `js/auth.js` を書く。`npm test` がすべて通ることを確かめる**

- [ ] **Step 7: コミット**（`feat: 通信・ログイン・ID の土台を追加`）

---

### Task 2: データベースの出し入れ（repo）と本番の規則

**Files:**
- Create: `js/repo.js`、`js/dev/memory-net.js`、`docs/setup/rules.json`
- Modify: `docs/setup/firebase.md`（「9. 本番の規則を貼る」「10. 先生のアカウントを作る」を足す）
- Test: `tests/repo.test.js`、`tests/rules-shape.test.js`

**Interfaces:**
- Consumes: Task 1 の `net`（`get`・`getPublic`・`set`・`update`・`remove`）、`formatStudentId`。
- Produces:
  - `js/dev/memory-net.js`: `createMemoryNet({ initial = null, onChange = () => {} })` → `net` と同じ形（`getPublic` も持つ）に、`dump()` と `clear()` を足したもの。スライドアプリの `js/dev/memory-net.js` を写し、`subscribe` を取りのぞく。規則は見ない。
  - `js/repo.js`: `createRepo(net)` → 次のメソッド。
    - `isTeacher(uid) → boolean`
    - `getGeneration(studentId) → number | null`（`getPublic` を使う）
    - `getMyStudentId(uid) → string | null`
    - `listClasses() → [{ id, year, name, createdAt }]`（年度の新しい順、同じ年度は名前順）
    - `createClass(id, { year, name }, now) → void`、`renameClass(id, name) → void`
    - `listStudents() → [{ id, uid, createdAt }]`（ID 順。`uid` が無ければ `null`）
    - `reserveIds(yy, count, now) → string[]`（`counters/<yy>` を進め、`students/<id>` を作る。1 回の update）
    - `linkAccount(studentId, { uid, generation, password }, oldUid = null) → void`（1 回のルート update: `accounts/<uid>`、`gen/<id>`、`initialPw/<id>`、`students/<id>/uid`、`oldUid` があれば `accounts/<oldUid>: null`）
    - `getInitialPasswords() → { [studentId]: string }`、`clearInitialPassword(studentId) → void`
    - `getMembers(classId) → [{ studentId, number }]`（出席番号順）
    - `getMembersOfYear(year) → { [studentId]: { classId, number } }`
    - `saveMembers(classId, { set: { [studentId]: number }, remove: string[] }) → void`（`members` と `memberOf` を 1 回のルート update で）
    - `myClasses(studentId) → [{ id, year, name, number }]`（年度の新しい順）

- [ ] **Step 1: `tests/repo.test.js` を書く（`createMemoryNet` を相手に動かす。失敗することを確かめる）**

  - `reserveIds(26, 3, 1000)` → `['s26-001','s26-002','s26-003']`。続けて `reserveIds(26, 2, 2000)` → `['s26-004','s26-005']`。`counters/26` は 5。`students/s26-004` は `{ createdAt: 2000 }`。
  - `reserveIds(26, 0, 0)` と、連番が 999 をこえる数は例外（データベースを変えない）。
  - `linkAccount('s26-001', { uid: 'u1', generation: 1, password: 'abcd2345' })` のあと、`accounts/u1 === 's26-001'`、`gen/s26-001 === 1`、`initialPw/s26-001 === 'abcd2345'`、`students/s26-001/uid === 'u1'`。**書きこみは `update('', …)` の 1 回だけ**（`net.update` の呼び出しを数える）。
  - `linkAccount('s26-001', { uid: 'u2', generation: 2, password: 'x' }, 'u1')` のあと、`accounts/u1` が無く、`accounts/u2 === 's26-001'`。
  - `saveMembers('c1', { set: { 's26-001': 3, 's26-002': 1 }, remove: [] })` のあと `getMembers('c1')` は出席番号順（`s26-002` が先）。`memberOf/s26-001/c1 === true`。`remove: ['s26-001']` で両方から消える。書きこみは 1 回。
  - `myClasses('s26-001')` は、`classes` の `year` の新しい順に `{ id, year, name, number }` を返す。`classes` に無い組（消えた組）は入れない。
  - `listClasses()` は、項目が欠けたデータ（`name` が数、`year` が文字）でも落ちない（`name` は `''`、`year` は `0` にする）。
  - `getGeneration('s26-001')` は `getPublic` を呼ぶ（`get` を呼ばない）。数でなければ `null`。

- [ ] **Step 2: `js/dev/memory-net.js` と `js/repo.js` を書き、`npm test` が通ることを確かめる**

- [ ] **Step 3: `docs/setup/rules.json` を書く**

  「データの形」4 章の表のとおり、全部の場所の規則を書く（`lessons`・`thumbs`・`records`・`marks`・`units` も今書く）。`check` は `docs/setup/rules-check.json` と同じ中身を入れる。式は 4 章の 3 つの言い方を、そのまま展開して書く。

- [ ] **Step 4: `tests/rules-shape.test.js` を書く**

  規則そのものの動きは Node では確かめられない（Task 6 の確認画面で確かめる）。ここでは、書きまちがいを見つけるテストだけを書く。

  - `rules.json` が JSON として読める。ルートの `.read`・`.write` が `false`。
  - 最上位のキーが、ちょうど `check`・`teacherList`・`gen`・`accounts`・`students`・`counters`・`initialPw`・`classes`・`members`・`memberOf`・`units`・`lessons`・`thumbs`・`records`・`marks`。
  - `teacherList` のどこにも `.write` がない。
  - `.read` が `true`（だれでも）なのは `check/ping` と `gen/$sid` だけ（木を全部たどって数える）。
  - `auth.uid` を使う式は、すべて `auth != null` を含む。
  - `records` の `$sid` の `.write` に `teacherList` が出てこない（先生は生徒の記録を書けない）。

- [ ] **Step 5: `docs/setup/firebase.md` に手順を足す**

  - 「9. 本番の規則を貼る」: `docs/setup/rules.json` の中身を、手順 3 と同じやり方で貼って公開する。
  - 「10. 先生のアカウントを作る」: Authentication の「ユーザー」タブで「ユーザーを追加」→ 先生のメールアドレスと、自分で決めたパスワードを入れる → 一覧に出た「ユーザー UID」をコピーする → Realtime Database の「データ」で `teacherList` → `<UID>`: `true`（boolean）を作る。パスワードは Claude Code に伝えない、と書く。

- [ ] **Step 6: `npm test` がすべて通ることを確かめ、コミット**（`feat: データベースの出し入れと本番の規則を追加`）

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

### Task 6: 規則の確認画面と、本物の Firebase での確認

**Files:**
- Create: `js/rules-probe.js`、`js/views/teacher-rules.js`、`docs/reports/stage1a-1-check.md`
- Modify: `js/views/teacher-classes.js`（下のほうに「規則の確認」へのリンク）、`README.md`（1a-1 の使い方と、先生の作業）
- Test: `tests/rules-probe.test.js`

**Interfaces:**
- Consumes: `createAuth`（2 つ目を、メモリだけの `storage` と別の `storageKey` で作る）、`createNet`、`createRepo`、`createIssuer`。
- Produces: `js/rules-probe.js`: `runRulesProbe({ teacherRepo, teacherNet, issuer, makeStudent, random, now }) → [{ label, expect: 'ok' | 'denied', got: 'ok' | 'denied' | 'error', pass }]`。`makeStudent(email, password) → { net, uid }`（確認用の生徒としてログインした `net` を返す）。

  手順:
  1. 先生として、確認用の生徒 ID `s00-999` を `students` に置き、`issuer.issueOne('s00-999', { generation: 今の回数 + 1 または 1, oldUid })` でアカウントを作る。確認用のクラス（名前「（規則の確認用）」、年度 0）を 2 つ作り、片方だけに `s00-999` を出席番号 1 で入れる。
  2. 確認用の生徒としてログインし、下の表を順に試す。
  3. 終わったら（途中で失敗しても）、先生として、確認用のクラス 2 つ・`members`・`memberOf`・`accounts` の対応・`initialPw/s00-999` を消す（`students/s00-999` と `gen/s00-999` は、次の確認のために残す）。

  | 試すこと（確認用の生徒として） | 期待 |
  |---|---|
  | `gen/s00-999` を読む（トークンなし） | ok |
  | `gen` 全体を読む（トークンなし） | denied |
  | `accounts/<自分の uid>` を読む | ok |
  | `accounts` 全体を読む | denied |
  | `teacherList/<先生の uid>` を読む | denied |
  | `students` を読む | denied |
  | `initialPw/s00-999` を読む | denied |
  | 入っているクラスの `classes/<id>` を読む | ok |
  | 入っていないクラスの `classes/<id>` を読む | denied |
  | `classes` 全体を読む | denied |
  | `members/<入っているクラス>/s00-999` を読む | ok |
  | `members/<入っているクラス>` 全体を読む | denied |
  | `memberOf/s00-999` を読む | ok |
  | `classes/<入っているクラス>/name` を書く | denied |
  | `memberOf/s00-999/<入っていないクラス>` に `true` を書く | denied |
  | `accounts/<自分の uid>` を別の ID に書きかえる | denied |
  | `gen/s00-999` を書く | denied |
  | `initialPw/s00-999` に文字を書く | denied |
  | `initialPw/s00-999` を消す | ok |

  確認用の ID（`s00-` で始まるもの）は、名簿の「生徒を足す」と「続きを発行する」の数に出さない。`js/roster-logic.js` に `isProbeId(studentId) → boolean` を足し、`unassigned` と `teacher-classes.js` の未発行の数え方で除く（テストも足す）。

- [ ] **Step 1: `tests/rules-probe.test.js` を書く**

  - 代役の `net` が期待どおりに答えるとき、全部の行が `pass: true`。
  - 代役が、`denied` のはずの読みを通してしまうとき、その行だけ `pass: false`（`got: 'ok'`）。
  - `NetError('network')` は `got: 'error'`、`pass: false`（`denied` と数えない）。
  - 途中で例外が出ても、片付け（クラス 2 つ・`members`・`memberOf`・`accounts`・`initialPw` を消す）が呼ばれる。
  - 結果の `label` に、パスワードとトークンが入っていない。

- [ ] **Step 2: `js/rules-probe.js` と `js/views/teacher-rules.js` を書く**

  画面: 「規則の確認を始める」→ 表（試したこと・期待・結果・○×）→「すべて ○ でした。」または「× があります。公開する前に、Claude Code に知らせてください。」→「結果をコピー」。練習モードでは「練習モードでは確かめられません（規則は本物の Firebase にあります）。」と出して、始められないようにする。

- [ ] **Step 3: `npm test` がすべて通ることを確かめ、コミット**（`feat: 規則の確認画面を追加`）

- [ ] **Step 4: 先生の作業を頼む**（ここから先は、先生の作業のあと）

  `docs/setup/firebase.md` の「9. 本番の規則を貼る」「10. 先生のアカウントを作る」を頼む。済んだら次へ。

- [ ] **Step 5: 公開して、本物の Firebase で確かめる**

  `tools/pages-branch.ps1` → `git push origin master pages`。公開されたページで、先生に（または、先生がアプリ内のブラウザでログインした状態で Claude Code が）次を確かめ、`docs/reports/stage1a-1-check.md` に書く。確かめられなかったことは、そう書く。

  1. 先生でログインできる。先生でないメールアドレスでは入れない。
  2. 「規則の確認」がすべて ○。
  3. クラスを 1 つ作り、ID を 3 人分発行し、名簿に入れ、ID の一覧が出る。
  4. 生徒の ID でログインでき、クラス名と出席番号が出る。パスワードを変えられる。
  5. パスワードを出し直すと、古いパスワードでは入れない。
  6. 段階 0 の確認ページ（`check.html`）が、今までどおり全部 ○ になる（規則を入れかえたため）。
  7. iPad の Safari で、ログインと生徒の画面が崩れていない。

- [ ] **Step 6: 結果をコミットして報告する**（`docs: 段階 1a-1 の確認結果を記録`）
