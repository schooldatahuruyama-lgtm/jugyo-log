# 実装指示書（修正 1）: 卒業後の削除と復元 — レビュー round 1 の指摘 3 件と、実装の報告で分かった 1 件

あなた（Codex）は、この指示書に沿ってコードを直します。進め方は `AGENTS.md` の「実装を頼まれたとき」のとおりです。もとの指示書は `.ai-tasks/20261121-190000_graduate-removal.md`、レビューは `.ai-review/20261121-131000_round1.md`。

## 変える内容

### 指摘 1（High）: Drive でファイルを確かめられなかったのに、記録を消してしまう

- `gas/Code.gs` の `trashStudentFiles_`: `findStudentFile_` を使わず、この中でファイルを 1 つずつ調べる。
  - `DriveApp.getFileById` が投げた → 0.5 秒待って、もう 1 回だけ試す。それでも投げた → **`unknown`**（確かめられなかった。消さない）。
  - 取れた: ゴミ箱に入っている・生徒のフォルダの中でない・説明の形がちがう → `missing`（生徒のファイルとして、もう無いと確かめられた）。
  - 持ち主が「消してよい生徒」でない → `skipped`（今までどおり）。
  - それ以外 → `setTrashed(true)` して `trashed`。`setTrashed` が投げた → `unknown`。
  - 戻り値に `unknown: 数` を足す。
- 練習モードの GAS・`files.trashStudents` も `unknown` を返す（練習モードではいつも 0。`files.trashStudents` は、GAS が `unknown` を返さない古い版なら 0 として扱う）。
- `js/graduate-flow.js` の `purgeCohort`: 引数 `allowUnknown`（既定は false）を足す。`unknown` が 1 つでもあり、`allowUnknown` が false なら、**その授業の記録を消さずに** `code: 'unknown-files'`（`count` に個数）のエラーで止める。`allowUnknown` が true なら進める（戻り値に `unknownFiles: 数` を足す）。
- `js/views/teacher-graduates.js`: `unknown-files` で止まったときの文: 「Drive で確かめられなかったファイルが ○ 個あったので、止めました。時間をおいて『続きから消す』を押してください。」。ボタンは「続きから消す」と「確かめられないファイルをとばして続ける」。後ろの方は、`confirmDialog`（danger）で「とばしたファイルは、先生の Google ドライブの『授業ログ_生徒』のフォルダに残ることがあります。記録の方は消えるので、アプリからはたどれなくなります。」とたずね、はいのときだけ `allowUnknown: true` で続ける。終わったあとの toast に、とばした数があれば足す（「…完全に消しました。確かめられなかったファイル ○ 個は、とばしました。」）。

### 指摘 2（High）: 名簿から外した生徒の、前のクラスの記録が残る

- `js/repo.js` に `listRecordIds(classId, lessonId)`（`records/<c>/<l>` を `shallow` で読み、生徒 ID の配列を返す）を足す。
- `purgeCohort` の、クラスの集め方を変える:
  1. `repo.listClasses()` のうち、`year` が入学年度（`cohort.year`）以上のクラス全部を調べる（`year` が 0 など、それより小さいクラスは調べない。規則の確認用のクラスも入らない）。
  2. クラスごとに `repo.listLessons`。授業ごとに `repo.listRecordIds` を読み、対象の生徒の ID があるかを見る。
  3. 「かかわるクラス」= 対象の生徒が今の名簿（`memberOf`）にいるクラス、または、どれかの授業に対象の生徒の記録があるクラス。
  4. かかわるクラスの**全部の授業**で、今までどおり（記録を読む → ファイルを消す → `purgeLessonRecords`）。`purgeLessonRecords` に渡す生徒は、対象の生徒の全員（そのクラスの名簿にいなくても。先生の返事・印だけ残っていることがあるため）。ただし、対象の生徒の記録が 1 つも無い授業では、`listRecords` を読まずに `purgeLessonRecords` だけ呼ぶ。
  5. かかわらないクラスには、何も書かない。
- 進み具合の「授業 ○ / ○」は、かかわるクラスの授業の数。調べている間は、画面に「記録をさがしています…（クラス ○ / ○）」と出す（`onProgress` に `phase: 'scan' | 'lessons' | 'students'` と `doneClasses`・`totalClasses` を足す）。

### 指摘 3（High）: 完全に消している途中の生徒を、出し直しでもどせてしまう

