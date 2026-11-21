# 実装指示書: 卒業後の削除と復元

あなた（Codex）は、この指示書に沿ってコードを書きます。進め方は `AGENTS.md` の「実装を頼まれたとき」のとおりです。

## 目的

要件定義書 `docs/requirements.md` の「卒業後の削除時期・削除方法・復元方法は未決定」と、設計書 `docs/superpowers/specs/2026-11-12-jugyo-log-design.md` の「4 以降: 卒業後の削除と復元」。2026-11-21 に先生が決めた: **先生がボタンで消す（自動では消さない）。消してから 30 日はもどせる。**

## 利用者から見える動き（決定ずみ。変えない）

| 項目 | 動き |
|---|---|
| 場所 | 先生のメニューに「卒業」（`#/t/graduates`）を足す。入学年度ごと（生徒 ID の `s26-…` の `26`）に、人数と状態を出す |
| 消す | 「この学年の記録を消す」→ 説明と、入学年度（例: `2026`）を入れる欄が出る。数字が合ったときだけ「消す」を押せる |
| 消した直後 | その学年の生徒は、ログインできず、何も読めない。データは残る。30 日の間は「もどす」で元どおり |
| 30 日をすぎたら | 「クラス」の画面に知らせを出す。「卒業」の画面を開くと、進み具合を見せながら完全に消し始める。「止める」で止められ、次に開くと続きから消す |
| 完全に消すもの | その生徒の、記録・写真・PDF・手書き・小さい画像・自分の用語・印・先生の返事・理科クエストの記録・名簿・ID の台帳・最初のパスワード。その生徒が入っていたクラスの AI のまとめ |
| 消さないもの | 先生の授業・資料・クラス・単元。Firebase のログイン用アカウント本体（アプリからは消せない。何も読めない状態で残る） |
| 写真・PDF を消せないとき | その授業の記録も消さずに止めて、理由を出す |

## データ

新しい場所 `removed/<生徒 ID>` = `{ removedAt: 数, uid?: 文字 }`（先生だけが読み書きできる）。

- **消す**（もどせる）: 1 回のルート update で、`accounts/<uid>` を null、`removed/<sid>` に `{ uid, removedAt }`。アカウントをまだ発行していない生徒（`uid` なし）は `{ removedAt }` だけ。
- **もどす**: 1 回のルート update で、`accounts/<uid>` に生徒 ID、`removed/<sid>` を null。
- 生徒が読めなくなるのは、今の規則がどれも `accounts/<uid>` を見ているため（規則の読む側は変えない）。

## 作る・変えるファイル

### 1. `js/config.js`

`graduate: { graceDays: 30, trashBatch: 20 }` を足す。

### 2. `js/graduate-logic.js`（新しい。純粋な関数）

- `cohortOf(studentId)` → 入学年度の下 2 けたの文字（`'26'`）。形がちがえば null。
- `cohorts({ students, removed, now, graceDays })` → 入学年度の新しい順の配列。`students` は `repo.listStudents()` の結果、`removed` は `{ sid: { removedAt, uid } }`。1 つの要素:
  `{ yy, year（2000 + yy）, total, active: [生徒], removed: [生徒＋removedAt], restorable: [もどせる生徒], purgeable: [30 日をすぎた生徒], restoreUntil（もどせる生徒のうち、いちばん早い期限。無ければ null）, state }`。
  `state` は `'active'`（全員使用中）・`'removed'`（消してある人がいて、30 日をすぎた人はいない）・`'purging'`（30 日をすぎた人がいる）。
- 30 日の境界: `removedAt + graceDays × 86400000 <= now` で「すぎた」。
- `daysLeft(removedAt, now, graceDays)` → 残りの日数（切り上げ。0 より小さくしない）。
- `matchesYear(input, year)` → 入力（前後の空白と全角の数字を直したもの）が `String(year)` と同じか。
- `fileIdsOf(record)` → その記録の Drive のファイル ID（`attachments` の `fileId`、`ink` の全部の `fileId`）。重複を除く。`repo.listRecords` の返す形を受け取る。

### 3. `js/repo.js`

