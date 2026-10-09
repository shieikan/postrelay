# 開発に参加する

不具合や機能の相談は[Issues](https://github.com/shieikan/postrelay/issues)、変更の提案はPull Requestで受け付けます。日本語・英語のどちらでも構いません。脆弱性や接続情報を含む報告は[SECURITY.md](SECURITY.md)を確認してください。

不具合報告には、使ったコミット、OS、起動方法、期待した結果、実際の結果、接続情報を除いた再現手順を添えてください。Cookie、Webhook、受け取りURL、DB、生通知、個人のメールアドレスは貼らないでください。

## 変更前に確認する

1. 大きな機能や取得方法の変更は、まずIssueで範囲を相談してください。
2. 不具合の修正では、修正前に失敗する小さなテストを追加してください。
3. 変更する動作と関係するテストを実行し、GUIの変更は実際の画面でも確認してください。
4. 起動・接続・データの扱いが変わる場合は、対応する文書と[CHANGELOG.md](CHANGELOG.md)も更新してください。

テストは合成データで行います。実際のX CookieやDiscordチャンネルへの送信をCIへ追加しないでください。利用者の通知設定・保存済みジョブ・トークンの互換性を守り、既存DBを破壊する移行を避けてください。

## ローカルで確認する

実行にはPython3.9以降、フロントエンドのテストにはNode.js18以降が必要です。

```sh
python3 -B -m unittest discover -s tests -v
node --test tests/*.test.cjs
node --check web/app.js
node --check web/notification-settings.js
git diff --check
```

Cloudflare版は `cloudflare/` に独立しています。Node.js 22以降と、端末の非表示入力テスト用にPython 3を用意してください。

```sh
cd cloudflare
npm ci
npm test
npm run build
npm audit --audit-level=high
```

この `build` はデプロイしないdry runです。実行環境のテストはworkerdと合成の通知元・送信先を使います。Cloudflareのログインや実際のCookieは不要です。[構成・検証範囲](cloudflare/README.md)も確認してください。CIの「Cloudflare adapter」はNode.js 22・24で同じ確認を行い、自動デプロイはしません。

以降のPython用コマンドはリポジトリのルートで実行します。

静的解析ツールはアプリの実行依存ではありません。Python3.12以降の専用環境で使います。

```sh
python3 -m venv .venv
.venv/bin/python -m pip install --require-hashes -r requirements-dev.txt
.venv/bin/ruff check --select F postrelay scripts integrations/angelic tests
.venv/bin/bandit -r postrelay scripts integrations/angelic -ll
.venv/bin/pip-audit --strict -r requirements-dev.txt
```

Python版アプリはPython標準ライブラリだけを使います。上のpip-auditは開発用解析ツールの依存を確認するもので、アプリのOS・Python本体やRust依存の安全性を証明するものではありません。コンテナのビルド・スキャンはCIで別途行います。

CIはpushとPRでテスト・静的解析・秘密情報検査を行います。Actionsの「CI」→「Run workflow」で手動実行すると、Linux/amd64で両方のコンテナをビルドし、ネットワークを無効にしたアプリのテスト、合成データによるComposeの起動・再起動後の保存と内部受信口、実際の両イメージの脆弱性検査も行います。検査結果のJSONはActionsの実行画面から14日間取得できます。既知のHigh/Criticalは修正または根拠付きの影響評価が終わるまで公開判断を止めます。結果は実行したコミットとデータベース日時の範囲に限定されます。

PRには問題と変更後の動作、確認したこと、未確認の範囲を短く記載してください。見た目だけの変更に、同じ実装をなぞるテストや無関係な依存更新は不要です。秘密情報やローカル作業記録を変更へ含めないでください。
