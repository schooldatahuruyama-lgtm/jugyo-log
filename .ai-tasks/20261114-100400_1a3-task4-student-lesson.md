# 実装指示書: 段階 1a-3 Task 4

あなた（Codex）は、この指示書に沿ってコードを書きます。進め方は `AGENTS.md` の「実装を頼まれたとき」のとおりです。

- 計画: `docs/superpowers/plans/2026-11-14-jugyo-log-stage1a-3.md` の Task 4（下に、そのまま写してあります）
- 設計: `docs/superpowers/specs/2026-11-12-jugyo-log-design.md`（7.2・7.3・8 章）、`docs/superpowers/specs/2026-11-13-jugyo-log-1a-data.md`（データの形）
- 目的: 要件定義書（`docs/requirements.md`）の「自由メモ」「共通の振り返り」「過去の授業の閲覧」「保存に失敗した場合の設計案」を、生徒の画面として作る。
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

## 端の場合

- 不正な入力: ハッシュの ID の授業が無い・読めない（`denied`）ときは「この授業は見つかりません。」と「一覧へ」。記録の欄は `normalizeRecord` でそろえてから出す。2000 文字をこえる入力は `maxlength` で止め、貼り付けでこえた分は `normalizeRecord` で切る（切ったあとの文字を欄に戻す）。形のおかしい資料（`materialList` が落とすもの）は出さない。
- 重複と境界: 2000 文字ちょうどまで書ける。残り 200 文字から数を出し、0 で「これ以上は書けません」。理解度の同じボタンをもう一度押しても、外れず、保存もしない。前と同じ内容では保存しない。「一覧へ」を続けて押しても、確かめは 1 回（今ある leave guard の動き）。資料が 0 件なら「先生の資料は、まだありません。」。画像が 13 個以上でも、`loadImages` に全部渡す（中で分ける）。
- 違反や失敗の見せ方: 保存の状態を上部に文字で出す（「保存中…」「保存しました」「保存できませんでした。もう一度ためしています…」「保存できませんでした」と「もう一度」）。通信が切れている間は「接続が切れています」。この iPad に下書きを残せなかった（`drafts.put` が `false`）ときは、「この iPad に下書きを残せません。保存しましたと出るまで、このページを閉じないでください。」と 1 回出す。読めなかった資料には「読みこめませんでした」と「もう一度」。保存できないまま離れるときは、確かめのダイアログを出す。

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

## 前のタスクから引きつぐこと

- `ctx.thumbs` は `{ load(lesson), clear() }`、`ctx.drafts` は `createDrafts` の戻り値、`ctx.timers` は `{ setTimeout, clearTimeout }`（`js/main.js` に入っている）。
- `js/main.js`・`js/views/student-home.js`・`js/record-flow.js`・`js/thumb-store.js` は、いま別の修正の作業中。**このタスクでは読むだけにして、変えない。**
- 一覧のタイルの見た目は `css/app.css` の `.lesson-tile…` にある。授業ページの見た目は、その下に足す。
