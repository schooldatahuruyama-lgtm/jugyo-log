# 授業ログ 段階 1a-2（単元・授業・先生の資料） Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 先生が単元と授業を作り、授業ごとに板書の写真と配布資料（写真・PDF）を置ける。ファイルは、本番用の Google Apps Script（GAS）を通して先生の Drive に保存し、取り出して大きく表示できる。

**Architecture:** 1a-1 の作り（`index.html` 1 つ、`js/views/` の画面、`js/repo.js` がデータベースの場所を知る）に足す。Drive とのやり取りは `gas/Code.gs`（本番用の GAS）と、それを呼ぶ `js/gas.js`（1 台につき同時に 1 つ・失敗したら間をあけてやり直す）で行う。取り出したファイルは `js/file-cache.js`（Cache API）に取っておく。先生の資料を開けるかどうかは、GAS が呼んだ人のトークンで `lessons/<classId>/<lessonId>/materials/<materialId>` を読めるかで決める（＝データベースの規則が決める）。

**Tech Stack:** HTML / CSS / JavaScript（ES モジュール、外部パッケージなし）、Node.js 18 以上の `node --test`、Firebase Realtime Database・Authentication（REST）、Google Apps Script のウェブアプリ、pdf.js（`js/lib/pdfjs/`。スライドアプリと同じ版を置いてある）、GitHub Pages。

**Spec:** `docs/superpowers/specs/2026-11-12-jugyo-log-design.md`（設計書）の 5.2・5.3・7.2 のサムネイルの決まり・7.5、`docs/superpowers/specs/2026-11-13-jugyo-log-1a-data.md`（データの形）の 3〜5 章。実装する人は両方を読む。

**この計画の範囲:** データの形 2 章の「1a-2」。生徒の画面（授業一覧・授業ページ・記録。1a-3）と、先生の記録確認・進級（1a-4）は入れない。生徒の添付と手書き（1b）も入れない。

**実装の担当:** コードは Codex が書く（`tools/codex-implement.ps1`）。各タスクの指示書は、この計画の「Global Constraints」「Review Focus」と、そのタスクの節をそのまま含む。

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

### Task 0: 部品のコピー（Claude Code が行う。Codex には渡さない）

