# 実装指示書: 段階 1a-2 Task 3

あなた（Codex）は、この指示書に沿ってコードを書きます。進め方は `AGENTS.md` の「実装を頼まれたとき」のとおりです。

- 計画: `docs/superpowers/plans/2026-11-14-jugyo-log-stage1a-2.md` の Task 3（下に、そのまま写してあります）
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

### Task 3: GAS を呼ぶ部品と、ファイルの取り置き

**Files:**
- Create: `js/gas.js`、`js/file-cache.js`、`js/files.js`、`js/dev/demo-gas.js`、`tests/gas.test.js`、`tests/file-cache.test.js`、`tests/files.test.js`、`tests/demo-gas.test.js`
- Modify: `js/gas-config.js`（`appUrl: ''` を足す。`url` は確認用のまま変えない）、`js/main.js`（`ctx.files` を足す。`ctx.signOutAll` を足す）、`js/dev/demo.js`（練習モードの `gas` を返す）、`js/views/teacher-classes.js`・`js/views/student-home.js`（ログアウトで `ctx.signOutAll()` を呼ぶ）、`js/errors.js`（NetError の code に `'notfound'`・`'toobig'` を足す。コメントだけ）

**Interfaces:**
- Consumes: `auth.getToken()`・`auth.forceRefresh()`、`CONFIG.gas`、`NetError`、Task 2 の op の表。
- Produces:
  - `js/gas.js`: `createGas({ url, auth, fetch, timeoutMs, maxTries, retryBaseMs, random, setTimeout, clearTimeout }) → { call(op, payload = {}) → 返ってきた JSON（ok: true のもの）, get busy }`
    - 呼び出しは **1 つずつ順番に**行う（前の呼び出しが、やり直しも含めて終わってから次を送る）。
    - 本文は `{ op, token, ...payload }`。トークンは送る直前に `auth.getToken()` で取る（やり直しのたびに取り直す）。
    - 応答が JSON でない・`fetch` の失敗・時間切れ・`error: 'server'` は「やり直せる失敗」。`retryBaseMs × 2^(回数-1) × (0.5〜1.5 のばらつき)` だけ待ってやり直す。`maxTries` 回でだめなら `NetError('network')`。
    - `error: 'auth'` は、1 回だけ `auth.forceRefresh()` してやり直す。それでも `auth` なら `NetError('auth')`。
    - `denied` → `NetError('denied')`、`notfound` → `'notfound'`、`toobig` → `'toobig'`、`bad`・`config`・そのほか → `'unknown'`（やり直さない）。
    - `url` が空なら、通信をせずに `NetError('unknown')`。
  - `js/file-cache.js`: `createFileCache({ caches, name = 'jugyolog-files-v1' }) → { get(fileId) → Blob | null, put(fileId, blob) → void, remove(fileId) → void, clear() → void }`。Cache API に `https://files.jugyolog.invalid/<fileId>` をキーにして入れる。`caches` が無い・使えない（例外）ときは、メモリの中の Map で同じように動く（落ちない）。
  - `js/files.js`: `createFiles({ gas, cache }) →`
    - `upload({ key, mime, name, dataB64 }) → { fileId, bytes }`（`putMaterial`）
    - `loadImages(classId, lessonId, materials) → { [materialId]: Blob }`（`materials` は `materialList` の結果。画像だけ。取り置きにあるものは GAS を呼ばず、無いものだけを 12 個ずつ `getMaterials` で取り、取り置きに入れる。取れなかったものは結果に入れない）
    - `loadFile(classId, lessonId, material) → Blob`（取り置きにあればそれを返す。無ければ `getFile`。PDF に使う）
    - `trash(fileId) → void`（`trashFile` のあと、取り置きからも消す）
    - `clearCache() → void`
    - base64 と Blob の変換は、このモジュールの中の関数で行う（`atob`・`Blob` は引数で受け取る。既定は `globalThis` のもの）。
  - `js/dev/demo-gas.js`: `createDemoGas({ net, getUser }) → { call(op, payload) }`。本物の GAS と同じ op と返し方を、端末の中だけでまねる（ファイルはメモリの中の Map。ページを読み直すと消える。`getMaterials`・`getFile` で無いファイルは `missing`・`notfound`）。先生かどうか・組の一員かどうかは、`net`（練習モードのデータベース）を読んで決める。
  - `js/main.js`: `ctx.files`（`createFiles`）。本物のときは `createGas({ url: GAS.appUrl, … })`、練習モードでは `createDemoGas`。`ctx.signOutAll()` は、`files.clearCache()` → `auth.signOut()` の順に行う（取り置きの片付けに失敗しても、ログアウトはする）。

