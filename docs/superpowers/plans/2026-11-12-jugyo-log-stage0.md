# 授業ログ 段階 0（接続確認） Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** リポジトリを用意し、学校の iPad と学校のネットワークから「Firebase（ログインとデータベース）」と「先生の Drive に保存する仕組み（GAS）」が使えるかを確かめる確認ページを作って公開する。

**Architecture:** ビルドなしの HTML・JavaScript（ES モジュール）。確認ページ `check.html` は画面だけを受け持ち、通信の手順は `js/check-steps.js`（`fetch` を引数で受け取る）、計算は `js/check-logic.js`（純粋な関数）に置いて `node --test` で確かめる。GAS 側は `gas/check/Code.gs` の 1 ファイルで、テストは Node の `vm` に GAS の代役（`DriveApp` など）を入れて動かす。

**Tech Stack:** HTML / JavaScript（ES モジュール、外部パッケージなし）、Node.js 18 以上の `node --test`、Firebase Realtime Database（REST）、Firebase Authentication（REST）、Google Apps Script のウェブアプリ、GitHub Pages。

**Spec:** `docs/superpowers/specs/2026-11-12-jugyo-log-design.md`（設計書）の 5 章と 6 章。もとの要件は `docs/requirements.md`（要件定義書）。実装する人は両方を読む。

**この計画の範囲:** 段階 0 だけ。段階 1a の計画は、段階 0 の結果（使えるメールアドレスのドメイン、GAS が使えるか、混み合いの数字）が出てから別のファイルに書く。結果によって 1a の作りが変わるため。

## Global Constraints

- 作業フォルダは `C:\Users\yan12\Documents\keita\AI開発\授業ログアプリ`。この外は編集しない（Task 0 で `..\スライドアプリ` からルールと道具をコピーするときだけ読む）。
- 進め方は `CLAUDE.md` のとおり。タスクごとに、指示書を `.ai-tasks/YYYYMMDD-HHMMSS_<内容>.md` に書く → 実装（通常はサブエージェント）→ `npm test` と差分の確認 → Codex レビュー（`tools/codex-review.ps1`。使えないときは別の Claude エージェント）→ コミット。各タスクの「コミット」は、このレビューが済んでから行う。
- 外部パッケージをインストールしない。`package.json` に `dependencies` を書かない。Firebase の SDK を入れない。外部の配信元から実行時に読み込まない。
- Firebase は Spark プラン（無料）のまま使う。課金の設定を前提にしない。
- JavaScript は ES モジュール。`js/check-logic.js` と `js/check-steps.js` は、ブラウザだけにあるもの（`window`、`document`、`fetch`、`localStorage`）を直接使わず、引数で受け取る。
- GAS を呼ぶ通信は、`method: 'POST'`、`headers: { 'Content-Type': 'text/plain;charset=utf-8' }`、本文は JSON の文字列。ほかのヘッダーを足さない。トークンは本文に入れる。GAS の成否は HTTP の状態コードではなく、返ってきた JSON の `ok` で見る。
- 生徒用のメールアドレスは、だれもメールを受け取れないドメインだけで作る。候補はこの順: `jugyolog.invalid`、`jugyolog.example`、`jugyolog.example.com`。ほかのドメインを足さない。
- Drive に保存したファイルを、だれとも共有しない（リンク共有にしない）。
- 生徒の本名、学校のメールアドレスなど、個人が分かる情報をコード・データ・報告に書かない。パスワードなどの秘密をリポジトリに入れない。`js/firebase-config.js` に入れてよいのはデータベースの URL と Web API キー、`js/gas-config.js` に入れてよいのは GAS のウェブアプリの URL だけ。
- 画面に出す文字は `textContent` で入れる。`innerHTML` を使わない。
- 基準の端末は iPad の Safari。ボタンは 44×44px 以上。状態は色だけで伝えず、文字（○・×）を添える。
- 画面の文とコードのコメントは日本語。コミットの文はスライドアプリと同じ形（`feat: …`、`docs: …`、`chore: …` に日本語）。

## Review Focus

設計書が直接は書いていないが、確認ページを学校で使うときに起きやすいこと。それぞれ、下に書いたタスクのテストで確かめる。