- [ ] `..\スライドアプリ\js\lib\pdfjs\` を `js/lib/pdfjs/` にコピーする（`LICENSE` を含む全部）。
- [ ] `..\スライドアプリ\js\image.js` を `js/image.js` にコピーする（中身はそのまま）。`..\スライドアプリ\tests\image.test.js` を `tests/image.test.js` にコピーし、`npm test` が通ることを確かめる。
- [ ] コミット（`chore: pdf.js と画像の縮小の部品を追加`）。

---

### Task 1: 単元・授業・資料のデータの出し入れ

**Files:**
- Create: `js/lesson-logic.js`、`tests/lesson-logic.test.js`
- Modify: `js/repo.js`、`tests/repo.test.js`、`js/net.js`、`tests/net.test.js`、`js/dev/memory-net.js`、`docs/setup/rules.json`、`tests/rules-shape.test.js`、`docs/superpowers/specs/2026-11-13-jugyo-log-1a-data.md`（4 章の表の `lessons` の行に「先生は全体を読める」と書き足す）、`js/config.js`

**Interfaces:**
- Consumes: `createNet`・`createMemoryNet`・`createRepo`（今あるもの）、`newId`。
- Produces:
  - `js/config.js` に足す: `lessonTitleMax: 60`、`unitNameMax: 40`、`materialNameMax: 80`、`image: { maxEdge: 1600, maxChars: 400000 }`、`thumb: { maxEdge: 320, maxChars: 20000 }`、`pdfMaxBytes: 10485760`、`materialsPerLesson: 12`、`gas: { timeoutMs: 60000, maxTries: 3, retryBaseMs: 1500 }`。
  - `js/net.js`: `get(path, { shallow = false } = {})`。`shallow: true` のとき URL に `&shallow=true` を足す（その場所の子のキーだけが `{ キー: true }` で返る）。`js/dev/memory-net.js` の `get` も同じ引数を受け、同じ形を返す。
  - `docs/setup/rules.json`: `lessons` の直下に、先生だけの `.read` を足す（`"lessons": { ".read": "<先生>", "$classId": { …今のまま… } }`）。ほかは変えない。
  - `js/lesson-logic.js`（通信をしない）:
    - `checkLesson({ date, title }, { titleMax }) → null | 'bad-date' | 'no-title' | 'long-title'`（`date` は実在する `YYYY-MM-DD`。`2026-02-30` は `'bad-date'`）
    - `checkUnitName(name, { max }) → null | 'empty' | 'long'`
    - `sortLessons(lessons) → lessons`（日付の新しい順、同じ日付は `createdAt` の新しい順。もとの配列を変えない）
    - `sortUnits(units) → units`（`order` の小さい順、同じなら名前順）
    - `moveInOrder(items, id, dir) → { [id]: order }`（`items` は `order` 順の `[{ id, order }]`。`dir` は `-1`（上へ）か `1`（下へ）。入れかえたあとの全員の `order` を 0 から振り直して返す。端で動けないときは `{}`）
    - `materialList(materials) → [{ id, kind, type, fileId, name, order, bytes }]`（`order` 順。形のおかしい項目は入れない。`kind` は `'board' | 'handout'`、`type` は `'image' | 'pdf'`）
    - `thumbOrder(materials) → string[]`（一覧のサムネイルに使う `materialId` の順。板書の画像 → そのほかの画像 → PDF。それぞれの中では `order` 順）
    - `nextOrder(materials) → number`（今ある `order` の最大 + 1。無ければ 0）
    - `fileRefs(allLessons, fileId) → [{ classId, lessonId, materialId }]`（`allLessons` は `{ [classId]: { [lessonId]: 授業 } }`）
    - `todayString(dateMs) → 'YYYY-MM-DD'`（その端末の時刻で）
  - `js/repo.js` に足すメソッド:
    - `listUnits(year) → [{ id, year, name, order }]`（その年度のものだけ。`sortUnits` の順）
    - `createUnit(id, { year, name, order }) → void`、`renameUnit(id, name) → void`、`setUnitOrders({ [id]: order }) → void`（1 回のルート update）
    - `listLessons(classId) → [{ id, classId, date, title, unitId, materials, createdAt, updatedAt }]`（`sortLessons` の順。`materials` は生のオブジェクト。無ければ `{}`）
    - `getLesson(classId, lessonId) → 授業 | null`
    - `listAllLessons() → { [classId]: { [lessonId]: 授業 } }`（先生だけが読める）
    - `createLessons(items, now) → void`（`items = [{ classId, lessonId, date, title, unitId }]`。1 回のルート update で全部作る。`unitId` が空なら項目を置かない）
    - `updateLesson(classId, lessonId, { date, title, unitId }, now) → void`（この 3 つと `updatedAt` だけを書く。`materials` にさわらない）
    - `countRecords(classId, lessonId) → number`（`records/<classId>/<lessonId>` を `shallow` で読んで、キーの数を返す）
    - `deleteLesson(classId, lessonId) → void`（`lessons/…` と `thumbs/…` を 1 回のルート update で消す。記録があるかは呼ぶ側が先に確かめる）
    - `addMaterial(targets, materialId, material, thumb, now) → void`（`targets = [{ classId, lessonId, order }]`。それぞれに `lessons/<c>/<l>/materials/<materialId>`（`material` に `order` を足したもの）、`thumbs/<c>/<l>/<materialId>`（`thumb` が文字のとき）、`lessons/<c>/<l>/updatedAt` を置く。全部を 1 回のルート update で）
    - `removeMaterial(classId, lessonId, materialId, now) → void`（`materials/<materialId>` と `thumbs/…/<materialId>` を消し、`updatedAt` を書く。1 回）
    - `setMaterialOrders(classId, lessonId, { [materialId]: order }, now) → void`
    - `getThumbs(classId, lessonId) → { [materialId]: string }`

- [ ] **Step 1: `tests/lesson-logic.test.js` を書く（失敗することを確かめる）**

```js
test('checkLesson', () => {
  assert.equal(checkLesson({ date: '2026-11-12', title: '電流と電圧' }, { titleMax: 60 }), null);
  assert.equal(checkLesson({ date: '2026-02-30', title: 'x' }, { titleMax: 60 }), 'bad-date');
  assert.equal(checkLesson({ date: '2026/11/12', title: 'x' }, { titleMax: 60 }), 'bad-date');
  assert.equal(checkLesson({ date: '2026-11-12', title: '   ' }, { titleMax: 60 }), 'no-title');
  assert.equal(checkLesson({ date: '2026-11-12', title: 'あ'.repeat(61) }, { titleMax: 60 }), 'long-title');
});
test('moveInOrder: 入れかえて 0 から振り直す。端では何もしない', () => {
  const items = [{ id: 'a', order: 0 }, { id: 'b', order: 5 }, { id: 'c', order: 9 }];
  assert.deepEqual(moveInOrder(items, 'b', -1), { b: 0, a: 1, c: 2 });
  assert.deepEqual(moveInOrder(items, 'a', -1), {});
  assert.deepEqual(moveInOrder(items, 'c', 1), {});
  assert.deepEqual(moveInOrder(items, 'x', 1), {});
});
test('thumbOrder: 板書の画像 → そのほかの画像 → PDF', () => {
  const m = {
    p: { kind: 'handout', type: 'pdf', fileId: 'f1', name: 'a.pdf', order: 0, bytes: 1 },
    h: { kind: 'handout', type: 'image', fileId: 'f2', name: 'a', order: 1, bytes: 1 },
    b2: { kind: 'board', type: 'image', fileId: 'f3', name: 'a', order: 3, bytes: 1 },
    b1: { kind: 'board', type: 'image', fileId: 'f4', name: 'a', order: 2, bytes: 1 },
    bad: { kind: 'board', type: 'video', fileId: 'f5', name: 'a', order: 4, bytes: 1 },
  };
  assert.deepEqual(thumbOrder(m), ['b1', 'b2', 'h', 'p']);
  assert.deepEqual(materialList(m).map((x) => x.id), ['p', 'h', 'b1', 'b2']);
});
test('fileRefs: 同じファイルを指している授業を全部返す', () => {
  const all = { c1: { l1: { materials: { m1: { fileId: 'F' }, m2: { fileId: 'G' } } } }, c2: { l9: { materials: { m1: { fileId: 'F' } } }, l8: {} } };
  assert.deepEqual(fileRefs(all, 'F'), [{ classId: 'c1', lessonId: 'l1', materialId: 'm1' }, { classId: 'c2', lessonId: 'l9', materialId: 'm1' }]);
  assert.deepEqual(fileRefs(all, 'Z'), []);
});
```

  ほかのテスト: `checkUnitName`、`sortLessons`（日付・`createdAt`・もとの配列を変えない）、`sortUnits`、`nextOrder`（空なら 0）、`todayString`、`materialList` が `null`・配列・文字を受けても落ちない。

- [ ] **Step 2: `js/lesson-logic.js` と `js/config.js` を書き、Step 1 が通ることを確かめる**

- [ ] **Step 3: `tests/net.test.js`・`tests/repo.test.js`・`tests/rules-shape.test.js` にテストを足す（失敗することを確かめる）**

  - `net.get('records/c1/l1', { shallow: true })` の URL は `https://db.example/records/c1/l1.json?auth=…&shallow=true`。引数なしの `get` は今までと同じ URL。
  - `createMemoryNet` の `get(path, { shallow: true })` は、オブジェクトなら `{ キー: true }`、文字や数ならそのまま、無ければ `null`。
  - `createLessons([{ classId: 'c1', lessonId: 'l1', date, title, unitId: 'u1' }, { classId: 'c2', lessonId: 'l2', date, title, unitId: '' }], 1000)`: 書きこみは `update('', …)` の 1 回。`lessons/c2/l2` に `unitId` の項目が無い。`createdAt`・`updatedAt` は 1000。
  - `updateLesson` は `materials` を消さない（先に `addMaterial` しておき、`updateLesson` のあとも残っている）。
  - `addMaterial([{ classId: 'c1', lessonId: 'l1', order: 0 }, { classId: 'c2', lessonId: 'l2', order: 3 }], 'm1', { kind: 'board', type: 'image', fileId: 'F', name: '板書', bytes: 100 }, 'data:image/jpeg;base64,xx', 2000)`: 2 つの授業に同じ `fileId` の資料が入り、`order` はそれぞれ 0 と 3。`thumbs/c1/l1/m1` がある。書きこみは 1 回。`thumb` が `null` なら `thumbs` を書かない。
  - `removeMaterial('c1', 'l1', 'm1', 3000)` のあと、`c1` からは消え、`c2/l2` には残る。`thumbs/c1/l1/m1` も消える。
  - `countRecords`: `records/c1/l1` に 2 人分あれば 2、無ければ 0。**`get` を `shallow: true` で呼ぶ**（中身を読まない）。
  - `deleteLesson` は `lessons/c1/l1` と `thumbs/c1/l1` を 1 回の update で消す。
  - `listLessons` は、`date` や `title` が欠けたデータでも落ちない（`''` にする）。`sortLessons` の順。
  - `listUnits(2026)` は 2026 年度だけを `order` 順で返す。`setUnitOrders` は 1 回の update。
  - 規則の形: `rules.lessons['.read']` が先生の式（`teacherList` を含む）で、`rules.lessons.$classId['.read']` と `['.write']` が今のまま残っている。`.read` が `true` の場所は、今までどおり `check/ping` と `gen/$sid` だけ。

