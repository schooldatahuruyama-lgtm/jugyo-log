# 実装指示書（修正 1）: オフラインでの記録 — レビュー round 1 の指摘 5 件と、確認で見つけた 1 件

あなた（Codex）は、この指示書に沿ってコードを直します。進め方は `AGENTS.md` の「実装を頼まれたとき」のとおりです。もとの指示書は `.ai-tasks/20261121-140000_offline-record.md`、レビューは `.ai-review/20261121-110823_round1.md`。

## 変える内容

### 指摘 1（High）: 取り置きで開いた授業の下書きが、新しいサーバーの記録を上書きする（`js/views/student-lesson.js`）

- 授業を読みこんだとき、記録が取り置きから来たか（読みこみの直後に `ctx.offline?.down` が真）を覚える。
- 取り置きから来た場合、**最初に送る前に 1 回だけ**、`ctx.liveRepo.getRecord(classId, lessonId, studentId)` で今のサーバーの記録を読む（`createRecordSaver` に渡している `save` の中、`ctx.recordQueue.run` の中で行う）。
  - 読めなかった（通信の失敗など）→ 送らずに失敗にする（今のやり直しと下書きの仕組みにまかせる）。次に送るときに、また確かめる。
  - サーバーの `updatedAt` が、送ろうとしている `editedAt` より新しい → **送らない**。下書きを消し、画面の記録をサーバーのものに入れかえ（`record`・`updatedAt`・`syncRecord()`）、`toast('ほかの端末で書いた新しい記録があったので、そちらを出しています。')` を出す。保存の状態は「保存しました」にせず、何も出さない状態（`idle`）にもどす。やり方は `js/record-saver.js` を読んで決める（必要なら `record-saver.js` に小さい変更をしてよい。今あるテストは通すこと）。
  - それ以外 → 今までどおり送る。確かめ終わったら、もう確かめない。
- 取り置きでない（ネットで読めた）ときは、今までと同じ（確かめない）。

### 指摘 2（Medium）: 一覧からの送り直しが、取り置きを消す処理を通らない（`js/main.js`）

- `liveRepo` を、「読むのは `backend.net`（取り置きを使わない）、書くのは `offlineNet`（書いた場所の取り置きを消す）」の net から作る。`getPublic`・`serverTimestamp` はそのまま。`resolveSession` に渡すのも、この `liveRepo` でよい（読むだけなので）。

### 指摘 3（Medium）: おそい読み取りの返事が、消した取り置きを生き返らせる（`js/offline-net.js`・`js/main.js`）

- `createOfflineNet` に `generation`（今のログインの世代を返す関数。省略したら、いつも 0）を足す。`main.js` は `sessionEpoch` を返す関数を渡す。
- `offline-net.js` の中に、書きこみの世代（数）を持つ。`set`・`update`・`remove` を **始めたとき** と **成功したとき** に 1 ずつ進める。
- `get` は、始めたときの scope・ログインの世代・書きこみの世代を覚え、終わったときに 3 つとも同じときだけ、取り置きに書く。取り置きから返すのは、scope とログインの世代が同じときだけ。
- `write` のあとの取り置きの削除も、scope とログインの世代が同じときだけ行う。

### 指摘 4（Medium）: 保存のすぐ後に画面を離れると、その授業が電波なしで開けなくなる（新しい `js/offline-refresh.js`・`js/main.js`・`js/views/student-lesson.js`・`js/views/student-home.js`）

- `export function createOfflineRefresh({ repo, setTimeout, clearTimeout, delayMs })` を作る。
  - `touch(classId, lessonId, studentId)`: `delayMs` 待ってから `repo.getRecord(classId, lessonId, studentId)` を 1 回呼ぶ（結果は使わない。失敗は無視）。同じ授業・同じ生徒で、待っている間にまた呼ばれたら、1 回にまとめる（タイマーを取り直す）。ちがう授業は、べつべつに待つ。
  - `clear()`: 待っているものを全部やめる。
