# 実装指示書: 段階 1a-2 Task 3 のレビュー修正（1 件）

あなた（Codex）は、この指示書に沿ってコードを直します。進め方は `AGENTS.md` の「実装を頼まれたとき」のとおりです。

- もとの指示書: `.ai-tasks/20261114-000300_1a2-task3-gas-client-file-cache.md`（Global Constraints はそのまま守る）
- レビュー: `.ai-review/20261113-224153_round1.md` の指摘 1
- 変えてよいファイル: `js/gas.js`、`tests/gas.test.js` だけ。ほかのファイル（`js/main.js`・`js/files.js`・`js/views/`・`js/router.js`・`tests/rules-check.test.js` など）は、別の作業が進行中なので変えない。変える必要があると思ったら、変えずに報告に書く。
- `git add`・`git commit` はしない。テストを先に書き、失敗を確かめてから直す。
- 完了の条件: `node --test tests/gas.test.js` がすべて成功し、`npm test` で、この修正と関係のない失敗（`tests/rules-check.test.js` の gas-config のキーの 1 件。把握済みで別の作業で直す）のほかに失敗がない。

## 直すこと

**ログアウトしても、順番待ち・やり直し待ちの GAS の呼び出しが止まらず、次にログインした人のトークンで送られてしまう。**

`createGas` の `call(op, payload)` は、呼ばれた時点のログイン中の人（`auth.user` の `uid`。ログインしていなければ `null`）を覚える。そして、次のどの時点でも、今の `auth.user` の `uid` が覚えた値と違っていたら（ログアウトした・別の人になった）、**通信を送らずに** `NetError('auth')` で終える。

- 順番が来て、最初に送る前
- やり直しの待ちが明けて、送り直す前
- `error: 'auth'` を受けて `auth.forceRefresh()` を呼ぶ前と、そのあと送り直す前
- トークンを取ったあと、送る直前（トークンを取っている間に替わることがあるため）

呼ばれた時点でログインしていない（`auth.user` が無い）ときは、通信を送らずに `NetError('auth')`。

`auth.user` は、`{ uid, email }` か `null` を返す getter（`js/auth.js` と `js/dev/demo.js` の auth。変えない）。

## 足すテスト（`tests/gas.test.js`）

テストの auth の代役には、`user`（書きかえられる）と `getToken`・`forceRefresh` を持たせる。

- **1 つ目の呼び出しを保留 → 2 つ目を呼ぶ（順番待ち）→ ログアウト（`user = null`）→ 別の人でログイン（`user = { uid: 'uB' }`）→ 1 つ目の保留を解除** → 2 つ目は `NetError('auth')` で終わり、`fetch` は 2 回目が呼ばれていない。そのあと、新しい人が呼んだ 3 つ目は、ふつうに送られる（順番待ちが止まらない）。
- やり直しの待ちの間に別の人に替わる → 送り直さずに `NetError('auth')`。
- `error: 'auth'` を受けたあと、`forceRefresh` の間に別の人に替わる → 送り直さずに `NetError('auth')`。
- 同じ人のまま（`uid` が同じ）なら、今までどおりに送られる（今あるテストがすべて通る）。
- ログインしていない状態で `call` → `fetch` を呼ばずに `NetError('auth')`。

## 報告

変更したファイル、テストの結果、指示書と違う点を、日本語の Markdown で報告する。