- [ ] **Step 4: `js/net.js`・`js/dev/memory-net.js`・`js/repo.js`・`docs/setup/rules.json`・データの形の文書を直し、`npm test` がすべて通ることを確かめる**

- [ ] **Step 5: コミット**（`feat: 単元・授業・資料のデータの出し入れを追加`）

---

### Task 2: 本番用の GAS

**Files:**
- Create: `gas/Code.gs`、`tests/gas-app.test.js`
- Modify: `tests/helpers/gas-sandbox.js`（下の `db` の代役を足す。今ある `tests/gas-check.test.js` が変わらず通ること）、`docs/setup/gas.md`（「本番用の GAS を公開する」の節を足す）

**Interfaces:**
- Consumes: `gas/check/Code.gs`（書き方の手本。本人確認・フォルダの探し方・ロック・エラーの返し方を同じにする）。
- Produces: `gas/Code.gs` のウェブアプリ。`doGet()` → `{ ok: true, version: 'app-1' }`。`doPost(e)` は本文の JSON の `op` で分ける。返すのは常に JSON（`ContentService`）。失敗は `{ ok: false, error }`、`error` は `'bad' | 'auth' | 'denied' | 'notfound' | 'toobig' | 'server' | 'config'`。

  | op | 受け取るもの | だれ | 返すもの |
  |---|---|---|---|
  | `ping` | なし | だれでも | `{ ok, version: 'app-1' }` |
  | `whoami` | `token` | ログインした人 | `{ ok, role: 'teacher' }` または `{ ok, role: 'student', studentId }` |
  | `putMaterial` | `token`・`key`・`mime`・`name`・`dataB64` | 先生だけ（ほかは `denied`） | `{ ok, id, existed, bytes }` |
  | `getMaterials` | `token`・`classId`・`lessonId`・`ids`（`materialId` の配列。1〜12 個） | 先生と、その組の一員 | `{ ok, files: { [materialId]: { mime, dataB64 } }, missing: [materialId] }` |
  | `getFile` | `token`・`classId`・`lessonId`・`materialId` | 先生と、その組の一員 | `{ ok, mime, name, dataB64 }` |
  | `trashFile` | `token`・`fileId` | 先生だけ | `{ ok, trashed: boolean }` |

  決まり:
  - スクリプト プロパティ `DATABASE_URL` が無ければ `config`（`ping` のほか）。
  - **本人確認**: トークンの形（`確認用と同じ TOKEN_RE`・4096 文字まで）と、ペイロードの `user_id`（`UID_RE`）を確かめ、`<DATABASE_URL>/teacherList/<uid>.json?auth=<token>` を読む。200 で本文が `true` なら先生。そうでなければ `<DATABASE_URL>/accounts/<uid>.json?auth=<token>` を読み、200 で本文が生徒 ID の形（`/^s\d{2}-\d{3}$/`）の文字なら生徒。どちらでもなければ `auth`。結果は `CacheService` に 60 秒だけ覚える（キーはトークンの SHA-256。値は `'t'` か `'s:<生徒ID>'`）。
  - **保存（`putMaterial`）**: `key` は `/^[A-Za-z0-9-]{8,64}$/`。`mime` は `'image/jpeg'` か `'application/pdf'`。`name` は 1〜80 文字の文字（改行を含まない）。`dataB64` は、画像なら 1,400,000 文字まで、PDF なら 14,000,000 文字までで、こえたら `toobig`。base64 として読めなければ `bad`。フォルダは Drive の直下の「授業ログ_資料」（無ければロックをかけて作る）。ファイル名は `m_<key>`。同じ名前で、説明が `teacher` のファイルがすでにあれば、作らずにその ID を返す（`existed: true`）。作るときは、検索から作成・説明の設定までをスクリプトのロックで守り、説明に `teacher` を書く（書けなければゴミ箱に入れて `server`）。`bytes` は保存したバイト数。
  - **取り出し（`getMaterials`・`getFile`）**: `classId`・`lessonId`・`materialId` は `/^[A-Za-z0-9]{1,40}$/`。`<DATABASE_URL>/lessons/<classId>/<lessonId>/materials.json?auth=<token>`（`getFile` も同じ場所を読む）を、**呼んだ人のトークンで**読む。200 でなければ `notfound`（Drive を読まない）。読めた中から、頼まれた `materialId` の `fileId`（`/^[A-Za-z0-9_-]{1,200}$/`）を取り、そのファイルが「授業ログ_資料」の中にあり・ゴミ箱に無く・説明が `teacher` のときだけ返す。そうでないものは、`getMaterials` では `missing` に入れ、`getFile` では `notfound`。`getMaterials` は、`type` が `'image'` の資料だけを返す（PDF は `missing` に入れる）。返す `dataB64` の合計が 6,000,000 文字をこえそうなら、そこで止めて、残りを `missing` に入れる。`getFile` の `name` は、データベースの `name`。
  - **削除（`trashFile`）**: `fileId` の形を確かめ、「授業ログ_資料」の中にあり・説明が `teacher` のファイルなら、ゴミ箱に入れて `{ ok, trashed: true }`。すでにゴミ箱にある・見つからないときは `{ ok, trashed: false }`（やり直しで失敗にしない）。
  - ファイルの共有の設定を変えない。フォルダは `DriveApp.getRootFolder().getFoldersByName` で探す（共有された同じ名前のフォルダを使わない）。
  - 例外は `doPost` でつかまえて `server` を返す。エラーの文にトークンを入れない。

  `tests/helpers/gas-sandbox.js` の `makeFakes` に足すもの: 引数 `db`（`{ read(path, uid) → { status, body } }`。`path` は `teacherList/uidT` のような文字、`uid` は `validTokens` から分かった呼んだ人。`db` が無いときは今までどおりに動く）。`UrlFetchApp.fetch` は、URL が `<databaseURL>/<path>.json?auth=<token>` の形なら、トークンが `validTokens` に無ければ 401、あれば `db.read(path, uid)` の結果を返す。

