# 実装指示書: 生徒の授業の画面 — 「先生の資料」と「自分の記録」の下の端をそろえる

あなた（Codex）は、この指示書に沿ってコードを直します。進め方は `AGENTS.md` の「実装を頼まれたとき」のとおりです。

## 目的

先生からの依頼（2026-11-20）。iPad の横向きで、左の「先生の資料」の枠が、右の「自分の記録」の枠より短く終わる。2 つの枠の下の端を同じ高さにそろえる。要件定義書（`docs/requirements.md`）の「UI/UX方針」（生徒の授業ページ）にあたる。

## 原因

`css/app.css` の `.student-lesson-columns` は `align-items: stretch` なので、本来は 2 つの枠が同じ高さになる。しかし `.student-lesson-teacher` に高さの上限と枠の中のスクロールがあり（`max-height: calc(100vh - 160px); max-height: calc(100dvh - 160px); overflow-y: auto; -webkit-overflow-scrolling: touch;`）、画面の低い iPad の横向きでは、左の枠だけがそこで止まる。

## 変える内容

### `css/app.css`

- `.student-lesson-teacher` の決まりから、次の 4 つを消す。ほかの指定（色の変数・背景）は残す。
  - `max-height: calc(100vh - 160px);`
  - `max-height: calc(100dvh - 160px);`
  - `overflow-y: auto;`
  - `-webkit-overflow-scrolling: touch;`
- `.student-lesson-columns` の `align-items: stretch` は、そのまま残す。
- この決まりの上のコメント（「生徒の授業。資料と記録を同じ幅で並べ、…」）に、「2 つの枠は同じ高さにする（枠の中ではスクロールしない）」ことを足す。
- ほかの決まりは変えない。

これで、横に 2 つ並ぶとき（横向き・幅 900px 以上）は、長いほうの枠に合わせて、もう一方の枠ものびる。短いほうの枠の下は、その枠の色のまま空く。1 列のとき（縦向き・せまい画面）は、それぞれの枠が中身の高さになる。先生が 1 人の記録を見る画面（`teacher-record.js`）も同じクラスを使っているので、同じ動きになる（それでよい）。

### `js/` のファイル

- 変えない。

## 端の場合

- 不正な入力: 入力は扱わない（見た目だけの変更）。
- 重複と境界:
  - 資料が 0 個・リンクが 0 個で、左の中身が短いとき → 左の枠は、右の枠の高さまでのびる。
  - 左の中身のほうが長いとき（リンクが 8 個など）→ 右の枠が、左の高さまでのびる。枠の中のスクロールは出ない。ページ全体がスクロールする。
  - 1 列のとき → 枠の高さはそろえない（上下に並ぶので）。
  - 「振り返り」と「先生からの返事」の枠は、今までどおり 2 列ぶんの幅で、上の段の下に出る。
- 違反や失敗の見せ方: 変えない。

## テスト

- 新しく `tests/lesson-columns-css.test.js` を作る（`node:test`。`css/app.css` を文字列で読む。読み方は `tests/picture-ink-screen.test.js` の `app.css` の読み方に合わせる）。
  - `.student-lesson-columns {` の決まりに `align-items: stretch` があること。
  - `.student-lesson-teacher {` の決まり（その 1 つのブロック）に、`max-height` と `overflow` が無いこと。
  - `.student-lesson-mine {` の決まりにも、`max-height` と `overflow` が無いこと。
- 今あるテストが、そのまま通ること。`npm test` がすべて成功すること。

## 守ること

- `git add`・`git commit` はしない。パッケージを足さない。
- 変えてよいのは `css/app.css` と、新しいテスト `tests/lesson-columns-css.test.js` だけ。
- このフォルダの外は読まない・変えない。

## 報告

変更したファイル、テストの結果、指示書と違う点・自分で決めた点・確かめられなかった点を、日本語の Markdown で報告する。
