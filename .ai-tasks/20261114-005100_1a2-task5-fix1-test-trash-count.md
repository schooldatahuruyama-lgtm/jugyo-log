# 実装指示書: 段階 1a-2 Task 5 のレビュー修正（テスト 1 件）

あなた（Codex）は、この指示書に沿ってテストを直します。進め方は `AGENTS.md` の「実装を頼まれたとき」のとおりです。

- レビュー: `.ai-review/20261113-230448_round1.md` の指摘 1
- 変えてよいファイル: `tests/material-flow.test.js` だけ。`js/material-flow.js` を含め、ほかのファイルは変えない（別の作業が進行中）。
- `git add`・`git commit` はしない。
- 完了の条件: `node --test tests/material-flow.test.js` がすべて成功する。

## 直すこと

`tests/material-flow.test.js` の「ほかの授業が同じファイルを指していれば `trash` を呼ばない」ことを確かめるテスト（96 行目あたりと 111 行目あたり）は、代役の `trash()` の中で `assert.fail()` を呼んでいる。しかし `removeMaterialFlow` は、片付けの失敗（例外）をつかまえて `{ trashed: false }` を返す作りなので、`trash()` がまちがって呼ばれても、テストが通ってしまう。

- 代役の `trash()` は、呼ばれた回数（と渡された `fileId`）を記録するだけにする。
- `await removeMaterialFlow(...)` のあとで、**呼ばれた回数が 0 回**であることを確かめる。
- 同じ形（代役の中の `assert.fail()` が、`removeMaterialFlow` や `addMaterialFlow` の `catch` に吸われうるもの）がこのファイルのほかの所にもあれば、同じように「あとで回数を確かめる」形に直す。
- 直したテストが、本当に失敗を見つけられることを確かめる: 一時的に `js/material-flow.js` の参照の確かめを外した状態を頭の中で追うのではなく、テストの中に「`fileRefs` が 0 件のときは `trash` が **1 回**呼ばれる」という対になるテストがあること（無ければ足す）で確かめる。`js/material-flow.js` は書きかえない。

## 報告

変更した内容とテストの結果を、日本語の Markdown で報告する。