- [ ] **Step 1: `tests/gas-app.test.js` を書く（失敗することを確かめる）**

  代役のデータベースは、テストの中で規則のまねをする: `teacherList/<uid>` は本人だけ、`accounts/<uid>` は本人だけ、`lessons/<classId>/<lessonId>/materials` は先生と、`memberOf` にその組がある生徒だけ（それ以外は 401）。

  - `ping` と `doGet` は `{ ok: true, version: 'app-1' }`。
  - `whoami`: 先生 → `teacher`。生徒 → `student` と ID。`accounts` に対応のないアカウント → `auth`。にせのトークン（形が違う・`validTokens` に無い）→ `auth`。
  - `putMaterial`: 生徒が呼ぶと `denied`（Drive にファイルができない）。先生が呼ぶとファイルが 1 個でき、説明が `teacher`、フォルダは「授業ログ_資料」。**同じ `key` でもう一度呼ぶと、ファイルは 1 個のままで同じ `id`・`existed: true`。** `mime` が `image/png`、`name` が空、`key` が短い → `bad`。大きすぎ → `toobig`。説明の設定に失敗 → ファイルがゴミ箱に入り `server`。
  - `getMaterials`: その組の生徒 → 画像が返る。**入っていない組の生徒 → `notfound` で、`DriveApp.getFileById` が 1 回も呼ばれていない。** PDF の資料は `missing`。データベースの `fileId` が、フォルダの外のファイル・ゴミ箱のファイル・説明が `teacher` でないファイルを指していたら `missing`。`ids` が 13 個・空・文字でない → `bad`。合計が上限をこえる分は `missing`。
  - `getFile`: PDF を返す（`mime`・`name`・`dataB64`）。入っていない組 → `notfound`。データベースに無い `materialId` → `notfound`。
  - `trashFile`: 生徒 → `denied`。先生 → ゴミ箱に入り `trashed: true`。もう一度 → `trashed: false`。フォルダの外のファイル → `trashed: false`（ゴミ箱に入れない）。
  - `DATABASE_URL` が空 → `ping` のほかは `config`。本文が JSON でない・`op` が知らない名前 → `bad`。
  - 本人確認の結果を覚えていて、同じトークンの 2 回目の呼び出しでは `teacherList`・`accounts` を読まない（`fetched` を数える）。資料の場所（`lessons/…/materials`）は毎回読む。

