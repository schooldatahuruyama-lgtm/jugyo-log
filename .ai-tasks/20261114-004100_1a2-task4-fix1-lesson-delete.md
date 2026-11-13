# 実装指示書: 段階 1a-2 Task 4 のレビュー修正（授業の削除）

あなた（Codex）は、この指示書に沿ってコードを直します。進め方は `AGENTS.md` の「実装を頼まれたとき」のとおりです。

- もとの指示書: `.ai-tasks/20261114-000400_1a2-task4-units-lessons-views.md`（Global Constraints はそのまま守る）
- レビュー: `.ai-review/20261113-225152_round1.md` の指摘 1〜3
- 変えてよいファイル: `js/views/teacher-lessons.js`、`js/lesson-flow.js`（新規）、`tests/lesson-flow.test.js`（新規）、`docs/setup/rules.json`、`tests/rules-shape.test.js`、`docs/superpowers/specs/2026-11-13-jugyo-log-1a-data.md`（4 章の表の `lessons` の行）。**ほかのファイルは変えない**（`js/views/teacher-lesson.js`・`js/material-flow.js`・`js/pdf.js`・`js/image.js`・`js/views/parts/viewer.js`・`css/app.css` は別の作業が進行中）。変える必要があると思ったら、変えずに報告に書く。
- `git add`・`git commit` はしない。テストを先に書き、失敗を確かめてから直す。
- 完了の条件: `npm test` がすべて成功する（別の作業の途中のファイルが原因の失敗があれば、その名前を報告に書く）。新しい `.js` は `node --check` で構文を確かめる。

## 直すこと

### 1. 記録がある授業を、データベースの規則で消せなくする（指摘 1）

今は、画面が「記録の件数を読む → 0 件なら消す」としている。読んだあと、消すまでの間に生徒が記録を保存すると、記録のある授業が消えてしまう。画面の確かめだけでは防げないので、規則で守る。

`docs/setup/rules.json` の `lessons` を、次の形に変える（「先生」は、今の式 `auth != null && root.child('teacherList').child(auth.uid).val() === true` のこと。「その組の一員」も今の式のまま）。

```
"lessons": {
  ".read": "<先生>",
  "$classId": {
    ".read": "<今のまま（先生、または、その組の一員）>",
    "$lessonId": {
      ".write": "<先生> && (newData.exists() || !root.child('records').child($classId).child($lessonId).exists())"
    }
  }
}
```

- `$classId` の `.write` は**取りのぞく**（書けるのは授業 1 つの場所から下だけにする。上で許すと、下の条件が効かないため）。
- これで、先生は授業を作る・直す・資料を足す／外す（授業が残る書きこみ）はできるが、**記録が 1 件でもある授業をまるごと消す書きこみは、データベースが断る**。
- `thumbs` の規則は変えない。
- 今の `js/repo.js` の書きこみは、どれも `lessons/<classId>/<lessonId>` か、その下の場所への書きこみなので、`repo.js` は変えなくてよい（変えない）。

`tests/rules-shape.test.js` に足す: `rules.lessons.$classId['.write']` が無いこと。`rules.lessons.$classId.$lessonId['.write']` が、`teacherList`・`newData.exists()`・`root.child('records').child($classId).child($lessonId).exists()` を含むこと。`rules.lessons['.read']` と `rules.lessons.$classId['.read']` が今のまま残っていること。

データの形の文書（4 章の表）の `lessons` の行の「書ける」に、「先生（授業 1 つの場所から下）。記録がある授業は、まるごとは消せない」と書き足す。

### 2. 消す順番を変える（指摘 3・指摘 2）

今は「ファイルをゴミ箱に入れる → 授業を消す」の順。授業を消すのに失敗すると、授業は残っているのにファイルだけが無くなる。順番を逆にし、ファイルを指している授業が無いことを、**授業を消したあとに読み直して**確かめる。

`js/lesson-flow.js`（新規。通信の順番だけを受け持つ。画面と DOM を知らない）:

```
deleteLessonFlow({ repo, files, classId, lesson }) → { deleted: true, leftover: number } | { deleted: false, reason: 'has-records' }
```

- `lesson` は `repo.listLessons` の 1 件（`{ id, materials, … }`）。
- 順番:
  1. `repo.countRecords(classId, lesson.id)` が 1 以上 → 何も消さずに `{ deleted: false, reason: 'has-records' }`。
  2. その授業の資料の `fileId` を、重なりを除いて覚える（`materialList` を使う）。
  3. `repo.deleteLesson(classId, lesson.id)`。**`NetError` の code が `'denied'` なら**（規則が断った＝確かめたあとに記録ができた）、何も片付けずに `{ deleted: false, reason: 'has-records' }`。ほかの失敗は、そのまま投げる（この時点では、ファイルは 1 つも消していない）。
  4. `repo.listAllLessons()` を**読み直し**、覚えた `fileId` のうち、`fileRefs` が 0 件のものだけを `files.trash` でゴミ箱に入れる。
  5. 4 の読み直しや `trash` が失敗しても例外にしない。片付けられなかったファイルの数を `leftover` に入れて `{ deleted: true, leftover }` を返す（読み直しに失敗したら、覚えたファイルの数ぜんぶを `leftover` にする）。
- 2 つの端末で同じ瞬間に、片方が授業を消し、片方が同じファイルをほかの授業に付けた場合までは防がない（先生は 1 人で使う前提）。そのことを、ファイルの先頭のコメントに書く。

`js/views/teacher-lessons.js` の「消す」は、確かめのダイアログのあと `deleteLessonFlow` だけを呼ぶ形に直す（画面の中に、順番のコードを残さない）。結果の出し方:

- `has-records` →「生徒の記録がある授業は消せません。」（消さない）
- `deleted: true, leftover: 0` →「授業を消しました。」
- `deleted: true, leftover: 1 以上` →「授業を消しました。一部のファイルを片付けられませんでした（Drive に残っています）。」
- 例外 →「つながりません。消せませんでした。もう一度ためしてください。」

確かめのダイアログを出す前の件数の確かめ（1 件でもあれば、ダイアログを出さずに「消せません」と出す）は、今のまま残してよい。

### 足すテスト（`tests/lesson-flow.test.js`）

`repo` と `files` は手書きの代役を使う。

- 記録が 1 件ある → `deleteLesson` も `trash` も呼ばない。`{ deleted: false, reason: 'has-records' }`。
- **件数は 0 だったが、`deleteLesson` が `NetError('denied')`** → `trash` を呼ばない。`has-records`。
- `deleteLesson` が `NetError('network')` → そのまま投げる。`trash` を呼ばない。
- ふつうの流れ: 呼ぶ順番は `countRecords` → `deleteLesson` → `listAllLessons` → `trash`。**`listAllLessons` は `deleteLesson` のあとに呼ぶ。**
- 資料が 3 つ（うち 2 つが同じ `fileId`）で、ほかの授業が 1 つの `fileId` を指している → `trash` は、指されていない `fileId` に 1 回だけ。
- `listAllLessons` が失敗 → 例外にならず、`{ deleted: true, leftover: 覚えたファイルの数 }`。`trash` を呼ばない（指されているか分からないファイルを消さない）。
- `trash` が 1 つだけ失敗 → `leftover: 1`。残りの `trash` は行う。
- 資料が無い授業 → `listAllLessons` を呼ばなくてよい。`{ deleted: true, leftover: 0 }`。

## 報告

変更したファイル、テストの結果、指示書と違う点を、日本語の Markdown で報告する。