- [ ] **Step 1: `tests/gas.test.js` を書く**

  ```js
  test('呼び出しは 1 つずつ。前のが終わるまで次を送らない', async () => {
    const f = deferredFetch();                       // 呼ばれた順に、あとから応答を決められる fetch
    const gas = createGas({ url: URL, auth: fakeAuth('t1'), fetch: f.fetch, ...fast });
    const a = gas.call('whoami'); const b = gas.call('ping');
    await tick(); assert.equal(f.calls.length, 1);   // b はまだ送られていない
    f.resolve(0, json({ ok: true, role: 'teacher' }));
    await a; await tick(); assert.equal(f.calls.length, 2);
    f.resolve(1, json({ ok: true, version: 'app-1' })); await b;
  });
  ```

  ほかのテスト:
  - 本文は `text/plain;charset=utf-8` の POST で、`{ op, token, …payload }`。ほかのヘッダーが無い。
  - HTML が返る（JSON でない）→ 待ってやり直し、3 回目で成功したらその結果。待つ時間は `retryBaseMs × 2^(n-1) × (0.5〜1.5)` の中（`random` と `setTimeout` を代役にして確かめる）。
  - 3 回ともだめ → `NetError('network')`。**そのあとの呼び出しは、ふつうに送られる**（順番待ちが止まらない）。
  - `fetch` が返らない → `timeoutMs` で止めてやり直す。
  - `error: 'auth'` → `forceRefresh` を 1 回呼び、新しいトークンで送り直す。また `auth` → `NetError('auth')`（3 回目は送らない）。
  - `denied`・`notfound`・`toobig`・`bad`・`config` は、やり直さずにそれぞれの code。
  - `url` が空 → `fetch` を呼ばずに `unknown`。
  - 例外の文に、トークンと本文（`dataB64`）が入っていない。

- [ ] **Step 2: `tests/file-cache.test.js`・`tests/files.test.js`・`tests/demo-gas.test.js` を書く**

  - `file-cache`: 代役の `caches`（`open` → `match`・`put`・`delete`、`caches.delete`）で、入れたものが取れる・`remove`・`clear`。`caches` が `undefined` でも、`open` が例外を投げても、メモリで同じように動く。キーにファイル ID のほかの情報（トークンなど）が入っていない。
  - `files.loadImages`: 取り置きに 2 個あり、3 個が無いとき、`getMaterials` の `ids` は無い 3 個だけ。取れたものは取り置きに入る。`missing` のものは結果に無い。13 個が無ければ、12 個と 1 個の 2 回に分けて呼ぶ。PDF は頼まない。
  - `files.loadFile`: 取り置きにあれば GAS を呼ばない。無ければ `getFile` を呼び、取り置きに入れる。
  - `files.upload`: `putMaterial` に `{ key, mime, name, dataB64 }` を渡し、`{ fileId: id, bytes }` を返す。
  - `files.trash`: `trashFile` のあと、取り置きから消える。
  - `demo-gas`: 先生は保存でき、同じ `key` は 1 個。生徒は `denied`。その組の一員でない生徒の `getMaterials` は `notfound`。

- [ ] **Step 3: 実装して `npm test` がすべて通ることを確かめる。`js/main.js`・`js/dev/demo.js`・ログアウトの 2 か所を直す**

- [ ] **Step 4: コミット**（`feat: GAS を呼ぶ部品とファイルの取り置きを追加`）