- [ ] **Step 2: `tests/helpers/gas-sandbox.js` に `db` を足し、`gas/Code.gs` を書く。`npm test` がすべて通ることを確かめる**

- [ ] **Step 3: `docs/setup/gas.md` に「本番用の GAS を公開する」を足す**

  確認用と同じ手順で、**別のプロジェクト**（名前「授業ログ 本番」）を作り、`gas/Code.gs` を貼り、`DATABASE_URL` を入れ、「自分として実行・全員がアクセス」で公開する、と書く。URL は Claude Code に伝える（`js/gas-config.js` の `appUrl` に入れる）。確認用のデプロイは、本番用が動いたらアーカイブする、と書く。コードを直したあとの公開し直し（「デプロイを管理」→ 新バージョン）も書く。

- [ ] **Step 4: コミット**（`feat: 本番用の GAS を追加`）

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

---

### Task 4: 単元と授業の画面

**Files:**
- Create: `js/views/teacher-units.js`、`js/views/teacher-lessons.js`、`js/views/parts/teacher-nav.js`
- Modify: `js/router.js`、`tests/router.test.js`、`js/views/teacher-classes.js`（上部の帯を `teacher-nav.js` に置きかえる）、`css/app.css`

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

---

### Task 5: 授業の編集と資料

**Files:**
- Create: `js/views/teacher-lesson.js`、`js/views/parts/viewer.js`、`js/pdf.js`、`js/material-flow.js`、`tests/material-flow.test.js`
- Modify: `js/image.js`（`dataUrlToBase64` を足す）、`tests/image.test.js`、`css/app.css`

