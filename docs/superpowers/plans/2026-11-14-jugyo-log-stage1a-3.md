# 授業ログ 段階 1a-3（生徒の画面） Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 生徒が、授業の一覧（サムネイルのタイル）から授業を開き、先生の資料を見ながら、文字のメモと振り返り（理解度・分かったこと・疑問）を書ける。書いたものは自動で保存され、保存できなかった分は端末の中に下書きとして残り、あとで送り直される。

**Architecture:** 1a-2 までの作り（`index.html` 1 つ、`js/views/` の画面、`js/repo.js` がデータベースの場所を知る）に足す。記録は `records/<classId>/<lessonId>/<生徒ID>` と `marks/<生徒ID>/<classId>/<lessonId>` に、1 回のルート update で一緒に書く。自動保存の順番（待つ・送る・やり直す）は `js/record-saver.js` が受け持ち、画面は状態を出すだけにする。下書きは `localStorage`（`js/drafts.js`）。一覧用の小さい画像は、授業の `updatedAt` を目印に端末へ取っておく（`js/thumb-store.js`）。

**Tech Stack:** HTML / CSS / JavaScript（ES モジュール、外部パッケージなし）、Node.js 18 以上の `node --test`、Firebase Realtime Database・Authentication（REST）、Google Apps Script のウェブアプリ（資料の取り出しだけ。1a-2 で作ったもの）、GitHub Pages。

**Spec:** `docs/superpowers/specs/2026-11-12-jugyo-log-design.md`（設計書）の 5.4 の最後の項目（ログアウト）・7.2・7.3・8 章、`docs/superpowers/specs/2026-11-13-jugyo-log-1a-data.md`（データの形）の 3 章・4 章。実装する人は両方を読む。

**この計画の範囲:** データの形 2 章の「1a-3」。手書き・生徒の写真と PDF の添付（1b）、先生の記録確認と進級（1a-4）は入れない。

**実装の担当:** コードは Codex が書く（`tools/codex-implement.ps1`）。各タスクの指示書は、この計画の「Global Constraints」「この計画で決めたこと」「Review Focus」と、そのタスクの節をそのまま含む。

## Global Constraints

- 作業フォルダは `C:\Users\yan12\Documents\keita\AI開発\授業ログアプリ`。この外は読まない・編集しない。
- 外部パッケージをインストールしない。Firebase の SDK を入れない。外部の配信元から実行時に読み込まない。
- Firebase は Spark プランのまま。課金の設定を前提にしない。
- `js/views/` と `js/main.js` のほかのモジュールは、`window`・`document`・`fetch`・`localStorage`・`caches`・`crypto`・`Date.now`・`setTimeout` を直接使わず、引数で受け取る。
- データベースの場所（`records/…` などの文字）を書いてよいのは `js/repo.js`・`js/dev/`・`js/rules-probe.js` だけ。
- **データベースの形と規則（`docs/setup/rules.json`）は変えない。** 記録の中身は `memo`・`learned`・`question`（2000 文字までの文字）、`level`（1〜4 の整数。選んでいなければ項目を置かない）、`updatedAt`（数）だけ。
- `records` と `marks` は、必ず 1 回の書きこみ（ルートへの複数パスの update）で一緒に変える。
- 生徒の本名、学校のメールアドレスを保存しない・入力させない。画面に出すのはクラス名と出席番号だけ。
- パスワード・トークンを、`console`・エラーの文・保存（localStorage・Cache）に出さない。下書きに入れるのは、記録の中身と時刻だけ。
- 画面に出す文字は `textContent`（`el()` の `text`）で入れる。`innerHTML` を使わない。画像は `<img>` の `src` に Blob の URL かデータ URL を入れ、使い終わった Blob の URL は `URL.revokeObjectURL` で外す。
- 基準の端末は iPad の Safari（横 1180×820 と縦 820×1180）。ボタンは 44×44px 以上。状態は色だけで伝えず、文字を添える。先生の資料は `--teacher` 系、自分の記録は `--mine` 系の色と、「先生の資料」「自分の記録」の文字で分ける。
- 画面の文とコードのコメントは日本語。生徒（中学生）が読む文は、短く、やさしい言葉で書く。
- 書き方（`createXxx({ … })` で依存を受け取る、`export function mount(root, ctx)` が片付けの関数を返す、`el()`・`confirmDialog`・`toast`・`statusChip` を使う、`ctx.setLeaveGuard`）は、今ある `js/views/teacher-lesson.js`・`js/material-flow.js`・`js/repo.js` に合わせる。
- `git add`・`git commit`・ブランチの操作はしない（コミットは Claude Code が行う）。指示書の「Files」のほかのファイルは変えない。変える必要があると思ったら、変えずに報告に書く。
- `check.html`・`js/check-*.js`・`gas/` は変えない。

## この計画で決めたこと（Claude の判断）

設計書に細かく書かれていない、生徒から見える動き。

