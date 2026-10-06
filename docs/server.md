# サーバーで使う

PostRelayはサーバーで動かし、利用者はブラウザーで操作します。Mac専用のアプリや、Chromeを開き続ける運用は必要ありません。LinuxサーバーでDocker Composeを使う構成を用意しています。登録キー作成用にPython3、実行用にDockerとComposeが必要です。

この構成のX通知元は、1つのXアカウントと1つのPostRelayアカウントの組み合わせです。複数利用者が各自のXを接続するホスティングサービスは、別途接続管理が必要です。

## 1. GUIを起動する

サーバー上で実行します。

```sh
git clone https://github.com/shieikan/postrelay.git
cd postrelay
python3 scripts/configure-server.py
docker compose up --build -d --wait
```

`.env`には表示用URLと登録キーが保存されます。ファイルは所有者だけが読める権限で作成し、既にある場合は上書きしません。Gitへ追加しないでください。

サーバーのWebポートは初期設定で`127.0.0.1:8765`にだけ公開します。手元のPCから操作するには、次のSSH接続を開いたままにしてください。

```sh
ssh -L 8765:127.0.0.1:8765 user@server
```

手元のブラウザーで[http://localhost:8765](http://localhost:8765)を開きます。PostRelayのアカウント作成時に、サーバーの`.env`にある`POSTRELAY_SIGNUP_KEY`の値を登録キー欄へ入力してください。通知設定にXのユーザー名と、Discordチャンネル専用のWebhookを保存します。メンションは初期状態で無効です。

別のポートを使う場合は初期設定時に`python3 scripts/configure-server.py --port 18765`を実行し、SSH転送とブラウザーのポートも合わせてください。

Docker構成では実送信が有効ですが、通知元とDiscordの送信先を設定するまでは配信されません。GUIだけを試す場合はリポジトリのデモ起動手順を使ってください。

## 2. X通知を接続する

Xのログイン情報は、Cookieを入力したアカウントへの接続に使います。信頼できるサーバーだけに保存してください。CookieやWebhookをチャット、Git、コマンド引数、Composeの環境変数へ貼らないでください。

受信元のXアカウントで、通知したい投稿者をフォローし、投稿通知をオンにします。GUIでユーザー名を追加するだけでは、Xの通知設定は変わりません。

サーバー上で、入力内容を非表示にする初期設定を実行します。

```sh
docker compose --profile x build angelic
docker compose --profile x run --rm angelic init
docker compose --profile x run --rm angelic set-receiver
docker compose --profile x run --rm angelic register
docker compose --profile x up -d angelic
```

- `init`では、受信元Xアカウントの`auth_token`と`ct0`を入力します。[上流の取得手順](https://github.com/sh1ma/Angelic-Angel#requirements)を参照してください。
- `set-receiver`では、GUIの「設定」→「投稿通知の受け取り方」で作成した受け取りURLを入力します。URLは内部受信用の接続に変換し、入力先のホストへ直接送信することはありません。
- `register`はXへ通知受信を登録します。`listen`に相当する最後の起動コマンドで、受信と転送を継続します。

現在の公開確認方法では返信・リポストを区別できません。通知設定画面で説明を確認し、「投稿の種類で絞り込まずに通知する」にチェックしてください。既存の不一致設定は一覧に確認が必要と表示します。設定内容を確認するまで、種類不明の投稿は送信しません。他人の投稿、DM、公開確認できない通知も転送しません。

受け取りURLを作り直した場合は、`set-receiver`を再実行して`docker compose --profile x restart angelic`で接続を更新してください。入力を隠せる対話端末が必要です。SSHのコマンド実行から設定する場合は`ssh -t user@server`で端末を割り当ててください。Xへの再登録は、このURLの変更だけでは必要ありません。

## 保存と継続運転

- アカウント・通知設定・履歴・送信待ちは`postrelay-data`という名前付きボリュームへ保存します。
- X Cookie、受信登録と復号鍵、PostRelayの受信トークンは`angelic-data`の非公開ディレクトリへ保存します。秘密ファイルは0600、ディレクトリは0700です。イメージに含めません。
- コンテナは非rootユーザーで動きます。終了したプロセスはDockerの再起動ポリシーで再起動します。サーバー再起動後の継続には、Docker自体が起動する設定が必要です。
- PostRelayは通常の停止でSIGTERMを処理し、送信処理の終了を待ちます。未完了のキューは保存され、次の起動後に再開します。X通知がPostRelayへ届く前の切断・失敗を回収する保証はありません。
- X受信コンテナはGUIコンテナとネットワーク名前空間を共有し、`127.0.0.1:8767`へ接続します。このポートはホストへ公開しません。GUIのWebポートでは生のX通知を受け付けません。
- 生の通知の保存は初期状態で無効です。必要な場合だけ、保存内容に同意した本人の環境で`--capture-push`を追加してください。最大20件・24時間の制限があり、稼働中に期限切れを削除します。

停止と再開は次の通りです。`down -v`は保存データも消すため、通常の停止には使わないでください。

```sh
docker compose --profile x stop
docker compose --profile x up -d
```

バックアップは両方のボリュームが対象です。Xの接続情報も含むため、アクセス制限と暗号化を適用してください。受信登録を複製した2台を同時に動かすと、同じ通知の接続が競合する可能性があります。移行時は元の受信コンテナを停止し、移行先だけを起動します。

## HTTPSのURLで公開する場合

SSH転送を使わずドメインでアクセスする場合は、HTTPSのリバースプロキシを別途用意します。初期設定時に`--origin https://notify.example.com`を指定するか、既存`.env`の`POSTRELAY_PUBLIC_URL`を更新してください。Web側はそのHostとOriginだけを受け付け、HTTPSのセッションCookieへSecureを付けます。プロキシは元のHostを保持してGUIの8765番へ転送し、8767番は公開しないでください。

本構成は少人数のセルフホスト向けです。インターネット公開には、バックアップ、メール確認と復旧、監視、負荷・登録制御の検証が必要です。[検証済みの範囲](../VERIFICATION.md)を参照してください。
