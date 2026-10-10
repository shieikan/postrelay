// All production outbound traffic is routed here during integration tests.
// Unknown destinations fail; this worker never calls the external network.
import { DurableObject } from 'cloudflare:workers';
const uaid = '0123456789abcdef0123456789abcdef';
export default {
  fetch(request, env) { return env.MOCK.get(env.MOCK.idFromName('upstream')).fetch(request); },
};
export class Mock extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.state = { connections: 0, registrations: [], messages: [], acks: [], embedRequests: 0, discordRequests: 0,
      profileRequests: 0, notificationRequests: 0, pendingEmbeds: 0, unexpected: [], options: {} };
    this.socket = null;
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS channel (id TEXT)');
    this.channel = ctx.storage.sql.exec('SELECT id FROM channel').toArray()[0]?.id;
    this.releases = [];
  }
  async fetch(request) {
    const state = this.state;
    const url = new URL(request.url);
    if (url.hostname === 'mock.test') {
      if (url.pathname === '/state') return Response.json(state);
      if (url.pathname === '/options') { Object.assign(state.options, await request.json()); return Response.json({ ok: true }); }
      if (url.pathname === '/push') {
        const data = await request.json();
        this.socket.send(JSON.stringify({ messageType: 'notification', channelID: this.channel, ...data }));
        return Response.json({ ok: true });
      }
      if (url.pathname === '/frame') { this.socket.send(await request.text()); return Response.json({ ok: true }); }
      if (url.pathname === '/release') { for (const release of this.releases.splice(0)) release(); return Response.json({ ok: true }); }
      if (url.pathname === '/close') {
        const body = request.method === 'POST' ? await request.json() : {};
        this.socket.close(body.code ?? 4774, 'Synthetic close'); return Response.json({ ok: true });
      }
    }
    if (url.hostname === 'push.services.mozilla.com' && request.headers.get('Upgrade') === 'websocket') {
      state.connections++;
      const pair = new WebSocketPair();
      const client = pair[0], server = pair[1];
      this.socket = server; server.accept();
      server.addEventListener('message', event => {
        const message = JSON.parse(event.data);
        if (message.messageType === 'hello') server.send(JSON.stringify({ messageType: 'hello', status: 200, uaid: state.options.uaid ?? uaid, use_webpush: true }));
        else if (message.messageType === 'register') {
          this.channel = message.channelID;
          this.ctx.storage.sql.exec('DELETE FROM channel');
          this.ctx.storage.sql.exec('INSERT INTO channel(id) VALUES (?)', this.channel);
          server.send(JSON.stringify({ messageType: 'register', status: 200, channelID: this.channel,
            pushEndpoint: 'https://updates.push.services.mozilla.com/wpush/v2/synthetic' }));
        } else if (message.messageType === 'ack') state.acks.push(...message.updates);
        else server.send('{}');
      });
      return new Response(null, { status: 101, webSocket: client });
    }
    if (url.hostname === 'x.com' && url.pathname === '/i/api/1.1/notifications/settings/login.json') {
      state.registrations.push((await request.json()).push_device_info);
      return Response.json({}, { status: state.options.registrationStatus ?? 200 });
    }
    if (url.hostname === 'x.com' && url.pathname === '/i/api/2/notifications/device_follow.json') {
      state.notificationRequests++;
      if (state.options.holdNotifications) await new Promise(resolve => this.releases.push(resolve));
      return Response.json(state.options.notifications ?? { globalObjects: { users: {}, tweets: {} }, timeline: { instructions: [] } },
        { status: state.options.notificationStatus ?? 200 });
    }
    if (url.hostname === 'publish.x.com' && url.pathname === '/oembed') {
      state.embedRequests++;
      if (state.options.holdEmbed) {
        state.pendingEmbeds++;
        await new Promise(resolve => this.releases.push(resolve));
        state.pendingEmbeds--;
      }
      if (state.options.embedStatus && state.options.embedStatus !== 200) return Response.json({}, { status: state.options.embedStatus });
      if (state.options.embedBody) return Response.json(state.options.embedBody);
      const id = new URL(url.searchParams.get('url')).pathname.split('/').at(-1);
      return Response.json({ type: 'rich', url: `https://x.com/demo_studio/status/${id}`,
        author_url: 'https://x.com/demo_studio', author_name: 'Demo Studio', html: `<blockquote><p>Public post ${id}</p>Footer</blockquote>` });
    }
    if (url.hostname === 'cdn.syndication.twimg.com' && url.pathname === '/tweet-result') {
      state.profileRequests++;
      if (state.options.profileStatus) return Response.json({}, { status: state.options.profileStatus });
      return Response.json({ __typename: 'Tweet', id_str: url.searchParams.get('id'),
        user: { id_str: '456', screen_name: 'demo_studio', name: 'Demo Studio',
          profile_image_url_https: 'https://pbs.twimg.com/profile_images/456/demo_normal.png' } });
    }
    if (url.hostname === 'discord.com' && url.pathname === '/api/webhooks/123/synthetic') {
      state.discordRequests++;
      if (state.options.discordStatus && state.options.discordStatus !== 200) return Response.json({ retry_after: state.options.retryAfter ?? 30 }, { status: state.options.discordStatus });
      state.messages.push(await request.json());
      return Response.json({ id: 'synthetic-message' });
    }
    state.unexpected.push(url.origin + url.pathname);
    return new Response('Unexpected mock destination', { status: 502 });
  }
}
