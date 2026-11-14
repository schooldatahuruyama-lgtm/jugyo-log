# 実装指示書: 先生の授業の編集（日付の枠のはみ出し、重要用語を右側に）

あなた（Codex）は、この指示書に沿ってコードを直します。進め方は `AGENTS.md` の「実装を頼まれたとき」のとおりです。

## 目的

先生が iPad の Safari で授業の編集の画面（`#/t/lesson/<c>/<l>`）を見て、2 つを指摘した（2026-11-15）。

1. 「日付」の枠が、「授業の情報」の枠の右にはみ出している（授業名・単元の枠より長い）。iPad の Safari は、`input[type=date]` に `width: 100%` を付けても、独自の見た目のせいで幅がそろわず、中の文字もまん中に寄る。
2. 「重要用語」の枠が「授業の情報」の下にある。**「授業の情報」の右側に並べる**。

（要件定義書 `docs/requirements.md` の「UI/UX 方針」。）

## 変えるファイル

`js/views/teacher-lesson.js`、`css/app.css`、`docs/design/design-board.html`（該当する説明があれば合わせる。無ければ変えない）。ほかのファイルは変えない。

### 1. 日付の枠（`css/app.css`）

- `input[type='date']`（`.inline-form` の中。今ある 1 行）に足す: `display: block; -webkit-appearance: none; appearance: none; min-width: 0; max-width: 100%; box-sizing: border-box; text-align: left;`。
- iPad の Safari で中の文字が左に寄るように、`input[type='date']::-webkit-date-and-time-value { text-align: left; }` を足す。
- 高さ（48px 以上）・線・角の丸み・文字は、授業名の枠（`input[type='text']`）と同じに見えるようにする。空のとき（新しい授業）にも高さがつぶれない（`min-height` は今のまま）。
- 「授業を作る」など、同じ `.inline-form` の日付の枠を使うほかの画面でも、同じ直しが効く（それでよい）。

### 2. 重要用語を右側に（`js/views/teacher-lesson.js`・`css/app.css`）

- 「授業の情報」の枠（`infoForm`）と「重要用語」の枠（`termsSection`）を、新しい入れ物 `div.lesson-edit-top` に入れる（順番は、情報 → 重要用語のまま。読み上げとキーボードの順も同じ）。「授業の資料」は、今までどおりその下に、横いっぱい。
- 幅 900px 以上: 2 列（`display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: var(--s-3); align-items: start;`）。左が「授業の情報」、右が「重要用語」。
- 幅 900px 未満（iPad の縦向き 820px など）: 1 列で、今までどおり上下に並ぶ。
- 2 つの枠は、列の幅いっぱいに広がる（`.inline-form` に幅の上限があれば、この入れ物の中では外す）。入れ物の中では、枠の下の余白が二重にならないようにする。
- 重要用語の枠の中身（用語の並び・入力欄・「＋ 足す」・候補・注意の文）と動きは変えない。列がせまくなっても、用語は折り返し、入力欄とボタンははみ出さない。

## 端の場合

- 不正な入力: 入力の扱いは変えない（日付の確かめ・用語の確かめは今のまま）。
- 重複と境界: 幅がちょうど 900px のときは 2 列。899px は 1 列。用語が 8 個あって右の枠が左より高くなっても、左の枠は引きのばさない（`align-items: start`）。長い用語（20 文字）や長いクラス名でも、横にはみ出さない。
- 違反や失敗の見せ方: 変えない（保存の失敗の文・用語の失敗の文は、今の場所に出る）。

## 確かめ

- テストのファイルは足さない。`npm test` がすべて成功し、変えた `.js` は `node --check` が通ること。
- 報告に、(1) 日付の枠に足した指定、(2) 2 列になる幅、(3) ほかの画面で `.inline-form` の日付の枠を使っている所の一覧、を書く。

## 守ること

- `git add`・`git commit` はしない。
- いま、別の変更（`.ai-tasks/20261115-210000_load-failure-and-new-version.md`）が `css/app.css` と `js/main.js` に入っている。その変更は消さない・直さない。
- 保存・資料・重要用語・離れるときの確かめの動きは変えない。ボタンは 44×44px 以上。

## 報告

変更したファイル、テストの結果、指示書と違う点・判断したことを、日本語の Markdown で報告する。
