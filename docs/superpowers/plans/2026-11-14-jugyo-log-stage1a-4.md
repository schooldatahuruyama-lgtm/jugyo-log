# 授業ログ 段階 1a-4（先生の記録確認と、年度の切り替えの確認） Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 先生が、クラスと授業を選んで、理解度のグラフと全員分の振り返りを読める。全員分の文章をコピーできる。1 人の生徒の記録を読み取り専用で開き、前の人・次の人へ移れる。

**Architecture:** 1a-3 までの作りに足す。記録は `records/<classId>/<lessonId>` を先生が 1 回で読む（規則は今のまま。先生は読めるが書けない）。集計・並べ替え・コピー用の文章は `js/review-logic.js`（通信をしない）で作り、画面は出すだけにする。生徒の授業ページの「先生の資料」の部分を `js/views/parts/material-pane.js` に取り出し、生徒の授業ページと、先生が見る生徒の記録の画面で同じものを使う。

**Tech Stack:** HTML / CSS / JavaScript（ES モジュール、外部パッケージなし）、Node.js 18 以上の `node --test`、Firebase Realtime Database（REST）、GitHub Pages。

**Spec:** `docs/superpowers/specs/2026-11-12-jugyo-log-design.md`（設計書）の 5.5・7.6、`docs/superpowers/specs/2026-11-13-jugyo-log-1a-data.md`（データの形）の 3 章・4 章。

**この計画の範囲:** データの形 2 章の「1a-4」。年度の切り替え（進級）に要る操作は、1a-1〜1a-3 でそろっている（年度ごとのクラスの作成、名簿の「前の年度のクラスから引きつぐ」、生徒の一覧の「年度」の選択、先生の授業の「年度」の選択）。この計画では、**進級のコードは足さず**、手順を README に書き、最後の確認で通しで確かめる。手書き・生徒の添付（1b）、先生のコメント（段階 2）は入れない。

**実装の担当:** コードは Codex が書く（`tools/codex-implement.ps1`）。

## Global Constraints

- 作業フォルダは `C:\Users\yan12\Documents\keita\AI開発\授業ログアプリ`。この外は読まない・編集しない。
- 外部パッケージをインストールしない。Firebase の SDK を入れない。外部の配信元から実行時に読み込まない。
- `js/views/` と `js/main.js` のほかのモジュールは、`window`・`document`・`fetch`・`localStorage`・`navigator`・`Date.now`・`setTimeout` を直接使わず、引数で受け取る。
- データベースの場所（`records/…` などの文字）を書いてよいのは `js/repo.js`・`js/dev/`・`js/rules-probe.js` だけ。
- **データベースの形と規則（`docs/setup/rules.json`）は変えない。先生は、生徒の記録を書かない・消さない**（画面にも、書く・消す操作を置かない）。
- 生徒の本名、学校のメールアドレスを保存しない・入力させない。画面に出すのは出席番号と生徒 ID だけ。**「全員分をコピー」の文には、出席番号も生徒 ID も入れない。**
- 「提出」の操作を作らない。書きかけの記録も、そのまま出す。
- 画面に出す文字は `textContent`（`el()` の `text`）で入れる。`innerHTML` を使わない。
- 基準の端末は iPad の Safari（横 1180×820 と縦 820×1180）と、PC の Chrome・Edge。ボタンは 44×44px 以上。状態は色だけで伝えず、文字を添える（グラフも、人数を数字で出す）。
- 画面の文とコードのコメントは日本語。やさしい言葉で書く。
- 書き方は、今ある `js/views/teacher-lessons.js`・`js/views/student-lesson.js`・`js/lesson-logic.js`・`js/repo.js` に合わせる。
- `git add`・`git commit`・ブランチの操作はしない。指示書の「Files」のほかのファイルは変えない。変える必要があると思ったら、変えずに報告に書く。
- `check.html`・`js/check-*.js`・`gas/` は変えない。

## この計画で決めたこと（Claude の判断）

