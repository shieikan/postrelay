# PostRelay（仮称）

**Xの新着を、いつものDiscordへ。**

Xの公開投稿通知を、指定したDiscordチャンネルへ届けるセルフホストのOSSです。Docker版ではブラウザーから、通知するアカウント・送信先・キーワード条件を設定し、送信結果を確認できます。端末で設定するCloudflare版も実験的に追加しています。

**ソフトウェアは無料・MITライセンス。** 自分のサーバー、または自分のCloudflareアカウントで動かします。運用費は利用者の負担です。Cloudflare版は無料枠内の運用を目指す構成ですが、実環境での使用量と継続受信は未検証です。

試験版です。固定したLinux/amd64構成は起動・再起動とHigh/Critical検査を通過しました。Medium/Low等の検出と運用上の未確認事項は残ります。少人数の信頼できる環境で試し、[安全性の確認範囲](SECURITY_REVIEW.md)を確認してください。公開ホスティング向けの認定は行っていません。

## こんな使い方ができます

| 使い方 | 通知先の例 | 設定の例 |
|---|---|---|
| 気になる研究者や開発者の投稿を、友達と共有する | `#ai-news` | 公開投稿者を指定し、キーワード条件は空欄にする |
| 使っているツールの新機能・リリース告知を集める | `#release-news` | 通知本文に「リリース」「公開」のどちらかを含む場合に送る |
| イベントやコミュニティの募集情報を届ける | `#community` | 「募集」「開催」で絞り、「広告」を含む通知は除外する |

チャンネル名は架空の例です。受け取った通知の本文で絞り込むため、すべての告知を集められる保証はありません。送信先はDiscordチャンネルのWebhook URLで指定します。

## できること

以下のGUI機能はDocker版・Python版で利用できます。

- XアカウントとDiscordチャンネルの組み合わせを、GUIで追加・編集する。
- 含める言葉・除外する言葉で通知を絞る。通知の停止・再開もできる。
- 送信履歴で結果を確認し、失敗した通知を再送する。
- 指定したDiscordロールへメンションする。初期状態ではメンションしない。
- 送信待ちを保存し、再起動後も送信を続ける。

## Angelic-Angelを使っています