1. **GAS が JSON ではないもの（エラーの HTML）を返す、または通信そのものが失敗する。** その項目が「×（理由）」になり、残りの項目へ進み、ページが止まらないこと（Task 3）。
2. **アカウントを作るときに Firebase が断る。** `INVALID_EMAIL` のときだけ次のドメインを試し、それ以外（`TOO_MANY_ATTEMPTS_TRY_LATER`、`OPERATION_NOT_ALLOWED` など）は試すのをやめて、その理由を出すこと（Task 3）。
3. **「確認を始める」を続けて押す・やり直す。** 実行中はボタンが押せず、やり直すたびに新しい確認用アカウントで行うこと。GAS に同じキーで 2 回保存しても、ファイルは 1 個のままであること（Task 2、Task 4）。
4. **GAS の返事が遅い・返ってこない。** 30 秒で打ち切って「×」にすること。同時に 40 回呼ぶ確認では、返ってこない呼び出しを失敗として数え、全体が止まらないこと（Task 3）。
5. **途中の項目が失敗したあとの後片付け。** ログインできていないときは後片付けを飛ばし、エラーを出さないこと。後の項目が失敗しても、作った確認用アカウントと Drive のファイルを消そうとすること（Task 3）。

## ファイルの構成

| ファイル | 役割 | 作るタスク |
|---|---|---|
| `CLAUDE.md`、`AGENTS.md`、`tools/codex-*.ps1`、`tools/codex-*-prompt.md`、`tools/pages-branch.ps1` | 開発のルールと道具（スライドアプリからコピーして書きかえ） | 0 |
| `package.json`、`.gitignore`、`README.md`、`docs/requirements.md` | リポジトリの土台 | 0 |
| `docs/setup/firebase.md`、`docs/setup/rules-check.json` | Firebase の準備の手順と、段階 0 用の規則 | 1 |
| `js/firebase-config.js`、`js/gas-config.js` | 公開してよい設定値（最初は空） | 1 |
| `gas/check/Code.gs`、`docs/setup/gas.md` | 確認用の GAS と、公開の手順 | 2 |
| `tests/helpers/gas-sandbox.js` | GAS の代役を入れて `Code.gs` を動かす道具 | 2 |
| `js/check-logic.js` | メールアドレスの組み立て、集計、結果の文章（純粋な関数） | 3 |
| `js/check-steps.js` | 確認の 1 項目ずつの通信 | 3 |
| `check.html`、`index.html` | 確認ページと、仮の入口 | 4 |
| `docs/reports/stage0-check.md` | 確認の結果を書く用紙 | 5 |

段階 0 のデータベースの形:

```
check/ping: true                 … だれでも読める
check/<uid>: 数値                … 本人だけ読み書きできる
```

---

### Task 0: リポジトリの準備