**Interfaces:**
- Consumes: Task 1 の `repo` と `lesson-logic`、Task 3 の `ctx.files`、`compressImage`・`compressCanvas`・`fitSize`（`js/image.js`）、`js/lib/pdfjs/`。
- Produces:
  - `js/image.js`: `dataUrlToBase64(dataUrl) → string`（`data:image/jpeg;base64,` のあとの部分。形が違えば例外）。
  - `js/pdf.js`（ブラウザ用。pdf.js は、初めて使うときに `import('./lib/pdfjs/pdf.min.mjs')` で読みこむ。`workerSrc`・`cMapUrl`・`standardFontDataUrl`・`wasmUrl` は `new URL('./lib/pdfjs/…', import.meta.url)` で自分のサイトの中を指す）:
    - `openPdf(data) → { pageCount, renderPage(pageNo, maxEdge) → HTMLCanvasElement, close() }`（`data` は `ArrayBuffer`。パスワードつき・こわれた PDF は、`code: 'broken'` を持つ `Error`。部品を読みこめなければ `code: 'load-failed'`）
  - `js/material-flow.js`（通信の順番だけを受け持つ。画面と DOM を知らない）:
    - `addMaterialFlow({ repo, files, key, materialId, kind, type, name, mime, dataB64, thumb, targets, now }) → { fileId }`。順番: (1) `files.upload({ key, mime, name, dataB64 })` → `{ fileId, bytes }`、(2) `repo.addMaterial(targets, materialId, { kind, type, fileId, name, bytes }, thumb, now)`。(2) が失敗したら例外をそのまま投げる（ファイルは Drive に残る。**同じ `key`・同じ `materialId` でやり直せば、ファイルは増えず、資料も 2 重にならない**）。
    - `removeMaterialFlow({ repo, files, classId, lessonId, material, now }) → { trashed: boolean }`。順番: (1) `repo.removeMaterial`、(2) `repo.listAllLessons()` → `fileRefs` が 0 件なら `files.trash(material.fileId)`。(2) の失敗（読めない・ゴミ箱に入れられない）は例外にせず、`{ trashed: false }` を返す。
  - `js/views/parts/viewer.js`: `openViewer({ title, kind: 'image' | 'pdf', load }) → { close() }`。画面いっぱいの表示（`<dialog>`）。`load()` は Blob を返す Promise。画像は、はじめは全体が入る大きさで出し、「＋」「－」で拡大・縮小（100%〜400%）、指やマウスで動かせる。PDF は 1 ページずつ `renderPage(n, 1600)` で出し、「前のページ」「次のページ」「3 / 12」。読みこみ中は「読みこんでいます…」、失敗は「開けませんでした。もう一度ためしてください。」と「もう一度」。「閉じる」と Esc で閉じ、Blob の URL と PDF を片付ける。1a-3 の生徒の画面でも使う。

- [ ] **Step 1: `tests/material-flow.test.js` と `tests/image.test.js` にテストを書く**

  - `addMaterialFlow`: `files.upload` → `repo.addMaterial` の順に呼ぶ。`addMaterial` に渡す資料は `{ kind, type, fileId, name, bytes }`（`fileId` と `bytes` は `upload` の結果）。`targets` と `thumb` はそのまま渡す。
  - `upload` が失敗 → `addMaterial` を呼ばない。
  - **`addMaterial` が 1 回目に失敗し、同じ引数でやり直す** → `upload` は同じ `key` で 2 回呼ばれ（GAS が同じ ID を返す前提）、`addMaterial` は同じ `materialId` で呼ばれる（資料が 2 つにならない）。
  - `removeMaterialFlow`: ほかの授業が同じ `fileId` を指していれば `files.trash` を呼ばない（`trashed: false`）。指していなければ呼ぶ（`trashed: true`）。**`repo.removeMaterial` を先に行い、そのあとで数える**（自分の分を数えない）。`listAllLessons` や `trash` の失敗は `{ trashed: false }`。
  - `dataUrlToBase64('data:image/jpeg;base64,AAAA') === 'AAAA'`。`data:` で始まらない・`;base64,` が無い → 例外。