| 項目 | 決めたこと |
|---|---|
| 年度の選択 | 「年度」の選択には、生徒が入っているクラスを `2026年度　2年A組` の形で並べる（新しい年度が先。はじめは 1 番上）。同じ年度に 2 つのクラスがあっても、どちらも選べる（片方を黙って隠さない） |
| 週の区切り | 週は月曜に始まる。今日より先の日付の授業は「これから」の見出しで 1 番上に出す。日付の形がおかしい授業は「日付なし」の見出しで 1 番下に出す（消さない） |
| 単元別 | 単元は先生が決めた順。授業が 1 つも無い単元は出さない。単元が付いていない・単元が見つからない授業は「その他」に入れ、1 番下に出す |
| タイルの印 | 理解度を選んであれば「記録あり」、なければ「振り返りがまだ」。送れていない下書きがある授業には「まだ保存できていません」も出す |
| 理解度 | 4 つのボタンから 1 つ。選び直せる。**選んだあとに「選んでいない」へは戻せない** |
| 文字数 | 1 つの欄 2000 文字まで。それより長くは入力できない。残り 200 文字から「あと N 文字」と出す |
| 保存 | 変えてから 2 秒後に自動で保存。失敗したら 2 秒・5 秒・15 秒後に自動でやり直し、それでもだめなら「保存できませんでした」と「もう一度」のボタンを出す。規則に断られた（授業が消された・クラスから外れた）ときは、自動ではやり直さない |
| 下書き | 変えるたびに、この iPad の中に下書きを残す。保存できたら下書きを消す。次に授業の一覧を開いたときに、残っている下書きを送り直す |
| 下書きとサーバーの食い違い | 下書きを書いた時刻が、サーバーの記録の `updatedAt` より新しければ下書きを使う。古ければ下書きを捨てる（ほかの端末で、あとから書いたものを残す。設計書 8 章） |
| 画面に戻ってきたとき | 送っていない変更が無ければ、最新の記録を読み直して入れかえる。送っていない変更があれば、読み直さない（書いている途中のものを消さない） |
| 「一覧へ」 | 送っていない変更があれば、先に保存する。保存できなければ「まだ保存できていません。この iPad の中に残して、一覧へもどりますか？」とたずねる |
| ログアウト | 下書きが残っていれば、確かめる文に「まだ保存できていない記録が N 件あります。ログアウトすると消えます。」と足す。ログアウトで、取り置いたファイル・小さい画像・下書きを消す |
| 資料の出し方 | 左（縦向きでは上）に、先生が決めた順で並べる。写真はそのまま出し、PDF は 1 ページ目の小さい画像と名前を出す。押すと大きく表示する。それぞれに「板書」「配布資料」の文字を付ける |
| サムネイルの矢印 | 画像が 2 枚以上あるタイルには、左右の矢印のボタンを iPad でも出す（指ですべらせても切りかわる） |

## Review Focus

仕様には書かれているが、ふつうのテストでは通ってしまいやすい点。担当のタスクにテストを入れてある。

1. **保存している途中に、また書いた場合**。送り終わったあとに、新しい内容をもう一度送ること。途中で下書きを消さないこと。保存の通信が同時に 2 本走らないこと（Task 2）。
2. **保存に失敗したまま画面を離れ、あとで開き直した場合**。下書きが残っていて、一覧を開いたときに送り直されること。サーバーのほうが新しければ、下書きで上書きしないこと（Task 1・Task 2）。
3. **理解度を選ばずにメモだけ書いた場合**。`level` の項目を置かずに保存でき、`marks` は書かれず、タイルは「振り返りがまだ」のままであること。理解度を選んだら `records` と `marks` が 1 回の書きこみで入ること（Task 1）。
4. **タイルの上で指をすべらせた場合**。横にすべらせたら画像が切りかわり、授業は開かないこと。縦にすべらせたら何も起きず、画面が動くこと。軽く押したときだけ授業を開くこと（Task 1・Task 3）。
5. **端末の保存が使えない場合**（`localStorage` が例外を投げる・いっぱい）。落ちずに、下書きなしで保存だけは動くこと（Task 1・Task 2）。

---

### Task 1: 記録のデータの出し入れと、一覧の計算

**Files:**
- Create: `js/record-logic.js`、`js/student-list-logic.js`、`js/drafts.js`、`tests/record-logic.test.js`、`tests/student-list-logic.test.js`、`tests/drafts.test.js`
- Modify: `js/repo.js`、`tests/repo.test.js`、`js/config.js`、`js/lesson-logic.js`（`dateLabel` を足す）、`tests/lesson-logic.test.js`、`js/views/teacher-lessons.js`（中の `dateLabel` を消し、`lesson-logic.js` のものを使う。動きは変えない）