**Files:**
- Create: `CLAUDE.md`、`AGENTS.md`、`package.json`、`.gitignore`、`README.md`、`docs/requirements.md`、`.ai-tasks/.gitkeep`、`.ai-review/.gitkeep`
- Create（`..\スライドアプリ\tools\` からコピー）: `tools/codex-implement.ps1`、`tools/codex-implement-prompt.md`、`tools/codex-review.ps1`、`tools/codex-review-prompt.md`、`tools/pages-branch.ps1`
- Test: `tests/repo.test.js`

**Interfaces:**
- Produces: `npm test` が `node --test "tests/*.test.js"` を実行する。

- [ ] **Step 1:** `git init`（ブランチ名は `master`）。`git config user.name` と `user.email` を、`git -C ..\スライドアプリ config user.name`／`user.email` と同じ値に、このリポジトリだけに設定する。
- [ ] **Step 2:** `tests/repo.test.js` を書く。テスト名「リポジトリの土台がそろっている」: `CLAUDE.md`、`AGENTS.md`、`docs/requirements.md`、`tools/codex-review.ps1`、`tools/codex-implement.ps1`、`tools/pages-branch.ps1` が存在する。`package.json` を読み、`type === 'module'`、`scripts.test === 'node --test "tests/*.test.js"'`、`dependencies` と `devDependencies` が無いことを確かめる。`.gitignore` に `.superpowers/` の行がある。
- [ ] **Step 3:** `node --test tests/repo.test.js` を実行し、失敗することを確かめる。
- [ ] **Step 4:** ファイルを作る。
  - `package.json`: `name: "jugyo-log"`、`version: "0.1.0"`、`private: true`、`type: "module"`、`description: "授業ログ 授業の資料と生徒の記録を残すアプリ（段階 0）"`、`scripts.test`。
  - `CLAUDE.md`、`AGENTS.md`: スライドアプリのものをコピーし、次を書きかえる。フォルダ名は `授業ログアプリ`、アプリ名は「授業ログ」。設計書の場所は `docs/superpowers/specs/2026-11-12-jugyo-log-design.md`。`-Note` の例は「接続確認ページを追加した」。AGENTS.md の秘密情報の行は「パスワード、先生のパスワード、生徒の最初のパスワード、API キー、生徒の個人情報など」。
  - `CLAUDE.md` の「ユーザーへの許可確認は不要」の行: ユーザーがこのアプリについても同じ承認をした場合だけ、その日付で入れる。承認がなければ、この行を入れず、「既存ファイルの上書き・削除、設定の変更、公開（push）の前にユーザーに確認する」と書く。
  - `tools/` の 5 ファイル: コピーし、中の「ClassPulse」「スライドアプリ」という語を「授業ログ」「授業ログアプリ」に書きかえる。`pages-branch.ps1` は、公開するものを `index.html`、`check.html`、`css`、`js`、`assets` のうち**存在するものだけ**にする（`gas`、`docs`、`tests`、`tools` は公開しない）。ほかの動きは変えない。
  - `docs/requirements.md`: `授業ログアプリ_要件定義書.md` と同じ内容（原本は残す）。
  - `.gitignore`: `node_modules/`、`*.local.json`、`.superpowers/`、`*.docx`。
  - `README.md`: アプリの 1 行の説明、「いまは段階 0（接続確認）」という状態、資料へのリンク（要件定義書、設計書、この計画）、`npm test` の説明。
- [ ] **Step 5:** `npm test` を実行し、成功することを確かめる。
- [ ] **Step 6:** コミット: `chore: リポジトリの準備（開発ルール、道具、要件定義書、設計書、計画）`。`docs/superpowers/` の設計書と計画も入れる。

---

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

### Task 2: 確認用の GAS

**Files:**
- Create: `gas/check/Code.gs`、`docs/setup/gas.md`、`tests/helpers/gas-sandbox.js`
- Test: `tests/gas-check.test.js`

**Interfaces:**
- Produces（GAS のウェブアプリの決まり。Task 3 が使う）: `doPost(e)` が、`e.postData.contents`（JSON の文字列）を読み、`ContentService` の JSON 文字列を返す。

| `op` | 入力 | 成功したときの返事 |
|---|---|---|
| `ping` | なし | `{ ok: true, version: 'check-1' }` |
| `put` | `token`、`key`（半角英数と `-` で 8〜64 文字）、`mime`（`image/jpeg`）、`dataB64` | `{ ok: true, id, existed }`（`existed` は、同じ人の同じ `key` がすでにあったら `true`） |
| `get` | `token`、`id` | `{ ok: true, mime, dataB64 }` |
| `quota` | `token` | `{ ok: true, limit, used }`（バイト数） |
| `cleanup` | `token` | `{ ok: true, removed }`（その人の確認用ファイルをゴミ箱に入れた数） |

失敗したときは `{ ok: false, error }`。`error` は `'bad'`（入力が正しくない）、`'auth'`（本人確認ができない）、`'notfound'`（無い、または自分のものではない）、`'toobig'`（`dataB64` が 1,400,000 文字を超える）、`'server'`（それ以外の例外）。

- `tests/helpers/gas-sandbox.js`: `export function loadGas(file, fakes)` — `file` の中身を `vm` で動かし、`fakes`（`DriveApp`、`UrlFetchApp`、`ContentService`、`PropertiesService`、`CacheService`、`LockService`、`Utilities`）をグローバルとして見せ、`{ doPost, doGet }` を返す。`export function makeFakes({ databaseURL, validTokens })` — メモリの中で動く代役の一式と、中身を調べるための `files`（保存されたファイルの配列）と `fetched`（`UrlFetchApp.fetch` に渡された URL の配列）を返す。`validTokens` は `{ <token>: <uid> }`。

本人確認の決まり（設計書 5.3）:
- トークン（JWT）の 2 番目の部分を base64url として読み、`user_id` を取り出す（署名はここでは確かめない）。
- `UrlFetchApp.fetch(DATABASE_URL + '/check/' + uid + '.json?auth=' + token, { muteHttpExceptions: true })` を呼び、応答コードが 200 なら本人とする。200 以外は `'auth'`。
- `DATABASE_URL` はスクリプト プロパティから読む。
- 確認の結果は `CacheService.getScriptCache()` に、トークンの SHA-256 をキーにして 60 秒だけ覚える。

ファイルの決まり:
- 保存先は、Drive の直下のフォルダ「授業ログ_接続確認」。無ければ `LockService` で 1 つだけ作る。
- ファイル名は `<uid>_<key>`。持ち主の `uid` はファイルの説明（description）に入れる。
- `get` と `cleanup` は、説明が呼んだ人の `uid` と同じファイルだけを扱う。フォルダの外のファイル ID を渡されたら `'notfound'`。
- ファイルの共有の設定を変えない。

- [ ] **Step 1:** `tests/helpers/gas-sandbox.js` を書く。
- [ ] **Step 2:** `tests/gas-check.test.js` を書く。`makeFakes({ databaseURL: 'https://db.example', validTokens: { [tokA]: 'uidA', [tokB]: 'uidB' } })` を使う（`tokA`・`tokB` は、ペイロードに `user_id` を入れたテスト用の JWT の形の文字列）。テスト:
  - 「ping はトークンなしで返る」: `{ ok: true, version: 'check-1' }`。
  - 「put したものを get で取り出せる」: `dataB64` が同じ、`mime` が `image/jpeg`、`existed === false`。
  - 「同じ key で 2 回 put してもファイルは 1 個」: 2 回目は `existed === true`、`id` が 1 回目と同じ、`files.length === 1`。
  - 「ほかの人のファイルは get できない」: `tokB` で `tokA` のファイルの `id` を渡すと `{ ok: false, error: 'notfound' }`。
  - 「フォルダの外のファイルは get できない」: 代役にフォルダの外のファイルを 1 つ置き、その `id` で `'notfound'`。
  - 「にせもののトークンは断る」: `validTokens` に無いトークンで `put`・`get`・`quota`・`cleanup` がどれも `{ ok: false, error: 'auth' }`。
  - 「トークンの形がこわれていても例外にならない」: `token: 'abc'`、`token: 123`、`token` なしで `'auth'`。
  - 「本人確認は 60 秒の間、問い合わせ直さない」: 同じトークンで 2 回呼び、`fetched.length === 1`。
  - 「key の形が正しくないと断る」: `'a'`、`'../x'`、65 文字で `'bad'`。
  - 「大きすぎるデータは断る」: `dataB64` が 1,400,001 文字で `'toobig'`。
  - 「JSON でない本文は bad」: `e.postData.contents = '<html>'` で `{ ok: false, error: 'bad' }`。
  - 「cleanup は自分のファイルだけをゴミ箱に入れる」: A が 2 個、B が 1 個のとき、A の `cleanup` は `removed === 2`、B のファイルは残る。
  - 「quota は数値を返す」: `limit` と `used` が数値。
  - 「中で例外が起きても JSON を返す」: 代役の `DriveApp` が例外を投げるようにして、`{ ok: false, error: 'server' }`。
- [ ] **Step 3:** `npm test` を実行し、失敗することを確かめる。
- [ ] **Step 4:** `gas/check/Code.gs` を書く。`doPost(e)` は全体を `try`／`catch` で囲み、必ず `ContentService.createTextOutput(JSON.stringify(...)).setMimeType(ContentService.MimeType.JSON)` を返す。`doGet()` は `{ ok: true, version: 'check-1' }` を返す（ブラウザで URL を開いて、公開できたかを目で確かめるため）。ファイルの先頭に、何のためのスクリプトかと、貼り方は `docs/setup/gas.md` にあることをコメントで書く。
- [ ] **Step 5:** `npm test` を実行し、成功することを確かめる。
- [ ] **Step 6:** `docs/setup/gas.md` を書く（先生が読む手順書）。入れる内容:
  1. 学校用の Google アカウントで script.google.com を開き、新しいプロジェクトを作る（名前は「授業ログ 接続確認」）。
  2. `gas/check/Code.gs` の中身を貼って保存する。
  3. 「プロジェクトの設定」→「スクリプト プロパティ」に `DATABASE_URL`（Firebase のデータベースの URL）を入れる。
  4. 「デプロイ」→「新しいデプロイ」→ 種類「ウェブアプリ」、実行するユーザー「自分」、アクセスできるユーザー「全員」。
  5. 権限の確認の画面で許可する（Drive と外部への通信）。出てくる画面の文と、押す順番を書く。
  6. 表示された URL（`https://script.google.com/macros/s/…/exec`）を Claude Code に伝える。
  7. **「全員」を選べない場合**（「（学校名）内の全員」しか出ない場合）: そこで止めて、その画面に出ている選択肢を Claude Code に伝える。これが段階 0 でいちばん確かめたい点である。
  8. コードを直したあとは、「デプロイを管理」→ 鉛筆 → バージョン「新バージョン」で更新する（URL は変わらない）。
