### Task 5: 公開と、結果を書く用紙

**Files:**
- Create: `docs/reports/stage0-check.md`
- Modify: `README.md`、`js/firebase-config.js`、`js/gas-config.js`

**Interfaces:**
- Consumes: ユーザーが `docs/setup/firebase.md` と `docs/setup/gas.md` を終えて伝えた値（データベースの URL、Web API キー、GAS の URL）。GitHub のリポジトリ（ユーザーが作る）。

- [ ] **Step 1:** `docs/reports/stage0-check.md` を書く。設計書 6 章の 1〜8 を表にし、それぞれに「学校」「家」の結果を書く欄と、日付の欄を作る。下に、次を書く欄を作る: 使えたメールアドレスのドメイン、GAS を「全員」で公開できたか、写真 1 枚の保存と取り出しにかかった時間、同時 40 回の結果（学校で 3 回分）、Drive の容量、iPad の情報、端末の中の保存の結果。最後に「段階 1a の計画に反映すること」の欄を作る。まだ確かめていない欄は「未確認」と書いておく。
- [ ] **Step 2:** `README.md` に、接続確認の手順を書き足す。先生がすること（`docs/setup/firebase.md` → `docs/setup/gas.md` → 値を Claude Code に伝える → 公開された確認ページを学校の iPad と家で開く → 「結果をコピー」で伝える）と、公開の手順（`tools/pages-branch.ps1`、`git push origin master`、`git push origin pages`、GitHub の Settings → Pages で Branch を `pages` / (root)）。
- [ ] **Step 3:** コミット: `docs: 接続確認の結果を書く用紙と、README の手順`。
- [ ] **Step 4（ユーザーの作業を待つ）:** ユーザーから 3 つの値と GitHub のリポジトリの URL を受け取ったら、`js/firebase-config.js` と `js/gas-config.js` に値を入れ、`npm test`、コミット（`chore: Firebase と GAS の設定値`）、`git remote add origin <URL>`、`tools/pages-branch.ps1`、push を行う。push は外に公開する操作なので、`CLAUDE.md` の決まりに従う（承認の行が無いときは、行う前にユーザーに確認する）。
- [ ] **Step 5（ユーザーの作業を待つ）:** 手元のパソコンで公開されたページを開き、項目 1〜11 を確かめる。次に、ユーザーが学校の iPad（学校のネットワーク）と家で開いた結果を受け取り、`docs/reports/stage0-check.md` に書く。確かめられなかった項目は「未確認」のままにする。
- [ ] **Step 6:** 結果をユーザーに報告する。× があった項目と、設計書 6 章の「止められていた場合の候補」のどれに当たるかを書き、段階 1a の計画に進むか、代わりの方法を相談するかを聞く。コミット: `docs: 段階 0 の確認の結果`。

---

## 段階 0 が終わったあと

- 確認用の GAS（`gas/check/`）と `check/` の規則は、段階 1a で本番用に置きかえる。確認ページは、学校の端末が変わったときのために残す。
- 段階 1a の計画（`docs/superpowers/plans/` の別ファイル）は、`docs/reports/stage0-check.md` の「段階 1a の計画に反映すること」をもとに書く。
