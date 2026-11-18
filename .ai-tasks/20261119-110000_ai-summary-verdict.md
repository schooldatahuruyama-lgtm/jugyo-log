# 実装指示書: AI のまとめ — 「まちがい」の印が付いた文だけを残す

あなた（Codex）は、この指示書に沿ってコードを直します。進め方は `AGENTS.md` の「実装を頼まれたとき」のとおりです。

## 目的

`app-5`（指示の文の直し。`.ai-tasks/20261119-100000_ai-summary-correct-not-wrong.md`）を本物の OpenAI で試した。1 番の正しい文は入らなくなったが、3 番の「鏡で光がはね返った。」が「まちがって覚えていそうな所」に残った。AI 自身が note に「表現としては正しいですが、…内容としてはまだ不十分です」と書いている。指示の文だけでは、正しい文が入るのを止めきれない。

先生の決定（2026-11-19）:「正しい文は入れない」。そこで、AI に 1 件ずつ**印（verdict）**を付けさせ、「まちがい」の印が付いたものだけを GAS で残す。

## 変えるファイルと内容

### 1. `gas/Code.gs`

- **スキーマ**（`aiSchema_`）: `misconceptions` の 1 件を、この順の 4 つにする。

  ```
  { number: text, quote: text, verdict: { type: 'string', enum: ['wrong', 'correct', 'unsure'] }, note: text }
  ```

  `verdict` は `note` の**前**に置く（AI に、説明を書く前に判定させるため）。`required`・`additionalProperties: false` は、今の `object()` の作りのままでよい。`maxItems` は 8 のまま。
- **指示の文**（`AI_INSTRUCTIONS`）: `misconceptions` について書いた 2 つの文（`app-5` で入れたもの）を、次の 2 つに**置きかえる**。ほかの文は変えない。

  ```
  'misconceptions には、理科の内容としてまちがっていそうな文を 8 件まで挙げる。number に生徒の呼び名、quote にその文の引用、verdict に判定、note にどこがまちがっているか・正しくはどうかを書く。' +
  'verdict は、理科の内容としてはっきりまちがっている文だけ wrong にする。内容が正しい文は、言い方があいまい・短い・説明が足りない・不十分なだけなら correct にする。疑問の形で書かれた文も correct にする。まちがいかどうか迷う文は unsure にする。先生に見せるのは wrong だけなので、correct や unsure になる文は、はじめから挙げなくてよい。当てはまる文が無ければ、空の配列にする。' +
  ```
- **整える所**（`cleanAiSummary_`）: `misconceptions` は、`verdict === 'wrong'` のものだけを残す。`verdict` が無い・文字でない・`wrong` 以外（`correct`・`unsure`・大文字・前後に空白・ほかの文字）は、**その 1 件だけ落とす**（まとめ全体は失敗にしない）。落としたあとで、今までどおり `number`・`quote`・`note` の確かめと、8 件までの切りつめをする。返す 1 件の形は今までどおり `{ number, quote, note }`（`verdict` は返さない）。
- `VERSION` を `'app-6'` にする。
- ほか（入力の確かめ、エラーの扱い、ほかの項目）は変えない。

### 2. `js/dev/demo-gas.js`

- `ping` の返事を `app-6` にする。ほかは変えない（練習モードの見本は `misconceptions: []` のままでよい）。

### 3. `README.md`・`docs/setup/gas.md`

- `app-5` と書いてある所を `app-6` にする（README の「`ping` が … を返す」、gas.md の 2 か所）。
- gas.md の版の説明の `app-5` の項はそのまま残し、うしろに `app-6`: 「AI に『まちがい／正しい／迷う』の印を付けさせ、『まちがい』の印の文だけを出す」を足す。

### 変えないもの

- ブラウザ側（`js/ai-summary-logic.js`・`js/views/`）は変えない。GAS が返す形は今までと同じ。

## 端の場合

- 不正な入力: `verdict` が無い・`null`・数字・`'Wrong'`・`' wrong '`・`'correct'`・`'unsure'`・知らない文字 → その 1 件を落とす。`misconceptions` が配列でないときは、今までどおり全体を失敗（`ai-failed`）にする。
- 重複と境界: `wrong` が 9 件以上返ってきたら、先頭から 8 件。`wrong` でないものが先に 8 件並び、そのあとに `wrong` があっても、`wrong` を残す（落としてから切りつめる）。全部が落ちて 0 件になっても、まとめ全体は成功として返す。
- 違反や失敗の見せ方: 落とした件は、画面に出さない（先生の決定「正しい文は入れない」のとおり。件数の知らせも出さない）。0 件のときの画面の出し方は、今のまま。失敗の文は変えない。

## テスト

- `tests/gas-code.test.js`:
  - 送るスキーマの `misconceptions` の 1 件に `verdict`（`enum` が `['wrong','correct','unsure']`）があり、`required` に入っていて、プロパティの順が `number, quote, verdict, note` であること。
  - `AI_INSTRUCTIONS` が「verdict」「wrong」「correct」「unsure」「先生に見せるのは wrong だけ」をふくむこと。`app-5` のテストで見ていた文のうち、残っているもの（「内容が正しい文は」「空の配列にする」）は、そのまま通ること。合わなくなった確かめは、新しい文に合わせて直す。
  - AI の返事に `wrong`・`correct`・`unsure`・`verdict` なし・`'Wrong'` が混ざっているとき、`wrong` だけが `{ number, quote, note }` の形で返ること（`verdict` のキーが返事に無いこと）。
  - `wrong` でない 8 件のあとに `wrong` が 1 件あるとき、その 1 件が返ること。
  - 全部が `correct` のとき、`misconceptions` が空の配列で、まとめ全体は成功すること。
  - 今ある `misconceptions` のテストの見本には `verdict: 'wrong'` を足して、今までの確かめ（文字数・8 件）が通るようにする。
- `tests/gas-app.test.js`・`tests/demo-gas.test.js` の `app-5` を `app-6` にする。
- `npm test` がすべて成功すること。

## 守ること

- `git add`・`git commit` はしない。
- `relay/`・`js/gas-config.js`・`js/ai-summary-logic.js`・`js/views/`・`docs/setup/rules.json`・`js/rules-probe.js`・`assets/`・`docs/reports/` は変えない。
- 上に書いたことのほかは変えない。パッケージを足さない。鍵・モデルの名前をコードに書かない。

## 報告

変更したファイル、テストの結果、指示書と違う点を、日本語の Markdown で報告する。