- [ ] **Step 7:** コミット: `feat: 確認用の GAS（保存・取り出し・本人確認）と公開の手順`。

---

### Task 3: 確認の計算と通信

**Files:**
- Create: `js/check-logic.js`、`js/check-steps.js`
- Test: `tests/check-logic.test.js`、`tests/check-steps.test.js`

**Interfaces:**
- Consumes: Task 1 の `FIREBASE`、`GAS`（値として受け取る。import しない）。Task 2 の GAS の決まり。
- Produces:

`js/check-logic.js`
```js
export const EMAIL_DOMAINS = ['jugyolog.invalid', 'jugyolog.example', 'jugyolog.example.com'];
export const GAS_TIMEOUT_MS = 30000;
export const FIREBASE_TIMEOUT_MS = 10000;
export const PARALLEL_COUNT = 40;

// 生徒 ID と「何回目か」からログイン用のメールアドレスを作る。例: ('s26-017', 1, 'jugyolog.invalid') → 's26-017.g1@jugyolog.invalid'
export function studentEmail(studentId, generation, domain) {}
// 確認用の ID を作る。例: 'chk-7f3a9c2d'（random は 0 以上 1 未満を返す関数）
export function checkStudentId(random) {}
// 12 文字のパスワードを作る（英小文字と数字。まぎらわしい l・o・0・1 を除く）
export function randomPassword(random) {}
// 同時に呼んだ結果をまとめる。runs は [{ ok: boolean, ms: number }]
// 戻り値: { total, ok, ng, medianMs, maxMs }（ok が 0 件のとき medianMs と maxMs は null）
export function summarizeParallel(runs) {}
// バイト数を「12.3GB」「456MB」の形にする
export function formatBytes(n) {}
// 結果の一覧を、貼り付け用の文章にする。
// items は [{ label, ok, detail }]（ok は true / false / null（未実施））、info は { when, userAgent, screen, place }
export function reportText(items, info) {}
```