- `main.js`: `ctx.offline` に `touch` を足す（`repo` は取り置きを使う方の `repo`、`delayMs` は `CONFIG.offline.rereadMs`）。`signOutAll` で `clear()` を呼ぶ。
- `student-lesson.js`: 保存のあとの読み直しを、画面のタイマーではなく `ctx.offline?.touch(classId, lessonId, studentId)` にする（画面を離れても止めない）。画面の中の `rereadTimer` は消す。
- `student-home.js`: 送り直しで 1 件でも送れたら、送れた授業について `ctx.offline?.touch` を呼ぶ。そのために `resendDrafts`・`resendInkDrafts`（`js/record-flow.js`・`js/ink-flow.js`）の戻り値に、送れた授業の一覧 `sentLessons: [{ classId, lessonId }]` を足す（今ある `sent`・`kept`・`dropped` は変えない）。

### 指摘 5（Medium）: 新旧の Service Worker が同じキャッシュに書く（`sw.js`）

- キャッシュ名を、版ごとにする: `` `jugyolog-app-${版}` ``。版は、自分のアドレス（`self.location.search`）の `v` から取る。無い・空のときは `dev`。使える文字は英数字・`.`・`_`・`-` だけにし、それ以外は `-` に置きかえる。
- `install`・`fetch` は、自分の版のキャッシュだけを読み書きする。
- `activate`: `jugyolog-app-` で始まる、自分の版でないキャッシュを全部消す（一覧が取れたかどうかに関係なく）。自分の版のキャッシュの、一覧に無いものを消す処理は、今のまま。

### 確認で見つけた 1 件: 電波なしで開いた授業で、用語と先生の返事が「読みこめませんでした」になる（`js/offline-warm.js`）

- `warmLessons` で、授業ごとに `repo.getLesson`・`repo.getRecord` に続けて、`repo.getMyLessonTerms(studentId, classId, lessonId)` と `repo.getReply(classId, lessonId, studentId)` も呼ぶ（1 つずつ順に。どれかが失敗したら、そこでやめる）。`repo` にその関数が無いときは、とばす。

## 端の場合

- 不正な入力: サーバーの記録が無い（null）・`updatedAt` が数でない → 新しい記録は無いものとして、送る。`v` に使えない文字（`../` など）→ `-` に置きかえる。
- 重複と境界:
  - 取り置き 10・下書き 20・サーバー 30 → 送らない。サーバーの 30 が画面に出て、下書きは消える。
  - 取り置き 10・下書き 20・サーバー 10 → 送る。
  - 取り置き 10・電波なしで今書いた（`editedAt` は今）・サーバー 30（今より前）→ 送る（あとから書いた方を残す）。
  - `editedAt` とサーバーの `updatedAt` が同じ → 送る。
  - 読み取りを始める → 同じ場所に書いて成功 → 読み取りの古い返事が届く、の順 → 取り置きに入らない。
  - 読み取りを始める → ログアウト → 同じ uid でログイン → 古い返事が届く → 取り置きに入らない。
  - `touch` を同じ授業で 3 回続けて呼ぶ → 読むのは 1 回。画面を離れても読む。`clear()` のあとは読まない。
  - 新しい版の install のあとに、古い版の Service Worker のおそい取得が終わる → 新しい版のキャッシュは変わらない。
- 違反や失敗の見せ方: サーバーの方が新しくて送らなかったときは、上の toast を出す（だまって消さない）。ほかは変えない。

## テスト

- 上の「重複と境界」の全部に、テストを 1 つずつ（`tests/reply-screen.test.js`・`tests/offline-net.test.js`・`tests/sw.test.js`・新しい `tests/offline-refresh.test.js`・`tests/offline-warm.test.js`・`tests/record-flow.test.js`・`tests/ink-flow.test.js` など、今あるファイルに合わせる）。
- `main.js` の `liveRepo` の作り（読むのは生、書くのは取り置きを消す方）は、今ある `main.js` の調べ方（文字を見るテストがあればそれ）に合わせて確かめる。
- 今あるテストが通ること。`npm test` がすべて成功すること（ファイルの読みこみの失敗が出たら、`node --test --test-concurrency=1 "tests/*.test.js"` でも確かめ、両方の結果を報告する）。

## 守ること

- `git add`・`git commit` はしない。パッケージを足さない。
- 変えてよいのは、上に書いたファイルとそのテスト、README（文が変わるときだけ）。先生の画面・`check.html`・規則・`gas/`・`relay/` は変えない。
- このフォルダの外は読まない・変えない。

## 報告

変更したファイル、テストの結果、指示書と違う点・自分で決めた点・確かめられなかった点を、日本語の Markdown で報告する。
