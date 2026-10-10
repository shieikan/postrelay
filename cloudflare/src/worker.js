import { DurableObject } from 'cloudflare:workers';
import { authorized, readConfig, RelayError, notificationCandidate, enrichAuthor, matchesFeed, fingerprint, sendDiscord } from './core.js';
import { generateKeys, decryptPush, seal, unseal, fromBase64 } from './crypto.js';
import { openSocket, registerX, readPostNotifications, validateCookies, validateEndpoint, X_VAPID_KEY } from './upstream.js';
import { notificationBatch, verifyCandidate } from './notifications.js';
import { Store } from './store.js';

const routes = new Map([['/api/status', 'GET'], ['/api/start', 'POST'], ['/api/stop', 'POST'], ['/api/retry', 'POST']]);
const json = (value, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
const safeError = error => error instanceof RelayError ? error.code : 'internal_error';
const sameChannel = (a, b) => typeof a === 'string' && typeof b === 'string' && a.replaceAll('-', '').toLowerCase() === b.replaceAll('-', '').toLowerCase();

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/health' && !url.search && request.method === 'GET') return json({ service: 'PostRelay', status: 'ok' });
    if (url.search || !routes.has(url.pathname)) return json({ error: 'not_found' }, 404);
    if (!await authorized(request.headers.get('Authorization'), env.ADMIN_TOKEN)) return json({ error: 'unauthorized' }, 401);
    if (request.method !== routes.get(url.pathname)) return json({ error: 'method_not_allowed' }, 405);
    try {
      // One installation, one object. Authors and channels never create more objects.
      return await env.RELAY.get(env.RELAY.idFromName('postrelay')).fetch(request);
    } catch { return json({ error: 'service_unavailable' }, 503); }
  },
};

