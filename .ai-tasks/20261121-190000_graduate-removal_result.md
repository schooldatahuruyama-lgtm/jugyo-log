# Codex 実装報告

## 変更したファイル

| ファイル | 変更内容 |
|---|---|
| `js/config.js` | 復元期限 30 日・ファイル削除単位 20 件を追加。 |
| `js/graduate-logic.js` | 学年分類、期限判定、年度入力の照合、ファイル ID 抽出を追加。 |
| `js/graduate-flow.js` | 削除・復元・完全削除、進捗通知、停止・再開を追加。 |
| `js/repo.js` | 削除情報の管理と各データの削除処理を追加。`removed` は最後の別通信で削除。 |
| `js/files.js` | ファイルの一括削除と取り置きの消去を追加。 |
| `js/dev/demo-gas.js` | 練習モードに一括削除と対象生徒の確認を追加。 |
| `gas/Code.gs` | `app-7` に更新。先生専用の一括削除を追加。 |
| `docs/setup/gas.md` | `app-7` の説明と更新手順を追加。 |
| `docs/setup/rules.json` | `removed` と、先生による削除対象データの削除権限を追加。 |
| `js/rules-probe.js` | 削除・復元について 14 項目の確認と後片付けを追加。 |
| `js/views/teacher-graduates.js` | 卒業画面、年度入力、復元、進捗、停止、エラー表示、離脱確認を追加。 |
| `js/router.js` | `#/t/graduates` を追加。 |
| `js/views/parts/teacher-nav.js` | 「記録」の右に「卒業」を追加。 |
| `js/views/teacher-classes.js` | 期限をすぎた学年の知らせを追加。 |
| `js/views/teacher-roster.js` | 「消してあります」の印を追加。 |
| `js/main.js` | ログイン確認が `none` の場合に `store` と `refresh` を消去。 |
| `css/app.css` | 卒業画面の幅制限と折り返しを追加。 |
| `README.md` | 使い方、削除対象、導入手順、残る制約を追記。 |
| `tests/graduate-logic.test.js` | 期限境界、混在学年、全角入力、重複 ID を検証。 |
| `tests/graduate-flow.test.js` | 削除順序、失敗時の記録保持、停止・再開、61 人の分割処理を検証。 |
| `tests/graduate-screen.test.js` | 画面表示、操作、通信中の無効化、停止、エラー文、知らせ・印を検証。 |
| `tests/repo.test.js` | 書き込み先と削除順序、出し直し時の復元を検証。 |
| `tests/files.test.js` | 一括削除の件数、空入力、取り置きの消去を検証。 |
| `tests/demo-gas.test.js` | 練習モードの権限、対象確認、入力制限を検証。 |
| `tests/gas-app.test.js` | GAS の持ち主確認、削除対象、入力制限を検証。 |
| `tests/rules-shape.test.js` | 削除権限と `removed` の形式を検証。 |
| `tests/rules-probe.test.js` | 新しい確認項目と代役を追加・更新。 |
| `tests/router.test.js` | 卒業画面の経路を検証。 |
| `tests/session.test.js` | `none` 時の取り置き・読み直し予約の消去を検証。 |

## テスト結果

- **最終の `npm test`：1,921 件すべて成功。**
- **`node --test --test-concurrency=1 "tests/*.test.js"`：1,921 件すべて成功。**
- `git diff --check`：問題なし。
- 既存の読み取り規則 38 か所が変更されていないことを確認。

途中の並列実行では、以下の一時的な失敗がありました。原因は特定できていません。該当ファイルの単独実行と、最後の全体再実行は成功しています。

```text
test at tests\record-logic.test.js:1:1
✖ tests\record-logic.test.js (1644.1793ms)
  'test failed'
```

```text
test at tests\rika-units.test.js:1:1
✖ tests\rika-units.test.js (3179.3693ms)
  'test failed'
```

## 指示書と違う点・判断したこと・残った問題

**「消した直後に何も読めない」は、指定範囲の変更だけでは完全に満たせません。**

- [rules.json](C:/Users/yan12/Documents/keita/AI開発/授業ログアプリ/docs/setup/rules.json:324) の `rika/state/<uid>`・`rika/log/<uid>` は、本人の認証だけで読み取りを許可しています。`accounts` を消しても読み取り権限が残ります。
- [Code.gs](C:/Users/yan12/Documents/keita/AI開発/授業ログアプリ/gas/Code.gs:241) は生徒の本人確認を最大 60 秒保持するため、その間は既存のファイル操作が許可される可能性があります。

既存の読み取り規則などを変えない指定に従い、この 2 点は変更せず README にも記載しました。

そのほかの判断・未確認事項は次のとおりです。

- 台帳削除後に通信が切れた場合も再開できるよう、`removed` だけ残った生徒も片付け対象にしました。
- 通信ごとの停止を守るため、`purgeStudent` に任意の `signal` を追加しました。
- GAS の上限に合わせ、生徒も 60 人ずつに分割します。
- `rules-check.json` は接続確認専用で、本番規則の写しではないため変更していません。
- 静的な規則確認では、指定対象を先生が削除できない箇所はありませんでした。本番 Firebase・GAS、学校回線、実ブラウザの幅 375px での表示は未確認です。
- `git add`・コミット・ブランチ操作・パッケージ追加は行っていません。