**Interfaces:**
- Consumes: `createRepo`・`createMemoryNet`（今あるもの）、`sortLessons`・`sortUnits`・`thumbOrder`（`js/lesson-logic.js`）。
- Produces:
  - `js/config.js` に足す: `recordTextMax: 2000`、`recordCountFrom: 1800`、`save: { delayMs: 2000, retryMs: [2000, 5000, 15000] }`、`swipe: { tapMax: 10, swipeMin: 30 }`。
  - `js/lesson-logic.js`: `dateLabel(value) → string`（`'2026-11-12'` → `'11/12（木）'`。形のおかしい値は `'日付なし'`。`js/views/teacher-lessons.js` の今の関数を移す。今の関数がおかしい値で別の文を返しているなら、その文のままにし、報告に書く）。
  - `js/record-logic.js`（通信をしない）:
    - `LEVELS = [{ value: 4, label: 'よく分かった' }, { value: 3, label: '分かった' }, { value: 2, label: 'あまり分からなかった' }, { value: 1, label: '全然分からなかった' }]`
    - `emptyRecord() → { memo: '', level: null, learned: '', question: '' }`
    - `normalizeRecord(v, { max }) → { memo, level, learned, question }`（文字でない欄は `''`、`max` より長い文字は先頭の `max` 文字、`level` は 1〜4 の整数のほかは `null`。`v` が `null`・配列・文字でも落ちない）
    - `sameRecord(a, b) → boolean`（4 つの項目が同じか）
    - `pickInitial(server, draft, { max }) → { record, fromDraft, updatedAt }`。`server` は `repo.getRecord` の結果（`null` でもよい）、`draft` は `drafts.get` の結果（`null` でもよい）。下書きがあり、`draft.editedAt > (server?.updatedAt ?? 0)` なら下書きを使う（`fromDraft: true`）。それ以外はサーバーの記録（無ければ `emptyRecord()`）で、`fromDraft: false`。`updatedAt` はサーバーの値（無ければ 0）。
    - `tileMark(level) → 'done' | 'todo'`（1〜4 の整数なら `'done'`）
  - `js/student-list-logic.js`（通信をしない）:
    - `classLabel({ year, name }) → '2026年度　2年A組'`
    - `groupByDate(lessons, todayMs) → [{ label, lessons }]`。見出しの順: 「これから」（今日より先）→「今週」→「先週」→ それより前は月ごと（`'2026年10月'`。新しい月が先）→「日付なし」。週は月曜に始まる（その端末の時刻で）。中身が無い見出しは出さない。見出しの中は `sortLessons` の順。今週・先週に入った授業は、月の見出しには入れない。
    - `groupByUnit(lessons, units) → [{ label, lessons }]`。`units` は `sortUnits` の順の `[{ id, name }]`。授業のある単元だけを、その順で。`unitId` が空・`units` に無い授業は `'その他'`（1 番下）。見出しの中は `sortLessons` の順。
    - `swipeDecision({ dx, dy }, { tapMax, swipeMin }) → 'tap' | 'prev' | 'next' | 'none'`。`|dx|` も `|dy|` も `tapMax` 以下なら `'tap'`。`|dx| >= swipeMin` で `|dx| > |dy|` なら、`dx < 0` は `'next'`、`dx > 0` は `'prev'`。そのほかは `'none'`。数でない値は `'none'`。
    - `stepIndex(index, dir, count) → number`（`dir` は `-1` か `1`。端では止まる。`count` が 0 なら 0）
  - `js/drafts.js`: `createDrafts({ storage }) →`（キーは `jugyolog:draft:<studentId>:<classId>:<lessonId>`、値は JSON の `{ record, editedAt }`）
    - `get(studentId, classId, lessonId) → { record, editedAt } | null`（無い・JSON でない・`editedAt` が数でない・`record` がオブジェクトでないものは `null`）
    - `put(studentId, classId, lessonId, record, editedAt) → boolean`（保存できたら `true`。`storage` が例外を投げたら `false`）
    - `remove(studentId, classId, lessonId) → void`
    - `list(studentId) → [{ classId, lessonId, record, editedAt }]`（その生徒の分だけ。形のおかしいものは入れない）
    - `clear() → void`（`jugyolog:draft:` で始まるキーを全部消す。ほかのキーは消さない）
    - `storage` が `null`・どのメソッドが例外を投げても、落ちない（`get` は `null`、`list` は `[]`）。
  - `js/repo.js` に足すメソッド:
    - `getRecord(classId, lessonId, studentId) → { memo, level, learned, question, updatedAt } | null`（無ければ `null`。形は `normalizeRecord` でそろえ、`updatedAt` は数でなければ 0）
    - `saveRecord(classId, lessonId, studentId, record, now) → void`。1 回の `net.update('', …)` で、`records/<c>/<l>/<sid>` に `{ memo, learned, question, updatedAt: now }`（`level` が 1〜4 のときだけ `level` も）を置き、`marks/<sid>/<c>/<l>` に `level`（`null` なら `null`＝消す）を置く。
    - `getMarks(studentId, classId) → { [lessonId]: 1〜4 }`（数でないもの・範囲の外は入れない）

- [ ] **Step 1: テストを書く（失敗することを確かめる）**

