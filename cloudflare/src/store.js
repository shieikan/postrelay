import { RelayError } from './core.js';

export const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
export const PENDING_LIMIT = 1000;
const LEASE_MS = 60000;

export class Store {
  constructor(storage) {
    this.storage = storage;
    this.sql = storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS posts (
      id TEXT PRIMARY KEY, url TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'queued',
      public_json TEXT, attempts INTEGER NOT NULL DEFAULT 0, next_at INTEGER NOT NULL,
      lease TEXT, lease_until INTEGER, error TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL)`);
    this.sql.exec(`CREATE INDEX IF NOT EXISTS posts_due ON posts(state, next_at)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY, post_id TEXT NOT NULL, feed_id TEXT NOT NULL, destination_hash TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'queued', attempts INTEGER NOT NULL DEFAULT 0,
      next_at INTEGER NOT NULL, lease TEXT, lease_until INTEGER, error TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`);
    this.sql.exec(`CREATE INDEX IF NOT EXISTS jobs_due ON jobs(state, next_at)`);
    this.sql.exec(`CREATE INDEX IF NOT EXISTS jobs_post ON jobs(post_id)`);
  }
  meta(key, fallback = null) {
    const row = this.sql.exec('SELECT value FROM metadata WHERE key = ?', key).toArray()[0];
    return row ? JSON.parse(row.value) : fallback;
  }
  setMeta(key, value) {
    this.sql.exec('INSERT INTO metadata(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, JSON.stringify(value));
  }
  accept(candidate, now) {
    return this.storage.transactionSync(() => {
      if (this.sql.exec('SELECT id FROM posts WHERE id = ?', candidate.id).toArray().length) return false;
      const pending = this.sql.exec("SELECT count(*) AS n FROM posts WHERE state IN ('queued','retry','sending')").one().n;
      if (pending >= PENDING_LIMIT) throw new RelayError('queue_full', true);
      this.sql.exec('INSERT INTO posts(id, url, next_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
        candidate.id, candidate.url, now, now, now);
      this.setMeta('last_received_at', now);
      return true;
    });
  }
  claimPost(now) { return this.claim('posts', now); }
  claimJob(now) { return this.claim('jobs', now); }
  claim(table, now) {
    // table is an internal constant, never an HTTP/configuration field.
    if (table !== 'posts' && table !== 'jobs') throw new Error('invalid_table');
    return this.storage.transactionSync(() => {
      this.sql.exec(`UPDATE ${table} SET state = 'failed', error = 'attempt_limit', lease = NULL,
        lease_until = NULL, updated_at = ? WHERE state = 'sending' AND lease_until <= ? AND attempts >= 8`, now, now);
      const row = this.sql.exec(`SELECT * FROM ${table} WHERE
        (state IN ('queued','retry') AND next_at <= ?) OR
        (state = 'sending' AND lease_until <= ?) ORDER BY created_at, id LIMIT 1`, now, now).toArray()[0];
      if (!row) return null;
      const lease = crypto.randomUUID();
      this.sql.exec(`UPDATE ${table} SET state = 'sending', attempts = attempts + 1,
        lease = ?, lease_until = ?, updated_at = ? WHERE id = ?`, lease, now + LEASE_MS, now, row.id);
      return { ...row, lease, attempts: row.attempts + 1, state: 'sending' };
    });
  }
  resolvePost(row, post, destinations, now) {
    return this.storage.transactionSync(() => {
      const valid = this.sql.exec("SELECT id FROM posts WHERE id = ? AND lease = ? AND state = 'sending'", row.id, row.lease).toArray().length;
      if (!valid) return;
      const pending = this.sql.exec("SELECT count(*) AS n FROM jobs WHERE state IN ('queued','retry','sending')").one().n;
      if (pending + destinations.length > PENDING_LIMIT) throw new RelayError('queue_full', true);
      for (const target of destinations) {
        this.sql.exec(`INSERT OR IGNORE INTO jobs(id, post_id, feed_id, destination_hash, next_at, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)`, `${post.id}:${target.id}`, post.id, target.id, target.hash, now, now, now);
      }
      this.sql.exec("UPDATE posts SET state = 'resolved', public_json = ?, lease = NULL, lease_until = NULL, error = '', updated_at = ? WHERE id = ?",
        JSON.stringify(post), now, row.id);
    });
  }
  post(id) {
    const row = this.sql.exec('SELECT public_json FROM posts WHERE id = ?', id).toArray()[0];
    return row?.public_json ? JSON.parse(row.public_json) : null;
  }
  finish(table, row, result, now) {
    if (table !== 'posts' && table !== 'jobs') throw new Error('invalid_table');
    let state = result.state;
    if (state === 'retry' && row.attempts >= 8) state = 'failed';
    const delay = result.delay || Math.min(5000 * (2 ** Math.min(row.attempts - 1, 10)), 1800000);
    return this.storage.transactionSync(() => {
      const updated = this.sql.exec(`UPDATE ${table} SET state = ?, next_at = ?, error = ?, lease = NULL,
        lease_until = NULL, updated_at = ? WHERE id = ? AND lease = ? AND state = 'sending' RETURNING id`,
      state, now + delay, result.error || '', now, row.id, row.lease).toArray().length;
      if (updated && table === 'jobs' && state === 'delivered') this.setMeta('last_delivered_at', now);
    });
  }
  retryFailed(now) {
    return this.storage.transactionSync(() => {
      let retried = 0, remaining = false;
      for (const table of ['posts', 'jobs']) {
        const active = this.sql.exec(`SELECT count(*) AS n FROM ${table} WHERE state IN ('queued','retry','sending')`).one().n;
        const available = Math.max(0, PENDING_LIMIT - active);
        retried += this.sql.exec(`UPDATE ${table} SET state = 'queued', attempts = 0,
          next_at = ?, error = '', lease = NULL, lease_until = NULL, updated_at = ? WHERE id IN (
          SELECT id FROM ${table} WHERE state = 'failed' ORDER BY updated_at, id LIMIT ?)
          RETURNING id`, now, now, available).toArray().length;
        remaining ||= this.sql.exec(`SELECT id FROM ${table} WHERE state = 'failed' LIMIT 1`).toArray().length > 0;
      }
      if (!retried && remaining) throw new RelayError('queue_full');
      return retried;
    });
  }
  nextDue() {
    const row = this.sql.exec(`SELECT min(due) AS due FROM (
      SELECT next_at AS due FROM posts WHERE state IN ('queued','retry') UNION ALL
      SELECT lease_until FROM posts WHERE state = 'sending' UNION ALL
      SELECT next_at FROM jobs WHERE state IN ('queued','retry') UNION ALL
      SELECT lease_until FROM jobs WHERE state = 'sending')`).one();
    return row.due;
  }
  cleanup(now) {
    // Pending work is never discarded to make room. Keep at most 2,000 terminal
    // jobs and 2,000 unreferenced terminal posts; retain posts needed by jobs.
    this.storage.transactionSync(() => {
      this.sql.exec("DELETE FROM jobs WHERE state NOT IN ('queued','retry','sending') AND updated_at < ?", now - RETENTION_MS);
      this.sql.exec(`DELETE FROM jobs WHERE id IN (SELECT id FROM jobs WHERE state NOT IN ('queued','retry','sending')
        ORDER BY updated_at DESC, id LIMIT -1 OFFSET 2000)`);
      this.sql.exec(`DELETE FROM posts WHERE state NOT IN ('queued','retry','sending') AND updated_at < ?
        AND NOT EXISTS (SELECT 1 FROM jobs WHERE jobs.post_id = posts.id)`, now - RETENTION_MS);
      this.sql.exec(`DELETE FROM posts WHERE id IN (SELECT id FROM posts WHERE state NOT IN ('queued','retry','sending')
        AND NOT EXISTS (SELECT 1 FROM jobs WHERE jobs.post_id = posts.id)
        ORDER BY updated_at DESC, id LIMIT -1 OFFSET 2000)`);
    });
  }
  counts(table) {
    if (table !== 'posts' && table !== 'jobs') throw new Error('invalid_table');
    return Object.fromEntries(this.sql.exec(`SELECT state, count(*) AS n FROM ${table} GROUP BY state`).toArray().map(row => [row.state, row.n]));
  }
  errors(table) {
    if (table !== 'posts' && table !== 'jobs') throw new Error('invalid_table');
    return Object.fromEntries(this.sql.exec(`SELECT error, count(*) AS n FROM ${table}
      WHERE state IN ('retry','failed') AND error != '' GROUP BY error`).toArray().map(row => [row.error, row.n]));
  }
}
