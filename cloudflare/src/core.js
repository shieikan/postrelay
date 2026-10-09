import { Parser } from 'htmlparser2';

export class RelayError extends Error {
  constructor(code, retryable = false) { super(code); this.name = 'RelayError'; this.code = code; this.retryable = retryable; }
}

const fail = (code = 'invalid_config') => { throw new RelayError(code); };
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const handlePattern = /^[a-zA-Z0-9_]{1,15}$/;
const idPattern = /^[a-zA-Z0-9_-]{1,32}$/;
const feedFields = new Set(['id', 'handle', 'webhook_url', 'include', 'exclude', 'role_id', 'enabled', 'allow_unknown_kind']);

export function validateWebhook(value) {
  // Validate the raw input: URL normalisation can hide an explicit port or dot segments.
  if (typeof value !== 'string' || value.length > 500 || /\s/.test(value) ||
    !/^https:\/\/(?:discord\.com|ptb\.discord\.com|canary\.discord\.com)\/api\/webhooks\/[0-9]{1,24}\/[A-Za-z0-9_-]{1,200}$/.test(value)) fail('invalid_webhook');
  return value;
}

export function readConfig(raw) {
  let value;
  try {
    if (typeof raw !== 'string' || raw.length > 48000) fail();
    value = JSON.parse(raw);
  } catch { fail(); }
  if (!object(value) || Object.keys(value).some(key => key !== 'feeds') ||
    !Array.isArray(value.feeds) || value.feeds.length < 1 || value.feeds.length > 20) fail();
  const ids = new Set();
  const feeds = value.feeds.map(feed => {
    if (!object(feed) || Object.keys(feed).some(key => !feedFields.has(key)) ||
      typeof feed.id !== 'string' || !idPattern.test(feed.id) || ids.has(feed.id) ||
      typeof feed.handle !== 'string' || !handlePattern.test(feed.handle) ||
      feed.allow_unknown_kind !== true || typeof feed.enabled !== 'boolean') fail();
    ids.add(feed.id);
    const include = words(feed.include ?? []), exclude = words(feed.exclude ?? []);
    if (include.length + exclude.length > 100) fail();
    const role = feed.role_id ?? '';
    if (typeof role !== 'string' || (role && !/^[0-9]{1,24}$/.test(role))) fail();
    return { id: feed.id, handle: feed.handle.toLowerCase(), webhook_url: validateWebhook(feed.webhook_url),
      include, exclude, role_id: role, enabled: feed.enabled, allow_unknown_kind: true };
  });
  return { feeds };
}

function words(value) {
  if (!Array.isArray(value) || value.length > 100 || value.some(word =>
    typeof word !== 'string' || !word.trim() || word.trim().length > 100)) fail();
  return [...new Set(value.map(word => word.trim()))];
}