```js
test('pickInitial: 下書きのほうが新しければ下書き、古ければサーバー', () => {
  const server = { memo: 'サーバー', level: 3, learned: '', question: '', updatedAt: 2000 };
  const draft = { record: { memo: '下書き', level: null, learned: '', question: '' }, editedAt: 3000 };
  assert.deepEqual(pickInitial(server, draft, { max: 2000 }),
    { record: { memo: '下書き', level: null, learned: '', question: '' }, fromDraft: true, updatedAt: 2000 });
  assert.equal(pickInitial(server, { ...draft, editedAt: 2000 }, { max: 2000 }).fromDraft, false);
  assert.deepEqual(pickInitial(null, null, { max: 2000 }),
    { record: { memo: '', level: null, learned: '', question: '' }, fromDraft: false, updatedAt: 0 });
});
test('normalizeRecord: おかしい値を直す', () => {
  assert.deepEqual(normalizeRecord({ memo: 5, level: '3', learned: 'あ'.repeat(2001), question: null }, { max: 2000 }),
    { memo: '', level: null, learned: 'あ'.repeat(2000), question: '' });
  for (const lv of [0, 5, 2.5, NaN, Infinity]) assert.equal(normalizeRecord({ level: lv }, { max: 2000 }).level, null);
  assert.deepEqual(normalizeRecord('x', { max: 2000 }), emptyRecord());
});
test('groupByDate: これから・今週・先週・月ごと・日付なし', () => {
  const today = new Date(2026, 10, 12, 9).getTime(); // 2026-11-12（木）
  const L = (id, date) => ({ id, date, createdAt: 0 });
  const g = groupByDate([L('a', '2026-11-09'), L('b', '2026-11-08'), L('c', '2026-11-02'), L('d', '2026-11-01'),
    L('e', '2026-10-30'), L('f', '2026-11-13'), L('g', ''), L('h', '2026-11-12')], today);
  assert.deepEqual(g.map((x) => [x.label, x.lessons.map((l) => l.id)]), [
    ['これから', ['f']], ['今週', ['h', 'a']], ['先週', ['b', 'c']],
    ['2026年11月', ['d']], ['2026年10月', ['e']], ['日付なし', ['g']]]);
});
test('swipeDecision', () => {
  const o = { tapMax: 10, swipeMin: 30 };
  assert.equal(swipeDecision({ dx: 3, dy: -4 }, o), 'tap');
  assert.equal(swipeDecision({ dx: -40, dy: 5 }, o), 'next');
  assert.equal(swipeDecision({ dx: 40, dy: 5 }, o), 'prev');
  assert.equal(swipeDecision({ dx: 20, dy: 0 }, o), 'none');   // 押したのでも、すべらせたのでもない
  assert.equal(swipeDecision({ dx: -40, dy: 60 }, o), 'none'); // 縦に動かした
  assert.equal(swipeDecision({ dx: NaN, dy: 0 }, o), 'none');
});
```

  ほかのテスト:
  - `groupByDate`: 月曜の日は「今週」、その前の日曜は「先週」。年をまたぐ（1 月の今日と 12 月の授業）。空の配列は `[]`。もとの配列を変えない。
  - `groupByUnit`: 単元の順、授業の無い単元は出ない、`unitId` が無い・知らない単元は「その他」が最後。
  - `stepIndex`: 端で止まる、`count` が 0。`tileMark`: 1〜4 は `'done'`、`null`・0・5・`'3'` は `'todo'`。`classLabel`。`dateLabel`（`'2026-11-12'` → `'11/12（木）'`）。
  - `drafts`: 入れたものが取れる・`remove`・`list` はその生徒の分だけ・`clear` はほかのキー（`jugyolog:auth`）を消さない。**`storage.setItem` が例外を投げると `put` は `false` で、落ちない。`storage` が `null` でも落ちない。** こわれた JSON・`editedAt` が文字のものは `get` が `null`、`list` に入らない。
  - `repo.saveRecord('c1', 'l1', 's26-001', { memo: 'm', level: null, learned: '', question: '' }, 5000)`: `update('', …)` の 1 回だけ。`records/c1/l1/s26-001` は `{ memo: 'm', learned: '', question: '', updatedAt: 5000 }`（**`level` の項目が無い**）。`marks/s26-001/c1/l1` は無い。
  - `level: 3` で保存 → `records/…/level` が 3、`marks/s26-001/c1/l1` が 3。書きこみは 1 回。
  - `getRecord`: 無ければ `null`。`level` が文字のデータは `null` にして返す。`getMarks`: `{ l1: 3, l2: 'x', l3: 9 }` → `{ l1: 3 }`。

- [ ] **Step 2: 実装して `npm test` がすべて通ることを確かめる**

- [ ] **Step 3: コミット**（`feat: 記録の出し入れと、授業一覧の計算を追加`）

---

### Task 2: 自動保存・下書きの送り直し・小さい画像の取り置き

**Files:**
- Create: `js/record-saver.js`、`js/record-flow.js`、`js/thumb-store.js`、`tests/record-saver.test.js`、`tests/record-flow.test.js`、`tests/thumb-store.test.js`

**Interfaces:**
- Consumes: Task 1 の `repo.getRecord`・`repo.saveRecord`、`createDrafts`、`normalizeRecord`・`sameRecord`、`createFileCache`（`js/file-cache.js`。`get(id) → Blob | null`・`put(id, blob)`）、`repo.getThumbs`、`NetError`。
- Produces:
  - `js/record-saver.js`: `createRecordSaver({ save, saveDraft, removeDraft, now, setTimeout, clearTimeout, delayMs, retryMs, onState }) →`
    - `save(record) → Promise`（サーバーへ送る。失敗は例外）、`saveDraft(record, editedAt)`・`removeDraft()`（下書き。例外を投げても保存は続ける）は呼ぶ側が渡す。
    - `edit(record)`: 今の内容を受け取る。すぐに `saveDraft(record, now())` を呼び、状態を `'dirty'` にし、`delayMs` 後に送る（待っている間にまた `edit` されたら、待ち直す）。
    - 送る: 状態 `'saving'`。**送っている間は、次を送らない。** 成功したとき、送り始めたあとに `edit` されていなければ `removeDraft()` を呼んで `'saved'`。されていれば、下書きは消さずに、新しい内容を続けて送る。
    - 失敗: `retryMs[0]`、`retryMs[1]`…の順に待って自動でやり直す（状態は `'retrying'`）。全部だめなら `'failed'`。`NetError` の `code` が `'denied'` のときは、やり直さずにすぐ `'failed'`。`'failed'` のあとに `edit` されたら、また `delayMs` 後に送る（やり直しの回数は最初から）。
    - `flush() → Promise<boolean>`: 待ちをやめて今すぐ送る。送っていない変更が無ければ、通信をせずに `true`。送っている途中なら、それが終わるのを待ち、残りがあれば続けて送る。自動のやり直しはしない（1 回だけ）。保存できたら `true`、できなければ `false`（状態は `'failed'`）。
    - `retry() → Promise<boolean>`: `'failed'`・`'retrying'` のときに、今すぐ送り直す（`flush` と同じ）。
    - `get state() → 'idle' | 'dirty' | 'saving' | 'retrying' | 'saved' | 'failed'`、`get dirty() → boolean`（送り終えていない変更があるか）。
    - `dispose()`: タイマーを止める。そのあとの `onState` は呼ばない。送っている途中の通信は止めない（下書きは残る）。
    - `onState(state)` は、状態が変わるたびに呼ぶ。
  - `js/record-flow.js`:
    - `resendDrafts({ repo, drafts, studentId, now, max }) → { sent, kept, dropped }`。`drafts.list(studentId)` の 1 件ずつについて: `repo.getRecord` を読み、下書きのほうが新しければ（`pickInitial` と同じ決まり）`repo.saveRecord` で送って下書きを消す（`sent`）。サーバーのほうが新しければ、送らずに下書きを消す（`dropped`）。読む・送るのに失敗したら、下書きを残す（`kept`）。`denied` で失敗したものも残す（消さない）。1 件の失敗で、残りをやめない。
    - `pendingLessons(drafts, studentId, classId) → Set<lessonId>`（そのクラスで、下書きが残っている授業）
  - `js/thumb-store.js`: `createThumbStore({ repo, cache, Blob = globalThis.Blob }) → { load(lesson) → { [materialId]: dataURL } }`。
    - `lesson.materials` が空なら、通信をせずに `{}`。
    - 取り置きのキーは `thumbs-<classId>-<lessonId>`、値は JSON `{ updatedAt, thumbs }` の Blob。取り置きがあり、`updatedAt` が `lesson.updatedAt` と同じなら、それを返す（通信しない）。違う・無い・読めないときは `repo.getThumbs` で読み、取り置きを置きかえて返す。
    - 同じ授業を同時に 2 回頼まれても、通信は 1 回（同じ Promise を返す）。失敗したら例外をそのまま投げ、次に頼まれたらもう一度読む。
    - 取り置きの読み書きが例外を投げても、落ちずに `repo.getThumbs` の結果を返す。

