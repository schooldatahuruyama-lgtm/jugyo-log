# 実装指示書: 手書きの修正 2（時刻のくらべを、規則で守る）

あなた（Codex）は、この指示書に沿ってコードを直します。進め方は `AGENTS.md` の「実装を頼まれたとき」のとおりです。

## 目的

Codex レビュー `.ai-review/20261115-105232_round2.md` の指摘 1（High）を直す。

今は、保存の前にサーバーの時刻を読んでくらべている。くらべたあと、ファイルを上げている間に、別の端末が新しい保存・全消去を終えると、古いほうが上書きしてしまう。

直し方（Claude Code の判断）: **「前より新しい時刻でなければ書けない」を、データベースの規則で守る**。規則は、書きこみの時にサーバーの中で確かめるので、くらべと書きこみの間にすき間が無い。端末のくらべ（今あるもの）は、むだな通信をへらすために残す。

## 1. 規則（`docs/setup/rules.json`）

`records/$classId/$lessonId/$sid/ink/$field` の `.validate` に、今ある条件に `&&` で足す。

```
(!data.exists() || newData.child('updatedAt').val() > data.child('updatedAt').val()) && (!data.parent().parent().child('inkCleared').child($field).exists() || newData.child('updatedAt').val() > data.parent().parent().child('inkCleared').child($field).val())
```

`records/…/$sid/inkCleared/$field` の `.validate` に、今ある条件に `&&` で足す。

```
(!data.exists() || newData.val() > data.val()) && (!data.parent().parent().child('ink').child($field).exists() || newData.val() > data.parent().parent().child('ink').child($field).child('updatedAt').val())
```

（`data` は書きこむ前の中身。目録を書くときは、前の目録の時刻と、前の「消した時刻」の両方より新しいこと。消した時刻を書くときも同じ。`repo.setInk`・`repo.removeInk` は 1 回の update で両方を書きかえるので、どちらの場合も、書きこむ前の中身とくらべられる。）

## 2. 断られたときの扱い（`js/ink-flow.js`）

`saveInkFlow` の中で、`repo.setInk`・`repo.removeInk` が `denied` で失敗したとき:

1. `repo.getRecord` で、今の記録を読み直す。
2. **自分の保存が、じつは届いていた**場合（通信の返事だけが届かなかった、やり直し）: 目録の `fileId` が今上げたファイルと同じで、`updatedAt === editedAt`（空の保存なら、目録が無く、`inkCleared[field] === editedAt`）→ 成功として `{ index, superseded: false }` を返す。
3. `serverInkTime(record, field) >= editedAt` → 新しいほうがある。今上げたファイルを片付け（失敗は無視）、`{ index: record.ink[field] ?? null, superseded: true, record }` を返す。
4. どちらでもない（ほんとうに断られた。クラスから外れた・授業が消えた など）→ 今までどおり、上げたファイルを片付けて、`denied` のエラーを投げる。
5. 読み直し（1）に失敗したら、そのエラーを投げる（保存の失敗として、やり直しに乗る。上げたファイルは残す。同じキーでやり直せる）。

`resendInkDrafts` と `js/views/parts/ink-field.js` は、今ある `superseded` の扱いのままで動くはず。動かない所があれば直す。

## 3. 規則の確認（`js/rules-probe.js`）

今ある手書きの確かめに、2 行足す（75 → 77）。今ある行の時刻の値を、順番が合うように決め直してよい（今ある行の意味は変えない）。

- 自分の `ink/memo` を、**前より古い時刻**で書く → できない
- 自分の `inkCleared/memo` に、**目録より古い時刻**を書く → できない

今ある「自分の `inkCleared/memo` に数を書く → できる」は、目録より新しい時刻で行う。片付けで残さない。README などの数を 77 に直す。`docs/superpowers/specs/2026-11-13-jugyo-log-1a-data.md` に、この決まりを書く。

## 端の場合

- 不正な入力: 変えない（形の確かめは今のまま）。
- 重複と境界: **同じ時刻**では書けない（規則が断る）→ 端末は読み直して、自分の保存なら成功、ちがえばサーバーを残す。はじめての保存（前の目録も消した時刻も無い）は、どの時刻でも書ける。消したあとの新しい保存は、消した時刻より新しければ書ける。
- 違反や失敗の見せ方: 新しいほうに入れかえたときは、今ある欄の下の知らせ（「ほかの端末で書いたほうが新しいので、そちらを出しました。」）。ほんとうに断られたときは、今ある「保存できませんでした」。規則の確認の失敗は、表に × で出る。

## テスト

- `tests/rules-shape.test.js`: 2 つの `.validate` に、上の条件が入っていること。
- `tests/ink-flow.test.js`（代役の `repo` で、順番を固定する）:
  - A がくらべを通ったあと、上げている間に B が新しい保存を終える → A の `setInk` は `denied` → A は読み直して `superseded`。B の目録が残り、A が上げたファイルは片付けられる。
  - 同じ順番で B が全消去 → A の `setInk` は `denied` → `superseded`。消した時刻が残り、生き返らない。
  - A の古い全消去（`removeInk`）が、B の新しい保存のあとに届く → `denied` → `superseded`。B の目録が残る。
  - 自分の保存が届いていた（同じ `fileId`・同じ時刻）→ 成功（`superseded: false`）。空の保存でも同じ。
  - ほんとうの `denied`（サーバーの時刻が古い）→ ファイルを片付けて `denied`。
  - 読み直しの失敗 → そのエラー、ファイルは残す。
- 代役のデータベース（`js/dev/memory-net.js` など）が規則を持たないなら、テストの中の代役で `denied` を返させればよい。練習モード（規則なし）の動きは変えない。
- 規則の確認のテスト: 77 行、片付け。
- `npm test` がすべて成功し、変えた `.js` は `node --check` が通る。`docs/setup/rules.json` が JSON として読める。

## 守ること

- `git add`・`git commit` はしない。上に書いたことのほかは変えない。

## 報告

変更したファイル、テストの結果、規則の確認の行の数、指示書と違う点を、日本語の Markdown で報告する。