`js/check-steps.js`
```js
// deps: { fetch, firebase: { databaseURL, apiKey }, gasUrl, now: () => number, random: () => number,
//         setTimeout, clearTimeout, AbortController }
// 戻り値の各関数は、成功したら詳細（文字列。無ければ ''）を返し、失敗したら Error を投げる（message は画面に出す日本語）。
export function createCheckSteps(deps) {
  return {
    readPing() {},            // 1. check/ping を読む
    signUp() {},              // 2. 生徒用の形のアカウントを作る。詳細は使えたドメイン
    signIn() {},              // 3. 作ったアカウントでログインする
    writeAndRead() {},        // 4. check/<uid> に数値を書いて読み、同じ値か確かめる
    refresh() {},             // 5. 更新用のトークンでログインを更新する
    gasPing() {},             // 6. GAS に届く
    gasPut(dataB64) {},       // 7. 写真を 1 枚保存する。詳細は「0.8 秒」のようなかかった時間
    gasGet() {},              // 8. 保存した写真を取り出す。戻り値は { detail, dataB64 }
    gasParallel() {},         // 9. 同時に PARALLEL_COUNT 回取り出す。詳細は「成功 38 / 失敗 2、中央 2.1 秒、最大 6.4 秒」
    gasQuota() {},            // 10. Drive の容量。詳細は「全体 100GB、使用 12.3GB」
    cleanup() {},             // 後片付け: GAS の cleanup と、Firebase のアカウントの削除（accounts:delete）
    state() {},               // { domain, uid, hasToken, fileId } を返す（テストと画面用）
  };
}
```

決まり:
- `signUp` は `EMAIL_DOMAINS` を順に試す。Firebase の返事のエラーが `INVALID_EMAIL` のときだけ次のドメインへ進む。ほかのエラーはそこでやめ、`Error('アカウントを作れませんでした（' + エラーの名前 + '）')` を投げる。全部のドメインが `INVALID_EMAIL` なら `Error('どのドメインの形も受け付けられませんでした')`。
- Firebase への通信は `FIREBASE_TIMEOUT_MS`、GAS への通信は `GAS_TIMEOUT_MS` で打ち切る。打ち切ったときの文は「N 秒たっても返事がありませんでした」。
- GAS の返事が JSON として読めないとき: `Error('保存の仕組みから、正しい形の返事がありませんでした')`。`fetch` が例外を投げたとき: `Error('保存の仕組みにつながりませんでした')`。`ok: false` のとき: `Error('保存の仕組みが断りました（' + error + '）')`。
- `gasPut` は、同じ実行の中では同じ `key` を使う（`checkStudentId` の値をもとに 1 回だけ作る）。
- `gasParallel` は、`PARALLEL_COUNT` 個の `get` を同時に始め、`Promise.allSettled` で全部を待つ。失敗と時間切れは `ok: false` として数える。1 件も成功しなければ Error、1 件でも成功すれば詳細を返す（失敗の数は詳細に出す）。
- `cleanup` は、トークンが無ければ何もせずに `''` を返す。GAS の `cleanup` が失敗しても、Firebase のアカウントの削除は行う。どちらかが失敗したら、その内容を詳細に入れて返す（投げない）。
- 前の項目が失敗して必要なもの（トークン、ファイル ID）が無いとき、その項目は `Error('前の項目ができていないため、確認できません')`。