- [ ] **Step 1: テストを書く（失敗することを確かめる）**

  タイマーは代役（呼ばれた関数と時間を覚え、テストから進める）を使う。

  - `edit` → すぐ `saveDraft`。`delayMs` たつ前は `save` を呼ばない。たったら 1 回呼ぶ。続けて 3 回 `edit` しても、`save` は最後の内容で 1 回。
  - **送っている途中に `edit`** → 1 回目が終わるまで 2 回目を送らない。1 回目が成功しても `removeDraft` を呼ばず、状態は `'saved'` にならない。2 回目（新しい内容）が成功して、はじめて `removeDraft` と `'saved'`。
  - 失敗 → `'retrying'`。2 秒・5 秒・15 秒後にやり直し、4 回目もだめなら `'failed'`。途中で成功したら `'saved'`。
  - `denied` → やり直さずに `'failed'`。
  - `'failed'` のあと `retry()` で成功 → `true`・`'saved'`・`removeDraft`。
  - `flush()`: 変更なし → `save` を呼ばずに `true`。待っている変更あり → すぐ送って `true`。失敗 → `false`・`'failed'`、**下書きを消していない**。送っている途中の `flush()` は、2 本目の通信を出さずに終わりを待つ。
  - `saveDraft` が例外を投げても、`save` は呼ばれる。
  - `dispose()` のあとは、タイマーが来ても `save`・`onState` を呼ばない。
  - `onState` の順: `dirty` → `saving` → `saved`。
  - `resendDrafts`: 新しい下書きは送られて消える。サーバーのほうが新しい下書きは、**送られずに**消える。`getRecord` が失敗した下書きは残る。1 件目が失敗しても 2 件目を送る。結果の数が合っている。
  - `thumb-store`: 資料なし → `getThumbs` を呼ばない。1 回目は読んで取り置き、2 回目（同じ `updatedAt`）は読まない。`updatedAt` が変わったら読み直す。同時に 2 回 → `getThumbs` は 1 回。`cache.get` が例外 → 読んで返す。失敗のあと、もう一度頼むと読む。

- [ ] **Step 2: 実装して `npm test` がすべて通ることを確かめる**

- [ ] **Step 3: コミット**（`feat: 記録の自動保存と下書きの送り直しを追加`）

---

### Task 3: 生徒の授業一覧

**Files:**
- Create: `js/views/parts/lesson-tile.js`
- Modify: `js/views/student-home.js`（書き直す）、`js/router.js`、`tests/router.test.js`、`js/main.js`、`css/app.css`