- `listRemoved()` → `{ sid: { removedAt, uid（無ければ null） } }`（形のちがうものは捨てる）。
- `removeStudents(list, now)`（`list` は `[{ id, uid }]`）: 上の「消す」を、全員まとめて 1 回のルート update で。空なら何もしない。
- `restoreStudents(list)`（`list` は `[{ id, uid }]`）: 上の「もどす」。`uid` が無い生徒は `removed/<sid>` を null にするだけ。
- `listMemberOf()` → `{ sid: [classId, …] }`（`memberOf` を読む）。
- `purgeLessonRecords(classId, lessonId, studentIds)`: 1 回のルート update で、生徒ごとに `records/<c>/<l>/<sid>`・`recThumbs/<c>/<l>/<sid>`・`inkThumbs/<c>/<l>/learned/<sid>`・`inkThumbs/<c>/<l>/question/<sid>`・`replies/<c>/<l>/<sid>`・`replyMarks/<sid>/<c>/<l>` を null、`aiSummaries/<c>/<l>` を null。
- `purgeStudent({ id, uid, classIds })`: 1 回のルート update で、`terms/<sid>`・`marks/<sid>`・`replyMarks/<sid>`・`memberOf/<sid>`・`members/<c>/<sid>`（クラスごと）・`initialPw/<sid>`・`gen/<sid>`・`students/<sid>` を null、`uid` があれば `rika/state/<uid>`・`rika/log/<uid>` も null。**そのあと、別の 1 回で** `removed/<sid>` を null（規則が `removed/<sid>` を見るので、最後に消す）。
- `linkAccount`（今ある。出し直し）: パッチに `removed/<sid>` = null を足す（出し直したら、もどしたことにする）。

### 4. `js/files.js`・`js/dev/demo-gas.js`

- `files.trashStudents(fileIds, studentIds)`: `gas.call('trashStudentFiles', { fileIds, studentIds })`。戻り値 `{ trashed, missing, skipped }`（数）。`fileIds` が空なら呼ばずに 0 を返す。取り置き（`cache`）から、その ID を消す。
- 練習モードの GAS に `trashStudentFiles` を足す（先生だけ。下の GAS と同じ決まり。練習モードでは `removed` を `net` から読む）。

### 5. `gas/Code.gs`

- `VERSION` を `'app-7'` に。`handle_` の許す op に `trashStudentFiles` を足す（先生だけ。ほかは `denied`）。
- `trashStudentFiles_(req, base)`:
  - `fileIds`: 1〜20 個の配列。どれも `ID_RE`。`studentIds`: 1〜60 個の配列。どれも `STUDENT_ID_RE`。ちがえば `bad`。
  - `studentIds` の 1 人ずつ、`base + '/removed/' + sid + '.json?auth=' + token` を読み、`removedAt` が数のものだけを「消してよい生徒」とする（先生のトークンで読む）。
  - ファイルごと: `findStudentFile_`（生徒のフォルダの中・ゴミ箱でない・説明が正しい）で見つからなければ `missing`。持ち主（`studentOwner_`）が「消してよい生徒」でなければ、**消さずに** `skipped`。そうでなければ `setTrashed(true)` して `trashed`。
  - 戻り値 `{ ok: true, trashed: 数, missing: 数, skipped: 数 }`。
- `docs/setup/gas.md` の版の説明に `app-7` を足す。

### 6. `docs/setup/rules.json`（と、規則の写しを見ているテスト・`docs/setup/rules-check.json` があれば合わせる）

下の `T` は `auth != null && root.child('teacherList').child(auth.uid).val() === true`、`R` は `root.child('removed').child($sid).exists()`。

- 新しく `removed`: `.read`・`.write` は `T`。`$sid` の `.validate`: `newData.hasChildren(['removedAt']) && newData.child('removedAt').isNumber()`、`uid` は文字、ほかの子は不可。
- 先生が「消してある生徒のものだけ」消せるようにする。次の場所の `.write` に `|| (T && !newData.exists() && R)` を足す（今の条件は変えない）:
  - `records/$classId/$lessonId/$sid`
  - `recThumbs/$classId/$lessonId/$sid`
  - `inkThumbs/$classId/$lessonId/$field/$sid`
