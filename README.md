# 授業ログ

授業 1 回ごとに、先生の板書・配布資料と、生徒自身のメモ・写真・振り返りを 1 か所に残すアプリです。

## いまの状態

段階 0（接続確認）を作っているところです。アプリ本体はまだありません。

段階 0 では、学校の iPad と学校のネットワークから、ログインとデータベース（Firebase）、写真を先生の Google Drive に保存する仕組みが使えるかを確かめます。

## 開発者向け

### テスト

```
npm test
```

Node.js 組み込みのテストランナー（`node --test`）で `tests/*.test.js` を実行します。依存パッケージはありません。ビルドもありません。

### 資料

- [要件定義書](docs/requirements.md)
- [設計書](docs/superpowers/specs/2026-11-12-jugyo-log-design.md)
- [段階 0 の実装計画](docs/superpowers/plans/2026-11-12-jugyo-log-stage0.md)