export function statusIdentity(value) {
  if (typeof value !== 'string' || value.length > 2048 || /[\s\x00-\x1f\x7f\\]/.test(value)) fail('not_public_post');
  const match = /^(?:https:\/\/(?:x\.com|twitter\.com))?(\/([A-Za-z0-9_]{1,15})\/status\/([0-9]{1,19})|\/i\/web\/status\/([0-9]{1,19}))(?:[?#][^\s]*)?$/.exec(value);
  if (!match) fail('not_public_post');
  return { author: match[2]?.toLowerCase() ?? null, id: match[3] ?? match[4] };
}

function publicText(html) {
  if (typeof html !== 'string' || html.length > 65536) fail('invalid_public_evidence');
  let active = false, finished = false, invalid = false;
  const parts = [];
  const parser = new Parser({
    onopentag(name) {
      if (name === 'p' && !finished) active = true;
      if (active && ['script', 'style', 'iframe'].includes(name)) invalid = true;
      if (active && name === 'br') parts.push('\n');
    },
    onclosetag(name, implied) {
      if (name === 'p' && active) { active = false; finished = true; if (implied) invalid = true; }
    },
    ontext(text) { if (active) parts.push(text); },
  }, { decodeEntities: true });
  parser.end(html);
  const text = parts.join('').trim();
  if (invalid || !finished || !text) fail('invalid_public_evidence');
  return [...text].slice(0, 4000).join('');
}

export function notificationCandidate(payload, feeds) {
  if (!object(payload) || !object(payload.data)) fail('not_public_post');
  const data = payload.data;
  const claimed = statusIdentity(Object.hasOwn(data, 'url') ? data.url : data.uri);
  if (Object.hasOwn(data, 'url') && Object.hasOwn(data, 'uri')) {
    const other = statusIdentity(data.uri);
    if (claimed.id !== other.id || claimed.author !== other.author) fail('not_public_post');
  }
  const authors = new Set(feeds.filter(feed => feed.enabled).map(feed => feed.handle));
  if (!authors.size || (claimed.author !== null && !authors.has(claimed.author))) fail('unconfigured_author');
  return { id: claimed.id, author: claimed.author, url: `https://x.com/${claimed.author ?? 'i/web'}/status/${claimed.id}` };
}

export async function verifyNotification(payload, feeds, resolver = resolvePublicEmbed) {
  const claimed = notificationCandidate(payload, feeds);
  const authors = new Set(feeds.filter(feed => feed.enabled).map(feed => feed.handle));
  const url = claimed.url;
  const evidence = await resolver(url);
  if (!object(evidence) || evidence.type !== 'rich') fail('invalid_public_evidence');
  const actual = statusIdentity(evidence.url);
  if (!actual.author || !authors.has(actual.author) || actual.id !== claimed.id ||
    (claimed.author !== null && actual.author !== claimed.author) ||
    typeof evidence.author_url !== 'string' ||
    !new RegExp(`^https://(?:x\\.com|twitter\\.com)/${actual.author}$`, 'i').test(evidence.author_url)) fail('invalid_public_evidence');
  return { id: actual.id, author: actual.author, url: `https://x.com/${actual.author}/status/${actual.id}`,
    text: publicText(evidence.html), kind: 'unknown', visibility: 'public',
    ...(displayName(evidence.author_name) ? { author_name: displayName(evidence.author_name) } : {}) };
}

// These fields are decoration only. Public-post eligibility is still proven by
// oEmbed above, never by notification titles, icons or syndication alone.
function displayName(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 200 ||
    /[\x00-\x1f\x7f-\x9f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u.test(value)) return null;
  return value.trim();
}

function profileImage(value) {
  if (typeof value !== 'string' || value.length > 500 || /[\s\\]/u.test(value)) return null;
  // Preserve the returned size/hash; never guess an image belonging to a handle.
  return /^https:\/\/pbs\.twimg\.com\/profile_images\/[0-9]+\/[A-Za-z0-9_-]+\.(?:jpg|jpeg|png|webp)$/i.test(value) ? value : null;
}

export async function resolvePublicAuthor(id) {
  if (typeof id !== 'string' || !/^[0-9]{1,19}$/.test(id) || /\s/.test(id)) fail('not_public_post');
  const endpoint = new URL('https://cdn.syndication.twimg.com/tweet-result');
  endpoint.searchParams.set('id', id);
  endpoint.searchParams.set('lang', 'en');
  // Public embed token calculation used by Vercel react-tweet (see NOTICE).
  endpoint.searchParams.set('token', ((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, ''));
  const response = await fetch(endpoint, { redirect: 'manual', signal: AbortSignal.timeout(2500),
    headers: { 'User-Agent': 'PostRelay/0.1' } });
  if (!response.ok) {
    await response.body?.cancel();
    throw new RelayError('public_author_unavailable');
  }
  return await readBoundedJson(response);
}

export async function enrichAuthor(post, resolver = resolvePublicAuthor) {
  try {
    const evidence = await resolver(post.id);
    const user = evidence?.user;
    if (!object(evidence) || evidence.__typename !== 'Tweet' || evidence.id_str !== post.id ||
      !object(user) || typeof user.screen_name !== 'string' ||
      user.screen_name.toLowerCase() !== post.author ||
      typeof user.id_str !== 'string' || !/^[0-9]{1,19}$/.test(user.id_str) || /\s/.test(user.id_str)) return post;
    const name = displayName(post.author_name) || displayName(user.name);
    const icon = profileImage(user.profile_image_url_https);
    return { ...post, author_id: user.id_str,
      ...(name ? { author_name: name } : {}), ...(icon ? { author_icon: icon } : {}) };
  } catch {
    // Best-effort decoration must not block a verified post or expose raw errors.
    return post;
  }
}

export function matchesFeed(post, feed) {
  if (!feed.enabled || post.author !== feed.handle || !feed.allow_unknown_kind) return false;
  const text = post.text.toLowerCase();
  if (feed.exclude.some(word => text.includes(word.toLowerCase()))) return false;
  return !feed.include.length || feed.include.some(word => text.includes(word.toLowerCase()));
}

export function discordMessage(post, feed) {
  const name = displayName(post.author_name), icon = profileImage(post.author_icon);
  const author = { name: name ? `${name} (@${post.author})` : '@' + post.author,
    url: `https://x.com/${post.author}`, ...(icon ? { icon_url: icon } : {}) };
  const message = { embeds: [{ author, title: '@' + post.author, description: post.text.slice(0, 4000),
    url: post.url, color: 13981467, footer: { text: 'PostRelay · 投稿通知' } }], allowed_mentions: { parse: [] } };
  if (feed.role_id) { message.content = `<@&${feed.role_id}>`; message.allowed_mentions.roles = [feed.role_id]; }
  return message;
}

export async function readBoundedJson(response, maxBytes = 65536) {
  if (!response.body) throw new RelayError('invalid_response', true);
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) fail('response_too_large');
      chunks.push(value);
    }
    const all = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { all.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(all));
  } catch { throw new RelayError('invalid_response', true); }
  finally { await reader.cancel().catch(() => {}); }
}