| 項目 | 決めたこと |
|---|---|
| 入り口 | 先生の上部のメニューに「記録」を足す。授業の編集の画面にも「生徒の記録を見る」を置く |
| 選び方 | 年度 → クラス → 授業の順に選ぶ。はじめは、今の年度の最初のクラスの、1 番新しい授業（今日より先の授業は除く。無ければ 1 番新しい授業） |
| グラフ | 横の棒 5 本（よく分かった／分かった／あまり分からなかった／全然分からなかった／まだ入力なし）。それぞれ人数を数字で出す。合計の人数も出す |
| 名簿にいない生徒の記録 | クラスから外した生徒の記録が残っているときは、消さずに、一覧の最後に「名簿にいない」と付けて出す。グラフの人数にも入れる |
| 一覧の 1 行 | 出席番号・理解度・文章。文章が空の人は「（まだ書いていません）」と出す（行は消さない） |
| 並び順 | はじめは「理解度が低い順」（全然分からなかった → よく分かった → 入力なし。同じなら出席番号順）。「出席番号順」に切りかえられる |
| 項目の切りかえ | 「疑問」と「分かったこと」。はじめは「疑問」 |
| コピー | 今出している項目の、文章を書いた人の分だけを、1 人 1 行で（文章の中の改行は空白にする）。出席番号も ID も付けない。0 人のときは「コピーする文章がありません。」と出し、コピーしない。コピーできたら「N 人分をコピーしました。」と出す。コピーできない端末では、文章を選べる欄に出して、手でコピーできるようにする |
| 1 人の記録 | 行を押すと、その生徒の授業ページを読み取り専用で開く（先生の資料・メモ・理解度・分かったこと・疑問・最後に書いた日時）。「前の人」「次の人」は出席番号順（名簿にいない生徒は最後） |
| 新しい記録 | 自動では読み直さない。「読み直す」のボタンを置く |

## Review Focus

1. **コピーの文に、出席番号・生徒 ID が入らないこと**。文章の中の改行で、1 人が 2 行にならないこと（Task 1）。
2. **名簿にいない生徒の記録・形のおかしい記録**があっても落ちず、消さずに出すこと（Task 1）。
3. **先生の画面から、記録を書く・消す通信が出ないこと**（Task 1・Task 2）。
4. **生徒の授業ページの動きが、部品を取り出したあとも変わらないこと**（Task 2）。
5. **理解度が同じ・出席番号が同じ・出席番号が無い**ときの並び順が、毎回同じになること（Task 1）。

---

### Task 1: 記録の集計と、データの読み出し

**Files:**
- Create: `js/review-logic.js`、`tests/review-logic.test.js`
- Modify: `js/repo.js`、`tests/repo.test.js`、`js/router.js`、`tests/router.test.js`、`js/rules-probe.js`、`tests/rules-probe.test.js`

