# 実装指示書（修正 2）: 卒業後の削除と復元 — レビュー round 2 の指摘 3 件

あなた（Codex）は、この指示書に沿ってコードを直します。進め方は `AGENTS.md` の「実装を頼まれたとき」のとおりです。これまでの指示書は `.ai-tasks/20261121-190000_graduate-removal.md`・`.ai-tasks/20261121-200000_graduate-removal-fix1.md`、レビューは `.ai-review/20261121-133426_round2.md`。

## 変える内容

### 指摘 1（High）: 出し直しと「消す」が重なると、新しいアカウントの対応が残る

- `docs/setup/rules.json` の `removed/$sid` の `.validate` に足す: `newData.child('uid').val() === root.child('students').child($sid).child('uid').val()`（`removed` に書く `uid` が、今の台帳の `uid` と同じ。どちらも無いときは通る。`root` は書く前のデータ）。`purging` を足すだけの書きこみ（`removed/<sid>/purging`）でも、この検査は通ること（`uid` は変わらないため）。台帳の `uid` を消す `purgeStudent` は、`removed/<sid>` をさわらない 1 回目の update なので、この検査にかからないこと。もし、今の作りでかかる場合は、かからない書き方にして、報告に書く。
- `js/graduate-flow.js` の `removeCohort`: `repo.removeStudents` が `denied` で失敗したら、`code: 'changed'` のエラーにする。
- `js/views/teacher-graduates.js`: `changed` のときは、一覧を読み直し、「名簿が変わっていたので、消しませんでした。もう一度『この学年の記録を消す』を押してください。」と出す。
- `js/rules-probe.js` に足す: 先生が、台帳とちがう `uid` で `removed/<sid>` を書く → `denied`。

### 指摘 2（High）: 名簿から外れ、先生の返事だけが残るクラスが、消す対象にならない

- `js/repo.js` に `listStudentIndex(studentId)` を足す: `marks/<sid>`・`terms/<sid>`・`replyMarks/<sid>` を読み（3 つとも先生が読める）、その下にあるクラス ID の配列（重複なし）を返す。
- `purgeCohort` の「かかわるクラス」に足す: 対象の生徒ごとの `listStudentIndex` に出てくるクラス（今の名簿・記録の走査に加えて）。`classes` に無いクラス ID（消えたクラス）は、授業を読めないのでとばす。
- 走査（`listRecordIds`）は、今までどおり行う（添付だけの記録は、印の場所に出ないため）。

### 指摘 3（High）: 出し直す前のアカウントの、理科クエストの記録が残る

- `js/repo.js` の `linkAccount`: `oldUid` があり、新しい `uid` とちがうとき、パッチに `rika/state/<oldUid>` = null と `rika/log/<oldUid>` = null を足す（出し直すと、前のアカウントの理科クエストの記録は本人も読めなくなるので、そのときに消す）。
- README の出し直しの説明に 1 行足す（「出し直すと、前のアカウントの理科クエストの記録は消えます」）。名簿の画面に、出し直しの前の確かめの文があれば、同じことを足す。
- これより前に出し直した生徒の、古いアカウントの理科クエストの記録は、たどる手がかりが無いので、このアプリからは消せない。README の「残るもの」に書く。

## 端の場合

- 不正な入力: `marks`・`terms`・`replyMarks` の下が、オブジェクトでない → そのクラスは無いものとして扱う。
- 重複と境界:
  - 卒業の画面が古い `uid` を読んだあとに、名簿で出し直す → 「消す」は規則に断られ、何も変わらない。上の文が出る。読み直したあとの「消す」は通る。
  - アカウントをまだ発行していない生徒（台帳にも `uid` なし）→ 「消す」は通る。
  - 名簿になく、記録もなく、先生の返事だけがあるクラス → 返事と印が消える。
  - 印の場所に出てくるクラスが、もう消えている → とばして進む（失敗にしない）。
  - 出し直し: 前と同じ `uid`・`oldUid` なし → 理科クエストの場所に何も書かない。
- 違反や失敗の見せ方: 上の `changed` の文。ほかは変えない。

## テスト

- 上の「重複と境界」の全部に、テストを 1 つずつ（`tests/rules-shape.test.js`・`tests/rules-probe.test.js`・`tests/graduate-flow.test.js`・`tests/graduate-screen.test.js`・`tests/repo.test.js`）。規則を動かすにせ物があれば、「`purging` だけを足す書きこみ」「最後の片付け」が通ることも確かめる。
- 今あるテストが通ること。`npm test` がすべて成功すること（ファイルの読みこみの失敗が出たら、`node --test --test-concurrency=1 "tests/*.test.js"` でも確かめ、両方の結果を報告する）。
- README の「規則の確認は ○ 項目」の数が、今の数と合っていなければ直す。

## 守ること

- `git add`・`git commit` はしない。パッケージを足さない。
- 生徒の画面（`js/views/student-*.js`）・`relay/`・`check.html`・`gas/` は変えない。
- このフォルダの外は読まない・変えない。

## 報告

変更したファイル、テストの結果、指示書と違う点・自分で決めた点・確かめられなかった点を、日本語の Markdown で報告する。