- [ ] **Step 2: `js/material-flow.js`・`js/image.js`・`js/pdf.js`・`js/views/parts/viewer.js` を書く**

- [ ] **Step 3: `js/views/teacher-lesson.js` を書く（`#/t/lesson/<classId>/<lessonId>`。設計書 7.5 の「授業の資料」）**

  - 上部: `teacherNav(ctx, 'lessons')`。その下に「‹ 授業の一覧へ」。
  - 授業の情報: 日付・授業名・単元を直せる欄と「保存する」（`checkLesson` → `repo.updateLesson`）。保存していない変更は `ctx.setLeaveGuard` で守る。
  - 資料の一覧: `materialList` の順に、サムネイル（`repo.getThumbs` の画像。無ければ種類の文字）・種類（「板書」「配布資料」）・名前・「上へ」「下へ」・「消す」。サムネイルか名前を押すと `openViewer`（画像は `ctx.files.loadImages` の 1 枚、PDF は `ctx.files.loadFile`）。
  - 「写真を足す」: `<input type="file" accept="image/*">`（iPad では、カメラ・写真・ファイルから選べる）。「PDF を足す」: `<input type="file" accept="application/pdf">`。選んだあと、足す前の欄を出す:
    - 種類（「板書」「配布資料」。写真のはじめは「板書」、PDF のはじめは「配布資料」）
    - 名前（はじめは、写真なら「板書」または「資料」、PDF ならファイル名から `.pdf` を取ったもの。1〜80 文字）
    - 「同じ資料を、ほかのクラスの授業にも付ける」: 同じ年度のほかのクラスの授業のうち、**日付が同じもの**をチェックで選べる（はじめは、どれもチェックなし）。
    - 「足す」「やめる」
  - 「足す」を押したら:
    - 写真: `compressImage(file, { maxEdge: CONFIG.image.maxEdge, maxBytes: CONFIG.image.maxChars })` → `dataUrlToBase64`。サムネイルは `compressImage(file, { maxEdge: CONFIG.thumb.maxEdge, maxBytes: CONFIG.thumb.maxChars })` のデータ URL。`mime` は `image/jpeg`。
    - PDF: `file.size` が `CONFIG.pdfMaxBytes` をこえたら「PDF は 10MB までです。」。`file.arrayBuffer()` を base64 にする（大きいので、8KB ずつに分けて文字にする。`String.fromCharCode(...全部)` のような、一度に広げる書き方をしない）。サムネイルは `openPdf` → `renderPage(1, CONFIG.thumb.maxEdge)` → `compressCanvas(canvas, { maxBytes: CONFIG.thumb.maxChars })`（作れなければ `null`。サムネイルなしで足す）。`mime` は `application/pdf`。
    - `key` は `newId(ctx.random, 24)`、`materialId` は `newId(ctx.random, CONFIG.idLength)`。**やり直しのときは、同じ `key` と `materialId` を使う。**
    - `targets` は、この授業と、チェックした授業。それぞれの `order` は、その授業の `nextOrder`。
    - `addMaterialFlow` を呼ぶ。進みぐあいを文で出す（「写真を小さくしています…」「送っています…（大きい PDF は 1 分ほどかかります）」）。送っている間も、画面のほかの所（一覧を見る・大きく表示する）は使える。足すボタンは、送り終わるまで押せなくする。
    - 失敗したら、その資料の所に「送れませんでした」と「やり直す」「やめる」を出す（選んだファイルと `key`・`materialId` は、画面にいる間は持っておく）。`toobig` は「ファイルが大きすぎます。」、`denied` は「先生としてログインし直してください。」。
    - 1 つの授業の資料は `CONFIG.materialsPerLesson` 個まで。こえるときは「資料は 12 個までです。」。
    - 送っている途中で画面を離れようとしたら、`ctx.setLeaveGuard` で確かめる。
  - 並べ替え: `moveInOrder` → `repo.setMaterialOrders`。
  - 「消す」: 確かめる（「この授業から外します。ほかの授業にも付けてある場合、そちらには残ります。」）→ `removeMaterialFlow`。
  - 授業が見つからない（消された・ID が違う）ときは「この授業は見つかりません。」と「授業の一覧へ」。

