# 変更履歴

## Unreleased

### 利用者向け

- Cloudflare Workersと1つのDurable Objectを使う実験版を追加。自分の接続情報で複数の投稿者・送信先を設定でき、端末から停止・再開・再送を操作可能。導入と無料枠の概算を専用ガイドに記載。実クラウド接続・使用量・長期運転は未検証。
- Cloudflare版で、正常な受信接続が約10秒で切断される問題を修正。失敗履歴が1,000件を超えても、空き容量分ずつ再送できるように変更。
- Cloudflare版の登録用設定をUTF-8で5,000バイト以内に検査。通知設定やX Cookieのローカル編集ミスがあっても、管理情報が正しければ状態確認と停止を実行可能。
- 課金画面と有料プランの制限を削除し、全利用者で共通の運用上限に統一。
- Linuxサーバー向けのCompose構成、データ保存、内部X通知受信口を追加。
- 通知の種類を判定できない接続では、種類で絞り込まずに通知することを設定画面で確認。未確認の既存設定には確認が必要と表示。
- READMEにユースケース例と起動手順を整理し、利用・連携の詳細を別のガイドに分離。

### 開発・保守

- Cloudflare版にWeb Push復号、公開投稿の再確認、暗号化した受信登録、SQLiteの送信待ち・再試行を実装。workerdによる合成環境の接続・障害・再起動テストと、デプロイしないCIを追加。
- PythonとJavaScriptのテスト、静的解析、秘密情報検査、Linuxコンテナのビルドと脆弱性検査をCIへ追加。
- 貢献方法と脆弱性報告の手順を追加。
- HTTP受付を各受信口16接続・総期限15秒に制限し、遅い送信と混同しやすい本文指定を拒否。HTTPS用nginxの設定例と実接続テストを追加。
- X受信側の補助処理をRustへ移し、Python・シェル・不要なOSコマンドを除去。GUI側はCPython3.12.15と必要な実行時ライブラリーを保持。
- 固定したベースイメージ、実コンポーネントの記録とSBOMを使って再検査。判定範囲と結果は安全性の確認記録に記載。

### 更新時

Cloudflare版は独立した追加構成です。Docker版のDBや接続情報との自動移行は行いません。Cloudflare版の更新手順は[導入ガイド](docs/cloudflare.md)を確認してください。

既存DBの通知設定・履歴と接続情報は保持します。課金プランの情報は内部でセルフホストへ移行します。Xの通知受信を使う場合、以前に種類の絞り込みを設定した通知先は「編集」から内容を確認してください。既存のX受信登録やDiscord Webhookを作り直す必要はありません。更新前に停止して非公開バックアップを保存し、同じデータボリュームで再起動してください。

独立したバージョンを付けたリリースはまだ作成していません。公開リリース時は、タグとこの履歴の対象バージョンを一致させます。

### Cloudflare public author display

- Show public display names, @handles, profile links and optional profile images in Discord embeds without changing the webhook sender.
- Look up matching public embed metadata without an API key; retain handle-only delivery when metadata is unavailable. Reuse stored metadata across retries and destinations.
