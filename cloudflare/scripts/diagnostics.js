const messages = {
  invalid_settings: '設定ファイルのJSONと version、origin、secrets を確認してください。',
  invalid_worker_origin: 'Worker URLは https://名前.サブドメイン.workers.dev の形式で指定してください。',
  invalid_admin_token: '設定ファイルの ADMIN_TOKEN を元の値に復元してください。',
  unsafe_settings_permissions: '設定フォルダーとファイルの所有者・権限を確認してください。フォルダーは700、ファイルは600にし、シンボリックリンクを使わないでください。',
  ENOENT: 'このフォルダーに .postrelay/settings.json がありません。保存先か非公開バックアップを確認してください。',
  config_too_large: '通知設定の合計が5,000バイトを超えています。通知先やキーワードを減らしてから secrets を実行してください。',
  invalid_config: '設定の feeds、ユーザー名、enabled、allow_unknown_kind とキーワードを確認してください。',
  invalid_webhook: 'DiscordのWebhook URLを確認してください。',
  invalid_x_credentials: '同じXアカウントの auth_token と ct0 を設定してください。',
  invalid_storage_key: '保存時の STORAGE_KEY を復元してください。新しい値で置き換えないでください。',
  storage_key_mismatch: '保存済みデータを復号できません。元の STORAGE_KEY を復元してください。',
  unauthorized: 'ローカル設定とWorkerの ADMIN_TOKEN が一致するか確認してください。',
  service_unavailable: 'Cloudflareの稼働状況と無料枠の使用量を確認してください。',
  x_auth_required: 'Xの接続認証が必要です。同じアカウントのCookieを更新して、secrets、start の順に実行してください。',
  notification_sync_invalid: 'Xの投稿通知一覧の形式を確認できませんでした。照合位置を更新せず再試行します。',
  notification_sync_rate_limit: 'Xの投稿通知一覧の取得制限です。30分後に再試行します。',
  notification_sync_unavailable: 'Xの投稿通知一覧を取得できませんでした。次の照合で再試行します。',
  x_registration_rejected: 'Xが通知登録を受け付けませんでした。Xの通知設定と接続方式の対応状況を確認してください。',
  x_registration_unavailable: 'Xの通知登録を再試行します。',
  push_server_backoff: '通知サーバーから30分の待機を指定されています。',
  push_connection_failed: '通知サーバーへの接続を再試行します。',
  push_disconnected: '通知サーバーとの接続が切れました。再接続を待ってください。',
  push_timeout: '通知サーバーの応答を待ってから再接続します。',
  push_protocol_error: '通知サーバーの応答形式を確認できませんでした。',
  push_input_limit: '受信量の上限に達したため、再接続して再試行します。',
  invalid_push_endpoint: '通知サーバーが返した接続先を確認できませんでした。',
  invalid_ciphertext: '通知を復号できませんでした。この通知は転送していません。',
  invalid_response: '接続先の応答を確認できませんでした。',
  public_lookup_failed: '公開投稿を確認できませんでした。failed の場合は原因解消後に retry を実行してください。',
  discord_rate_limit: 'Discordの送信制限です。retry は指定時刻まで待機し、failed は手動再送が必要です。',
  discord_unavailable: 'Discordへ送信できませんでした。failed の場合は原因解消後に retry を実行してください。',
  discord_rejected: 'DiscordのWebhookの有効性と送信先を確認してください。',
  destination_changed: '送信先が変更されています。古いジョブの再送には元の送信先を復元してください。',
  attempt_limit: '8回の試行後に停止しました。原因を解消し、必要な場合に retry を実行してください。',
  queue_full: '処理待ちが上限に達しています。障害を解消し、処理待ちが減ってから retry を実行してください。',
  stopped: '停止したため、次の start まで送信を待ちます。',
  internal_error: '処理を完了できませんでした。接続情報を含めずに不具合を報告してください。',
};
const known = code => typeof code === 'string' && Object.hasOwn(messages, code);
export function errorText(code) {
  return known(code) ? `${code}: ${messages[code]}` : '操作できませんでした。設定、接続情報、Cloudflareの状態を確認してください。';
}
export function statusView(value) {
  const result = {};
  if (!value || typeof value !== 'object') return result;
  for (const field of ['enabled', 'connected', 'source_paused', 'registered']) if (typeof value[field] === 'boolean') result[field] = value[field];
  for (const field of ['last_received_at', 'last_delivered_at', 'next_reconnect_at', 'last_notification_sync_at', 'next_notification_sync_at', 'push_received', 'last_push_at', 'last_socket_close_code']) if (Number.isSafeInteger(value[field]) || value[field] === null) result[field] = value[field];
  for (const field of ['posts', 'jobs']) {
    if (value[field] && typeof value[field] === 'object') result[field] = Object.fromEntries(
      ['queued', 'retry', 'sending', 'resolved', 'ignored', 'delivered', 'failed', 'cancelled']
        .filter(key => Number.isSafeInteger(value[field][key])).map(key => [key, value[field][key]]));
  }
  for (const field of ['post_errors', 'job_errors']) {
    if (value[field] && typeof value[field] === 'object') result[field] = Object.fromEntries(
      Object.entries(value[field]).filter(([code, count]) => known(code) && Number.isSafeInteger(count)));
  }
  if (value.last_error === '' || known(value.last_error)) result.last_error = value.last_error;
  if (value.last_notification_sync_error === '' || known(value.last_notification_sync_error)) result.last_notification_sync_error = value.last_notification_sync_error;
  if (value.notification_mode === 'push_only') result.notification_mode = value.notification_mode;
  if (['', 'empty', 'accepted', 'notification_list', 'invalid_ciphertext', 'not_public_post', 'unconfigured_author', 'conflicting_post_urls'].includes(value.last_push_result)) result.last_push_result = value.last_push_result;
  if (value.x_registration && ['on', 'off', 'unknown'].includes(value.x_registration.tweets)) result.x_registration = {
    settings_present: value.x_registration.settings_present === true, tweets: value.x_registration.tweets };
  return result;
}
