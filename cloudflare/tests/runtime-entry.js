// Test-only entry point. Never referenced by wrangler.jsonc or a deploy command.
import worker, { Relay } from '../src/worker.js';
export default worker;
export class TestRelay extends Relay {
  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === '/__test/due') {
      this.store.sql.exec("UPDATE posts SET next_at = 0, lease_until = 0 WHERE state IN ('queued','retry','sending')");
      this.store.sql.exec("UPDATE jobs SET next_at = 0, lease_until = 0 WHERE state IN ('queued','retry','sending')");
      this.store.setMeta('next_reconnect_at', 0);
      await this.tick();
      return Response.json({ ok: true });
    }
    if (path === '/__test/restart-alarm') {
      this.store.sql.exec("UPDATE jobs SET next_at = 0 WHERE state = 'retry'");
      await this.ctx.storage.setAlarm(Date.now() + 1500);
      await this.ctx.storage.sync();
      return Response.json({ ok: true });
    }
    if (path === '/__test/inspect') return Response.json({
      metadata: this.store.sql.exec('SELECT * FROM metadata').toArray(),
      posts: this.store.sql.exec('SELECT * FROM posts').toArray(),
      jobs: this.store.sql.exec('SELECT * FROM jobs').toArray(),
    });
    if (path === '/__test/store') {
      const input = await request.json();
      const execute = ({ operation, args = [] }) => {
        // Explicit test-only store operations, reached through the local DO binding.
        if (!['accept', 'claimPost', 'claimJob', 'resolvePost', 'finish', 'post', 'counts', 'cleanup', 'retryFailed', 'meta', 'nextDue'].includes(operation))
          return { error: 'unknown_test_operation' };
        try { return { value: this.store[operation](...args) ?? null }; }
        catch (error) { return { error: error.message }; }
      };
      return Response.json(Array.isArray(input) ? input.map(execute) : execute(input));
    }
    return super.fetch(request);
  }
}