**Interfaces:**
- Consumes: `normalizeRecord`・`LEVELS`（`js/record-logic.js`）、`repo.getMembers`、`CONFIG.recordTextMax`、`sortLessons`・`todayString`（`js/lesson-logic.js`）。
- Produces:
  - `js/repo.js`: `listRecords(classId, lessonId) → { [studentId]: { memo, level, learned, question, updatedAt } }`（`records/<classId>/<lessonId>` を 1 回読む。1 人分の形は `getRecord` と同じにそろえる。オブジェクトでない 1 人分は入れない）。
  - `js/router.js`:

    | name | ハッシュ | 画面のファイル | だれ |
    |---|---|---|---|
    | `t-review` | `#/t/review` または `#/t/review/<classId>/<lessonId>` | `teacher-review`（Task 2） | teacher |
    | `t-record` | `#/t/review/<classId>/<lessonId>/<studentId>` | `teacher-record`（Task 2） | teacher |

    `classId`・`lessonId` は `/^[A-Za-z0-9]+$/`、`studentId` は `isStudentId`（`js/ids.js`）の形だけ。`routeHash('t-review', {})` は `#/t/review`、`classId` と `lessonId` があれば `#/t/review/<c>/<l>`。
  - `js/review-logic.js`（通信をしない）:
    - `reviewPeople(members, records) → [{ studentId, number, inRoster, record }]`。`members` は `repo.getMembers` の結果（`[{ studentId, number }]`）、`records` は `repo.listRecords` の結果。名簿の全員（記録が無ければ `record: null`）と、名簿にいないが記録のある生徒（`number: null`・`inRoster: false`）。順は、出席番号の小さい順 → 同じなら生徒 ID 順 → 名簿にいない生徒（ID 順）。
    - `levelCounts(people) → { 4: n, 3: n, 2: n, 1: n, none: n, total: n }`
    - `reviewRows(people, { field, sort }) → [{ studentId, number, inRoster, level, text }]`。`field` は `'question' | 'learned'`、`sort` は `'level' | 'number'`。`text` は、その項目の文章（無ければ `''`）。`'level'` は、理解度 1 → 2 → 3 → 4 → 入力なしの順で、同じなら `reviewPeople` の順。`'number'` は `reviewPeople` の順。知らない `field`・`sort` は、`'question'`・`'level'` として扱う。
    - `copyText(rows) → { text, count }`。`text` が空白だけでない人の分を、`rows` の順に 1 人 1 行（前後の空白を取り、中の改行と続く空白は 1 つの空白にする）。行の区切りは `\n`。`count` は入れた人数。
    - `neighbors(people, studentId) → { prev, next }`（`reviewPeople` の順での前後の生徒 ID。無ければ `null`。`studentId` が見つからなければ両方 `null`）
    - `defaultLesson(lessons, todayMs) → lessonId | null`（`sortLessons` の順で、日付が今日以前の最初の授業。無ければ最初の授業。授業が無ければ `null`）
    - `levelLabel(level) → string`（1〜4 は `LEVELS` の文、ほかは `'まだ入力なし'`）
  - `js/rules-probe.js`: 確かめに 2 行足す（44 → 46 項目）。「先生として `records/<入っているクラス>/<授業>` を読む → ok」「先生として `marks/<確認用の生徒>` を読む → ok」。生徒が記録を書いたあと・片付けの前に行う。ほかは変えない。

**端の場合:**
- 不正な入力: `members`・`records` が `null`・配列・文字でも落ちない（空として扱う）。記録の欄は `normalizeRecord` でそろえる（文字でない欄は `''`、`level` が 1〜4 の整数でなければ入力なし）。出席番号が数でない名簿の行は、`number: null` にして最後のほうに出す（消さない）。
- 重複と境界: 理解度も出席番号も同じ 2 人は、生徒 ID 順。0 人のクラスは、`levelCounts` がすべて 0、`reviewRows` が `[]`、`copyText` が `{ text: '', count: 0 }`。文章が空白と改行だけの人は、コピーに入れない。2000 文字の文章は、そのまま 1 行にする。
- 違反や失敗の見せ方: このタスクに画面は無い。計算の関数は例外を投げず、決めた値を返す。`repo.listRecords` の通信の失敗は `NetError` のまま投げる。規則の確認で期待と違った行は、今までどおり `×`。

- [ ] **Step 1: テストを書く（失敗することを確かめる）**

