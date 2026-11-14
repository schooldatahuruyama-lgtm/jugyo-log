# 実装指示書: 読みこめなかったときの表示と、新しい版の知らせ

あなた（Codex）は、この指示書に沿ってコードを書きます。進め方は `AGENTS.md` の「実装を頼まれたとき」のとおりです。

## 目的

公開のあとに、本番で 2 つのことが起きた（`docs/reports/ui-and-terms-check.md` の「気づいたこと」）。

1. 配信元が 1 つのファイルに 503 を返し、アプリが「読みこんでいます…」のまま進まなかった。
2. 前から開いていたブラウザで、読みこみ直すまで古い画面（古いファイル）が出た。

生徒が黙って待ち続けたり、古い画面を使い続けたりしないように、文とボタンを出す（要件定義書 `docs/requirements.md` の「UI/UX 方針」）。

## 変える・作るファイル

- 作る: `js/version.js`、`js/version-check.js`、`tests/version-check.test.js`
- 変える: `index.html`、`js/main.js`、`css/app.css`、`tools/pages-branch.ps1`、`README.md`（数行）
- ほかのファイルは変えない。`check.html` は変えない。

## 1. はじめの読みこみに失敗したとき（`index.html`）

`js/main.js` と、そこから読むファイルのどれかを読みこめないと、`main.js` は 1 行も動かない。だから、この見張りは `index.html` の中に、module ではないふつうの `<script>` で直接書く（ほかのファイルを読まない）。`<script type="module" src="js/main.js">` より前に置く。

- `window.__jugyologBoot = { started: false }` を作る。`js/main.js` は、`start()` のはじめで `window.__jugyologBoot.started = true` にする（オブジェクトが無いときは何もしない）。
- 失敗を出す関数 `showBootFailure()`: `started` が `true` なら何もしない。`#app` の中身を、次に置きかえる（`textContent` と `createElement` で作る。`innerHTML` は使わない）。
  - 見出し「授業ログ」
  - 文（`role="alert"`）: 「読みこめませんでした。電波を確かめて、「もう一度」を押してください。」
  - ボタン「もう一度」（`class="btn btn-primary"`）: 押すと `location.reload()`。
- `showBootFailure()` を呼ぶとき:
  - module の `<script>` の `error` イベント（どれかのファイルを取れなかった）。
  - `window` の `error` イベントで、`started` が `false` のとき（構文の誤りなどで `main.js` が動かなかった）。
  - ページを開いてから 20 秒たっても `started` が `false` のとき（`setTimeout`）。
- 表示のあとでアプリが動き出したら、アプリが `#app` を書きかえるので、文は自然に消える（今の `render()` のまま）。

## 2. 画面のファイルを読みこめなかったとき（`js/main.js`）

今は、`loadView` の `import()` が失敗すると「この画面は、まだありません。」と出る。これは、電波が切れたときには合わない文。

- `viewFile(name)` が無い（画面が決まっていない）ときは、今までどおり `placeholder`。
- `import()` が失敗したとき、または読めたのに `mount` が関数でないときは、`showMessage('画面を読みこめませんでした。電波を確かめて、もう一度ためしてください。', { retry })`。`retry` は `location.reload()`（同じ `import()` をやり直しても、ブラウザによっては失敗を覚えているため）。
- この時点では、前の画面は片付け済み（`teardown()` のあと）なので、離れるかの確かめは要らない。

## 3. 新しい版の知らせ

### `js/version.js`

```js
// 公開するとき、tools/pages-branch.ps1 がこの中身を、公開したコミットの印に置きかえる。
export const VERSION = 'dev';
```

### `tools/pages-branch.ps1`

pages ブランチの木を作るとき、次の 2 つを、リポジトリのファイルではなく、その場で作った中身で入れる（`.nojekyll` と同じやり方）。`<short>` は `git rev-parse --short HEAD` の結果。

- `js/version.js`: 中身は `export const VERSION = '<short>';` と改行（HEAD の `js/version.js` を置きかえる）。
- `version.txt`: 中身は `<short>` と改行。

master の `js/version.js` は `'dev'` のまま（作業ツリーは変えない）。スクリプトのほかの動きは変えない。

### `js/version-check.js`（計算だけ。画面と通信を持たない）

- `parseVersion(text) → string | null`: 前後の空白を取り、`/^[0-9a-f]{7,40}$/` に合えばその文字、合わなければ `null`（文字でない値も `null`）。
- `isNewVersion(current, published) → boolean`: `current` が `'dev'` または `parseVersion` で `null` → `false`。`published` が `parseVersion` で `null` → `false`。両方が正しい形で、ちがう文字のときだけ `true`。
- `shouldCheck(now, lastCheckedAt, intervalMs) → boolean`: `lastCheckedAt` が `null` なら `true`。`now - lastCheckedAt >= intervalMs` なら `true`。数でない・負の差（時計が戻った）は `true`。

### `js/main.js`

