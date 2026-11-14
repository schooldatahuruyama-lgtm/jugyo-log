# 実装指示書: 段階 1a-3 Task 2

あなた（Codex）は、この指示書に沿ってコードを書きます。進め方は `AGENTS.md` の「実装を頼まれたとき」のとおりです。

- 計画: `docs/superpowers/plans/2026-11-14-jugyo-log-stage1a-3.md` の Task 2（下に、そのまま写してあります）
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

- 不正な入力: `save` が `NetError` でない例外を投げても、通信の失敗と同じにやり直す。`saveDraft`・`removeDraft` が例外を投げても、保存は続ける。`retryMs` が空の配列なら、1 回の失敗で `'failed'`。取り置きの中身が JSON でない・`thumbs` がオブジェクトでないときは、無いものとして読み直す。`lesson.materials` が `null`・配列のときは、資料なしとして `{}`。
- 重複と境界: 送っている途中の `edit`・`flush`・`retry` で、通信が 2 本にならない。`dispose()` を 2 回呼んでも落ちない。`flush()` を続けて 2 回呼んでも、通信は必要な分だけ。同じ内容で `edit` が続いても、最後の 1 回だけ送る。下書きが 0 件の `resendDrafts` は、通信をせずに `{ sent: 0, kept: 0, dropped: 0 }`。同じ授業の小さい画像を同時に頼まれても、通信は 1 回。
- 違反や失敗の見せ方: このタスクに画面は無い。保存の成否は `state`（`'retrying'`・`'failed'`）と `onState` で伝える（黙って止まらない）。`flush`・`retry` は `true`・`false` を返す。`resendDrafts` は、送れなかった件数を `kept` で返す。`createThumbStore().load` の通信の失敗は、例外のまま投げる（タイルが灰色の枠を出す）。

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
