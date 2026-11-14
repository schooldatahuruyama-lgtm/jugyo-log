# Codex 実装報告

## 変更したファイル

- `css/base.css`：`.btn-danger-text` を追加。44×44px以上の操作領域、ホバー・フォーカス表示を維持。
- `css/app.css`：添付ボタンの枠線、保存状態の文字表示と折り返し、淡い黄色の「未記入」を実装。
- `js/views/student-lesson.js`：保存・接続状態を枠なしの文字表示に変更。記号、通知属性、再試行ボタンを維持。
- `js/views/parts/attachment-pane.js`：添付追加と「消す」に専用クラスを適用。
- `js/views/teacher-lesson.js`：資料の「消す」を赤い文字に変更。
- `js/views/teacher-lessons.js`：授業一覧の「消す」を赤い文字に変更。
- `docs/design/design-board.html`：Eの該当見本を更新。

## テスト結果

- `npm test`：**799件すべて成功**。失敗・スキップなし。
- `node --check`：変更したJavaScript 4ファイルすべて成功。
- `git diff --check`：成功。
- テストファイルの追加なし。

## 指示書と違う点・判断したこと・残った問題

- `teacher-record.js` の「未記入」は共通CSSで反映されるため、同ファイルの編集は不要でした。
- 保存・添付・削除処理と、確認ダイアログの `danger: true` は変更していません。
- 他画面で、確定操作以外に赤く塗った危険ボタンを使用している箇所は見つかりませんでした。
- 実ブラウザでの表示確認は未実施です。