- [ ] **Step 1:** `tests/check-logic.test.js` を書く。
  - `studentEmail('s26-017', 1, 'jugyolog.invalid') === 's26-017.g1@jugyolog.invalid'`、`studentEmail('s26-017', 3, 'jugyolog.example') === 's26-017.g3@jugyolog.example'`。
  - `EMAIL_DOMAINS` が上の 3 つで、この順。
  - `checkStudentId(() => 0)` が `/^chk-[0-9a-f]{8}$/` に合う。`random` を変えると値が変わる。
  - `randomPassword` が 12 文字で、`/^[a-km-np-z2-9]+$/` に合う。
  - `summarizeParallel([{ok:true,ms:100},{ok:true,ms:300},{ok:false,ms:9000},{ok:true,ms:200}])` が `{ total: 4, ok: 3, ng: 1, medianMs: 200, maxMs: 300 }`。
  - `summarizeParallel([])` と、全部が失敗の入力で `medianMs === null`、`maxMs === null`。
  - `formatBytes(107374182400) === '100GB'`、`formatBytes(13207024435) === '12.3GB'`、`formatBytes(478150656) === '456MB'`、`formatBytes(0) === '0MB'`。
  - `reportText` が、1 行目に日時、各項目を「○ / × / －」と `label` と `detail` で 1 行ずつ、最後に `userAgent`・`screen`・`place` を出す。`ok: null` の項目は「－ 未実施」。
- [ ] **Step 2:** `tests/check-steps.test.js` を書く。`fetch` の代役は、呼ばれた `(url, init)` を記録し、テストごとに決めた返事を返す。
  - 「GAS への通信は text/plain の POST で、ほかのヘッダーが無い」: `gasPing` のあと、記録した `init.method === 'POST'`、`Object.keys(init.headers)` が `['Content-Type']` だけ、値が `'text/plain;charset=utf-8'`、`JSON.parse(init.body).op === 'ping'`。`gasPut` では本文に `token` が入り、URL にトークンが入っていない。
  - 「INVALID_EMAIL のときだけ次のドメインを試す」: 1 回目 `INVALID_EMAIL`、2 回目成功 → `state().domain === 'jugyolog.example'`、`signUp` の詳細に `jugyolog.example` が入る。
  - 「ほかのエラーでは次を試さない」: 1 回目 `TOO_MANY_ATTEMPTS_TRY_LATER` → Error（message にその名前）、`fetch` は 1 回だけ。
  - 「全部 INVALID_EMAIL」: Error「どのドメインの形も受け付けられませんでした」、`fetch` は 3 回。
  - 「GAS が HTML を返す」: `gasPing` が Error「保存の仕組みから、正しい形の返事がありませんでした」。
  - 「fetch が失敗する」: `gasPing` が Error「保存の仕組みにつながりませんでした」。
  - 「GAS が断る」: `{ ok: false, error: 'auth' }` → message に `auth`。
  - 「時間切れ」: 返事を返さない `fetch` と、手で進める `setTimeout` の代役で、`gasPing` が「30 秒たっても返事がありませんでした」、`readPing` が「10 秒たっても返事がありませんでした」。
  - 「同時に 40 回」: `get` の 40 回のうち 3 回を失敗、2 回を返事なし（時間切れ）にする → 詳細が「成功 35 / 失敗 5」で始まり、Error にならない。40 回とも失敗 → Error。
  - 「同じ実行では put の key が同じ」: `gasPut` を 2 回呼び、本文の `key` が同じ。
  - 「前の項目が無いとき」: `signUp` をせずに `signIn`、`gasPut`、`gasGet` → Error「前の項目ができていないため、確認できません」。
  - 「後片付け」: トークンなしで `cleanup()` が `''` を返し、`fetch` が呼ばれない。トークンありで GAS の `cleanup` が失敗しても、`accounts:delete` が呼ばれ、投げない。
  - 「書いた値を読んで確かめる」: `writeAndRead` で、読んだ値が違うと Error。
