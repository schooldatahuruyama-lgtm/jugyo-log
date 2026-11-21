# Codex 実装報告

## 変更したファイル

| ファイル | 変更内容 |
|---|---|
| `js/views/student-lesson.js` | 取り置きから開いた場合の送信前確認、新しいサーバー記録の表示、共有の読み直し処理への切り替え。 |
| `js/record-saver.js` | 競合で送信しなかった場合、下書きを消して `idle` に戻す処理を追加。 |
| `js/main.js` | `liveRepo` の読み書きを分離。世代管理と共有の読み直し処理、ログアウト時の停止を接続。 |
| `js/offline-net.js` | ログインと書き込みの世代を確認し、古い応答による取り置きの復活を防止。 |
| `js/offline-refresh.js`（新規） | 授業・生徒ごとに読み直しをまとめ、画面移動後も実行する処理を追加。 |
| `js/views/student-home.js` | 再送できた授業の読み直しを予約。 |
| `js/record-flow.js` | 戻り値に `sentLessons` を追加。 |
| `js/ink-flow.js` | 戻り値に、授業の重複を除いた `sentLessons` を追加。 |
| `sw.js` | 版ごとにキャッシュを分離し、activate 時に旧版を削除。 |
| `js/offline-warm.js` | 用語と先生の返事を順番に先読み。 |
| `tests/reply-screen.test.js` | 下書き競合、再確認、画面移動後の読み直し、オフライン表示を検証。 |
| `tests/record-saver.test.js` | 競合時の `idle` 復帰と、確認中の追加入力を検証。 |
| `tests/session.test.js` | `main.js` の通信分離、読み直し、ログアウト・再ログインを検証。 |
| `tests/offline-net.test.js` | 書き込みやログイン世代変更と、遅い応答との競合を検証。 |
| `tests/offline-refresh.test.js`（新規） | 予約の集約、個別実行、全件停止、読み取り失敗を検証。 |
| `tests/record-flow.test.js` | `sentLessons` の内容を検証。 |
| `tests/ink-flow.test.js` | `sentLessons` の内容と授業の重複除外を検証。 |
| `tests/sw.test.js` | 版の正規化、旧版削除、新旧キャッシュの分離を検証。 |
| `tests/offline-warm.test.js` | 先読みの順序、失敗・中断、関数がない場合を検証。 |

## テスト結果

`npm test`：**1,859件すべて成功**。

```text
ℹ tests 1859
ℹ pass 1859
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```

ファイル読み込みの失敗はなく、直列実行での再確認は不要でした。`git diff --check` も成功しました。

## 指示書と違う点・判断したこと・残った問題

- 指示範囲からの逸脱なし。既存の変更を保持しました。
- 送信を取りやめた場合は `{ superseded: true }` を返し、保存状態を `idle` に戻す方式を採用しました。
- サーバー確認中に追加入力された場合は、その入力を保持します。
- 実機のiPad・ブラウザでの手動確認は未実施です。
- git の状態を変える操作、パッケージ追加は行っていません。