# 実装指示書: 資料が 1 つだけのとき、資料の下に「null」と出る不具合を直す

あなた（Codex）は、この指示書に沿ってコードを直します。進め方は `AGENTS.md` の「実装を頼まれたとき」のとおりです。

## 目的

Claude Code が、公開先の生徒の授業ページで見つけた不具合（2026-11-15）。先生の資料が **1 つだけ**の授業で、資料の下に「null」という文字が出る。

原因: `js/views/parts/material-pane.js` の `materialsArea.replaceChildren(frame, …, materials.length > 1 ? controls : null, messages)`。DOM の `replaceChildren` は、`null` を文字「null」として入れる。

（要件定義書 `docs/requirements.md` の「UI/UX 方針」。資料が 1 つのときは、めくる部品を出さない、という前の指示書の決まりを、正しく満たす。）

## 変えるファイル

`js/views/parts/material-pane.js` だけ。

- 資料が 1 つだけのとき、めくる部品（`controls`）を**入れない**（`null` を `replaceChildren`・`append` に渡さない）。たとえば、配列を作って `filter(Boolean)` してから広げる。
- 同じファイルの中に、`replaceChildren`・`append`・`prepend`・`before`・`after` へ `null`・`undefined`・`false` が渡りうる所がほかに無いかを調べ、あれば同じように直す（`el()` の子として渡す分は、`el()` が取り除くので、そのままでよい）。
- ほかの動きは変えない。

## 端の場合

- 不正な入力: 変えない。
- 重複と境界: 資料 0 個（「先生の資料は、まだありません。」）・1 個（めくる部品も「1 / 1」も無く、「null」も出ない）・2 個以上（めくる部品が出る）。
- 違反や失敗の見せ方: 変えない。

## 確かめ

- テストのファイルは足さない。`npm test` がすべて成功し、`node --check js/views/parts/material-pane.js` が通ること。
- 代役の `ctx` を使った手元の実行で、資料 1 個のときに、部品の中の文字に「null」「undefined」「false」が含まれないことを確かめ、報告に書く。

## 守ること

- `git add`・`git commit` はしない。ほかのファイルは変えない（`css/app.css`・`js/views/teacher-review.js` などは、別のタスクが作業中）。

## 報告

変更したファイル、テストの結果、指示書と違う点を、日本語の Markdown で報告する。