```js
const members = [{ studentId: 's26-002', number: 2 }, { studentId: 's26-001', number: 1 }, { studentId: 's26-003', number: 3 }];
const records = {
  's26-001': { memo: '', level: 4, learned: 'オームの法則', question: '', updatedAt: 1 },
  's26-002': { memo: '', level: 1, learned: '', question: 'なぜ電圧が\n分かれるのか\n\n  知りたい', updatedAt: 2 },
  's26-009': { memo: '', level: 2, learned: '', question: '単位が分からない', updatedAt: 3 },
};
test('reviewPeople: 名簿の全員と、名簿にいない生徒の記録', () => {
  const p = reviewPeople(members, records);
  assert.deepEqual(p.map((x) => [x.studentId, x.number, x.inRoster, x.record === null]),
    [['s26-001', 1, true, false], ['s26-002', 2, true, false], ['s26-003', 3, true, true], ['s26-009', null, false, false]]);
  assert.deepEqual(levelCounts(p), { 4: 1, 3: 0, 2: 1, 1: 1, none: 1, total: 4 });
});
test('reviewRows: 理解度が低い順、入力なしは最後', () => {
  const rows = reviewRows(reviewPeople(members, records), { field: 'question', sort: 'level' });
  assert.deepEqual(rows.map((r) => r.studentId), ['s26-002', 's26-009', 's26-001', 's26-003']);
  assert.equal(rows[3].level, null);
  assert.equal(rows[2].text, '');
});
test('copyText: 1 人 1 行。番号も ID も入れない', () => {
  const rows = reviewRows(reviewPeople(members, records), { field: 'question', sort: 'level' });
  const c = copyText(rows);
  assert.deepEqual(c, { text: 'なぜ電圧が 分かれるのか 知りたい\n単位が分からない', count: 2 });
  assert.ok(!/s26|\b[0-9]+\b/.test(c.text));
});
```

  ほかのテスト: `sort: 'number'`、`field: 'learned'`、知らない `field`・`sort`、`neighbors`（先頭・最後・見つからない）、`defaultLesson`（今日より先の授業を飛ばす・全部が先なら最初・空なら `null`）、`levelLabel`、`null`・配列を渡しても落ちない、同じ出席番号は ID 順、出席番号が数でない行。`repo.listRecords`（2 人分・無ければ `{}`・1 人分が文字なら入れない・`net.get` は 1 回で、書きこみをしない）。ルーター（`#/t/review`、`#/t/review/a/b`、`#/t/review/a/b/s26-001`、`#/t/review/a`・`#/t/review/a/b/xx`・`#/t/review/a/b/s26-001/x` は `not-found`、`routeHash` の行き来、`roleFor` は `'teacher'`）。規則の確認（足した 2 行が代役の答えどおりに `pass` になる・ならない。合計 46 行）。

- [ ] **Step 2: 実装して `npm test` がすべて通ることを確かめる**

- [ ] **Step 3: コミット**（`feat: 記録の集計と読み出しを追加`）

---

### Task 2: 先生の記録確認の画面

**Files:**
- Create: `js/views/teacher-review.js`、`js/views/teacher-record.js`、`js/views/parts/material-pane.js`、`docs/reports/stage1a-4-check.md`
- Modify: `js/views/student-lesson.js`（「先生の資料」の部分を `material-pane.js` に移す。**生徒から見える動きは変えない**）、`js/views/parts/teacher-nav.js`（メニューに「記録」を足す。`current` に `'review'`）、`js/views/teacher-lesson.js`（「生徒の記録を見る」のボタンを 1 つ足すだけ）、`css/app.css`、`README.md`

