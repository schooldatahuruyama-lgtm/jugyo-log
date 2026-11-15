# 実装指示書: 手書き Task 2b — 手書きの小さい画像の置き場所を変える（`inkThumbs`）

あなた（Codex）は、この指示書に沿ってコードを直します。進め方は `AGENTS.md` の「実装を頼まれたとき」のとおりです。

## 目的

Task 2（`.ai-tasks/20261115-231000_ink-task2-data.md`）では、手書きの小さい画像を、添付と同じ `recThumbs/<c>/<l>/<sid>/<inkMemo|inkLearned|inkQuestion>` に置いた。これを、Claude Code の設計の見直しで変える。

理由: 先生の記録の一覧は、全員分の「分かったこと」または「疑問」の手書きを、1 回で読みたい。`recThumbs` を授業ごとに読むと、全員の添付の小さい画像（1 人 6 枚まで）もいっしょに来て、重い。欄ごとに分けた別の場所に置けば、今出している欄の分だけを 1 回で読める。メモの手書きは一覧に出さないので、小さい画像を作らない。

## 新しい形

- `inkThumbs/<classId>/<lessonId>/<field>/<sid>` = データ URL（文字。20000 文字まで）。`field` は **`learned`・`question` だけ**（`memo` は置かない）。
- `recThumbs` は、Task 2 の前の形に戻す（`$aid` は `a1`〜`a6` だけ）。

## 変えるファイル

Task 2 で変えた・作ったファイルのうち、関係するもの: `js/config.js`、`js/repo.js`、`js/ink-flow.js`、`docs/setup/rules.json`、`js/rules-probe.js`、それぞれのテスト、`README.md`・`docs/superpowers/specs/2026-11-13-jugyo-log-1a-data.md`（形の説明）。ほかのファイルは変えない。

### 設定

- `CONFIG.inkThumbKeys` を消し、`inkThumbFields: ['learned', 'question']` を足す。

### 規則（`docs/setup/rules.json`）

- `recThumbs` の `$aid` の `.validate` を、元の `$aid.matches(/^a[1-6]$/) && newData.isString() && newData.val().length <= 20000` に戻す。
- 次を足す（`recThumbs` のとなり）。読めるのは先生（授業ごとにまとめて）と本人。書けるのは本人だけ（`records` と同じ条件: 自分の ID・そのクラスに入っている・その授業がある）。

```json
"inkThumbs": {
  "$classId": {
    "$lessonId": {
      "$field": {
        ".read": "auth != null && root.child('teacherList').child(auth.uid).val() === true",
        ".validate": "$field === 'learned' || $field === 'question'",
        "$sid": {
          ".read": "auth != null && root.child('accounts').child(auth.uid).val() === $sid",
          ".write": "auth != null && root.child('accounts').child(auth.uid).val() === $sid && root.child('memberOf').child(root.child('accounts').child(auth.uid).val()).child($classId).val() === true && root.child('lessons').child($classId).child($lessonId).exists()",
          ".validate": "newData.isString() && newData.val().length <= 20000"
        }
      }
    }
  }
}
```

### `js/repo.js`

- `setInk(classId, lessonId, studentId, field, { fileId, bytes, strokes }, thumb, now)`: 目録は今のまま。小さい画像は、`field` が `learned`・`question` のときだけ扱う（`thumb` が文字 → `inkThumbs/<c>/<l>/<field>/<sid>` に書く。`null` → 消す。`undefined` → 触らない）。`field` が `memo` のときは、`thumb` に何が来ても、小さい画像には触らない。
- `removeInk(…)`: 目録を消す。`learned`・`question` のときは、小さい画像も消す。
- `listInkThumbs(classId, lessonId, field) → { [studentId]: データ URL }`: 先生が、1 つの欄の全員分を 1 回で読む。`field` が `learned`・`question` 以外なら `TypeError`。文字でない値は落とす。
- `getInkThumb` のような 1 人分の読みこみは、いらない（作らない）。

### `js/ink-flow.js`

- 動きは同じ（`thumb` を `repo.setInk` に渡すだけ）。`inkThumbKeys` を使っている所があれば直す。

### 規則の確認（`js/rules-probe.js`）

Task 2 で足した「`recThumbs/…/inkMemo` を書く → できる」「`recThumbs/…/inkOther` を書く → できない」の 2 行を、次に変える。

- 自分の `inkThumbs/…/learned/（自分）` を書く → できる
- 自分の `inkThumbs/…/memo/（自分）` を書く → できない
- ほかの生徒（`s00-998`）の `inkThumbs/…/learned/s00-998` を書く → できない
- `inkThumbs/（入っているクラス）/（授業）/learned` 全体を読む（生徒として）→ できない
- 先生として `inkThumbs/（入っているクラス）/（授業）/learned` を読む → できる（今ある「先生として…を読む」の確かめと同じやり方）

行の数は 70 → 73 になる（2 行を 5 行に）。片付けで、足した `inkThumbs` を消す。前回の残りの片付け（確認用のクラスが残っていたとき）でも、`inkThumbs` を消す（今ある `terms`・`recThumbs` の片付けと同じ所で）。README などの数を 73 に直す。

## 端の場合

- 不正な入力: `field` が `learned`・`question` 以外の `listInkThumbs` → `TypeError`。20001 文字の小さい画像 → 規則が断る。文字でない値 → `listInkThumbs` が落とす。
- 重複と境界: `memo` の保存では、小さい画像を書かない・消さない。20000 文字ちょうどは通る。小さい画像がもともと無い欄を消しても成功する。
- 違反や失敗の見せ方: このタスクは画面を持たない。規則の確認の失敗は、結果の表に × で出る。

## テスト

- Task 2 のテストを、新しい形に合わせて直す。`listInkThumbs` のテストを足す。規則の確認が 73 行で、片付けのあとに `inkThumbs` が残らないこと。
- `npm test` がすべて成功する。変えた `.js` は `node --check` が通る。`docs/setup/rules.json` が JSON として読める。

## 守ること

- `git add`・`git commit` はしない。Task 2 のほかの部分（目録・GAS・下書き・保存の順番）は変えない。

## 報告

変更したファイル、テストの結果、規則の確認の行の数、指示書と違う点を、日本語の Markdown で報告する。
