# 授業ログ 段階 1a のデータの形と分け方（設計書の補足）

作成日: 2026-11-13　／　もとにした資料: `docs/superpowers/specs/2026-11-12-jugyo-log-design.md`（以下「設計書」）の 5 章・9 章・11 章と、段階 0 の結果（`docs/reports/stage0-check.md`）

設計書 11 章で「実装計画を書く人に任せる」とされた、データベースの形・規則・GAS の呼び方・計画の分け方を、ここで決める。すべて Claude の判断。段階 1a の 4 つの計画は、この文書を共通の決まりとして使う。設計書と違うところは 1 章に書いた。

## 1. 段階 0 の結果で決まったこと・設計書から変わったこと

| 項目 | 決まったこと |
|---|---|
| 生徒用メールアドレスのドメイン | `jugyolog.invalid`（第 1 候補がそのまま使えた） |
| メールアドレスの形 | `<生徒ID>.g<何回目>@jugyolog.invalid`（例 `s26-017.g1@jugyolog.invalid`）。最初の発行は `g1` |
| GAS の公開 | 「自分として実行・全員がアクセス」で公開でき、ログインなしのブラウザから呼べた |
| 混み合い | 同時 40 回の取り出しは、パソコンと iPad（家の回線）で失敗 0、最大 4.1 秒 |
| 写真 1 枚の保存 | iPad で 7.7 秒（0.71MB）。1a の資料の追加では、送る前に長辺 1600px・約 0.3MB に縮め、送信中も画面を止めない |
| **保存先の Drive** | 設計書は「先生の学校用 Google Drive」。段階 0 では先生が **gmail.com のアカウント**でログインして公開した（全体 400GB、使用 30GB）。**1a もこのアカウントの Drive を使う前提で進める（ユーザーの確認待ち）**。学校の異動でアカウントが消える心配がなくなる代わりに、学校の決まりで許されるかは先生の判断になる |
| 学校の回線 | まだ確かめていない（2026-11-13 時点）。止められる通信が見つかったら、その計画を直す |

## 2. 段階 1a の計画の分け方

1a は 4 つの計画に分ける。どれも、終わった時点で動かして確かめられる。

| 計画 | 内容 | 終わったときにできること |
|---|---|---|
| 1a-1 土台とログインと名簿 | アプリの枠、通信とログイン、本番の規則、クラス、生徒 ID の発行、名簿、ID 一覧の印刷、パスワードの出し直しと変更、練習モード、規則の確認画面 | 先生がクラスを作り ID を配れる。生徒がログインして（まだ空の）授業一覧を見られる |
| 1a-2 単元・授業・先生の資料 | 単元、授業の作成と編集、本番用の GAS、写真の縮小と PDF、一覧用の画像、端末の中の取り置き、GAS の順番待ち | 先生が授業を作り、板書と配布資料を置ける |
| 1a-3 生徒の画面 | 授業一覧（タイルとスライド）、授業ページ（資料を見る・文字のメモ・振り返り）、自動保存と下書き | 生徒が授業で使える |
| 1a-4 先生の記録確認と進級 | 理解度のグラフ、全員分の一覧とコピー、生徒のページを読み取り専用で開く、年度の切り替え、最後の確認 | 初期版の前半が完成 |

1a-2 以降の計画は、前の計画が終わってから書く。

## 3. Realtime Database の形

ID（`classId`・`unitId`・`lessonId`・`materialId`）は、端末で作る 12 文字の英数字。生徒 ID は `s<入学年度の下 2 桁>-<3 桁の連番>`（例 `s26-017`）。

```
teacherList/<uid>: true                      先生の一覧（コンソールでだけ書く）
gen/<studentId>: number                      その ID の「今は何回目か」。ログイン前でも読める
accounts/<uid>: "<studentId>"                ログイン用アカウント → 生徒 ID
students/<studentId>: { createdAt, uid }     発行した ID の台帳。uid は今のアカウント（未発行なら無い）
counters/<yy>: number                        その入学年度で、最後に使った連番
initialPw/<studentId>: "<password>"          最初のパスワード（印刷用）
classes/<classId>: { year, name, createdAt } year は数（例 2026）
members/<classId>/<studentId>: number        出席番号
memberOf/<studentId>/<classId>: true         members の逆引き（規則と、生徒の授業一覧で使う）
units/<unitId>: { year, name, order }                                              … 1a-2
lessons/<classId>/<lessonId>: { date, title, unitId, materials, createdAt, updatedAt } … 1a-2
thumbs/<classId>/<lessonId>/<materialId>: "<data URL>"   一覧用の小さい画像          … 1a-2
records/<classId>/<lessonId>/<studentId>: { memo, level, learned, question, updatedAt } … 1a-3
marks/<studentId>/<classId>/<lessonId>: number   理解度（1〜4）。一覧の印に使う       … 1a-3
check/…                                      段階 0 の確認用（そのまま残す）
```

- `lessons/.../materials/<materialId>`: `{ kind: 'board'|'handout', type: 'image'|'pdf', fileId, name, order, bytes }`。`fileId` は Drive のファイル ID。
- `date` は `'YYYY-MM-DD'`。
- 理解度の数: 4 よく分かった／3 分かった／2 あまり分からなかった／1 全然分からなかった。選んでいなければ項目を置かない。
- `members` と `memberOf` は、必ず 1 回の書きこみ（ルートへの複数パスの update）で一緒に変える。
- `records` と `marks` も、1 回の書きこみで一緒に変える。
- 一覧用の画像を `lessons` と分けるのは、授業の一覧（文字だけ・軽い）を 1 回で読み、画像は見えるタイルの分だけ読むため。
- 本名・学校のメールアドレスは、どこにも置かない。

