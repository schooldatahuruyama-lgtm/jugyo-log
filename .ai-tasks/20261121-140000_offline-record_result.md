# Codex 実装報告

## 変更したファイル

| ファイル | 変更内容 |
|---|---|
| `sw.js` | アプリファイルの取り置き、通信失敗・５秒経過時の読み取りを追加。 |
| `js/sw-register.js` | 登録条件とバージョン付き URL を追加。 |
| `js/offline-store.js` | 生徒ごとのデータ保存・取得・削除とメモリへの代替処理を追加。 |
| `js/offline-net.js` | 通信失敗時の取り置き利用、更新後の無効化、状態通知を追加。 |
| `js/session-memo.js` | uid・生徒 ID だけを保存する控えを追加。 |
| `js/session.js` | 控えとログイン中の uid が一致する生徒のオフライン復帰を追加。 |
| `js/main.js` | 通信経路の接続、帯表示、再確認、ログアウト時の消去、Worker 登録を追加。 |
| `js/config.js` | 先読み件数・再確認間隔・読み直し間隔を追加。 |
| `js/offline-warm.js` | 授業と記録を順番に先読みする処理を追加。 |
| `js/views/student-home.js` | 最新５授業の先読みと、再送時の `liveRepo` 使用を追加。 |
| `js/views/student-lesson.js` | 未取り置き授業の案内と、保存後の読み直しを追加。 |
| `js/dev/demo.js` | オフラインの切り替えとリセット時の解除を追加。 |
| `tools/pages-branch.ps1` | `sw.js` の公開対象化と、公開用 `app-files.json` の生成を追加。 |
| `.gitignore` | `app-files.json` を追加。 |
| `css/app.css` | 折り返し可能なオフラインの帯を追加。 |
| `README.md` | 新しい表示文と、オフラインで使える機能・端末に残る内容を追記。 |
| `tests/offline-net.test.js` | 読み取り・書き込み・scope 変更・状態通知を検証。 |
| `tests/offline-store.test.js` | 保存・破損・消去・Cache API の失敗を検証。 |
| `tests/session-memo.test.js` | 保存項目と形式検査を検証。 |
| `tests/offline-warm.test.js` | 順番・件数・中断・失敗を検証。 |
| `tests/sw.test.js` | install・activate・fetch・時間切れを VM で検証。 |
| `tests/sw-register.test.js` | 登録条件と URL を検証。 |
| `tests/session.test.js` | オフライン復帰、30秒の境界、画面維持、ログアウトとの競合を検証。 |
| `tests/demo.test.js` | オフラインの切り替えと復帰を検証。 |
| `tests/reply-screen.test.js` | 先読み・再送・案内・保存後の読み直し・オフライン記録を検証。 |
| `tests/repo.test.js` | 公開用ファイル一覧の生成処理を確認。 |

## テスト結果

**最終版の逐次実行は、1,818 件すべて成功しました。**

| 実行 | 成功 | 失敗 |
|---|---:|---:|
| `npm test` 初回 | 1,766 | 1 |
| `npm test` 最終版 | 1,783 | 1 |
| `node --test --test-concurrency=1 "tests/*.test.js"` 最終版 | **1,818** | **0** |

通常実行では、テストファイルの読み込み段階で失敗しました。失敗出力の抜粋（原文）：

```text
Error: UNKNOWN: unknown error, lstat 'C:\'

test at tests\ink-flow.test.js:1:1
✖ tests\ink-flow.test.js (1636.7491ms)
  'test failed'
```

```text
test at tests\reply-screen.test.js:1:1
✖ tests\reply-screen.test.js (838.806ms)
  'test failed'
```

`git diff --check` と PowerShell の構文チェックも成功しました。

## 指示書と違う点・判断したこと・残った問題

- アプリファイルの保存キーはクエリを除いて統一し、古い写しが優先されることを防ぎました。
- オフラインの印は生徒の scope に紐づけ、ログアウト後に残さないようにしました。
- ログアウトでは指定されたデータ・控え・下書きを消去し、アプリファイルは残します。README にも明記しました。
- 通常の `npm test` の読み込みエラーは残っています。逐次実行では全件成功しています。
- iPad Safari 実機、375px 幅の実表示、公開後の動作は未確認です。公開スクリプトは Git の状態を変えるため実行していません。
- 指定外ファイルの変更、パッケージ追加、`git add`・コミット・ブランチ操作は行っていません。