- 次の場所に、`.write`: `T && !newData.exists() && R` を足す（今は `$classId` にだけ `.write` がある）:
  - `terms/$sid`、`marks/$sid`
- `replies`・`replyMarks`・`aiSummaries`・`members`・`memberOf`・`students`・`gen`・`initialPw`・`accounts`・`rika/state/$uid`・`rika/log/$uid` は、今の規則で先生が消せるので変えない（消せないものがあれば、報告に書く）。
- 読む側の規則は変えない。

### 7. `js/rules-probe.js`（規則の確認）

今ある確認の作りに合わせて、次を足す（確認用の生徒 `PROBE_ID` で。後片付けもする）:

- 消していない生徒の記録を、先生が消そうとする → `denied`。
- 生徒が `removed/<自分>` を読む・書く → `denied`。
- 先生が「消す」（`removeStudents`）→ `ok`。そのあと: 生徒が自分の記録を読む → `denied`。先生が、その生徒の `records`・`recThumbs`・`inkThumbs`・`terms`・`marks` を消す → `ok`。先生が、その生徒の記録に書く（消すのでなく）→ `denied`。
- 先生が「もどす」→ `ok`。そのあと、生徒が自分の記録を読む → `ok`。

### 8. `js/graduate-flow.js`（新しい。通信の流れ。画面に依存しない）

- `removeCohort({ repo, cohort, now })`: `cohort.active` を `repo.removeStudents`。戻り値は人数。
- `restoreCohort({ repo, cohort })`: `cohort.restorable` を `repo.restoreStudents`。30 日をすぎた生徒は、もどさない。
- `purgeCohort({ repo, files, cohort, batch, onProgress, signal })`: `cohort.purgeable` の生徒を完全に消す。
  1. `repo.listMemberOf()` から、その生徒たちが入っているクラスを集める。
  2. クラスごとに `repo.listLessons(classId)`。授業ごとに `repo.listRecords(classId, lessonId)` を読み、対象の生徒の記録から `fileIdsOf` でファイル ID を集める。
  3. ファイル ID を `batch` 個ずつ `files.trashStudents(ids, 対象の生徒の ID)`。**失敗（投げた）したら、その授業の記録を消さずに、全体を止める**。`skipped` が 1 つでもあれば、同じく止める（消してよい生徒でない、と GAS が判断した＝食いちがい）。`missing` は進めてよい（もう無い）。
  4. その授業で `repo.purgeLessonRecords(classId, lessonId, そのクラスに入っている対象の生徒)`。対象の生徒の記録が 1 つも無い授業でも呼ぶ（先生の返事だけ残っていることがあるため）。
  5. 全部のクラスが終わったら、生徒ごとに `repo.purgeStudent`。
  - `onProgress({ doneLessons, totalLessons, doneStudents, totalStudents })` を、授業 1 つ・生徒 1 人ごとに呼ぶ。
  - `signal` が止められたら、次の通信の前に `AbortError` で止まる（止めた所までは消えたまま。もう一度呼べば、続きから同じ結果になる）。
  - 戻り値 `{ students: 人数, files: 消したファイルの数 }`。失敗は、`code`（`'files'`・`'skipped'`・`'network'`・`'denied'` など）の分かるエラーで投げる。

### 9. `js/views/teacher-graduates.js`（新しい）・`js/router.js`・`js/views/parts/teacher-nav.js`

