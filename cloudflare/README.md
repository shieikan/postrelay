# Cloudflare adapter

An experimental, single-operator deployment of PostRelay on Workers and one
SQLite-backed Durable Object. Start with the [Japanese setup guide](../docs/cloudflare.md).
There is no GUI or multi-tenant account system in this adapter. The existing
Python/Docker deployment is independent.

## Data flow and recovery

```text
Authenticated control Worker
          |
          v
One Relay Durable Object <-- outgoing Mozilla AutoPush WebSocket
          |
          +-- decrypt push in memory
          +-- validate candidate status URL and configured author
          +-- persist canonical URL, then ACK Mozilla
          +-- verify public oEmbed ID, author and content
          +-- atomically store public text and per-feed Discord jobs
          +-- send through configured Discord webhooks
```

All authors and channels share `idFromName('postrelay')`. Creating an object for
each author would invalidate the one-object free-duration estimate. All
management routes require the operator bearer token, checked both by the Worker
and the object. `/health` reports HTTP liveness only. A new database is stopped.

The protocol and X registration compatibility code is a port of
[Angelic-Angel](https://github.com/sh1ma/Angelic-Angel) at
`169a098e2025cc6e41a50fc8d521c483e21d9b6d`; see [NOTICE](NOTICE).
The X web-client bearer identifier and VAPID public key in source are public
protocol constants. They do not replace the operator's X cookies.

The outgoing socket uses the standard WebSocket API. Outgoing connections cannot
use [Cloudflare WebSocket hibernation](https://developers.cloudflare.com/durable-objects/best-practices/websockets/).
A recovery alarm runs at most 60 seconds apart; earlier queue deadlines shorten
that interval to at least one second. The protocol sends an idle ping after five
minutes. Handshakes and pings have deadlines, and the next recovery alarm is armed
before network work. The upgrade request's ten-second cancellation timer is
cleared after a successful handshake so it cannot terminate the established
WebSocket. Mozilla close code 4774 persists a 30-minute backoff. Other
transient connection failures back off from five seconds to five minutes. An X
401/403 pauses source retries until the operator renews cookies and starts again.

This follows the [Durable Object lifecycle](https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/)
and [alarm recovery model](https://developers.cloudflare.com/durable-objects/api/alarms/).
Platform eviction, quota exhaustion, upstream retention and runtime changes can
still interrupt delivery. The always-active cost estimate and a successful local
socket test do not prove continuous cloud operation.

Public lookup and Discord work have separate durable queues. A canonical
candidate remains available when public lookup is temporarily unavailable. Jobs
use 60-second leases with random identifiers so a stale completion cannot replace
a newer attempt. A crash after Discord accepts a request can still produce a
duplicate. Each queue item gets at most eight attempts, including recovered
leases, before explicit retry is required. The destination fingerprint includes
the webhook and role ID; queued work cannot silently move to a replacement
destination. Deduplication lasts only while the relevant history is retained.

Manual retry requeues the oldest failed rows up to the remaining active capacity
of each queue independently. Excess failures and existing active leases remain
unchanged; retry again after capacity becomes available. A full public-lookup
queue does not block a delivery queue that still has room.

The CLI validates the normalized configuration against a conservative 5,000-byte
UTF-8 limit before putting it in a single Worker Secret. The twenty-feed count
limit is subject to that aggregate size limit, including webhook values and
filters. Status and stop use validated management fields, while retaining
the same protected-file, origin and token checks. Start, retry and secret upload
continue to validate the complete runtime settings.

See the [operator guide](../docs/cloudflare.md) for limits and
retention. Cleanup runs hourly while enabled. It preserves pending work and posts
referenced by jobs. Completed history and unused posts are bounded separately.

## Local checks

Use Node.js 22 or newer and Python 3 for the POSIX terminal fixture. Run from this
directory:

```sh
npm ci
npm test
npm run build
npm audit --audit-level=high
```

`build` is a Wrangler dry run. It needs no Cloudflare login and does not deploy.
Tests use synthetic credentials. Runtime tests execute real workerd WebSockets,
SQLite transactions, alarms and Web Crypto, with every outbound request routed to a local
mock Durable Object. Unknown mock destinations fail instead of reaching the
network. A persisted-alarm test resumes queued work after a full runtime restart
without a start command. Other scenarios shorten retry deadlines instead of
waiting for production intervals. The test-only entry point is not used by Wrangler; its inspection
routes are not exposed by the production HTTP router.

The tests cover:

- RFC 8291's published decryption vector and an independent `http_ece` oracle for
  modern `aes128gcm` and legacy `aesgcm` encryption.
- Private-body exclusion, identity proof, mismatched authors, DMs, redirects,
  malformed responses, mention restrictions and bounded input.
- Authentication, methods, source registration, singleton reuse, persisted
  backoff, authentication failures and subscription replacement.
- Delivery over the same healthy socket after the handshake deadline, and
  cancellation of a handshake that never completes.
- Deduplication, public-lookup outages, Discord 429, automatic restart recovery, stale
  leases, retry limits, queue limits and pending-work preservation.
- Stop during lookup, destination replacement and wrong-storage-key recovery.
- Protected setup files, symlink rejection and hidden input in an actual POSIX
  terminal. The CLI prints known status fields and error codes only.
- Configuration byte boundaries, multibyte values, management during unrelated
  local setting errors, and bounded retries with more than 1,000 retained failures.

Miniflare 5 is currently the version required by the pinned Wrangler release.
The lockfile pins both. A targeted override selects `sharp` 0.35.5 for Miniflare
to address [GHSA-wq5f-xc86-pv6w](https://github.com/advisories/GHSA-wq5f-xc86-pv6w)
in its development-only image dependency. No image-processing feature or sharp
dependency is shipped in the Worker bundle. Review this override when updating
Wrangler instead of removing it to match a transitive version range.

## Security boundary and remaining evidence

The exposed assets are management authority, X cookies, Discord webhooks,
subscription private keys and queued delivery state. This is a trusted-operator
deployment. HTTPS endpoints are fixed or strictly allowlisted; redirects are
not followed. SQL values are bound parameters. Only canonical candidate URLs,
IDs, confirmed repost actor handles and independently confirmed public text enter queue storage. Raw push bodies and
titles never enter jobs, status responses or application logs.

The subscription is encrypted and authenticated with AES-256-GCM, a fresh random
nonce and an installation-specific key stored in Worker Secrets. Web Push uses
Web Crypto P-256 ECDH, HKDF and AES-GCM. Cookie and webhook values live in Secrets,
not queue rows. The provider and anyone controlling the Cloudflare account can
access the running Worker and its secrets; this is not protection against that
operator. Loss of `STORAGE_KEY` fails closed without resetting state.

Browser sessions, password recovery, multi-tenant authorization, payments and
file uploads are not applicable: this adapter provides none of them. The
unauthenticated `/health` endpoint and rejected requests still consume Worker
request quotas. Upstream changes, credential expiration, provider outages,
quota exhaustion and Discord's lack of a delivery idempotency key remain
availability/duplicate-delivery risks. A dependency scan does not certify the
whole application.

Local verification on 2026-10-07 covers the synthetic scenarios above. It does
**not** cover real X registration from Cloudflare, current X account eligibility,
real Discord messages, cloud free-tier metering, or a 24-hour run. The initial
release should remain experimental until those checks are recorded on the
intended installation. CI installs, tests, audits and bundles; it never deploys
or accesses live service credentials.

## Public author metadata

Eligible posts retain the validated public oEmbed display name. A best-effort, unauthenticated request to X's public syndication endpoint adds the matching top-level author's ID and profile image. The response is capped at 64 KiB and 2.5 seconds; redirects, mismatched IDs/handles, tombstones, and non-profile CDN image URLs are rejected. Metadata failure does not change public-post eligibility or block delivery. No push body/title/icon is used. Saved posts without metadata still render.

The metadata snapshot follows the existing post retention policy and is reused for multiple destinations and retries. It is not a current-profile cache, permanent identity tracker, or replacement for the configured handle allowlist. See NOTICE for the react-tweet token calculation attribution.

## Optional repost reconciliation

An enabled feed with `include_reposts: true` activates one shared, authenticated
GET of X's device-follow notification timeline only when a post or notification-list push arrives. Startup, reconnect and idle alarms never initiate a lookup. The request
uses only the fixed `x.com` endpoint, a ten-second timeout, no redirects and a
1 MiB response cap. This is an undocumented browser endpoint, not a stable API.
An authentication failure or rate limit postpones reconciliation for 30 minutes;
the independent Web Push connection is unchanged. Separate status fields report
the last successful reconciliation, error and next attempt.

Only top-level notification entries establish candidates. The wrapper user ID
must resolve to a public configured account, and its explicit retweeted-status
ID must resolve to the public original author. Nested quotes and unconfigured
actors do not confer eligibility. The original ID/author/content must then pass
unauthenticated oEmbed verification. Raw authenticated timeline text is discarded.
Discord displays the original author's name/icon with a separate repost actor.

The latest 20 entries are checked without pagination. Existing installations
start from their last accepted notification timestamp; new installations start
with a five-minute overlap at the first push. The persisted millisecond boundary is
inclusive; wrapper IDs deduplicate repeated results and distinguish different
accounts reposting the same original. A previously rejected raw-push wrapper can
be upgraded by a confirmed relationship. Normal post candidates use the existing
post IDs. Read errors and stopped generations do not advance the checkpoint.
Push-triggered lookup work is persisted before ACK and retried up to eight times on failure. No recurring timeline polling runs after that work completes. This recovers recent notification gaps, not arbitrary historical posts or every
event during an extended outage. The optional actor column is a nullable additive
SQLite migration; older records retain their original behavior.
