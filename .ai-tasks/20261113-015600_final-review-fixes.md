# 全体レビューの指摘への対応（段階 0）

目的: 段階 0（設計書 6 章）の全体レビューで出た指摘を、1 回でまとめて直す。

守ること: 既存の公開の関数名・戻り値の形・画面の項目名・既存のエラー文は変えない。`innerHTML` を使わない。報告の文にトークン・パスワード・メールアドレス・uid を入れない。外部パッケージを入れない。git の状態を変えない。指示にない変更をしない。完了の条件は `npm test` がすべて成功すること。

## 1.（Important）確認が終わったあとの片付けの手順
- `docs/setup/gas.md` の「確認が終わったら」に足す: 「デプロイ」→「デプロイを管理」→ 接続確認のデプロイ →「アーカイブ」で公開をやめる。理由（公開したままだと、URL を知っている人が先生の Drive に確認用の写真を置けるため）を 1 文で書く。フォルダ「授業ログ_接続確認」を消してよいことは残す。
- `docs/setup/firebase.md` に「確認が終わったら」を足す: 段階 1a まで日があくときは、Authentication の「メール／パスワード」を無効にする（だれでもアカウントを作れる状態を閉じる）。再開するときは有効に戻す。
- `README.md` の先生の手順の最後に、「結果を伝え終わったら、`docs/setup/gas.md` と `docs/setup/firebase.md` の『確認が終わったら』を行う」を足す。

## 2. データベースのエラーの理由を報告に出す（`js/check-steps.js`、`tests/check-steps.test.js`）
- Realtime Database の REST は、エラーを `{"error":"Permission denied"}` のように **文字列** で返す。いまは `error.message` しか見ないので、いつも `UNKNOWN` になる。
- `body.error` が文字列のときは、決まった一覧（`Permission denied` → `PERMISSION_DENIED`、`Auth token is expired` → `TOKEN_EXPIRED`、`Could not parse auth token.` → `BAD_TOKEN`。大文字小文字と末尾の句点は無視）に当たるものだけをその名前で出し、当たらなければ `UNKNOWN`。
- Firebase（データベースとログインの両方）の失敗の文に、HTTP の状態番号を「HTTP 401」の形で足す（例: `…（PERMISSION_DENIED、HTTP 401）`）。既存の文の前半は変えない。既存のテストがこの追加で落ちる場合は、テストの期待を新しい形に合わせる。
- テストを追加: 401 と `{"error":"Permission denied"}` → 文に `PERMISSION_DENIED` と `HTTP 401`。404 と HTML の本文 → `UNKNOWN` と `HTTP 404`。`error` の文字列に機密風の値が入っていても文に出ない。

## 3. `check/ping` が文字列の "true" のとき
- `docs/setup/firebase.md` の手順 4 に足す: 値の種類を選ぶ欄があれば「boolean」を選ぶ。できあがりで `true` に引用符（" "）が付いていないことを確かめる。
- `js/check-steps.js` の `readPing`: 読んだ値が文字列の `"true"` のときは、専用の文「check/ping が文字の "true" になっています。種類を boolean にしてください」で失敗にする。テストを 1 件足す。

## 4. 後片付けでデータベースの数値も消す（`js/check-steps.js`、テスト）
- `cleanup()` で、アカウントを消す前に `check/<uid>` へ DELETE を送る。失敗しても投げず、詳細に「データベースの後片付けができませんでした（…）」を足して、アカウントの削除へ進む。成功のときの詳細の文は今のままでよい（足す場合は短く）。
- テスト: cleanup で DELETE が `accounts:delete` より前に呼ばれる。DELETE が失敗してもアカウントの削除が呼ばれる。

## 5. GAS の設定まちがいを見分ける（`gas/check/Code.gs`、`js/check-steps.js`、テスト）
- スクリプト プロパティ `DATABASE_URL` が空のとき、トークンの要る操作は `{ ok:false, error:'config' }` を返す（`ping` は今のまま）。
- `js/check-steps.js` の GAS の既知のコードに `config` を足す。
- `docs/setup/gas.md` の「うまくいかないとき」に相当する場所（無ければ末尾に作る）に 1 行: 確認ページに `config` と出たら、手順 3 のスクリプト プロパティを見直す。
- テスト: `tests/gas-check.test.js` に、`DATABASE_URL` なしで `put` が `config`。`tests/check-steps.test.js` に、`config` がそのまま文に出る。

## 6. 古い iPadOS でページが黙って止まらないようにする（`check.html`、`tests/check-page.test.js`）
- HTML に直接、`id="boot-note"` の段落を置く:「読み込み中です。このままの場合は、iPadOS が古い可能性があります。端末の情報（設定 → 一般 → 情報）を Claude Code に伝えてください。」モジュールのスクリプトの最初で、この段落を `hidden` にする。
- `<noscript>` に「JavaScript が使えないため、確認できません。」を置く。
- テスト: `check.html` に `id="boot-note"` と `<noscript>` がある。

## 7. 文書の注記
- `docs/reports/stage0-check.md` の「同時 40 回の結果」の欄に注記を足す: この確認は、1 台の端末が約 0.4MB の写真を 40 回同時に受け取る（合わせて約 15〜20MB）。失敗や時間切れには、その端末の回線の速さも混ざる。また、本人確認は直前の項目で済んでいるため、本番（生徒 40 人がそれぞれ最初の確認をする）より軽い。実際のクラスで同時に開く確認が別に要る。
- 同じ用紙の「最初の実行で見ること」として、次を箇条書きで足す: 項目 2 の詳細に出たドメイン。後片付けが × で `CREDENTIAL_TOO_OLD_LOGIN_AGAIN` と出たら、時間がかかりすぎ。項目 10 の数字が Drive の画面と大きく違う（0MB やとても大きい数）場合は、学校全体の値の可能性。項目 6 が ×「つながりませんでした」なら、まず GAS の公開の設定（「全員」になっているか）を疑う。
- `README.md` の公開の手順に足す: GitHub に新しいリポジトリを作る段（先生の作業。Pages を無料で使うにはリポジトリを公開にする必要があり、その場合 `master` に入れたファイル（`docs`、`gas`、`tests`、`.ai-tasks`、`.ai-review` を含む）はすべて見える）。公開したあと、設定の変更が届くまで 10 分ほどかかることがある（古い表示のままなら、待ってから読み直す）。
