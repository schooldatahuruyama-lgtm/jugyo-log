# 実装指示書: 先生の「クラス」の一覧に、理科クエストの進み具合への入口を足す（段階 4・授業ログ側）

あなた（Codex）は、この指示書に沿ってコードを書きます。進め方は `AGENTS.md` の「実装を頼まれたとき」のとおりです。

## 目的

設計書 `docs/superpowers/specs/2026-11-19-rika-link-design.md` の段階 4「先生の確認」。進み具合の画面そのものは、理科クエスト（となりのフォルダ。別の指示書）の「先生用の確認画面」に作る。授業ログ側は、先生の「クラス」の一覧から、そのクラスの進み具合を開く入口だけを足す。規則（`docs/setup/rules.json`）は変えない。

## 変えるファイルと内容

### 1. `js/rika-link.js`

- `rikaProgressUrl(baseUrl, classId)` を足す（純粋な関数）。
  - `rikaEntryUrl(baseUrl)` が `null`（HTTPS でない・形がおかしい）なら `null`。
  - `classId` が `/^[A-Za-z0-9]+$/` に合わなければ `null`。
  - 返すのは、もとのアドレスに `teacher=1` と `class=<classId>` の 2 つを付けたもの（`URL` と `searchParams.set` で作る。もとのアドレスにあった問い合わせの部分は残す。`#` より後ろは付けない）。

### 2. `js/views/teacher-classes.js`

- 各クラスの行の「単元を決める」のとなりに、リンク「進み具合を見る」を足す。
  - `el('a', { class: 'btn', href: rikaProgressUrl(CONFIG.rika?.url, cls.id), target: '_blank', rel: 'noopener noreferrer', text: '進み具合を見る', 'aria-label': '<クラスの名前> の理科クエストの進み具合を見る（別のタブで開きます）' })`
  - `rikaProgressUrl` が `null` のときは、リンクを出さない。
  - このリンクは、単元を読みこめていないとき（`listClassUnits` の失敗）も出す（単元の表示とは別のもの）。
- 見た目は、今ある行のボタンに合わせる（高さ 44px 以上、幅 375px で横にはみ出さない）。必要なら `css/app.css` に少し足す。

### 3. 文書

- `README.md` の先生の「クラス」の説明に 1〜2 文足す: 「進み具合を見る」を押すと、別のタブで理科クエストの先生の画面が開き、そのクラスの生徒の進み具合が出ること。授業ログに先生としてログインしているブラウザで開くこと。

## 端の場合

- 不正な入力: `CONFIG.rika.url` が無い・`http://`・形がおかしい → リンクを出さない。クラスの id に記号がある（ふつうは無い）→ リンクを出さない。
- 重複と境界: クラスが 0 個 → 今までどおり。クラスごとに、そのクラスの id のリンクになる。
- 違反や失敗の見せ方: リンクを出せないときは、何も出さない（理科クエストの設定が無い環境のため）。

## テスト

- `tests/rika-link.test.js`（今あるテストに足す。無ければ、`rikaEntryUrl` のテストのある所に足す）: `rikaProgressUrl` — ふつうのアドレス、末尾の `/` の有無、もとに問い合わせがある、`http://` → `null`、id に記号 → `null`、空の id → `null`。
- `tests/class-unit-screen.test.js`: 各行にリンクがあり、`href` がそのクラスの id を持ち、`target="_blank"`・`rel` に `noopener` がある。`listClassUnits` が失敗してもリンクは出る。
- `npm test` がすべて成功すること。

## 守ること

- `git add`・`git commit` はしない。パッケージを足さない。
- 変えてよいのは、上に書いたファイルとテストだけ。規則・`js/rules-probe.js`・GAS・`check.html` は変えない。
- このフォルダの外（となりの `理科アプリ` もふくむ）は読まない・変えない。

## 報告

変更したファイル、テストの結果、指示書と違う点・自分で決めた点・確かめられなかった点を、日本語の Markdown で報告する。
