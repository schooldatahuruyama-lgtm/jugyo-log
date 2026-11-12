### Task 1: Firebase の準備の手順と、段階 0 用の規則

**Files:**
- Create: `docs/setup/firebase.md`、`docs/setup/rules-check.json`、`js/firebase-config.js`、`js/gas-config.js`
- Test: `tests/rules-check.test.js`

**Interfaces:**
- Produces:
  - `js/firebase-config.js`: `export const FIREBASE = { databaseURL: '', apiKey: '' };`
  - `js/gas-config.js`: `export const GAS = { url: '' };`
  - `docs/setup/rules-check.json`: 上の「段階 0 のデータベースの形」を守る規則。

- [ ] **Step 1:** `tests/rules-check.test.js` を書く。`docs/setup/rules-check.json` を読んで JSON として解釈し、次を確かめる。
  - 根の `.read` と `.write` が `false`。
  - `rules.check.ping['.read'] === true`、`rules.check.ping` に `.write` が無い。
  - `rules.check.$uid['.read']` と `['.write']` が、どちらも文字列 `"auth != null && auth.uid === $uid"`。
  - `rules.check.$uid['.validate'] === "newData.isNumber()"`。
  - `js/firebase-config.js` と `js/gas-config.js` を import し、キーの名前が上の Interfaces のとおりで、値が文字列であること。
- [ ] **Step 2:** `npm test` を実行し、失敗することを確かめる。
- [ ] **Step 3:** `docs/setup/rules-check.json`、`js/firebase-config.js`、`js/gas-config.js` を作る。
- [ ] **Step 4:** `docs/setup/firebase.md` を書く（先生が読む手順書。むずかしい言葉を使わず、押すボタンの名前を書く）。入れる内容:
  1. Firebase のコンソールで新しいプロジェクトを作る（ClassPulse とは別。Google アナリティクスは無効。料金プランは Spark のまま）。
  2. Realtime Database を作る（場所は任意。ロックモードで開始）。
  3. 「ルール」に `docs/setup/rules-check.json` の中身を貼って公開する。
  4. 「データ」で `check/ping` に `true` を入れる。
  5. Authentication を始め、「メール／パスワード」を有効にする（「メールリンク」は無効のまま）。匿名は有効にしない。
  6. プロジェクトの設定から、データベースの URL と Web API キーを写し、Claude Code に伝える（この 2 つは公開してよい値）。
  7. してはいけないこと: Blaze プランへの切り替え、支払い方法の登録。
- [ ] **Step 5:** `npm test` を実行し、成功することを確かめる。
- [ ] **Step 6:** コミット: `docs: Firebase の準備の手順と、段階 0 用の規則`。

---

