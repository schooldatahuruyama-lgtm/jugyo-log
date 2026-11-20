# Codex 実装報告

## 変更したファイル

- `js/rika-link.js`：`rikaProgressUrl` を追加。入力を検証し、既存のクエリを残してクラス別URLを生成します。
- `js/views/teacher-classes.js`：「進み具合を見る」を追加。単元取得に失敗しても表示します。
- `README.md`：リンクの用途と、先生としてログインしたブラウザで開く説明を追加しました。
- `tests/rika-link.test.js`：URL生成・不正入力・クエリ保持などのテストを追加しました。
- `tests/class-unit-screen.test.js`：クラス別リンク・属性・取得失敗時・非表示条件を検証しました。

## テスト結果

- **並列数1での全件実行：1663件すべて成功。**
  `node --test --test-concurrency=1 --test-reporter=tap "tests/*.test.js"`
- **`npm test` 最終実行：1647件中1646件成功、1件失敗。**
- `git diff --check`：成功。

最終実行の失敗出力：

```text
test at tests\record-flow.test.js:1:1
✖ tests\record-flow.test.js (907.796ms)
  'test failed'
```

## 指示書と違う点・判断したこと・残った問題

- 既存CSSの高さ44px以上・折り返しを利用し、CSSは変更していません。幅375pxでの実ブラウザ表示は未確認です。
- 通常の `npm test` は実行ごとに異なる既存ファイルで失敗し、ファイル読み込みエラーも発生しました。原因は未確定です。並列数1では全件成功しています。
- 理科クエスト側での実際の画面遷移は未確認です。
- 指定外のファイル変更、gitの状態を変える操作、パッケージ追加は行っていません。