- データ: 完全に消し始める前に、対象の生徒の `removed/<sid>/purging` に `true` を書く（1 回のルート update で全員。`repo.markPurging(ids)`）。`purgeCohort` は、いちばん最初（クラスを調べる前）にこれを行う。
- `js/graduate-logic.js`: `repo.listRemoved` と `cohorts` は `purging` を読む。`purging` が true の生徒は、30 日の前でも「すぎた」側（`purgeable`）に入れ、`restorable` に入れない。
- `docs/setup/rules.json`:
  - `removed/$sid` に `purging` を足す（`.validate`: `newData.val() === true`）。
  - `removed/$sid` の `.validate` に、「`purging` が付いたら外せない」を足す: `(!data.child('purging').exists() || newData.child('purging').val() === true)`（丸ごと消す＝ `newData` が無いときは `.validate` が動かないので、最後の片付けは通る）。
  - `accounts/$uid` の `.validate` を、`newData.isString() && !root.child('removed').child(newData.val()).child('purging').exists()` にする（完全に消している途中の生徒に、アカウントを結びつけられない＝もどす・出し直すが規則で断られる）。
- `js/repo.js`: `restoreStudents` と `linkAccount` は今のまま（規則が断る）。ただし `purgeStudent` が最後に `removed/<sid>` を消す所は今のまま。
- 名簿の画面（`js/views/teacher-roster.js`）: `purging` の生徒は、印を「完全に消している途中」にし、出し直しのボタン（今ある発行・出し直しの操作）を押せなくする。押せない理由を近くに出す（「完全に消している途中の生徒は、出し直せません。」）。
- `js/rules-probe.js` に足す: `purging` を付けたあと、先生が `accounts/<uid>` にその生徒を結びつける → `denied`。先生が `purging` を外す（`removed/<sid>` を `purging` なしで書き直す）→ `denied`。先生が `removed/<sid>` を丸ごと消す → `ok`（後片付けをかねる）。

### 実装の報告で分かった 1 件: 消してある生徒が、理科クエストの自分の記録を読める

- `docs/setup/rules.json` の `rika/state/$uid` と `rika/log/$uid` の `.read` を、`auth != null && auth.uid === $uid && (root.child('teacherList').child(auth.uid).val() === true || root.child('accounts').child(auth.uid).isString())` にする（書く側と同じ条件。先生と、対応のある生徒だけ）。
- `js/rules-probe.js` に足す: 消してある生徒が `rika/state/<自分の uid>` を読む → `denied`。使用中の生徒は `ok`（今ある確認があれば、それでよい）。
- README の「消した直後も理科クエストの記録は読める」という文があれば直す。GAS の本人確認が最大 60 秒残ることは、README に残す（変えない）。

## 端の場合

- 不正な入力: GAS の返事に `unknown` が無い・数でない → 0 として扱う。`purging` が true 以外 → 付いていないものとして扱う。
- 重複と境界:
  - `getFileById` が 1 回目だけ投げる → 2 回目の結果を使う。
  - ゴミ箱に入っているファイル → `missing`（進む）。
  - 名簿から外した生徒: 前のクラスの記録・ファイル・先生の返事が消える。そのクラスの名簿（`members`）には、もともといないので、何も起きない。
  - 入学年度より前の年度のクラス・年度 0 のクラス → 調べない・書かない。
  - 対象の生徒がかかわらないクラス → 書きこみ 0 回。
  - 完全に消している途中（`purging`）で止める → 名簿で出し直せない。「もどす」も出ない。次に開くと続きから。
  - 30 日の前でも、`purging` が付いていれば、もどせない。
  - `markPurging` を 2 回呼ぶ → 同じ結果。
- 違反や失敗の見せ方: `unknown-files` は、上の文と 2 つのボタン。とばすのは、先生が確かめの画面で「はい」と答えたときだけ。規則に断られた出し直しは、名簿でボタンを押せなくして理由を出す（通信で断られた場合は、今ある失敗の出し方のまま）。

## テスト

- 上の「重複と境界」の全部に、テストを 1 つずつ（`tests/gas-app.test.js`・`tests/demo-gas.test.js`・`tests/files.test.js`・`tests/graduate-flow.test.js`・`tests/graduate-logic.test.js`・`tests/graduate-screen.test.js`・`tests/repo.test.js`・`tests/rules-shape.test.js`・`tests/rules-probe.test.js`）。
- 今あるテストが通ること。`npm test` がすべて成功すること（ファイルの読みこみの失敗が出たら、`node --test --test-concurrency=1 "tests/*.test.js"` でも確かめ、両方の結果を報告する）。

## 守ること

- `git add`・`git commit` はしない。パッケージを足さない。
- 先生の授業・資料・クラス・単元を消さない。生徒の画面（`js/views/student-*.js`）・`relay/`・`check.html` は変えない。
- このフォルダの外は読まない・変えない（理科クエストのフォルダもさわらない）。

## 報告

変更したファイル、テストの結果、指示書と違う点・自分で決めた点・確かめられなかった点を、日本語の Markdown で報告する。