export class Relay extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.store = new Store(ctx.storage);
    this.config = null;
    this.session = null;
    this.socket = null;
    this.phase = 'disconnected';
    this.generation = 0;
    this.connecting = false;
    this.deadline = null;
    this.lastMessageAt = 0;
    this.pingOutstanding = false;
    this.draining = false;
    this.syncingNotifications = false;
    this.messages = Promise.resolve();
    this.pendingMessages = 0;
  }

  get enabled() { return this.store.meta('enabled', false); }

  async load() {
    if (this.config) return;
    const config = readConfig(this.env.POSTRELAY_CONFIG);
    validateCookies(this.env);
    try { if (fromBase64(this.env.STORAGE_KEY, 32).length !== 32) throw new Error(); }
    catch { throw new RelayError('invalid_storage_key'); }
    const saved = this.store.meta('subscription');
    const session = saved ? await unseal(saved, this.env.STORAGE_KEY) : null;
    this.config = config;
    this.session = session;
  }

  status() {
    return { enabled: this.enabled, connected: this.phase === 'ready' && this.socket !== null,
      source_paused: this.store.meta('source_paused', false), registered: this.store.meta('registered', false),
      posts: this.store.counts('posts'), jobs: this.store.counts('jobs'),
      post_errors: this.store.errors('posts'), job_errors: this.store.errors('jobs'),
      last_error: this.store.meta('last_error', ''), last_received_at: this.store.meta('last_received_at'),
      push_received: this.store.meta('push_received', 0),
      last_push_at: this.store.meta('last_push_at'),
      last_push_result: this.store.meta('last_push_result', ''),
      last_socket_close_code: this.store.meta('last_socket_close_code'),
      x_registration: this.store.meta('x_registration'),
      notification_mode: 'push_only',
      last_notification_sync_at: this.store.meta('last_notification_sync_at'),
      next_notification_sync_at: this.store.meta('notification_lookup_pending', false) ? this.store.meta('next_notification_sync_at', 0) : 0,
      last_notification_sync_error: this.store.meta('last_notification_sync_error', ''),
      last_delivered_at: this.store.meta('last_delivered_at'), next_reconnect_at: this.store.meta('next_reconnect_at', 0) };
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (!await authorized(request.headers.get('Authorization'), this.env.ADMIN_TOKEN)) return json({ error: 'unauthorized' }, 401);
    if (url.search || !routes.has(url.pathname)) return json({ error: 'not_found' }, 404);
    if (routes.get(url.pathname) !== request.method) return json({ error: 'method_not_allowed' }, 405);
    try {
      if (url.pathname === '/api/status') return json(this.status());
      if (url.pathname === '/api/stop') {
        this.store.setMeta('enabled', false);
        this.disconnect();
        await this.ctx.storage.deleteAlarm();
        return json(this.status());
      }
      if (url.pathname === '/api/start') {
        let loadError;
        await this.ctx.blockConcurrencyWhile(async () => {
          // A rejected blockConcurrencyWhile resets the object before it can
          // return an actionable configuration error. Preserve the state instead.
          try {
            await this.load();
            const resuming = !this.enabled;
            this.store.setMeta('enabled', true);
            // A stopped installation may have refreshed its X credentials.
            // Renew the upstream registration, retaining its endpoint and keys.
            if (resuming && this.session?.registered) {
              await this.saveSession({ ...this.session, registered: false }, this.generation);
            }
            this.store.setMeta('source_paused', false);
            this.store.setMeta('last_error', '');
            // Do not bypass a persisted Mozilla backoff on repeated starts.
          } catch (error) { loadError = error; }
        });
        if (loadError) throw loadError;
      } else if (url.pathname === '/api/retry') {
        this.store.retryFailed(Date.now());
      }
      if (this.enabled) { await this.schedule(); this.ctx.waitUntil(this.tick()); }
      return json(this.status(), 202);
    } catch (error) { return json({ error: safeError(error) }, error instanceof RelayError ? 400 : 503); }
  }

  disconnect() {
    this.generation++;
    const socket = this.socket;
    this.socket = null;
    this.phase = 'disconnected';
    this.connecting = false;
    this.deadline = null;
    this.pingOutstanding = false;
    try { socket?.close(1000, 'Reconnect or stop'); } catch { /* no raw upstream errors */ }
  }

  async alarm() { await this.tick(); }

  async schedule() {
    if (!this.enabled) return;
    const now = Date.now();
    const times = [now + 60000];
    const due = this.store.nextDue();
    if (due !== null) times.push(due);
    if (this.deadline !== null) times.push(this.deadline);
    if (this.store.meta('notification_lookup_pending', false)) times.push(this.store.meta('next_notification_sync_at', 0));
    if (!this.socket && !this.connecting && !this.store.meta('source_paused', false)) times.push(this.store.meta('next_reconnect_at', 0));
    const next = Math.max(now + 1000, Math.min(...times));
    const current = await this.ctx.storage.getAlarm();
    if (this.enabled && (current === null || next < current)) await this.ctx.storage.setAlarm(next);
  }

  async tick() {
    if (!this.enabled) return;
    // Arm recovery before network operations, even if this invocation is interrupted.
    await this.ctx.storage.setAlarm(Date.now() + 60000);
    try {
      await this.load();
      if (!this.enabled) return;
      // Retention scans run hourly instead of spending free SQL row reads on
      // terminal history at every one-minute recovery alarm.
      if (Date.now() - this.store.meta('last_cleanup_at', 0) >= 3600000) {
        this.store.cleanup(Date.now());
        this.store.setMeta('last_cleanup_at', Date.now());
      }
      if (this.deadline !== null && Date.now() >= this.deadline) await this.connectionFailed('push_timeout', true);
      if (!this.socket && !this.connecting && !this.store.meta('source_paused', false) &&
        Date.now() >= this.store.meta('next_reconnect_at', 0)) await this.connect();
      if (this.phase === 'ready' && !this.pingOutstanding && Date.now() - this.lastMessageAt >= 300000) {
        this.socket.send('{}');
        this.pingOutstanding = true;
        this.deadline = Date.now() + 10000;
      }
      await this.syncNotifications();
      await this.drain();
    } catch (error) {
      const code = safeError(error);
      this.store.setMeta('last_error', code);
      if (['invalid_config', 'invalid_webhook', 'invalid_x_credentials', 'invalid_storage_key', 'storage_key_mismatch'].includes(code)) {
        this.store.setMeta('enabled', false);
        this.disconnect();
        await this.ctx.storage.deleteAlarm();
      }
    } finally { await this.schedule(); }
  }

  async connectionFailed(code, retryable, overrideDelay = 0) {
    this.disconnect();
    this.store.setMeta('last_error', code);
    if (!this.enabled) return;
    const attempts = this.store.meta('connect_attempts', 0) + 1;
    this.store.setMeta('connect_attempts', attempts);
    this.store.setMeta('source_paused', !retryable);
    this.store.setMeta('next_reconnect_at', Date.now() + (overrideDelay || Math.min(5000 * (2 ** Math.min(attempts - 1, 10)), 300000)));
    await this.schedule();
  }

  requestNotificationLookup() {
    if (!this.config.feeds.some(feed => feed.enabled && feed.include_reposts)) return;
    this.store.setMeta('notification_lookup_sequence', this.store.meta('notification_lookup_sequence', 0) + 1);
    if (this.store.meta('notification_lookup_pending', false)) return;
    if (this.store.meta('notification_watermark') === null)
      this.store.setMeta('notification_watermark', this.store.meta('last_received_at') ?? Date.now() - 300000);
    this.store.setMeta('notification_lookup_pending', true);
    this.store.setMeta('notification_lookup_attempts', 0);
  }

  async syncNotifications() {
    if (!this.config.feeds.some(feed => feed.enabled && feed.include_reposts)) {
      this.store.setMeta('notification_lookup_pending', false);
      return;
    }
    if (!this.enabled || !this.store.meta('notification_lookup_pending', false) || this.syncingNotifications || !this.config.feeds.some(feed => feed.enabled && feed.include_reposts) ||
      Date.now() < this.store.meta('next_notification_sync_at', 0)) return;
    this.syncingNotifications = true;
    const sequence = this.store.meta('notification_lookup_sequence', 0);
    const generation = this.generation;
    const since = this.store.meta('notification_watermark', this.store.meta('last_received_at') ?? Date.now());
    this.store.setMeta('notification_watermark', since);
    this.store.setMeta('next_notification_sync_at', 0);
    try {
      const value = await readPostNotifications(this.env);
      if (!this.enabled || generation !== this.generation) return;
      const batch = notificationBatch(value, this.config.feeds, since, Date.now());
      for (const candidate of batch.candidates) this.store.accept(candidate, Date.now());
      this.store.setMeta('notification_watermark', batch.watermark);
      this.store.setMeta('last_notification_sync_at', Date.now());
      this.store.setMeta('last_notification_sync_error', '');
      this.store.setMeta('notification_lookup_pending', this.store.meta('notification_lookup_sequence', 0) !== sequence);
      await this.ctx.storage.sync();
    } catch (error) {
      if (!this.enabled || generation !== this.generation) return;
      const code = safeError(error);
      this.store.setMeta('last_notification_sync_error', code);
      const attempts = this.store.meta('notification_lookup_attempts', 0) + 1;
      this.store.setMeta('notification_lookup_attempts', attempts);
      this.store.setMeta('notification_lookup_pending', attempts < 8);
      this.store.setMeta('next_notification_sync_at', Date.now() +
        (code === 'notification_sync_rate_limit' || code === 'x_auth_required' ? 1800000 : Math.min(5000 * 2 ** attempts, 300000)));
    } finally { this.syncingNotifications = false; }
  }

  async connect() {
    this.connecting = true;
    const generation = ++this.generation;
    this.phase = 'connecting';
    this.deadline = Date.now() + 10000;
    try {
      const socket = await openSocket();
      if (!this.enabled || generation !== this.generation) { socket.close(1000, 'Stopped'); return; }
      this.socket = socket;
      this.connecting = false;
      this.phase = 'hello';
      this.deadline = Date.now() + 10000;
      socket.addEventListener('message', event => {
        if (generation !== this.generation || !this.enabled) return;
        if (typeof event.data !== 'string' || event.data.length > 100000 || this.pendingMessages >= 16) {
          this.ctx.waitUntil(this.connectionFailed('push_input_limit', true));
          return;
        }
        this.pendingMessages++;
        const task = this.messages.then(async () => {
          if (generation === this.generation && this.enabled) await this.receive(event.data, generation);
        }).catch(async error => {
          if (generation === this.generation) await this.connectionFailed(safeError(error), error instanceof RelayError ? error.retryable : true);
        }).finally(() => { this.pendingMessages--; });
        this.messages = task;
        this.ctx.waitUntil(task);
      });
      socket.addEventListener('close', event => {
        if (generation === this.generation) this.store.setMeta('last_socket_close_code', event.code);
        if (generation === this.generation && this.enabled) this.ctx.waitUntil(this.connectionFailed(
          event.code === 4774 ? 'push_server_backoff' : 'push_disconnected', true, event.code === 4774 ? 1800000 : 0));
      });
      socket.addEventListener('error', () => {
        if (generation === this.generation && this.enabled) this.ctx.waitUntil(this.connectionFailed('push_disconnected', true));
      });
      socket.send(JSON.stringify({ messageType: 'hello', uaid: this.session?.uaid ?? '', use_webpush: true, broadcasts: {} }));
    } catch (error) {
      if (generation === this.generation) await this.connectionFailed(safeError(error), true);
    }
    await this.schedule();
  }

  async saveSession(session, generation) {
    const saved = await seal(session, this.env.STORAGE_KEY);
    if (generation !== this.generation || !this.enabled) return false;
    this.ctx.storage.transactionSync(() => {
      this.store.setMeta('subscription', saved);
      this.store.setMeta('registered', session.registered);
    });
    this.session = session;
    return true;
  }

  async completeRegistration(generation) {
    this.phase = 'x_registration';
    this.deadline = Date.now() + 15000;
    const registration = await registerX(this.session, this.env);
    if (generation !== this.generation || !this.enabled) return;
    this.store.setMeta('x_registration', registration);
    if (!await this.saveSession({ ...this.session, registered: true }, generation)) return;
    this.ready();
  }

  ready() {
    this.phase = 'ready';
    this.deadline = null;
    this.lastMessageAt = Date.now();
    this.store.setMeta('connect_attempts', 0);
    this.store.setMeta('next_reconnect_at', 0);
    this.store.setMeta('source_paused', false);
    this.store.setMeta('last_error', '');
  }

  async receive(raw, generation) {
    let message;
    try { message = JSON.parse(raw); } catch { throw new RelayError('push_protocol_error', true); }
    if (!message || typeof message !== 'object' || Array.isArray(message)) throw new RelayError('push_protocol_error', true);
    this.lastMessageAt = Date.now();
    if (this.phase === 'ready') { this.pingOutstanding = false; this.deadline = null; }
    if (Object.keys(message).length === 0) return;
    if (message.messageType === 'hello') {
      if (this.phase !== 'hello' || message.status !== 200 || typeof message.uaid !== 'string' ||
        !/^[a-fA-F0-9-]{32,36}$/.test(message.uaid) || message.use_webpush === false) throw new RelayError('push_protocol_error', true);
      if (this.session?.uaid === message.uaid) {
        if (this.session.registered) this.ready();
        else await this.completeRegistration(generation);
      } else {
        const keys = await generateKeys();
        if (generation !== this.generation || !this.enabled) return;
        this.pendingSession = { uaid: message.uaid, channelId: crypto.randomUUID(), keys, registered: false };
        this.phase = 'register';
        this.deadline = Date.now() + 10000;
        this.socket.send(JSON.stringify({ messageType: 'register', channelID: this.pendingSession.channelId, key: X_VAPID_KEY }));
      }
    } else if (message.messageType === 'register') {
      if (this.phase !== 'register' || message.status !== 200 || !sameChannel(message.channelID, this.pendingSession.channelId)) throw new RelayError('push_protocol_error', true);
      const endpoint = validateEndpoint(message.pushEndpoint);
      if (!await this.saveSession({ ...this.pendingSession, endpoint }, generation)) return;
      await this.completeRegistration(generation);
    } else if (message.messageType === 'notification') {
      if (this.phase !== 'ready' || !sameChannel(message.channelID, this.session.channelId) ||
        typeof message.version !== 'string' || message.version.length < 1 || message.version.length > 256) throw new RelayError('push_protocol_error', true);
      this.store.setMeta('push_received', this.store.meta('push_received', 0) + 1);
      this.store.setMeta('last_push_at', Date.now());
      this.store.setMeta('last_push_result', 'empty');
      let ack = 100;
      if (message.data) {
        try {
          const plain = await decryptPush(message.data, message.headers, this.session.keys);
          let payload;
          try { payload = JSON.parse(plain); } catch { throw new RelayError('not_public_post'); }
          if (generation !== this.generation || !this.enabled) return;
          // A push is the only trigger for a bounded relationship lookup.
          // A DM or arbitrary link cannot cause an authenticated timeline read.
          let candidate;
          try { candidate = notificationCandidate(payload, this.config.feeds); }
          catch (error) {
            const link = payload?.data?.url ?? payload?.data?.uri;
            if (typeof link === 'string' && /^(?:https:\/\/(?:x|twitter)\.com)?\/i\/notifications(?:\?.*)?$/.test(link)) {
              this.requestNotificationLookup();
              this.store.setMeta('last_push_result', 'notification_list');
            } else throw error;
          }
          if (candidate) {
            // Only the canonical candidate URL survives. Private push bodies/titles
            // are neither stored nor included in jobs, status, logs or responses.
            this.requestNotificationLookup();
            this.store.accept(candidate, Date.now());
            this.store.setMeta('last_push_result', 'accepted');
          }
        } catch (error) {
          if (error instanceof RelayError && error.code === 'invalid_ciphertext') { ack = 101; this.store.setMeta('last_error', 'invalid_ciphertext'); this.store.setMeta('last_push_result', 'invalid_ciphertext'); }
          else if (error instanceof RelayError && !error.retryable) { ack = 100; this.store.setMeta('last_push_result', safeError(error)); } // permanently ineligible content
          else throw error; // no ACK until the canonical candidate is durable
        }
      }
      if (generation !== this.generation || !this.enabled) return;
      await this.ctx.storage.sync();
      this.socket.send(JSON.stringify({ messageType: 'ack', updates: [{ channelID: message.channelID, version: message.version, code: ack }] }));
      this.ctx.waitUntil(this.drainAndSchedule());
    }
    await this.schedule();
  }

  async drainAndSchedule() {
    try { await this.syncNotifications(); await this.drain(); }
    catch (error) { this.store.setMeta('last_error', safeError(error)); }
    finally { await this.schedule(); }
  }

  async drain() {
    if (this.draining || !this.enabled) return;
    this.draining = true;
    try {
      for (let i = 0; i < 5 && this.enabled; i++) {
        const row = this.store.claimPost(Date.now());
        if (!row) break;
        try {
          const post = await verifyCandidate(row, this.config.feeds);
          const targets = await Promise.all(this.config.feeds.filter(feed => matchesFeed(post, feed)).map(async feed => ({ id: feed.id, hash: await fingerprint(feed) })));
          const decorated = targets.length ? await enrichAuthor(post) : post;
          this.store.resolvePost(row, decorated, targets, Date.now());
        } catch (error) {
          const retryable = !(error instanceof RelayError) || error.retryable;
          this.store.finish('posts', row, { state: retryable ? 'retry' : 'ignored', error: safeError(error) }, Date.now());
        }
      }
      for (let i = 0; i < 5 && this.enabled; i++) {
        const row = this.store.claimJob(Date.now());
        if (!row) break;
        const post = this.store.post(row.post_id);
        const feed = this.config.feeds.find(feed => feed.id === row.feed_id);
        let result;
        if (!feed || !post || !matchesFeed(post, feed)) result = { state: 'cancelled', error: 'feed_disabled_or_changed' };
        else if (await fingerprint(feed) !== row.destination_hash) result = { state: 'failed', error: 'destination_changed' };
        else if (!this.enabled) result = { state: 'retry', error: 'stopped' };
        else result = await sendDiscord(post, feed);
        this.store.finish('jobs', row, result, Date.now());
      }
    } finally { this.draining = false; }
  }
}
