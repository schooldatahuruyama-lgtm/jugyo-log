# 実装指示書: 段階 1a-3 Task 2 の修正 1（送り直しと下書きの食い違い、小さい画像の取り置きの消去）

あなた（Codex）は、この指示書に沿ってコードを直します。進め方は `AGENTS.md` の「実装を頼まれたとき」のとおりです。

## 目的

Codex レビュー `.ai-review/20261114-100828_round1.md` の指摘 1（High）と 2（Medium）を直す。あわせて、Task 3 の確認で Claude Code が見つけた 2 点（下の 3・4）を直す。もとの計画は `docs/superpowers/plans/2026-11-14-jugyo-log-stage1a-3.md`。

## 変えるファイル

`js/record-flow.js`、`tests/record-flow.test.js`、`js/thumb-store.js`、`tests/thumb-store.test.js`、`js/main.js`、`js/views/student-home.js`。ほかのファイルは変えない。

### 1. `js/record-flow.js` の `resendDrafts`（指摘 1）

送り直している間に、生徒が同じ授業を開いて書き足すと、下書きが新しくなる。古い内容の送信が終わったときに、その新しい下書きを消してはいけない。

- 1 件ごとに、`repo.getRecord` のあと（送る直前）に `drafts.get(studentId, classId, lessonId)` を読み直す。無い、または `editedAt` が一覧のときと違えば、**送らず・消さず**に次へ進む（`kept` に数える）。
- `repo.saveRecord` のあと（消す直前）にも読み直す。`editedAt` が一覧のときと同じときだけ `drafts.remove` する。違えば消さない（送ったので `sent` に数える）。
- サーバーのほうが新しくて下書きを捨てる分岐でも、消す直前に読み直し、`editedAt` が同じときだけ消す。違えば消さずに `kept`。

### 2. `js/thumb-store.js`（指摘 2）

- `createThumbStore` の戻り値に `clear() → void` を足す。呼ぶと、世代の番号を進め、待っている読みこみの表（`pending`）を空にする。
- `clear()` の前に始まった読みこみは、応答が届いても `cache.put` をしない（読んだ画像は、そのまま呼んだ側へ返してよい）。
- `clear()` のあとに始まった読みこみは、今までどおり取り置く。

### 3. `js/main.js`

- 今の `pendingThumbs`・`clearing`・`thumbs` の包み（`load` を包んで待つ仕組み）をやめ、`ctx.thumbs` には `createThumbStore` の戻り値をそのまま渡す。
- `signOutAll` は、`thumbs.clear()` → `files.clearCache()` → `drafts.clear()` → `auth.signOut()` の順。前の 3 つは、それぞれ失敗してもログアウトを続ける。読みこみ中の通信が終わるのを待たない（電波が悪いときに、ログアウトが長く止まらないように）。

### 4. `js/views/student-home.js`

- タイルの印（「記録あり」「振り返りがまだ」）は、印（`marks`）を読めていれば出す。単元（`units`）を読めたかどうかと結び付けない（今は `marks !== null && unitsReady` になっている）。
- 画面を離れるとき（授業を開く・パスワードの画面へ・クラスの切りかえ）と、ログアウトのときに、下書きの送り直し（`resending`）が終わるのを**待たない**。1 の直しで、送り直しと授業のページの書き足しが重なっても、下書きは消えなくなるため。電波が無いときに、タイルを押してから授業が開くまで長く待たされないようにする。
  - 離れたあとに届いた送り直しの結果で、画面を書きかえない（今ある `alive`・`leaving` の確かめはそのまま使う）。
  - `load()` の先頭の「送り直しが終わるのを待つ」は、そのままでよい。

## 端の場合

- 不正な入力: 読み直した下書きが `null`（消された・こわれた）ときは、送らず・消さずに `kept`。取り置きの中身がおかしいときの扱いは、今のまま。
- 重複と境界: `editedAt` が同じなら「変わっていない」とする（中身は比べない）。`clear()` を続けて 2 回呼んでも落ちない。`clear()` のあと、同じ授業をもう一度頼まれたら、新しく読む（古い読みこみの Promise を使い回さない）。
- 違反や失敗の見せ方: 送れなかった・残した下書きは `kept` の数で返し、一覧の「まだ保存できていない記録が N 件あります。」とタイルの「まだ保存できていません」で見せる（今ある表示）。黙って消さない。

## 追加・変更するテスト

- `tests/record-flow.test.js`:
  - `getRecord` を待っている間に、同じ授業の下書きが新しい `editedAt` で置きかわる → `saveRecord` を呼ばない、下書きは新しいまま残る、`kept` が 1。
  - `saveRecord` を待っている間に、下書きが置きかわる → 下書きは新しいまま残る、`sent` が 1。
  - サーバーのほうが新しい分岐で、`getRecord` を待っている間に下書きが置きかわる → 消さない、`kept` が 1。
  - 今あるテスト（変わらなければ送って消す・捨てる）が通る。
- `tests/thumb-store.test.js`:
  - `getThumbs` を待っている間に `clear()` → 応答が届いても `cache.put` が呼ばれない。`load` の結果は読んだ画像。
  - `clear()` のあとの `load` は、`getThumbs` を呼び直し、`cache.put` する。

## 守ること

- `git add`・`git commit` はしない。
- データベースの形と規則は変えない。

## 完了の条件

- `npm test` がすべて成功する。変えた `.js` は `node --check` で構文を確かめる。

## 報告

変更したファイル、テストの結果、指示書と違う点を、日本語の Markdown で報告する。