- [ ] **Step 3:** `npm test` を実行し、失敗することを確かめる。
- [ ] **Step 4:** `js/check-logic.js` を実装する。
- [ ] **Step 5:** `js/check-steps.js` を実装する。Firebase の REST は次を使う: `accounts:signUp`（`email`、`password`、`returnSecureToken: true`）、`accounts:signInWithPassword`、`securetoken.googleapis.com/v1/token`（`grant_type=refresh_token`）、`accounts:delete`（`idToken`）。データベースは `<databaseURL>/check/<uid>.json?auth=<idToken>`。
- [ ] **Step 6:** `npm test` を実行し、成功することを確かめる。
- [ ] **Step 7:** コミット: `feat: 接続確認の計算と通信（アカウントの形、保存の仕組み、同時 40 回）`。

---

### Task 4: 確認ページ

**Files:**
- Create: `check.html`、`index.html`
- Test: `tests/check-page.test.js`

**Interfaces:**
- Consumes: `createCheckSteps`、`reportText`、`PARALLEL_COUNT`（Task 3）、`FIREBASE`、`GAS`（Task 1）。

画面（1 列。`..\スライドアプリ\check.html` の見た目と作りをもとにする。配色は設計書 7 章の青系: 主な色 `#1F4E79`）:
- 見出し「授業ログ 接続確認」と、1 行の説明。
- 設定が空のとき（`FIREBASE.databaseURL`、`FIREBASE.apiKey`、`GAS.url` のどれか）: 「× 設定がまだありません。」と、どれが空かを出し、ボタンを押せなくする。
- 「確認している場所」の選択（学校／家／そのほか）。結果の文章に入る。
- ボタン「確認を始める」。実行中は押せない。終わったら「もう一度確認する」。
- 項目の一覧（11 個＋後片付け）。それぞれ「－ まだ確認していません」→「… 確認しています」→「○ できました（詳細）」または「× できませんでした（理由）」。

| 番号 | 画面に出す名前 |
|---|---|
| 1 | データベースを読む |
| 2 | 生徒用のアカウントを作る |
| 3 | 作ったアカウントでログインする |
| 4 | データベースに書いて読む |
| 5 | ログインを更新する |
| 6 | 保存の仕組みに届く |
| 7 | 写真を 1 枚保存する |
| 8 | 保存した写真を取り出して表示する |
| 9 | 同時に 40 回取り出す |
| 10 | Drive の容量を見る |
| 11 | 端末の中に保存できる |
| － | 後片付け |

- 項目 7 の写真: ページの中で作る（`canvas` 1600×1200 に、色の帯と細かい模様と日時の文字を描き、JPEG 品質 0.8 にする。およそ 0.2〜0.4MB になるようにする）。カメラや写真の許可を求めない。
- 項目 8: 取り出した写真を、項目の下に幅 240px で表示する。
- 項目 11: `localStorage`、`IndexedDB`、`caches`（Cache API）のそれぞれに、小さな値を書いて読んで消す。詳細に「localStorage ○、IndexedDB ○、Cache ×」のように出す。3 つとも × のときだけ「×」。
- 項目 1〜11 は、前が失敗しても順に全部行う。最後に必ず後片付けを行う（`try`／`finally`）。
- まとめの文: 1〜11 が全部 ○ なら「すべて ○ でした。」。× があれば「× がありました。下の『結果をコピー』を押して、Claude Code に伝えてください。」。
- 端末の情報: `navigator.userAgent`、画面の大きさ（`screen.width`×`screen.height`、`devicePixelRatio`）、`navigator.maxTouchPoints`。
- ボタン「結果をコピー」: `reportText` の文章をクリップボードに入れる。できないときは、文章を選べるテキストの欄に出す。結果の文章に、トークン・パスワード・メールアドレス・uid を入れない。

`index.html`: 「授業ログは準備中です」と、`check.html` へのリンクだけ。

