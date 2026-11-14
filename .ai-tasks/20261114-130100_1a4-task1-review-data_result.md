# Codex 実装報告

## 変更したファイル

- `js/review-logic.js`：記録の集計・並べ替え・コピー文・前後の生徒・初期授業の選択を追加。
- `tests/review-logic.test.js`：名簿外の記録、不正な値、並び順、コピー文などを検証。
- `js/repo.js`：1回の読み取りで全員の記録を取得する `listRecords` を追加。
- `tests/repo.test.js`：取得結果の整形、通信回数、書き込みなし、エラー伝達を検証。
- `js/router.js`：先生用の `t-review`・`t-record` を追加。
- `tests/router.test.js`：ルートの往復、権限、不正なIDの拒否を検証。
- `js/rules-probe.js`：先生の読み取り確認を2項目追加し、計46項目に変更。
- `tests/rules-probe.test.js`：追加項目の成功・拒否・通信失敗と実行順を検証。

## テスト結果

- テストを先に追加し、未実装による失敗を確認してから実装しました。
- `npm test`：**682件すべて成功、失敗0件**。
- `node --check`：変更した8ファイルすべて成功。
- `git diff --check`：問題なし。

## 指示書と違う点・判断したこと・残った問題

- 指定外のファイル変更、パッケージ追加、コミットは行っていません。ブラウザ確認は指示どおり未実施です。
- 既存の [getMembers](/C:/Users/yan12/Documents/keita/AI開発/授業ログアプリ/js/repo.js:326) は、出席番号が数値でない行を取得時に除外します。今回の `reviewPeople` はそのような行も保持しますが、取得処理の変更は指示範囲外のため行っていません。