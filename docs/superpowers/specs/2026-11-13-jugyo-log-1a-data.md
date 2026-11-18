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

ID（`classId`・`unitId`・`lessonId`・`materialId`・`termId`）は、端末で作る 12 文字の英数字。生徒 ID は `s<入学年度の下 2 桁>-<3 桁の連番>`（例 `s26-017`）。

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
lessons/<classId>/<lessonId>: { date, title, unitId, materials, terms, createdAt, updatedAt } … 1a-2・重要用語
lessons/<classId>/<lessonId>/terms/<termId>: "光の反射"   先生の重要用語
terms/<studentId>/<classId>/<lessonId>/<t1〜t8>: "鏡の実験"   生徒が足した用語
thumbs/<classId>/<lessonId>/<materialId>: "<data URL>"   一覧用の小さい画像          … 1a-2
records/<classId>/<lessonId>/<studentId>: { memo, level, learned, question, updatedAt, attachments, ink, inkCleared, inkPages, inkPagesCleared } … 1a-3・1b-1・1b-2・PDF への書きこみ
records/<classId>/<lessonId>/<studentId>/attachments/<a1〜a6>: { type, fileId, bytes, addedAt } … 1b-1
recThumbs/<classId>/<lessonId>/<studentId>/<a1〜a6>: "<data URL>"   添付の小さい画像 … 1b-1
records/<classId>/<lessonId>/<studentId>/ink/<place>: { fileId, bytes, strokes, updatedAt, on? } … 1b-2・写真への書きこみ
records/<classId>/<lessonId>/<studentId>/inkCleared/<place>: 数（空にした時刻） … 1b-2・写真への書きこみ
records/<classId>/<lessonId>/<studentId>/inkPages/<place>/p<N>: { fileId, bytes, strokes, updatedAt, on } … PDF のページへの書きこみ
records/<classId>/<lessonId>/<studentId>/inkPagesCleared/<place>/p<N>: 数（空にした時刻） … PDF のページへの書きこみ
inkThumbs/<classId>/<lessonId>/<learned・question>/<studentId>: "<data URL>" … 1b-2（メモの画像は置かない）
marks/<studentId>/<classId>/<lessonId>: number   理解度（1〜4）。一覧の印に使う       … 1a-3
replies/<classId>/<lessonId>/<studentId>: { text?, seen?, updatedAt }   先生の返事 … 段階 2
replyMarks/<studentId>/<classId>/<lessonId>: number   返事の updatedAt と同じ数 … 段階 2
aiSummaries/<classId>/<lessonId>: { v: 1, createdAt, model, basedOn: { count, latest }, labels: { <呼び名>: <studentId> }, overview, questionGroups, misconceptions, nextLesson, followUp } … AI のまとめ
check/…                                      段階 0 の確認用（そのまま残す）
```

- `lessons/.../materials/<materialId>`: `{ kind: 'board'|'handout', type: 'image'|'pdf', fileId, name, order, bytes }`。`fileId` は Drive のファイル ID。
- 先生の重要用語は `lessons` の中に置き、1 授業につき 8 個まで、1 つ 20 文字まで。追加・削除は、用語 1 つと `updatedAt` を 1 回の update で変える。授業の編集・資料の追加や削除では `terms` を残す。
- 生徒が足した用語は `terms` に生徒 ID ごとにまとめ、`t1`〜`t8` に 1 つ 20 文字まで置く。`terms/<studentId>/<classId>` を 1 回読むと、そのクラスの全授業の自分の用語がそろう。本人と先生だけが読める。
- 用語は前後の空白を取り、中の改行・タブ・連続した空白を 1 つの空白にしてから文字数を確かめる。検索と重複の比較では NFKC・小文字・ひらがなにそろえ、空白を除く。表示は整えた文字のまま。先生の用語を先にし、同じ用語は最初の 1 つだけ出す。重なっている自分の用語も保存した値は消さない。
- `date` は `'YYYY-MM-DD'`。
- AI のまとめは先生だけが読み書きする。`overview` は 600 文字まで。`questionGroups` は `{ topic, numbers, example }` を 6 件、`misconceptions` は `{ number, quote, note }` を 8 件、`nextLesson` は文字を 3 件、`followUp` は `{ number, reason }` を 8 件まで。`topic`・`note`・`reason`・次の授業の各項目は 200 文字、`example`・`quote` は 300 文字まで。生徒の呼び名は `N番` または `名簿外N`（N は 1〜99）。まとめを作ったときの「呼び名 → 生徒 ID」の対応（`labels`）を、同じ場所（先生だけが読める）に保存し、呼び名のボタンはこの対応だけで生徒を引く。OpenAI には、呼び名だけを送り、ID と対応は送らない。`labels` の無い古いまとめは、呼び名を文字だけで出す。
- OpenAI に送る前に、文の中の決まった形（生徒の ID・メールアドレス・10 けた以上の数字）を伏せる。文の中に書かれた名前は、見分けられないので、そのまま送られる（画面と手順書に書いてある）。
- `basedOn` は送った先頭 60 人までの人数と、その記録の `updatedAt` の最大。文字のない記録は含めない。同じ授業の作り直しは上書きし、授業を消す update でまとめも消す。空配列がデータベースで省かれた場合は、読み取り時に空配列へ戻す。
- AI の規則確認は 5 行（先生の書く・読む・overview なしの拒否、生徒の読む・書くの拒否）。確認用のまとめは先生が片付け、応答が失われた場合も消す。片付けに失敗した残りは、次回の年度 0 のクラスの片付けで消す。
- 理解度の数: 4 よく分かった／3 分かった／2 あまり分からなかった／1 全然分からなかった。選んでいなければ項目を置かない。
- `members` と `memberOf` は、必ず 1 回の書きこみ（ルートへの複数パスの update）で一緒に変える。
- 先生の返事は生徒 1 人・授業 1 回につき 1 つ。`text` は 1〜400 文字、`seen` は `true` だけで、どちらかが必須。空の文と `false` は保存しない。改行を `\n` にそろえて前後の空白を取り、中の改行を残す。文字数は記録と同じ JavaScript の `length`（UTF-16 の単位）で数える。文が文字でなければ空、印が厳密に `true` でなければ印なしとして扱う。
- `setReply` は整形後に空または 400 文字超過なら `TypeError` とし、両方なくすときは `removeReply` で削除する。更新時刻は有限の数を渡す。`replies` と `replyMarks` は必ず同じ 1 回のルート update で保存・削除する。記録のない生徒にも保存でき、再保存は同じ場所の返事と時刻を置きかえる。
- `getReply`・`listReplies` は読み取った値を整え、物でない値、不正な時刻、400 文字を超える文、文も印もない返事を落とす。`getReplyMarks` は数でない値を落とす。`deleteLesson` は返事の生徒 ID を `shallow: true` で先に読み、授業・資料の小さい画像・返事・該当する生徒の目印を同じ update で削除する。浅い読みが失敗したら何も消さず失敗を伝える。
- 文字の記録の保存は、`records` の `memo`・`learned`・`question`・`updatedAt`・`level` と `marks` を、1 回のルートへの複数パスの update で一緒に変える。`level` が未選択なら `level` と `marks` を `null` で消す。記録全体は置きかえず、`attachments`・`ink` を残す。
- 生徒の添付（1b-1）は、置き場所を `a1`〜`a6` に固定し、1 回の授業につき 6 個まで。目録は `{ type: 'image'|'pdf', fileId, bytes, addedAt }`。元のファイル名は保存しない。足した日時（`addedAt`）の古い順、同じ日時なら置き場所順に並べ、写真と PDF をそれぞれ 1 から数えて「写真 1」「PDF 1」と出す。
- 添付の追加は、目録の置き場所 1 つと、文字の小さい画像があれば `recThumbs` の同じ置き場所を、1 回の update で書く。削除は目録と小さい画像を 1 回の update で消す。書きこみの目録か削除時刻がある場合は、`max(now, serverInkTime(record, slot) + 1)` を使い、同じ update で `ink/<slot>` を消して `inkCleared/<slot>` を残す。その後、写真と書きこみのファイルを片付ける。どちらも文字の記録と `updatedAt`・`marks` は変えない。
- 小さい画像を `recThumbs` に分けて置き、一覧を並べるだけでは GAS を呼ばない。本体は押したときに取り出して端末に取っておく。
- 手書き（1b-2）は、`memo`・`learned`・`question` ごとに線の JSON を Drive へ保存し、`ink` に目録を置く。`learned`・`question` の小さい画像は `inkThumbs` に分け、目録と 1 回の update で書く。文字・理解度・記録全体の `updatedAt`・`marks` は変えない。画像の引数が `undefined` なら維持、`null` なら削除、文字なら保存する。線が 0 本なら目録と画像を消し、同じ update で `inkCleared/<field>` に書いた時刻を残す。新しく手書きを保存するときは、目録と同じ update でその欄の `inkCleared` を消す。`memo` は画像の引数にかかわらず目録と削除時刻だけを変え、画像に触らない。
- 写真への書きこみでは、`place` を欄（`memo`・`learned`・`question`）、自分の添付（`a1`〜`a6`）、先生の資料 ID の 3 種類に広げる。資料 ID は画面の `newId(random, CONFIG.idLength)` と同じ英数字 12 文字で判定する（GAS の `MATERIAL_ID_RE` は英数字 1〜40 文字を許すが、画面の生成は 12 文字）。写真の目録には対象写真のファイル ID を `on`（1〜200 文字）として持たせ、欄には付けない。`pictureIndex` は `on` が一致するときだけ目録を返し、写真の入れ替え前の書きこみを出さない。写真への書きこみには小さい画像を作らず、先生の一覧・コピーの「手書き N 件」も欄だけを数える。
- 写真の線の JSON は `{ v: 1, k: 'pic', h, s }`。横 800、高さは `round(800 * naturalHeight / naturalWidth)` を 100〜4000 におさめた整数で、400 の倍数にはしない。寸法が正の有限の数でなければ高さ 600。`cleanInk` も写真の高さを四捨五入して範囲におさめ、不正な高さは 600 にする。写真には紙を足せない。欄の JSON はこれまでどおり `k` を付けず、400 単位の高さにする。PDF の各ページもこの形を使い、`emptyPictureInk` にページの寸法を渡す。
- PDF への書きこみはページごとに別ファイル・別目録とし、1 ページにつき線 2000 本・250000 文字まで。コードでは `<場所>#p<N>`（例: `a1#p3`、`Abc123Def456#p12`）を使う。元の場所は添付または資料 ID、N は先頭に 0 のない 1〜999 の整数に限り、欄のページ名は認めない。`inkPagePlace` で作り、`splitInkPlace` で分け、`hasPageInk` は同じ場所・同じ `on` の目録の有無を返す。
- DB は `#` をキーにできないため、PDF の目録を `inkPages/<場所>/p<N>`、削除時刻を `inkPagesCleared/<場所>/p<N>` に置く。`getRecord`・`listRecords` はこれらを `ink`・`inkCleared` の平らなページ名に変換し、不正な場所・ページ・目録・数でない時刻を落とす。ページの `on` は対象 PDF のファイル ID（1〜200 文字）を必須とする。保存は目録と削除時刻の消去、全消去は目録の消去と削除時刻を、それぞれ同じ update で行い、小さい画像は書かない。
- PDF の保存前と `denied` 後の存在確認は、元の場所の添付・資料が `type === 'pdf'` かつ `fileId === on` であることを確かめる。PDF がない・入れ替わった・写真になった場合は `gone: true`。競合・再送は写真と同じ流れを使う。下書きの保存先も `<場所>#p<N>` を含む名前でよく、`:` での区切りは変わらない。ページの下書きも `on` が必要。
- 添付のページ目録かページの削除時刻があれば、`removeAttachmentFlow` は写真とその添付の全ページの `serverInkTime` の最大に 1 を足した時刻と `now` の大きいほう、および目録があるページ番号だけを渡す。`removeAttachment` は `inkPages/<slot>` 全体を消し、指定されたページの削除時刻を同じ update で残す。削除時刻だけのページは既存値を維持する。ページ一覧は配列の整数 1〜999 に限り、渡す場合は有限の `clearedAt` が必要。DB の削除後に元の添付・写真の書きこみ・各ページの書きこみのファイルを片付け、片付けの失敗は無視する。画面は Task 2 で追加する。
- 写真の保存前には、添付なら読んだ記録の同じ置き場所、資料なら `getLesson` の `materials[place]` に、`type === 'image'` かつ `fileId === on` の写真があることを確かめる。なければアップロードせず `{ index: null, superseded: true, gone: true, record }` を返す。時刻の比較は欄と同じ。`denied` 後の成功判定は写真では `on` の一致も必要で、成功でも時刻による `superseded` でもなければ写真の存在をもう一度確かめる。写真がなければ今回のファイルを片付けて `gone` を返す。新しい保存の成功後には `on` が違う前の書きこみファイルも片付ける。
- 授業から外された資料への書きこみは目録に残るが、表示しない。書きこみの JSON は従来どおり生徒本人と先生だけが読み、Drive のファイルは共有しない。
- 先生の一覧では `listInkThumbs(classId, lessonId, field)` で、今出している欄の全員分を 1 回で読む。`field` は `learned`・`question` だけで、それ以外は `TypeError`。文字でない値は落とし、`{ [studentId]: データ URL }` を返す。
- 手書きの保存順は、アップロード → 目録 → 古いファイルの片付け。目録の保存・全消去が `denied` なら記録を読み直す。同じ `fileId`・`updatedAt === editedAt` の目録（全消去なら目録が無く `inkCleared[field] === editedAt`）があれば、自分の保存が届いていたものとして成功にする。それ以外でサーバーの時刻が `editedAt` 以上なら、今回アップロードしたファイルを片付け、新しい記録を `superseded` として返す。サーバーの時刻が古ければ、今回のファイルを片付けて元の `denied` を返す。読み直しに失敗したらそのエラーを返し、同じキーで再送できるようファイルを残す。通信失敗でもファイルを残し、片付けの失敗は保存結果を変えない。壊れた JSON の読み取りは `bad-data` にする。
- 目録に入らなかったアップロードの ID はページを開いている間だけ覚え、保存成功時に現在の目録以外を片付ける。ページを閉じて覚えが消えた分は片付けず、目録からは見えない小さいファイルが Drive に残る。
- 手書きの端末下書きは `jugyolog:ink:<studentId>:<classId>:<lessonId>:<place>` に `{ ink, editedAt, key, on? }` を置く。写真の場所では文字の `on` がない下書きを読まず、欄では `on` を落とす。自動保存・やり直し・再送は授業ごとの順番待ちの中でサーバーの記録を読み、目録の `updatedAt` と `inkCleared` の大きいほうが下書きの `editedAt` 以上なら保存せず、古い下書きを捨てる。写真がなくなった `gone` も `dropped` として捨てる。授業ページでは新しい記録を表示して知らせるが、待つ間に書き足した線は残して保存を続ける。送信中に変わった下書き（`on` だけの変更も含む）や失敗した下書きは残す。ログアウトで全員分の手書き下書きを消す。
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
| `lessons/$classId` | 先生と、その組の一員。`lessons` は先生が全体を読める | 先生（授業 1 つの場所から下）。記録がある授業は、まるごとは消せない |
| `thumbs/$classId` | 先生と、その組の一員 | 先生 |
| `records/$classId` | 先生。`$lessonId/$sid` は本人も | 本人だけ（その組の一員で、その授業があるとき）。先生は書けない |
| `recThumbs/$classId` | 先生。`$lessonId/$sid` は本人も | 本人だけ（その組の一員で、その授業があるとき）。`records` と同じ式。先生は書けない |
| `inkThumbs/$classId/$lessonId/$field` | 先生。`$sid` は本人も | 本人だけ（その組の一員で、その授業があるとき）。`records` と同じ式。先生は書けない |
| `marks/$sid` | 先生と本人 | 本人だけ（その組の一員）。1〜4 の数 |
| `replies/$classId` | 先生（クラス全体）。`$lessonId/$sid` は本人も | 先生だけ。記録の有無は問わない |
| `replyMarks/$sid` | 先生と本人 | 先生だけ。`$classId/$lessonId` は数 |
| `terms/$sid` | 先生と本人（`marks/$sid` と同じ式） | `$classId` から下に本人だけ（その組の一員。`marks/$sid/$classId` と同じ式）。先生は書けない |
| `check` | 段階 0 のまま | 段階 0 のまま |