export async function resolvePublicEmbed(url) {
  try {
    const endpoint = new URL('https://publish.x.com/oembed');
    endpoint.search = new URLSearchParams({ url, omit_script: 'true' }).toString();
    const response = await fetch(endpoint, { redirect: 'manual', signal: AbortSignal.timeout(10000),
      headers: { 'User-Agent': 'PostRelay/0.1' } });
    if (!response.ok) {
      await response.body?.cancel();
      throw new RelayError('public_lookup_failed', response.status === 429 || response.status >= 500);
    }
    return await readBoundedJson(response);
  } catch (error) {
    if (error instanceof RelayError) throw error;
    throw new RelayError('public_lookup_failed', true);
  }
}

export async function sendDiscord(post, feed) {
  try {
    const response = await fetch(validateWebhook(feed.webhook_url) + '?wait=true', {
      method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(10000),
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'PostRelay/0.1' },
      body: JSON.stringify(discordMessage(post, feed)),
    });
    if (response.status === 429) {
      let delay = 30000;
      try {
        const value = await readBoundedJson(response, 32768);
        if (typeof value.retry_after === 'number' && Number.isFinite(value.retry_after)) delay = Math.max(1000, Math.min(value.retry_after * 1000, 86400000));
      } catch { /* keep bounded default */ }
      return { state: 'retry', error: 'discord_rate_limit', delay };
    }
    await response.body?.cancel();
    if (response.ok) return { state: 'delivered', error: '', delay: 0 };
    if (response.status >= 500) return { state: 'retry', error: 'discord_unavailable', delay: 0 };
    return { state: 'failed', error: 'discord_rejected', delay: 0 };
  } catch { return { state: 'retry', error: 'discord_unavailable', delay: 0 }; }
}

export async function fingerprint(feed) {
  const bytes = new TextEncoder().encode(JSON.stringify([feed.webhook_url, feed.role_id]));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(v => v.toString(16).padStart(2, '0')).join('');
}

export async function authorized(header, secret) {
  if (typeof secret !== 'string' || !/^[A-Za-z0-9_-]{43,128}$/.test(secret) ||
    typeof header !== 'string' || header.length > 160) return false;
  const encode = (value) => crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  const [a, b] = await Promise.all([encode(header), encode('Bearer ' + secret)]);
  let difference = 0;
  const left = new Uint8Array(a), right = new Uint8Array(b);
  for (let i = 0; i < left.length; i++) difference |= left[i] ^ right[i];
  return difference === 0;
}