X通知の受信には、[sh1maさん](https://github.com/sh1ma)が作成した[Angelic-Angel](https://github.com/sh1ma/Angelic-Angel)を使います。Angelic-AngelがXのWeb Push通知を受信し、PostRelayが公開投稿を確認してDiscordへ届けます。

```text
Xの投稿通知 → Angelic-Angel → PostRelay → Discord
                              設定・履歴はブラウザーで操作
```

Angelic-Angelとは別の、独立したプロジェクトです。上流の固定版と修正パッチを使い、原作のMITライセンス表示を保持しています。固定版・変更内容は[連携の説明](integrations/README.md)、動作確認の範囲は[検証記録](VERIFICATION.md)を参照してください。

## サーバーで使う

Linuxサーバーで、Python 3・Docker・Docker Composeを用意して実行します。

```sh
git clone https://github.com/shieikan/postrelay.git
cd postrelay
python3 scripts/configure-server.py
docker compose up --build -d --wait
```

このコマンドでGUIを起動できます。実際の配信には、続けてX通知元とDiscordの送信先を接続します。[サーバー起動ガイド](docs/server.md)に、ブラウザーでのアクセス、登録キー、Xの初期接続、保存・停止・再開の手順をまとめています。Mac専用アプリやChromeの常時起動は必要ありません。

接続には、通知を受け取るXアカウントのCookieと、DiscordチャンネルのWebhook URLが必要です。X側では通知したい投稿者をフォローし、投稿通知をオンにしてください。GUIでユーザー名を追加するだけでは、Xの通知設定は変わりません。

## Cloudflareで使う（実験版）

Workersと1つのDurable Objectで受信と配信を動かす構成です。常時起動するMacやVMは不要で、自分のCloudflareアカウント・通知用Xアカウント・Discord Webhookを使います。複数の投稿者とチャンネルを設定できます。GUIはなく、設定・停止・再開・再送は端末で操作します。

[Cloudflare導入ガイド](docs/cloudflare.md)に、無料枠の概算、必要な接続情報、導入コマンド、保存・復旧の手順をまとめています。Angelic-Angelの通知受信処理をWorkers向けに移植し、ローカルで受信・公開確認・再送・再起動後の復旧を検証しました。Cloudflare版では、`include_reposts` を有効にすると投稿通知一覧を約5分ごとに照合し、監視対象によるリポストも元投稿の公開確認後に転送します。長期の安定運転や通知の全件取得は保証しません。

## 接続せずにGUIを試す

Python 3.9以降があれば試せます。外部PythonパッケージやNode.jsは不要です。

```sh
git clone https://github.com/shieikan/postrelay.git
cd postrelay
python3 -m postrelay --mode demo
```

[http://127.0.0.1:8765](http://127.0.0.1:8765)を開き、「デモを試す」を選んでください。架空の通知で、追加・編集・停止・再開・送信履歴を試せます。XやDiscordへアクセスせず、実際のDiscord Webhook URLも保存しません。

## 使う前に知っておきたいこと

- 届くのはXが通知した公開投稿です。過去投稿の取得、全投稿の網羅、画像・動画の展開には対応していません。
- Python版のAngelic-Angel連携では返信・リポストを区別できません。通知設定画面で説明を確認し、「投稿の種類で絞り込まずに通知する」にチェックしてください。Cloudflare版のリポスト対応は[導入ガイド](docs/cloudflare.md#リポストと通知の取りこぼしの補完)を参照してください。DMや公開確認できない通知は転送しません。
- Docker構成のX通知元は、1つのXアカウントと1つのPostRelayアカウントの組み合わせです。各利用者が個別にXを接続する公開ホスティングは提供していません。
- CookieやWebhook URLは接続情報です。信頼できるサーバーへ保存し、Gitや公開ログへ含めないでください。Discordへ送る本文には、通知を受け取るXアカウントの名前やCookieを含めません。
- 再送により同じ通知が重複する可能性があります。通知の網羅性や長期運転、公開環境の負荷・運用は未検証です。メール確認とパスワード再設定も未実装です。

詳細な[通知元の仕様](docs/notification-source.md)と[利用・保存・再送の説明](docs/usage.md)も確認してください。

## ドキュメントと開発

- [サーバー起動ガイド](docs/server.md)：Dockerでの接続・保存・継続運転。
- [Cloudflare導入ガイド](docs/cloudflare.md)：MacやVMを常時起動しない実験版の導入・運用。
- [利用・運用ガイド](docs/usage.md)：GUIの使い方、Pythonでの起動、上限とデータの扱い。
- [通知元の仕様](docs/notification-source.md)：Angelic-Angelの公開確認、他のツールから送るJSON。
- [Angelic-Angel連携パッチ](integrations/README.md)：固定版、修正内容、上流ライセンス。
- [検証記録](VERIFICATION.md)：確認したことと、未確認の範囲。
- [安全性の確認記録](SECURITY_REVIEW.md)：スキャン・独立レビューの結果と未解消項目。
- [貢献方法](CONTRIBUTING.md)、[脆弱性の報告](SECURITY.md)、[変更履歴](CHANGELOG.md)。

開発用のテストは、リポジトリ内で次のように実行します。合成データとローカルHTTPを使い、実際のX・Discordへ送信しません。

```sh
python3 -B -m unittest discover -s tests -v
```

## ライセンス

[MIT](LICENSE)。Angelic-Angelの著作権・ライセンス表示は[連携の説明](integrations/README.md)と[Cloudflare版のNOTICE](cloudflare/NOTICE)、GUIで使うTabler Iconsなどの表示は[THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md)にまとめています。X・Discordの公式プロジェクトではありません。ソフトウェアのライセンスとは別に、接続先サービスの利用条件も確認してください。