- `records` の中身は、`memo`・`learned`・`question` が 2000 文字までの文字、`level` が 1〜4 の整数、`updatedAt` が数。1b-1 で `attachments`、1b-2 で `ink`・`inkCleared`、PDF への書きこみで `inkPages`・`inkPagesCleared` を追加する。それ以外の項目は、今までどおり `$other: false` で受けつけない。
- `replies` は数の `updatedAt` と、`text` または `seen` が必須。`text` は 1〜400 文字、`seen` は `true` のみで、ほかの項目は受けつけない。生徒は自分の返事 1 件だけを読み、授業全体やほかの生徒の返事は読めない。返事・目印とも生徒は書けない。
- 先生の返事の確認は 12 行。AI のまとめの 5 行も合わせ、規則の確認は合計 107 行。先生の 400 文字の文・印だけの返事・数の目印は通り、時刻だけ・401 文字・`seen: false` は別々の行で拒否を試す。本人の返事と目印の読み取りは通り、本人の書きこみ・ほかの生徒の返事と授業全体の返事の読み取りは拒否される。権限の根拠となる `accounts` などの書きかえを試す前に行う。規則を個別に試すときだけ本文と目印を別々に書き、先生として同じ update で片付ける。応答だけ失われた場合も削除し、削除が失敗したら × を出して次回に年度 0 のクラスの残りを片付ける。
- `attachments` は子を持つ目録。`$aid` は `/^a[1-6]$/` に合うものだけで、7 個目の置き場所は受けつけない。各項目には `type`（`'image'` または `'pdf'`）・`fileId`（1〜200 文字の文字）・`bytes`（0 以上の数）・`addedAt`（数）の 4 つを必須とし、ほかの項目は受けつけない。同じ置き場所への再送は置きかえになる。呼ぶ側は、保存済みと送信中の置き場所を数え、空きだけを使う。
- すでに目録がある置き場所への書きこみは、同じ `fileId` のときだけ受けつける（`!data.exists() || newData.child('fileId').val() === data.child('fileId').val()`）。別のファイルに入れかえるには先に消す。`null` による削除は今までどおりできる。
- `inkCleared` の場所は `memo`・`learned`・`question`、`a1`〜`a6`、その授業にある資料の ID で、値は数。`getRecord`・`listRecords` は 3 種類の場所を残し、不正値・知らない場所を落とし、無ければ `{}` を返す。
- `ink` は `fileId`（1〜200 文字）・`bytes`（0〜400000 の数）・`strokes`（1〜2000 の整数）・`updatedAt`（数）の 4 項目が必要。欄の `on` は禁止。添付は書きこみ後の記録にある同じ置き場所、資料はその授業の `materials` にある同じ ID の `type` が `image` で、`on` がその `fileId` に一致するときだけ保存できる。写真の `on` は 1〜200 文字で、それ以外の項目は受けつけない。読み取り時は写真の `on` が不正なら目録を落とし、欄の `on` は外す。読み取り・書きこみの権限は `records` と同じ。
- `ink/<field>` の `updatedAt` と `inkCleared/<field>` の時刻は、書きこむ前の同じ欄の目録・削除時刻の両方より新しい場合だけ書ける（同じ時刻は拒否）。前の目録も削除時刻も無い初回は、形が正しければどの時刻でも書ける。消したあとの保存は削除時刻より新しい場合に通る。比較には書きこむ前の `data` を使い、`setInk`・`removeInk` が目録と削除時刻を同じ update で書きかえても、比較と書きこみの間にすき間を作らない。端末の事前比較は通信を減らすために残し、比較後の競合はこの規則で拒否する。
- `recThumbs` の `$aid` は `/^a[1-6]$/` に合う添付の置き場所だけ。値は 20000 文字までの文字。`$classId` の読み取りは `teacherList` で先生を確かめ、`$lessonId/$sid` の読み取りは `accounts` で本人を確かめる。書きこみは本人に限り、`memberOf` の所属と `lessons` の授業の存在も確かめる。
- `inkThumbs` の `$field` は `learned`・`question` だけで、`memo` は置かない。値は 20000 文字までの文字。`$classId/$lessonId/$field` は先生がまとめて読み、その下の `$sid` は本人も読める。書きこみは本人に限り、`memberOf` の所属と `lessons` の授業の存在も確かめる。
- `terms/$sid/$classId` は `newData.hasChildren()`、その下の `$lessonId` は `newData.hasChildren() && root.child('lessons').child($classId).child($lessonId).exists()` で、実在する授業の用語だけを受けつける。`$tid` は `$tid.matches(/^t[1-8]$/) && newData.isString() && newData.val().length >= 1 && newData.val().length <= 20`。削除は `null` で行う。
- 先生の用語は既存の `lessons` の規則をそのまま使う。先生だけが書け、その組の一員が読める。先生の用語の個数と文字数は呼ぶ側で確かめる。公開読み取り（`.read: true`）は引き続き `check/ping` と `gen/$sid` だけ。
- 規則の確認は用語の 6 行・手書きの 14 行・写真の 6 行・PDF の 7 行・先生の返事の 12 行・AI のまとめの 5 行を含む 107 行。用語の置き場所 `t9`・21 文字・ほかの生徒の読み取り・先生の用語への書きこみは拒否を確かめる。手書きは自分の正しい目録・`learned` の画像が通り、知らない目録の欄・`strokes` なし・0 本・ほかの生徒への書きこみ・`memo` の画像・生徒による画像の欄全体の読み取りは拒否を確かめる。形の拒否を試す時刻は目録より新しくし、時刻の拒否に隠されないようにする。先生は画像の欄全体を読めることも確かめる。自分の `ink/memo` を前より古い時刻で書く場合と、`inkCleared/memo` に目録より古い時刻を書く場合は拒否される。目録より新しい数の `inkCleared/memo` への書きこみは通り、`inkCleared/other` は拒否され、確認用の削除時刻も片付ける。所属を消す前に生徒として記録・小さい画像・`terms/<自分>/<入っているクラス>` を片付ける。前回の残りの片付けでも、授業ごとに自分の `inkThumbs` の `learned`・`question` を消す。
- PDF の規則は `inkPages`・`inkPagesCleared` に分け、権限を `records` から引き継ぐ。ページ名は `p1`〜`p999`。添付は更新後の記録、資料は授業にある PDF を確かめ、目録の `on` が一致するときだけ通す。目録の子の値の規則は写真と同じで、`on` を必須にする。削除時刻は添付の場所または授業に実在する資料の場所で数だけを認める。目録・削除時刻とも、書きこむ前の同じページの両時刻より新しい場合だけ通し、同じ時刻は拒否する。写真の `ink`・`inkCleared` の規則は変えない。
- PDF の確認 7 行は、同じ `on` の自分の PDF と授業の PDF 資料のページが通り、違う `on`・`p0`・写真の場所へのページ目録・PDF の場所への写真目録・古い時刻は拒否されることを試す。最初の PDF の行で確認用の `attachments/a2` を用意し、PDF 資料も準備する。Drive に実物は作らず、添付とページ目録は通信の応答が失われた場合も生徒の片付け対象とし、資料は授業と一緒に消す。
- 写真への書きこみの確認は追加の 6 行。自分の写真と同じ `on` の `ink/a1` と、授業の写真の資料と同じ `on` の目録は通る。違う `on` の `ink/a1`、写真がない `ink/a2`、`on` 付きの `ink/memo`、授業にない資料の目録は拒否される。`on` の拒否を試す時刻は既存の目録・削除時刻より新しくする。確認用の写真は既存の添付・資料の準備を使い、Drive にファイルを作らず、書きこみも既存の片付け処理で消す。
- 生徒が自分で書きかえられるのは、`records`・`recThumbs`・`inkThumbs`・`marks`・`terms` の自分の分と、`initialPw` の自分の分を消すことだけ。`accounts`・`memberOf`・`lessons` は先生しか書けないので、規則と GAS の判断の根拠にしてよい。添付の `fileId` は本人が書きかえられるため、ファイルを開けるかどうかの根拠にしない。GAS が保存時に付けた持ち主と、認証した本人で判断する。
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
- 手書き対応は `app-3`。`putStudentFile` は `application/json` を base64 400000 文字まで受け取り、UTF-8 の JSON オブジェクトで `v === 1` か確かめる。ファイルは `serializeInk` の文字で、名前 `s_<key>`・説明 `student:<sid>:<classId>:<lessonId>` を付け「授業ログ_生徒」に置く。`getStudentFile`・`trashStudentFile` を共用し、`getStudentFiles` は写真だけのまま。

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