## 4. 規則（`docs/setup/rules.json`）

読みやすさのため、次の 3 つの言い方を使う（実際のファイルでは式をそのまま書く）。

- 先生: `auth != null && root.child('teacherList').child(auth.uid).val() === true`
- 自分の生徒 ID: `root.child('accounts').child(auth.uid).val()`
- その組の一員: `root.child('memberOf').child(<自分の生徒 ID>).child($classId).val() === true`

| 場所 | 読める | 書ける |
|---|---|---|
| ルート | だれも読めない | だれも書けない |
| `teacherList/$uid` | 本人 | なし |
| `gen/$sid` | だれでも（1 件ずつ。一覧は読めない） | 先生。数だけ |
| `accounts` | 先生（全体）。`$uid` は本人も | 先生。文字だけ |
| `students`、`counters` | 先生 | 先生 |
| `initialPw` | 先生 | 先生。`$sid` は、本人が**消す**ことだけできる |
| `classes` | 先生（全体）。`$classId` はその組の一員も | 先生 |
| `members` | 先生（全体）。`$classId/$sid` は本人も | 先生。数だけ |
| `memberOf` | 先生（全体）。`$sid` は本人も | 先生 |
| `units` | 先生と、`accounts` に対応のある生徒 | 先生 |
| `lessons/$classId`、`thumbs/$classId` | 先生と、その組の一員 | 先生 |
| `records/$classId` | 先生。`$lessonId/$sid` は本人も | 本人だけ（その組の一員で、その授業があるとき）。先生は書けない |
| `marks/$sid` | 先生と本人 | 本人だけ（その組の一員）。1〜4 の数 |
| `check` | 段階 0 のまま | 段階 0 のまま |

- `records` の中身は、`memo`・`learned`・`question` が 2000 文字までの文字、`level` が 1〜4 の数、`updatedAt` が数。ほかの項目は受けつけない（1b で項目を足す）。
- 生徒が自分で書きかえられるのは、`records`・`marks` の自分の分と、`initialPw` の自分の分を消すことだけ。`accounts`・`memberOf`・`lessons` は先生しか書けないので、規則と GAS の判断の根拠にしてよい。
- パスワードを出し直すと、古いアカウントの `accounts/<uid>` が消えるので、古いアカウントは何も読めなくなる。
- メール／パスワードのアカウントは、公開している API キーでだれでも作れる。作っただけのアカウントには `accounts` の対応がないので、`gen` と `check` のほかは何も読めない。

1a-1 では、この表の全部を `rules.json` に書く（あとの計画で形を変えないため）。1a-1 の規則の確認画面で確かめるのは 1a-1 の範囲だけで、`lessons` 以降は、それぞれの計画で確認を足す。

## 5. 本番用の GAS の呼び方（1a-2 で作る。ここでは考え方だけ）

- 置き場所は `gas/Code.gs`。確認用の `gas/check/Code.gs` とは別のプロジェクトにする。
- 呼び方は確認用と同じ（`text/plain` の POST、トークンは本文、成否は JSON の `ok`）。
- 本人確認: トークンで `teacherList/<uid>` か `accounts/<uid>` を読む。覚えておくのは 60 秒まで。
- **先生の資料を開けるかどうかは、呼んだ人が送ってきたファイル ID を信じない。** 呼んだ人は `classId`・`lessonId`・`materialId` を送り、GAS が呼んだ人のトークンで `lessons/<classId>/<lessonId>/materials/<materialId>/fileId` を読む。読めたら（＝規則が「その組の一員」と認めたら）、その `fileId` のファイルを返す。
- 1 つの授業の画像は、1 回の呼び出しでまとめて返す。PDF は開くときに 1 つずつ返す。
- 保存と削除は先生だけ。保存は端末が作ったキーを付け、同じキーなら 1 個にする。
- 生徒自身のファイル（1b）は、ファイルの説明に書いた持ち主の生徒 ID と、トークンから分かる生徒 ID を比べて判断する。

## 6. ファイルの分け方（1a 全体）

スライドアプリ（ClassPulse）と同じ分け方にする。

| 置き場所 | 中身 |
|---|---|
| `index.html`、`css/base.css`、`css/app.css` | 1 つのページ。画面は `#/…` で切りかえる |
| `js/main.js`、`js/router.js`、`js/ui.js` | 入り口、ハッシュと画面の対応、画面の部品 |
| `js/net.js`、`js/auth.js`、`js/errors.js` | 通信とログイン。URL や書式を知っているのはここだけ |
| `js/repo.js` | データベースの場所（3 章）を知っているのはここだけ |
| `js/ids.js`、`js/*-logic.js` | 通信をしない計算。`npm test` で確かめる |
| `js/views/*.js` | 画面。1 画面 1 ファイル |
| `js/dev/` | 練習モード（`?demo=1`。localhost だけ） |
| `gas/Code.gs` | 本番用の GAS（1a-2） |
| `docs/setup/` | 手順書と規則 |