**Interfaces:**
- Consumes: Task 1・Task 2 のもの全部、`repo.myClasses`・`repo.listLessons`・`repo.listUnits`、`thumbOrder`・`dateLabel`、`CONFIG`。
- Produces:
  - `js/router.js`: 画面 `lesson`（ハッシュ `#/lesson/<classId>/<lessonId>`、ファイル `student-lesson`（Task 4）、だれ: `student`）。`classId`・`lessonId` は `/^[A-Za-z0-9]+$/` だけ。`home` は、選んだクラスを覚えるために `#/?c=<classId>` も受けつける（`parseRoute('#/?c=abc')` → `{ name: 'home', params: { classId: 'abc' } }`。形のおかしい `c` は `not-found`）。`routeHash('home', { classId })` は、`classId` があれば `#/?c=<classId>`、無ければ `#/`。
  - `js/main.js`: `ctx.drafts`（`createDrafts({ storage: window.localStorage })`。`localStorage` にさわると例外になる端末では `storage: null`）、`ctx.thumbs`（`createThumbStore({ repo, cache })`。`cache` は `files` と同じ `createFileCache` のもの）、`ctx.timers`（`{ setTimeout, clearTimeout }`。`window` のものを bind して渡す）。`signOutAll` は、取り置きの片付け → `drafts.clear()` → `auth.signOut()` の順（片付けに失敗してもログアウトする）。
  - `js/views/parts/lesson-tile.js`: `lessonTile({ lesson, mark, pending, loadThumbs, onOpen, swipe }) → { node, destroy() }`。
    - `mark` は `'done' | 'todo'`、`pending` は下書きが残っているか、`loadThumbs() → Promise<{ [materialId]: dataURL }>`、`onOpen()` は授業を開く、`swipe` は `CONFIG.swipe`。
    - 上にサムネイルの枠（4:3）、下に日付（`dateLabel`）・授業名・印（`statusChip('ok', '記録あり')` または `statusChip('warn', '振り返りがまだ')`。`pending` なら `statusChip('danger', 'まだ保存できていません')` も）。
    - サムネイルは、タイルが画面に入ってから `loadThumbs()` を 1 回呼ぶ（`IntersectionObserver`。無い端末ではすぐ呼ぶ）。`thumbOrder(lesson.materials)` の順で、画像のあるものだけを使う。1 枚も無い（資料が無い・読めなかった）ときは、灰色の枠に授業名を出す。
    - 画像が 2 枚以上なら、下に点（枚数と今の位置。今の点は形も変える）と、左右の矢印のボタン（44px。`aria-label`「前の画像」「次の画像」。端では押せない）を出す。枠の上で指をすべらせると切りかわる（`pointerdown`〜`pointerup` の動きを `swipeDecision` に渡す。`'tap'` なら `onOpen()`、`'prev'`・`'next'` なら `stepIndex`、`'none'` なら何もしない）。枠には CSS で `touch-action: pan-y` を付ける（縦に動かすとページが動く）。
    - 日付と授業名の所は `<button>`（または `<a>`）にして、押す・Enter で `onOpen()`。読み上げの名前は「11/12（木） 電流と電圧 を開く」。
    - `destroy()` で、見張りと待ち受けを外す。

- [ ] **Step 1: `tests/router.test.js` にテストを足す**（`#/lesson/a/b` → `lesson`。`#/lesson/a`・`#/lesson/a/b/c`・`#/lesson/a%2Fb/c` は `not-found`。`#/?c=abc` → `home` と `classId`。`#/?c=`・`#/?c=a/b`・`#/?x=1` は `not-found`。`routeHash` の行き来。`roleFor('lesson')` は `'student'`）

- [ ] **Step 2: `js/views/student-home.js` を書き直す（設計書 7.2）**

  - 上部: 「授業ログ」、クラス名と出席番号、メニュー（「パスワードを変える」「ログアウト」）。
  - その下: 「年度」の選択（`classLabel`。クラスが 1 つでも出す）、「日付順／単元別」の切りかえ（2 つのボタン。今のほうに `aria-pressed="true"`）。並べ方は `sessionStorage` などに覚えない（開き直したら日付順）。選んだクラスは `ctx.navigate('home', { classId })` でハッシュに残す（授業から「一覧へ」で同じクラスに戻れる）。`ctx.params.classId` が自分のクラスに無ければ、1 番上のクラスにする。
  - 読みこみ: `repo.myClasses` → 選んだクラスの `repo.listLessons`・`repo.getMarks`・`repo.listUnits(year)` を同時に読む。`getMarks`・`listUnits` だけが失敗したときは、授業は出し、上に「一部を読みこめませんでした。」と「もう一度」を出す（印は全部「振り返りがまだ」ではなく、**印を出さない**）。`listLessons` が失敗したら、今までどおり「つながりません。…」と「もう一度ためす」。
  - 読みこみのあと、`resendDrafts` を 1 回走らせる（画面を止めない）。終わったら、`sent` が 1 以上のときは `getMarks` を読み直して印を直し、タイルの「まだ保存できていません」を直す。`kept` が 1 以上なら、上に「まだ保存できていない記録が N 件あります。電波のよい所で、もう一度開いてください。」と出す。
  - 一覧: `groupByDate(lessons, ctx.now())` または `groupByUnit` の見出し（`<h2>`）ごとに、タイルを格子で並べる（横向き 4 枚、縦向き 3 枚。`@media (orientation: portrait)` と幅で切りかえる）。授業が 1 つも無ければ「まだ授業がありません。」。
  - タイルは `lessonTile`。`loadThumbs` は `() => ctx.thumbs.load(lesson)`。`onOpen` は `ctx.navigate('lesson', { classId, lessonId })`。
  - クラスに入っていないときは、今までどおり「まだクラスに入っていません。先生に聞いてください。」。
  - ログアウト: `ctx.drafts.list(studentId).length` が 1 以上なら、確かめる文に「まだ保存できていない記録が N 件あります。ログアウトすると消えます。」を足し、ボタンを危険の色にする。
  - 片付けの関数で、タイルの `destroy()` を全部呼ぶ。

- [ ] **Step 3: `css/app.css` に、一覧の格子・タイル・サムネイル・点・矢印の見た目を足す。`npm test` がすべて通ることと、`node --check` で画面のファイルの構文を確かめる**

- [ ] **Step 4: コミット**（`feat: 生徒の授業一覧（サムネイル）を追加`）

---

### Task 4: 生徒の授業ページ

