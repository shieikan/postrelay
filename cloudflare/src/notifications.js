import { RelayError, statusIdentity, verifyNotification } from './core.js';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const id = value => typeof value === 'string' && /^[0-9]{1,19}$/.test(value) && !/\s/.test(value);
const handle = value => typeof value === 'string' && /^[A-Za-z0-9_]{1,15}$/.test(value) && !/\s/.test(value);

// Only the dedicated device-follow timeline can confer repost attribution.
// Push titles, ordinary mentions, quoted posts and nested graph records cannot.
export function notificationBatch(value, feeds, since, now) {
  const graph = value?.globalObjects, instructions = value?.timeline?.instructions;
  if (!object(graph?.tweets) || !object(graph?.users) || !Array.isArray(instructions) || instructions.length > 100)
    throw new RelayError('notification_sync_invalid', true);
  const entries = instructions.flatMap(instruction => instruction?.addEntries?.entries ?? []);
  if (entries.length > 100) throw new RelayError('notification_sync_invalid', true);
  const candidates = [];
  let watermark = since;
  const user = key => {
    const found = graph.users[key];
    return id(key) && found?.id_str === key && handle(found.screen_name) && found.protected === false ? found : null;
  };
  for (const entry of entries) {
    const eventId = entry?.content?.item?.content?.tweet?.id;
    if (!id(eventId) || entry.entryId !== `tweet-${eventId}`) continue;
    if (typeof entry.sortIndex !== 'string' || !/^[0-9]{1,16}$/.test(entry.sortIndex)) continue;
    const timestamp = Number(entry.sortIndex);
    // Milliseconds are not unique: replay the boundary and deduplicate by ID.
    if (!Number.isSafeInteger(timestamp) || timestamp < since || timestamp > now + 60000) continue;
    watermark = Math.max(watermark, timestamp);
    const event = graph.tweets[eventId];
    if (event?.id_str !== eventId) continue;
    const actor = user(event.user_id_str);
    if (!actor) continue;
    const actorHandle = actor.screen_name.toLowerCase();
    const targets = feeds.filter(feed => feed.enabled && feed.handle === actorHandle);
    if (!targets.length) continue;
    if (event.retweeted_status_id_str !== undefined) {
      const originalId = event.retweeted_status_id_str, original = graph.tweets[originalId];
      if (!targets.some(feed => feed.include_reposts) || !id(originalId) || originalId === eventId ||
        original?.id_str !== originalId || original.retweeted_status_id_str !== undefined) continue;
      const author = user(original.user_id_str);
      if (!author) continue;
      candidates.push({ id: eventId, url: `https://x.com/${author.screen_name.toLowerCase()}/status/${originalId}`, reposted_by: actorHandle });
    } else {
      candidates.push({ id: eventId, url: `https://x.com/${actorHandle}/status/${eventId}` });
    }
  }
  return { candidates, watermark };
}

export async function verifyCandidate(row, feeds, resolver) {
  if (!row.reposted_by) return verifyNotification({ data: { url: row.url } }, feeds, resolver);
  if (!handle(row.reposted_by) || !id(row.id) || !feeds.some(feed => feed.enabled && feed.include_reposts && feed.handle === row.reposted_by))
    throw new RelayError('unconfigured_author');
  const original = statusIdentity(row.url);
  if (!original.author || original.id === row.id) throw new RelayError('invalid_public_evidence');
  // The actor was established by the authenticated X relationship above.
  // Independently require public evidence for the original author's content.
  const post = await verifyNotification({ data: { url: row.url } }, [{ handle: original.author, enabled: true }], resolver);
  return { ...post, id: row.id, original_id: post.id, kind: 'repost', reposted_by: row.reposted_by };
}