- 道すじ: `'t-graduates': ['#/t/graduates', 'teacher-graduates', 'teacher']`。メニューに `['graduates', '卒業']` を足す（「記録」の右）。
- 画面（今ある先生の画面の書き方・部品に合わせる。`teacherNav(ctx, 'graduates')`）:
  - 上の説明: 「卒業した学年の記録を消す画面です。消す前に、生徒が『記録をまとめて保存』で自分の記録を残したかを確かめてください。」
  - 入学年度ごとの行: 「2026 年度入学」「生徒 33 人」と状態。
    - `active`: 「使用中」と、ボタン「この学年の記録を消す」。
    - `removed`: 「消してあります（○ 人）。あと ○ 日は、もどせます。」と、ボタン「もどす」。使用中の生徒も残っているとき（途中で止まったなど）は、「この学年の記録を消す」も出す。
    - `purging`: 「30 日をすぎました。完全に消しています… 授業 ○ / ○、生徒 ○ / ○ 人」と「止める」。止まっているときは理由と「続きから消す」。
  - 「この学年の記録を消す」を押すと、その行の下に、説明・入力欄・「消す」「やめる」が出る。説明: 「2026 年度入学の生徒 33 人が、ログインできなくなります。30 日の間は『もどす』で元にもどせます。30 日をすぎると、記録・写真・PDF・手書きが完全に消え、もどせません。」。入力欄: 「確かめのため、入学年度（2026）を入れてください」。`matchesYear` が真のときだけ「消す」を押せる。
  - 完全に消すのは、**この画面を開いたとき**に、`purging` の学年について自動で始める（1 つずつ順に）。画面を離れたら止める（`signal`）。終わったら、一覧を読み直し、`toast('2026 年度入学の記録を、完全に消しました。')`。
  - 失敗の文:
    - `files`・GAS の通信の失敗: 「写真・PDF を消せなかったので、止めました。学校の回線では消せないことがあります。家などの回線で、この画面をもう一度開いてください。」
    - `skipped`: 「消してよい生徒かどうかを確かめられなかったファイルがあったので、止めました。もう一度ためしても同じときは、Claude Code に伝えてください。」
    - `denied`: 「データベースの規則が古いため、消せませんでした。規則を入れ直してください。」
    - そのほか: 「つながりません。電波を確かめて、もう一度ためしてください。」
  - 生徒が 1 人もいないとき: 「まだ生徒がいません。」
- 消す・もどす・完全に消す、のどれかの通信中は、ほかのボタンを押せなくする。完全に消している間に画面を離れるときは、leave guard で「完全に消している途中です。離れると止まります（次に開くと、続きから消します）。」とたずねる。

### 10. `js/views/teacher-classes.js`・`js/views/teacher-roster.js`

- クラスの画面: `purging` の学年が 1 つでもあれば、上に知らせ「消してから 30 日をすぎた学年があります。『卒業』の画面を開くと、完全に消します。」と、「卒業の画面へ」のボタン。`listRemoved`・`listStudents` の読みこみに失敗しても、クラスの画面は今までどおり出す（知らせを出さないだけ）。
- 名簿の画面: 消してある生徒の行に「消してあります」の印（今ある印の部品に合わせる）。読みこみに失敗したら、印なしで今までどおり。

### 11. `js/main.js`（1 つだけ）

- ログインを確かめた結果が `none` になったとき（生徒だったのに、対応が消えたなど）、読んだ内容の取り置き（`store.clear()`）と、保存後の読み直しの予約（`refresh.clear()`）も消す（消された生徒の iPad に、前の内容を残さない）。

### 12. `css/app.css`・`README.md`

- 画面の見た目は、今ある先生の画面のクラス名を使い、足りない分だけ足す（幅 375px ではみ出さない。状態は色だけにたよらず文で出す）。
- README: 先生向けの使い方に「卒業した学年の記録を消す」の節を足す（上の「利用者から見える動き」の内容と、消さないもの、学校の回線では完全に消せないこと、規則と GAS（`app-7`）の入れ直しが要ること）。

## 端の場合

- 不正な入力:
  - 入学年度の欄: 空・ちがう数字・`２０２６`（全角）・前後の空白 → 全角と空白は直して比べる。合わなければ「消す」を押せない。
  - 生徒 ID の形がちがう台帳の行 → どの学年にも入れない（消さない）。
  - `removed/<sid>` の形がちがう（`removedAt` が数でない）→ 消してある、と見なさない。
  - 記録の `fileId` が文字でない・空 → とばす。
  - `trashStudentFiles`: 21 個以上・0 個・形のちがう ID・生徒の役割 → `bad`／`denied`。