**Files:**
- Create: `js/views/student-lesson.js`
- Modify: `css/app.css`

**Interfaces:**
- Consumes: `repo.getLesson`・`repo.getRecord`・`repo.saveRecord`、`ctx.files.loadImages`・`ctx.files.loadFile`、`ctx.thumbs.load`、`ctx.drafts`、`ctx.timers`、`createRecordSaver`、`pickInitial`・`normalizeRecord`・`sameRecord`・`LEVELS`、`materialList`・`dateLabel`、`openViewer`（`js/views/parts/viewer.js`）、`CONFIG`。
- Produces: 画面 `#/lesson/<classId>/<lessonId>`（設計書 7.3 と 8 章。1a の範囲＝文字だけ）。

- [ ] **Step 1: `js/views/student-lesson.js` を書く**

  - 上部: 「‹ 一覧へ」（`ctx.navigate('home', { classId })`）、日付（`dateLabel`）と授業名、保存の状態。
  - 保存の状態（文字と `statusChip`。`role="status"`）: `idle` は何も出さない、`dirty`・`saving` は「保存中…」、`saved` は「保存しました」、`retrying` は「保存できませんでした。もう一度ためしています…」、`failed` は「保存できませんでした」と「もう一度」のボタン（`saver.retry()`）。通信が切れている間（`window` の `offline`〜`online`。はじめは `navigator.onLine`）は「接続が切れています」も出す。`online` になったら、`failed`・`retrying` なら `saver.retry()`。
  - 読みこみ: `repo.getLesson` と `repo.getRecord` を同時に読む。授業が `null`、または `denied` で読めないときは「この授業は見つかりません。」と「一覧へ」。通信の失敗は「つながりません。…」と「もう一度ためす」。
  - はじめの中身は `pickInitial(server, ctx.drafts.get(…), { max: CONFIG.recordTextMax })`。`fromDraft` なら、すぐ `saver.edit(record)` して送り直し、「前に保存できなかった内容を、もう一度送ります。」と `toast` を出す。下書きがあったのに使わなかったとき（サーバーのほうが新しい）は、下書きを消す。
  - 左「先生の資料」（`--teacher` の色の枠と見出し）: `materialList(lesson.materials)` の順に並べる。それぞれに「板書」「配布資料」の文字。
    - 写真: まず `ctx.thumbs.load(lesson)` の小さい画像を出し、`ctx.files.loadImages(classId, lessonId, 全部の画像)`（1 回の呼び出し）が届いたら、本物の画像（Blob の URL）に入れかえる。押すと `openViewer({ kind: 'image', load: () => その Blob })`。
    - PDF: 小さい画像（無ければ「PDF」の文字）と名前。押すと `openViewer({ kind: 'pdf', load: () => ctx.files.loadFile(classId, lessonId, material) })`。
    - 画像を読めなかった資料には「読みこめませんでした」と「もう一度」（`loadImages` を、読めなかったものだけで呼び直す）。
    - 資料が 1 つも無ければ「先生の資料は、まだありません。」。
    - 資料の読みこみは、右側の入力を止めない（待たずに書ける）。
  - 右「自分の記録」（`--mine` の色の枠と見出し）: 上から
    - 「メモ」: `<textarea>`（`maxlength` は `CONFIG.recordTextMax`）。
    - 「振り返り」: 「今日の理解度」— `LEVELS` の 4 つのボタン（今の値に `aria-pressed="true"` と、色のほかに「✓」）。同じボタンをもう一度押しても外れない。「分かったこと・学んだこと」「疑問・まだ分からないこと」の `<textarea>`。
    - それぞれの `<textarea>` の下に、`CONFIG.recordCountFrom` 文字をこえたら「あと N 文字」と出す（0 のときは「これ以上は書けません」）。
    - 入力・ボタンのたびに、4 つの項目を `normalizeRecord` でそろえて `saver.edit(record)`。前と同じ内容（`sameRecord`）なら呼ばない。
    - 日本語の変換の途中（`compositionstart`〜`compositionend`）でも、`input` のたびに `edit` してよい（保存は 2 秒待つ）。画面を作り直して、入力中の `<textarea>` のフォーカスや変換をこわさないこと（状態の文だけを書きかえる）。
  - `saver` は `createRecordSaver({ save: (r) => repo.saveRecord(classId, lessonId, studentId, r, ctx.now()), saveDraft: (r, t) => ctx.drafts.put(studentId, classId, lessonId, r, t), removeDraft: () => ctx.drafts.remove(…), now: ctx.now, ...ctx.timers, delayMs: CONFIG.save.delayMs, retryMs: CONFIG.save.retryMs, onState })`。
  - 画面に戻ってきたとき（`document` の `visibilitychange` で `visible`）: `saver.dirty` なら何もしない。そうでなければ `repo.getRecord` を読み、`updatedAt` が今持っている値より新しければ、4 つの項目を入れかえる（入力中の欄にフォーカスがあっても入れかえる。`saver.edit` は呼ばない）。読めなくても何も出さない。
  - 離れるとき: `ctx.setLeaveGuard(async () => …)`。`saver.dirty` でなければ `true`。そうなら「保存中…」を出して `await saver.flush()`。`true` なら離れる。`false` なら `confirmDialog({ title: 'まだ保存できていません', body: 'この iPad の中に残して、一覧へもどりますか？　次に一覧を開いたときに、もう一度送ります。', okLabel: '一覧へもどる', cancelLabel: 'ここに残る' })` の答え。
  - 片付け: `saver.dispose()`、待ち受けを外す、Blob の URL を外す、開いているビューアーを閉じる。
  - 並べ方: 横向きは左右（左 5：右 5。左は中でたてに動かせる）、縦向き（`@media (orientation: portrait)`）は上下（資料が上、記録が下）。

