# 実装指示書: 段階 1b-1 Task 2 の修正 1（`recThumbs` の親に、文字や数を直接書けないようにする）

あなた（Codex）は、この指示書に沿って直します。進め方は `AGENTS.md` の「実装を頼まれたとき」のとおりです。

## 目的

Codex レビュー `.ai-review/20261114-192403_round1.md` の指摘 1（Medium）を直す。

`docs/setup/rules.json` の `recThumbs/$classId/$lessonId/$sid` に型の検証が無いので、本人が、その場所に長い文字や数を直接書ける（子が無いので `$aid` の検証が働かず、20000 文字の上限をすりぬける）。

## 変えるファイル

`docs/setup/rules.json`、`tests/rules-shape.test.js`。ほかのファイルは変えない（`js/` はほかのタスクが作業中）。

- `recThumbs/$classId/$lessonId/$sid` に `".validate": "newData.hasChildren()"` を足す（子を持つ形だけを受けつける。消すこと（`null`）は、今までどおりできる）。
- ほかの規則は変えない。

## 端の場合

- 不正な入力: `$sid` の場所に、文字・数・真偽を直接書く → 規則が断る。
- 重複と境界: 最後の 1 つの小さい画像を消して、`$sid` の場所が空になるのは通る（消すときは検証されない）。`a1` に 20000 文字は通り、20001 文字は断る（今のまま）。
- 違反や失敗の見せ方: 規則が断ると、アプリには `denied` が返る（今ある表示のまま）。

## 追加・変更するテスト（`tests/rules-shape.test.js`）

- `rules.recThumbs.$classId.$lessonId.$sid['.validate']` が `newData.hasChildren()`。
- 今あるテストが通る。

## 守ること

- `git add`・`git commit` はしない。

## 完了の条件

- `npm test` で、自分の変更に関わるテストが成功する（ほかのタスクの作業中のテストが失敗していたら、関係ないことを確かめて報告に書く）。

## 報告

変更したファイル、テストの結果、指示書と違う点を、日本語の Markdown で報告する。