- [ ] **Step 4: `npm test` がすべて通ることを確かめる。`node --check` で新しいファイルの構文を確かめる**

- [ ] **Step 5: コミット**（`feat: 授業の編集と資料の追加・表示を追加`）

---

### Task 6: 規則の確認の追加と、手順書

**Files:**
- Modify: `js/rules-probe.js`、`tests/rules-probe.test.js`、`README.md`、`docs/setup/firebase.md`（「9. 本番の規則を貼る」に、規則を直したときは貼り直す、と書き足す）
- Create: `docs/reports/stage1a-2-check.md`

**Interfaces:**
- Consumes: 今ある `runRulesProbe`（準備 → 確かめ → 片付け）。Task 1 の `repo.createLessons`・`repo.addMaterial`・`repo.createUnit`。
- Produces: `runRulesProbe` の確かめに、下の行を足す。準備では、先生として、確認用のクラス 2 つ（入っているクラス・入っていないクラス）にそれぞれ授業を 1 つ作り（`repo.createLessons`）、資料を 1 つ置き（`repo.addMaterial`。`fileId` は `'probe'`、サムネイルは短いデータ URL）、単元を 1 つ作る（年度 0）。片付けでは、その `lessons`・`thumbs`・`units` も消す。前回の残りの片付け（年度 0 のクラス）でも、そのクラスの `lessons`・`thumbs` と、年度 0 の `units` を消す。

  | 試すこと（確認用の生徒として） | 期待 |
  |---|---|
  | 入っているクラスの `lessons/<classId>` を読む | ok |
  | 入っていないクラスの `lessons/<classId>` を読む | denied |
  | `lessons` 全体を読む | denied |
  | 入っているクラスの `thumbs/<classId>/<lessonId>` を読む | ok |
  | 入っていないクラスの `thumbs/<classId>/<lessonId>` を読む | denied |
  | `units` を読む | ok |
  | 入っているクラスの `lessons/<classId>/<lessonId>/title` を書く | denied |
  | 入っているクラスの `lessons/<classId>/<lessonId>/materials/<id>/fileId` を書く | denied |
  | 入っているクラスの `thumbs/<classId>/<lessonId>/<id>` を書く | denied |
  | `units/<id>/name` を書く | denied |

- [ ] **Step 1: `tests/rules-probe.test.js` にテストを足す**（足した 10 行が、代役の答えどおりに `pass` になる・ならない。片付けで `lessons`・`thumbs`・`units` が消える。書きこみが通ってしまった場合も、片付けで元に戻る）

- [ ] **Step 2: `js/rules-probe.js` を直し、`npm test` がすべて通ることを確かめる**

- [ ] **Step 3: `README.md` に 1a-2 の使い方（単元 → 授業 → 資料）と、先生の作業（規則の貼り直し、本番用の GAS の公開）を足す。`docs/reports/stage1a-2-check.md` に、下の「最後の確認」の項目を「未確認」で書く**

- [ ] **Step 4: コミット**（`feat: 規則の確認に授業と資料を追加`）

---

### 最後の確認（Claude Code と先生が行う。Codex には渡さない）

- [ ] 練習モード（`?demo=1`）のブラウザで、iPad の横・縦の大きさで確かめる: 単元を作って並べ替える → 2 つのクラスに同じ授業を作る → 写真を足す（もう 1 つのクラスの授業にも付ける）→ PDF を足す → 大きく表示する（拡大・ページ送り）→ 並べ替える → 片方の授業から外す（もう片方には残る）→ 授業を消す。コンソールにエラーが出ていない。
- [ ] 先生の作業: 規則を貼り直す（`lessons` の 1 行が変わったため）。本番用の GAS を公開し、URL を `js/gas-config.js` の `appUrl` に入れる。
- [ ] 公開して、本物で確かめ、`docs/reports/stage1a-2-check.md` に書く:
  1. 規則の確認が、足した 10 行を含めてすべて ○。
  2. 先生が、写真 1 枚と PDF 1 つを授業に置ける。Drive の「授業ログ_資料」にファイルができ、共有されていない。
  3. 置いた写真と PDF を、大きく表示できる（2 回目は取り置きから出て、速い）。
  4. 同じ資料を 2 つのクラスの授業に付け、片方から外しても、もう片方で開ける。両方から外すと、Drive のファイルがゴミ箱に入る。
  5. 写真を置くのにかかる時間（縮める・送る）と、PDF（数 MB）を置くのにかかる時間。
  6. ログインしていない人・生徒のトークンで本番用の GAS を呼んでも、保存できない（`denied`・`auth`）。
  7. 接続確認ページ（`check.html`）が今までどおり動く。
