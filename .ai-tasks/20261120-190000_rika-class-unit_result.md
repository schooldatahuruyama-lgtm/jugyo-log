# Codex 実装報告

## 変更したファイル

| ファイル | 変更内容 |
|---|---|
| `js/rika-units.js`（新規） | 20単元の一覧、検索・表示名・入力検証を追加。 |
| `js/repo.js` | クラス別単元の取得・一覧取得・保存・解除を追加。 |
| `js/views/teacher-classes.js` | 単元の表示・選択・保存、読みこみと保存の失敗表示を追加。 |
| `js/views/student-home.js` | カードに現在の単元を表示。年度切りかえ前の応答は破棄。 |
| `css/app.css` | 行の折り返し、選択欄の幅、44px以上のボタンを整備。 |
| `docs/setup/rules.json` | 指定の `classUnit` 規則だけを追加。既存規則は変更なし。 |
| `js/rules-probe.js` | 末尾に11項目を追加して139項目に変更。片付け処理も追加。 |
| `tests/rika-units.test.js`（新規） | 単元一覧と不正値・文字数境界を検証。 |
| `tests/repo.test.js` | 取得・保存・解除、不正入力時の書きこみ防止を検証。 |
| `tests/rules-shape.test.js` | 読み書きの権限と値の検証を追加。 |
| `tests/rules-probe.test.js` | 139項目の順序、誤った規則の検出、片付けを検証。 |
| `tests/class-unit-screen.test.js`（新規） | 先生・生徒の表示、操作、失敗、年度切りかえを検証。 |
| `README.md` | 使い方と追加した11項目を記載。 |
| `docs/setup/firebase.md` | 規則更新の説明と139項目への変更。 |
| `docs/setup/ai-summary.md` | 確認項目数を139に変更。 |

## テスト結果

- 関連テスト：**433件すべて成功**。
- 全テストの直列実行：**1634件すべて成功**。
  - コマンド：`node --test --test-concurrency=1 "tests/*.test.js"`
- `git diff --check`：成功。
- 通常の `npm test`：繰り返しファイル参照エラーが発生。最後の通常実行は1604件中1601件成功、3件失敗。

通常実行の失敗出力（抜粋）：

```text
Error: UNKNOWN: unknown error, lstat 'C:\Users\yan12\Documents\keita\AI開発\授業ログアプリ\tests\check-logic.test.js'
Error: UNKNOWN: unknown error, lstat 'C:\Users\yan12\Documents\keita\AI開発\授業ログアプリ\tests\check-page.test.js'
Error: UNKNOWN: unknown error, lstat 'C:\'
```

## 指示書と違う点・判断したこと・残った問題

- `repo.js` にクラス削除処理がないため、削除処理への追加はありません。
- 既存の画面内 `openForm` を拡張しました。
- 規則確認の既存番号は変更せず、129〜139番に追加しました。
- 片付け時、確認用生徒が通常のクラスに所属していても、そのクラスの単元は消さないようにしました。
- 通常の `npm test` のファイル参照エラーは原因未特定です。直列実行では全件成功しています。
- 本番Firebase、幅375pxの実ブラウザ表示、別アプリとの接続動作は未確認です。
- 指定外ファイルの変更、パッケージ追加、Gitの状態を変える操作は行っていません。