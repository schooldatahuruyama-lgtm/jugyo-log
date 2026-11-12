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