- [ ] **Step 2: `css/app.css` に見た目を足す。`npm test` がすべて通ることと、`node --check` を確かめる**

- [ ] **Step 3: コミット**（`feat: 生徒の授業ページ（資料・メモ・振り返り）を追加`）

---

### Task 5: 規則の確認の追加と、手順書

**Files:**
- Modify: `js/rules-probe.js`、`tests/rules-probe.test.js`、`README.md`
- Create: `docs/reports/stage1a-3-check.md`

**Interfaces:**
- Consumes: 今ある `runRulesProbe`（準備 → 確かめ → 片付け。1a-2 で授業と資料を足した）。
- Produces: `runRulesProbe` の確かめに、下の行を足す（合計 29 → 44 項目）。

  | 試すこと（書いていなければ、確認用の生徒として） | 期待 |
  |---|---|
  | 入っているクラスの授業に、自分の `records` を書く（メモだけ） | ok |
  | その `records` を読む | ok |
  | 自分の `records` と `marks` を、1 回の書きこみで書く（`level: 3`） | ok |
  | 自分の `marks/<自分>/<入っているクラス>` を読む | ok |
  | `records/<入っているクラス>` 全体を読む | denied |
  | `records/<入っているクラス>/<授業>` 全体を読む | denied |
  | ほかの生徒 ID（`s00-998`）の `records` を読む | denied |
  | ほかの生徒 ID の `records` を書く | denied |
  | 入っていないクラスの授業に、自分の `records` を書く | denied |
  | 入っているクラスの、存在しない授業に `records` を書く | denied |
  | `memo` が 2001 文字の `records` を書く | denied |
  | `level` が 5 の `records` を書く | denied |
  | 知らない項目（`extra`）を入れた `records` を書く | denied |
  | ほかの生徒 ID の `marks` を書く | denied |
  | 先生として、確認用の生徒の `records` を書く | denied |

  片付けの決まり（**先生は `records` を書けない・消せない。記録のある授業は消せない**）:
  - 確かめのあと、**確認用の生徒として**、自分の `records`（入っているクラスの授業）と `marks` を消す。そのあとで、先生として今までどおりクラス・授業などを消す。
  - 「通ってはいけない書きこみ」が通ってしまったときも、その場所を確認用の生徒として消す（消せなければ、片付けの失敗として結果に出す）。
  - 前回の残りの片付け: 前回、記録を消す前に止まっていると、先生は年度 0 のクラスの授業を消せない。そこで、準備の順を「確認用の生徒を発行してログインする → 確認用の生徒として、年度 0 の各クラス（生徒が入っているもの）の各授業の、自分の `records` と `marks/<自分>/<classId>` を消す → 先生として前回の残りを消す → 今回のクラスを作る」にする。前回の残りの授業は、先生が `lessons/<classId>`（shallow）で読んで、生徒に渡す。生徒として消せなかった（もう入っていないクラスなど）ときは、先生の片付けが `denied` になるので、片付けの失敗として結果に出す（黙って続けない）。

- [ ] **Step 1: `tests/rules-probe.test.js` にテストを足す**（足した 15 行が、代役の答えどおりに `pass` になる・ならない。片付けで、生徒の `records`・`marks` が先に消え、そのあと授業が消える。前回の残りに記録があっても、生徒として消してから先生が消す。生徒として消せなかったときは、片付けの失敗が結果に出る）

- [ ] **Step 2: `js/rules-probe.js` を直し、`npm test` がすべて通ることを確かめる**

- [ ] **Step 3: `README.md` に 1a-3 の使い方（生徒: 一覧 → 授業 → メモと振り返り、保存の見方）を足す。`docs/reports/stage1a-3-check.md` に、下の「最後の確認」の項目を「未確認」で書く**

- [ ] **Step 4: コミット**（`feat: 規則の確認に記録を追加`）

---

### 最後の確認（Claude Code と先生が行う。Codex には渡さない）

- [ ] 練習モード（`?demo=1`）のブラウザで、iPad の横・縦の大きさで確かめる: 先生として、クラス・生徒・単元・授業（資料あり・なし、今週・先週・先月）を用意する → 生徒としてログインする → 一覧のタイル（日付順・単元別、サムネイルの切りかえ、印）→ 授業を開く → 資料を大きく表示する → メモと振り返りを書く →「保存しました」になる → 一覧に戻ると「記録あり」になっている → 開き直すと中身が残っている。通信を切って書く →「保存できませんでした」→ 一覧に戻る →「まだ保存できていません」の印 → 通信を戻して一覧を開き直すと、送り直されて印が消える。コンソールにエラーが出ていない。
- [ ] 公開して、本物で確かめ、`docs/reports/stage1a-3-check.md` に書く:
  1. 規則の確認が、足した 15 行を含めて 44 項目すべて ○。
  2. 接続確認ページ（`check.html`）がすべて合格。
  3. Drive の実機の確認（写真 1 枚と PDF 1 つの、アップロード・表示・削除。確認用のファイルは残さない）。
  4. （先生が行う）生徒の ID でログインし、学校の iPad で: 一覧が出る、授業を開ける、資料が見える、メモと振り返りが保存される、開き直して残っている。
  5. （先生が行う）ほかの生徒の ID でログインし、4 で書いた記録が見えない。
