# Codex 実装報告

## 変更したファイル

- `js/lesson-logic.js`：入力検証、並べ替え、資料一覧、共有ファイルの参照検索、日付処理を追加。
- `tests/lesson-logic.test.js`：上記処理のテスト10件を追加。
- `js/config.js`：指定された文字数・画像・PDF・GAS関連の定数を追加。
- `js/repo.js`：単元・授業・資料の読み書きと、記録の件数取得を追加。
- `tests/repo.test.js`：一括更新、資料の保持、共有参照、件数取得などのテストを追加。
- `js/net.js`：`get` の `shallow` オプションに対応。
- `tests/net.test.js`：通常時と認証更新後の `shallow` を検証。
- `js/dev/memory-net.js`：子のキーだけを返す読み出しに対応。
- `docs/setup/rules.json`：先生による `lessons` 全体の読み取りを許可。
- `tests/rules-shape.test.js`：追加した権限と既存規則の保持を検証。
- `docs/superpowers/specs/2026-11-13-jugyo-log-1a-data.md`：4章の指定行に読み取り権限を追記。

## テスト結果

- 実装前に、新しいテストが失敗することを確認済み。
- `npm test`：**387件成功、失敗0件**。
- `node --check`：作成・変更したJavaScript 9ファイルすべて成功。
- `git diff --check`：エラーなし。

## 指示書と違う点・判断したこと・残った問題

仕様からの変更、残った問題はありません。指示どおり、コミットとブラウザ確認は行っていません。

作業中に対象外のGAS関連ファイルにも差分があることを確認しましたが、本作業では編集していません。