**Interfaces:**
- Consumes: Task 1 の全部、`repo.listClasses`・`repo.listLessons`・`repo.getLesson`・`repo.getMembers`、`ctx.files`・`ctx.thumbs`、`openViewer`、`schoolYear`、`dateLabel`・`materialList`、`statusChip`・`toast`。
- Produces:
  - `js/views/parts/material-pane.js`: `materialPane({ ctx, classId, lessonId, lesson }) → { node, destroy() }`。今 `js/views/student-lesson.js` の中にある「先生の資料」の一覧（小さい画像 → 本物の写真に入れかえ、PDF、押すと大きく表示、読めなかったときの「読みこめませんでした」と「もう一度」、資料が無いときの文、Blob の URL の片付け、開いているビューアーを閉じる）を、そのまま移したもの。`student-lesson.js` はこれを使う。
  - `js/views/teacher-review.js`（`#/t/review`、`#/t/review/<classId>/<lessonId>`。設計書 7.6）:
    - 上部: `teacherNav(ctx, 'review')`。
    - 「年度」「クラス」「授業」の選択と「読み直す」。授業の選択肢は `11/12（木） 電流と電圧` の形。クラスや授業を選ぶと `ctx.navigate('t-review', { classId, lessonId })`（ハッシュに残す。開き直しても同じ授業）。ハッシュに ID が無いときは、今の年度の最初のクラスと `defaultLesson`。ハッシュのクラス・授業が見つからなければ「この授業は見つかりません。」と出し、選択は使える。クラスが無ければ「先にクラスを作ってください。」、授業が無ければ「このクラスには、まだ授業がありません。」。
    - 左: 「理解度」の棒グラフ（`levelCounts`。棒 5 本。`LEVELS` の文と「まだ入力なし」、人数の数字、合計「全部で N 人」）。棒の長さは、1 番多い人数を 100% とする。読み上げ用に、同じ中身の文（「よく分かった 12 人」…）を持たせる。
    - 右: 「疑問」「分かったこと」の切りかえ、「理解度が低い順」「出席番号順」の切りかえ（どちらも 2 つのボタンと `aria-pressed`）、「全員分をコピー」、一覧。
      - 1 行: 出席番号（`3 番`。名簿にいない生徒は「名簿にいない」）、理解度（`statusChip` と `levelLabel`。入力なしも文字で出す）、文章（空なら「（まだ書いていません）」。改行はそのまま見せる）。行の全体がボタンで、押すと `ctx.navigate('t-record', { classId, lessonId, studentId })`。読み上げの名前は「3 番の記録を開く」。
      - 0 人なら「このクラスには、まだ生徒がいません。」。
    - 「全員分をコピー」: `copyText(今出している行)`。`count` が 0 なら「コピーする文章がありません。」と `toast`。そうでなければ `navigator.clipboard.writeText`。成功したら「N 人分をコピーしました。」。できない（関数が無い・例外）ときは、文章を入れた `<textarea readonly>` と「閉じる」を出し、「コピーできませんでした。下の文章を選んで、コピーしてください。」と添える。
    - 読みこみの失敗は「つながりません。もう一度ためしてください。」と「もう一度ためす」。読みこみ中はボタンを押せなくする。古い読みこみの結果は捨てる。
    - 記録を書く・消す操作は置かない。
  - `js/views/teacher-record.js`（`#/t/review/<classId>/<lessonId>/<studentId>`）:
    - 上部: `teacherNav(ctx, 'review')`。その下に「‹ 一覧へ」（`t-review` の同じ授業へ）、「前の人」「次の人」（`neighbors`。無ければ押せない）、日付・授業名、「3 番の記録（読み取り専用）」（名簿にいない生徒は「名簿にいない生徒の記録（読み取り専用）」と生徒 ID）。
    - 左: 「先生の資料」（`materialPane`）。右: 「この生徒の記録」— メモ、理解度（`levelLabel`）、分かったこと・学んだこと、疑問・まだ分からないこと。どれも入力欄ではなく、読むだけの文として出す（空なら「（まだ書いていません）」）。最後に書いた日時（`updatedAt`。`2026/11/14 10:23` の形。0 なら出さない）。
    - 記録がまだ無い生徒は「この生徒は、まだ何も書いていません。」。
    - 読むもの: `repo.getLesson`、`repo.getMembers`、`repo.listRecords`（前後の人を決めるため、全員分を読む）。授業が無ければ「この授業は見つかりません。」。その生徒が名簿にも記録にもいなければ「この生徒は見つかりません。」と「一覧へ」。
    - 並べ方は、生徒の授業ページと同じ（横向きは左右、縦向きは上下）。
  - `js/views/teacher-lesson.js`: 「‹ 授業の一覧へ」の近くに「生徒の記録を見る」（`ctx.navigate('t-review', { classId, lessonId })`）。保存していない変更があるときの確かめは、今ある leave guard がそのまま働く。
  - `README.md`: 「段階 1a-4 の使い方」（記録の見方・コピーの使い方）と、「年度が変わったら」（新しい年度のクラスを作る → 名簿で「前の年度のクラスから引きつぐ」→ 出席番号を入れて保存 → 新しい年度の単元と授業を作る。前の年度のクラス・授業・記録は消さない。生徒は「年度」で前の学年を見られる）を足す。
  - `docs/reports/stage1a-4-check.md`: 下の「最後の確認」の項目を「未確認」で書く（形は `docs/reports/stage1a-3-check.md` に合わせる）。