- 練習モード（`backend.demo`）と、`VERSION === 'dev'` のときは、何もしない（通信もしない）。
- 確かめるとき: 画面を描き直すたび（`render()` の終わり）と、タブが見える状態に戻ったとき（`visibilitychange` で `document.visibilityState === 'visible'`）。ただし `shouldCheck(now(), last, 5 分)` が `true` のときだけ。同時に 2 つ走らせない。はじめの 1 回は、開いてから 5 分たってからでよい（`last` のはじめの値を、開いた時刻にする）。
- 確かめ方: `fetch('version.txt', { cache: 'no-store' })`。`ok` でない・取れない・形が合わないときは、**何も出さずに**やめる（次の機会にまた試す。電波が無いことは、ほかの表示が知らせる）。画面の描き直しを待たせない（`await` で `render()` を止めない）。
- `isNewVersion(VERSION, 取れた文字)` が `true` なら、`#banner` に知らせを出す（練習モードの帯があるときは、それを消さずに、その下に足す。同じ知らせを 2 つ出さない。一度出したら、それ以上は確かめない）。
  - 文（`role="status"`）: 「新しい版があります。「読みこみ直す」を押してください。」
  - ボタン「読みこみ直す」（44×44px 以上）。
- 「読みこみ直す」を押したとき:
  1. `leave.ask()` で、今の画面を離れてよいかをたずねる（書きかけの保存を待つ、今ある確かめ）。`false` なら、何もしない（知らせは残す）。
  2. ボタンを押せなくして、文を「読みこみ直しています…」にする。
  3. 古いファイルがブラウザに残らないよう、`performance.getEntriesByType('resource')` のうち、このアプリと同じ置き場所（`new URL('.', location.href)` で始まる）の `.js`・`.mjs`・`.css` と、`index.html` を、`fetch(url, { cache: 'reload' })` で取り直す（失敗は無視する。全体で 10 秒まで待つ）。
  4. `location.reload()`。
- 見た目（`css/app.css`）: 画面の上に、横いっぱいの帯。背景 `--teacher-bg`、下に 2px の線 `--teacher`、文字は `--c-navy`、文とボタンは横に並び、せまいときは折り返す。横にはみ出さない（820px でも）。

## 端の場合

- 不正な入力: `version.txt` の中身が、空・長すぎる・印の形でない（エラーのページの HTML など）ときは、新しい版とみなさない。`VERSION` が `'dev'` や形のおかしい値のときも、知らせを出さない。
- 重複と境界: 知らせは 1 つだけ。5 分より短い間に何度画面を移っても、通信は 1 回。確かめの通信の途中でもう一度きっかけが来ても、2 つ目は始めない。同じ版なら何も出さない。はじめの読みこみの見張りは、アプリが動き出したあとは何もしない（20 秒のタイマーが来ても、画面を書きかえない）。「読みこみ直す」を続けて押しても、動くのは 1 回。
- 違反や失敗の見せ方: はじめの読みこみの失敗と、画面のファイルの失敗は、文（`role="alert"`）と「もう一度」ボタンで見せる（黙って待たせない）。新しい版は、上の帯で見せる。版の確かめの通信の失敗だけは、利用者に関係がないので出さない。離れるかの確かめで残ることを選んだら、読みこみ直さない。

## 追加するテスト（`tests/version-check.test.js`。今あるテストの書き方に合わせる）

- `parseVersion`: `'abc1234\n'` → `'abc1234'`。40 文字の印 → そのまま。`''`・`'dev'`・`'<!doctype html>'`・6 文字・41 文字・大文字・`null`・数 → `null`。
- `isNewVersion`: `('abc1234', 'def5678')` → `true`。同じ → `false`。`('dev', 'def5678')` → `false`。`('abc1234', '')` → `false`。`('abc1234', '<html>')` → `false`。`('abc1234', 'def5678\n')` → `true`。
- `shouldCheck`: `(1000, null, 300000)` → `true`。`(300999, 1000, 300000)` → `false`。`(301000, 1000, 300000)` → `true`。`(500, 1000, 300000)` → `true`。`(NaN, 1000, 300000)` → `true`。

## 確かめ

- `npm test` がすべて成功する。変えた・作った `.js` は `node --check` が通る。
- `tools/pages-branch.ps1` は実行しない（git の状態を変えるため）。中身を読んで確かめたことを報告に書く。
- 手元の実行（代役でよい）で、次を確かめて報告に書く: (1) `main.js` から読むファイルを 1 つ取れないようにすると、「読みこめませんでした。…」と「もう一度」が出る。(2) 画面のファイルの `import()` が失敗すると、「画面を読みこめませんでした。…」が出る。(3) `VERSION` と `version.txt` がちがうと、帯が出る。同じなら出ない。

## 守ること

- `git add`・`git commit`・ブランチの操作はしない。
- 画面に出す文字は `textContent` で入れる。`innerHTML` を使わない。
- 入力・保存・添付・重要用語・離れるときの確かめの、今の動きは変えない。
- 秘密の値を書かない。

## 報告

変更したファイル、テストの結果、指示書と違う点・判断したことを、日本語の Markdown で報告する。
