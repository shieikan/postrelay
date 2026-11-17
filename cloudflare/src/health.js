import { RelayError, validateWebhook } from './core.js';

export const HEALTH_TIMING = Object.freeze({
  registration: 24 * 60 * 60 * 1000,
  silentRenewal: 6 * 60 * 60 * 1000,
  silenceAlert: 24 * 60 * 60 * 1000,
  retry: 5 * 60 * 1000,
  alertTimeout: 10000,
});

export const CONFIG_ERRORS = ['invalid_config', 'invalid_webhook', 'invalid_x_credentials',
  'invalid_storage_key', 'storage_key_mismatch'];
const SOURCE_ERRORS = new Set([...CONFIG_ERRORS, 'x_auth_required', 'x_registration_rejected']);
const messages = {
  silence: ['24時間プッシュを受信していません。', 'プッシュ受信の監視が正常に戻りました。'],
  source: ['受信元が停止中、または認証・設定エラーです。statusを確認してください。', '受信元の停止・認証・設定エラーが解消しました。'],
  jobs: ['送信ジョブにfailedがあります。statusを確認してください。', 'failedの送信ジョブがなくなりました。'],
};

export function silenceSince(store) {
  return store.meta('last_push_at') ?? store.meta('monitoring_started_at', Date.now());
}

export function alertConditions(store, now) {
  return {
    silence: now - silenceSince(store) >= HEALTH_TIMING.silenceAlert,
    source: store.meta('source_paused', false) || SOURCE_ERRORS.has(store.meta('last_error', '')) ||
      SOURCE_ERRORS.has(store.meta('last_x_registration_error', '')),
    jobs: store.hasFailedJobs(),
  };
}

export async function sendHealthAlert(webhook, condition, active) {
  const url = validateWebhook(webhook);
  const response = await fetch(url + '?wait=true', {
    method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(HEALTH_TIMING.alertTimeout),
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'PostRelay/0.1' },
    body: JSON.stringify({ content: `PostRelay ${active ? '警告' : '復旧'}: ${messages[condition][active ? 0 : 1]}`,
      allowed_mentions: { parse: [] } }),
  });
  await response.body?.cancel();
  if (!response.ok) throw new RelayError('health_alert_failed', true);
}