**端の場合:**
- 不正な入力: ハッシュの ID の形がおかしければ「ページが見つかりません」（ルーター）。見つからないクラス・授業・生徒は、文で知らせて、選び直せる・一覧へ戻れるようにする。形のおかしい記録は `normalizeRecord` でそろえて出す。`updatedAt` が 0・数でないときは、日時を出さない。
- 重複と境界: 0 人のクラス、記録が 0 件の授業（全員「まだ入力なし」）、全員が同じ理解度（棒 1 本が 100%）。1 人だけのクラスでは「前の人」「次の人」がどちらも押せない。「全員分をコピー」を続けて押しても、落ちない。とても長い文章（2000 文字）は、行の中で折り返す（横にはみ出さない）。クラスを切りかえている途中の古い読みこみの結果は捨てる。
- 違反や失敗の見せ方: 読めないときは「つながりません。もう一度ためしてください。」と「もう一度ためす」。コピーできないときは、文章を選べる欄を出す（黙って失敗しない）。コピーする文章が無いときは、そう出す。名簿にいない生徒の記録は「名簿にいない」と付けて出す（消さない）。写真を読めないときは、今までどおり「読みこめませんでした」と「もう一度」。

- [ ] **Step 1: `material-pane.js` を作り、`student-lesson.js` をそれを使う形に直す。`npm test` が通ることと、`node --check` を確かめる**

- [ ] **Step 2: `teacher-review.js`・`teacher-record.js` を書き、メニューとボタンを足す。`css/app.css` に見た目（グラフ・一覧・読むだけの記録）を足す**

- [ ] **Step 3: `README.md` と `docs/reports/stage1a-4-check.md` を書く。`npm test` がすべて通ることと、新しいファイルの `node --check` を確かめる**

- [ ] **Step 4: コミット**（`feat: 先生の記録確認の画面を追加`）

---

### 最後の確認（Claude Code と先生が行う。Codex には渡さない）

- [ ] 練習モード（`?demo=1`）のブラウザで、iPad の横・縦の大きさで確かめる:
  1. 生徒 3 人以上の記録（理解度がばらばら・未入力あり・文章なしあり）を用意し、先生の「記録」で、グラフの人数と一覧が合っている。
  2. 「疑問／分かったこと」「理解度が低い順／出席番号順」を切りかえられる。
  3. 「全員分をコピー」で、文章だけがコピーされる（番号・ID が入っていない）。
  4. 行を押すと 1 人の記録が読み取り専用で開き、「前の人」「次の人」で移れる。資料を大きく表示できる。
  5. 生徒の授業ページが、前と同じに動く（資料の表示・保存）。
  6. 進級: 次の年度のクラスを作り、名簿で前の年度のクラスから引きつぐ → 生徒の一覧の「年度」に 2 つ出て、前の年度の授業と記録が残っている。先生も、前の年度の記録を「記録」で読める。
  7. コンソールにエラーが出ていない。
- [ ] 公開して、本物で確かめ、`docs/reports/stage1a-4-check.md` に書く:
  1. 規則の確認が 46 項目すべて ○。
  2. 接続確認ページ（`check.html`）がすべて合格。
  3. Drive の実機の確認（写真 1 枚と PDF 1 つの、アップロード・表示・削除。確認用のファイルは残さない）。
  4. （先生が行う）生徒の ID で書いた記録が、先生の「記録」に出る。書きかけも出る。
  5. （先生が行う）要件定義書「初期版で確認する動作」の 1・2・4・5・6・7（手書きと生徒の添付を除く）を、学校の iPad で確かめる。