- [ ] **Step 1:** `tests/check-page.test.js` を書く（ファイルを文字として読む検査）。
  - `check.html` に `innerHTML` という文字が無い。
  - `check.html` が `./js/check-steps.js`、`./js/check-logic.js`、`./js/firebase-config.js`、`./js/gas-config.js` を import している。
  - 上の表の 12 個の名前が、すべて `check.html` にある。
  - `check.html` に `http://` で始まる外部の読み込みが無く、`<script src=` と `<link rel="stylesheet"` が無い（外から読み込まない）。
  - `check.html` に `<meta name="viewport"` がある。
  - `index.html` に `check.html` へのリンクがある。
- [ ] **Step 2:** `npm test` を実行し、失敗することを確かめる。
- [ ] **Step 3:** `check.html` と `index.html` を書く。
- [ ] **Step 4:** `npm test` を実行し、成功することを確かめる。
- [ ] **Step 5:** ブラウザで確かめる。`python -m http.server 8765 --bind 127.0.0.1` で開き、iPad の大きさ（1024×768 と 768×1024）で、次を見る。
  - 設定が空のとき、「設定がまだありません」が出て、ボタンが押せない。
  - スクラッチパッドに置いた一時スクリプトで、`fetch` を代役に差しかえたページ（成功の場合、GAS だけ失敗の場合、全部失敗の場合）を開き、項目の表示、まとめの文、写真の表示、「結果をコピー」の文章を見る。
  - 実行中にボタンが押せないこと、やり直すと表示が最初に戻ることを見る。
- [ ] **Step 6:** コミット: `feat: 接続確認ページ（段階 0）`。

---

### Task 5: 公開と、結果を書く用紙

**Files:**
- Create: `docs/reports/stage0-check.md`
- Modify: `README.md`、`js/firebase-config.js`、`js/gas-config.js`

**Interfaces:**
- Consumes: ユーザーが `docs/setup/firebase.md` と `docs/setup/gas.md` を終えて伝えた値（データベースの URL、Web API キー、GAS の URL）。GitHub のリポジトリ（ユーザーが作る）。

- [ ] **Step 1:** `docs/reports/stage0-check.md` を書く。設計書 6 章の 1〜8 を表にし、それぞれに「学校」「家」の結果を書く欄と、日付の欄を作る。下に、次を書く欄を作る: 使えたメールアドレスのドメイン、GAS を「全員」で公開できたか、写真 1 枚の保存と取り出しにかかった時間、同時 40 回の結果（学校で 3 回分）、Drive の容量、iPad の情報、端末の中の保存の結果。最後に「段階 1a の計画に反映すること」の欄を作る。まだ確かめていない欄は「未確認」と書いておく。
- [ ] **Step 2:** `README.md` に、接続確認の手順を書き足す。先生がすること（`docs/setup/firebase.md` → `docs/setup/gas.md` → 値を Claude Code に伝える → 公開された確認ページを学校の iPad と家で開く → 「結果をコピー」で伝える）と、公開の手順（`tools/pages-branch.ps1`、`git push origin master`、`git push origin pages`、GitHub の Settings → Pages で Branch を `pages` / (root)）。
- [ ] **Step 3:** コミット: `docs: 接続確認の結果を書く用紙と、README の手順`。
- [ ] **Step 4（ユーザーの作業を待つ）:** ユーザーから 3 つの値と GitHub のリポジトリの URL を受け取ったら、`js/firebase-config.js` と `js/gas-config.js` に値を入れ、`npm test`、コミット（`chore: Firebase と GAS の設定値`）、`git remote add origin <URL>`、`tools/pages-branch.ps1`、push を行う。push は外に公開する操作なので、`CLAUDE.md` の決まりに従う（承認の行が無いときは、行う前にユーザーに確認する）。
- [ ] **Step 5（ユーザーの作業を待つ）:** 手元のパソコンで公開されたページを開き、項目 1〜11 を確かめる。次に、ユーザーが学校の iPad（学校のネットワーク）と家で開いた結果を受け取り、`docs/reports/stage0-check.md` に書く。確かめられなかった項目は「未確認」のままにする。
- [ ] **Step 6:** 結果をユーザーに報告する。× があった項目と、設計書 6 章の「止められていた場合の候補」のどれに当たるかを書き、段階 1a の計画に進むか、代わりの方法を相談するかを聞く。コミット: `docs: 段階 0 の確認の結果`。

---

## 段階 0 が終わったあと

- 確認用の GAS（`gas/check/`）と `check/` の規則は、段階 1a で本番用に置きかえる。確認ページは、学校の端末が変わったときのために残す。
- 段階 1a の計画（`docs/superpowers/plans/` の別ファイル）は、`docs/reports/stage0-check.md` の「段階 1a の計画に反映すること」をもとに書く。