- 重複と境界:
  - `removedAt + 30 日` ちょうど → すぎた（もどせない）。1 ミリ秒前 → もどせる。
  - 同じファイル ID が 2 つの欄にある → 1 回だけ消す。
  - 学年の中に、消してある人・使用中の人・30 日をすぎた人がまざる → 状態は `purging`。もどせる人だけ「もどす」、使用中の人だけ「消す」、すぎた人だけ完全に消す。
  - アカウントをまだ発行していない生徒（`uid` なし）→ 消す・もどす・完全に消す、のどれも通る。
  - 完全に消している途中で止める → もう一度で続きから。2 回目に同じ授業を通っても失敗しない（もう無いファイルは `missing`）。
  - 生徒が 0 人の学年・クラスに入っていない生徒 → 授業を通らず、生徒の後片付けだけ行う。
  - 消してある生徒を「出し直す」（名簿の画面）→ `removed/<sid>` が消え、使用中にもどる。
  - 2 つの学年が同時に `purging` → 新しい学年から 1 つずつ。
- 違反や失敗の見せ方:
  - 写真・PDF を消せない → その授業の記録を消さずに止め、上の文を出す（だまって記録だけ消さない）。
  - 規則が古い（`denied`）→ 上の文を出す。
  - 消してある生徒は、名簿に印を出す。30 日をすぎた学年は、クラスの画面に知らせを出す。

## テスト（`node:test`。今あるテストのにせ物の作り方に合わせる）

- `tests/graduate-logic.test.js`: 上の全部の関数。30 日の境界、まざった学年、全角の数字、重複のファイル ID。
- `tests/graduate-flow.test.js`: 消す・もどす（30 日をすぎた人はもどさない）・完全に消す（順番: ファイル → 記録 → 生徒 → `removed`）、ファイルの失敗で記録を消さない、`skipped` で止まる、`missing` は進む、止める、2 回目で同じ結果、`uid` なし、クラスに入っていない生徒、進み具合。
- `tests/repo.test.js`（今あるものに足す）: 新しい関数が書く場所（上のパスを 1 つずつ）。`purgeStudent` が `removed` を最後に別の 1 回で消すこと。`linkAccount` が `removed` を消すこと。
- `tests/files.test.js`・`tests/demo-gas.test.js`（今あるものに足す）: `trashStudents`（空・数・取り置き）、練習モードの `trashStudentFiles`（消してよい生徒でないファイルは `skipped`）。
- GAS のテストが今あれば（`gas/Code.gs` を読むテスト）、`trashStudentFiles_` を同じやり方で足す。
- 規則のテストが今あれば（`rules.json` を読むテスト・規則を動かすにせ物）、上の規則を足す。`tests/rules-probe.test.js` に新しい確認を足す。
- 画面のテスト（新しい `tests/graduate-screen.test.js`）: 3 つの状態の表示、入学年度の入力で「消す」が押せる・押せない、もどす、開いたときに完全に消し始める、止める、4 つの失敗の文、通信中にボタンが押せない。クラスの画面の知らせ、名簿の印。
- `tests/router.test.js`: 新しい道すじ。
- `tests/session.test.js`（`main.js` を見ているテスト）: `none` で取り置きを消す。
- 今あるテストが通ること。`npm test` がすべて成功すること（ファイルの読みこみの失敗が出たら、`node --test --test-concurrency=1 "tests/*.test.js"` でも確かめ、両方の結果を報告する）。

## 守ること

- `git add`・`git commit` はしない。パッケージを足さない。
- 自動で消す仕組み（日付だけで、先生がこの画面を開かずに消える）を作らない。
- 先生の授業・資料・クラス・単元を消さない。
- 生徒の名前・パスワード・トークンを、コード・テスト・記録に書かない。
- `relay/`・`check.html`・生徒の画面（`js/views/student-*.js`）は変えない。
- このフォルダの外は読まない・変えない。

## 報告

変更したファイル、テストの結果、指示書と違う点・自分で決めた点・確かめられなかった点（とくに、今の規則で先生が消せなかった場所があれば）を、日本語の Markdown で報告する。
