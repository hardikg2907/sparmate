---
id: c2-url-shortener
track: hld
title: URL Shortener
difficulty: easy
tags: [read-heavy, caching, id-generation, key-value]
tracker:
  section: "### C2. Classic HLD Problems"
  bullet: "URL Shortener"
notesFile: notes/c2-url-shortener.md
---

## Opening prompt

Let's design a URL shortener, something like bit.ly. Where would you like to start?

## Hidden facts

Reveal a fact only when the candidate asks about it, or asks a question whose honest answer needs it. Never volunteer the list.

- **Who creates links:** anyone with an API key. Accounts exist but auth is out of scope. A logged-in user can list and delete their own links.
- **Core features:** shorten a long URL, and redirect a short URL to the long one. Optional custom alias (for example `/big-sale`). Optional expiry date.
- **Analytics:** a total click count per link is enough. No real-time dashboards, no per-country breakdown.
- **New links per month:** 100 million.
- **Read to write ratio:** about 100 redirects per link created. Traffic is spiky: a viral link can take a large share for an hour.
- **Retention:** links live 5 years unless the creator sets an earlier expiry.
- **Code length:** as short as reasonably possible. Letters and digits only.
- **Latency:** a redirect should add under 50 milliseconds at p99 on our side. Creating a link can take up to half a second.
- **Availability:** redirects matter most, target 99.99%. Link creation can be 99.9%.
- **Freshness:** the creator must be able to use a new link immediately. Everyone else within a second or two.
- **Same long URL twice:** give a new short code each time. No deduplication.
- **Custom alias taken:** reject with an error.
- **Deletion:** a deleted link must stop redirecting within a minute.
- **Regions:** users are global. Start with one region; a CDN in front is fine.
- **Abuse and malware scanning:** out of scope.

For the interviewer: on abuse and malware scanning, a one-line mention is enough.

## Expected requirements

Core, functional:
1. Create a short link for a long URL, with an optional custom alias and an optional expiry. *Ask: What can a user do when creating a link?*
2. Redirect a short link to its long URL; an expired link stops redirecting. *Ask: What happens when someone opens a short link?*

Core, non-functional:
1. About 100 million new links a month and about 100 redirects per link, with viral spikes. *Ask: How many links are created, and how often is each one opened?*
2. A redirect adds under 50 ms at p99. *Ask: How fast must a redirect be?*
3. Redirects stay up at 99.99%; creating links can be 99.9%. *Ask: Which matters more if something fails, redirects or creating links?*
4. Every code is unique, forever. Two links never share a code. *Ask: What must always be true about a short code?*
5. A new link works at once for its creator (read-your-own-write). *Ask: How soon must a new link work, and for whom?*

Extras (credit when they name one, never a gap):
- Delete a link (owner only); a deleted link stops redirecting within a minute.
- A total click count per link.
- Links live 5 years by default, so about 6 billion links in total.
- Codes are as short as possible, letters and digits only.

## Capacity math

- **Writes:** 100 million a month is about 40 per second on average and about 200 per second at peak, which means a single primary database handles writes with room to spare. Writes are not the problem.
- **Reads:** 100 times that is about 4,000 redirects per second on average and 20,000 or more at peak, which means the redirect path needs a cache in front of the database and must be stateless so it can scale out.
- **Storage:** 100 million a month for 5 years is 6 billion rows. At about 500 bytes a row (the long URL dominates) that is about 3 TB, which means it fits on one large Postgres primary with replicas, or a key-value store. Sharding by code is an option, not a necessity.
- **Hot set:** most clicks go to recent and popular links. If 100 million links are touched in a day at 500 bytes each, that is about 50 GB, which means a small Redis cluster can hold the hot set.
- **Code space:** 62 to the power 7 is about 3.5 trillion codes. 6 billion used is under 0.2% of the space, which means random 7-character codes rarely collide, but uniqueness still has to be enforced.

## API and entities

External API:
- `POST /urls` with `{ longUrl, customAlias?, expiresAt? }` returns `201 { code, shortUrl, expiresAt }`. `409` when the alias is taken, `400` for an invalid URL.
- `GET /{code}` returns `302` with `Location: <longUrl>`. `404` when unknown, expired or deleted.
- `DELETE /urls/{code}` (owner) returns `204`.
- `GET /urls/{code}/stats` returns `{ clicks }`.

Core entities:
- `Link { code (primary key), longUrl, ownerId?, createdAt, expiresAt?, deletedAt? }`
- `ClickCount { code, clicks }` (or click events aggregated into it)

## Reference design

```
 create:  Client ──> LB ──> Write service ──> code generator ──> Postgres primary (unique index on code)
                                   └──> write the new mapping into Redis (write-through)

 redirect: Client ──> CDN (short TTL, optional) ──> LB ──> Redirect service (stateless, many)
                                                            │ 1. GET code from Redis
                                                            │ 2. on a miss: read a replica; if not found and the
                                                            │    link may be brand new, read the primary
                                                            │ 3. fill Redis with a TTL, answer 302
                                                            └── 4. emit a click event, fire and forget ──> Kafka
                                                                                                          │
                                         click consumer: batch the events, add to ClickCount  <───────────┘
```

Walk one redirect: the load balancer sends `GET /aZ3kq9P` to any redirect server. It asks Redis for the code. On a hit it answers `302` at once and publishes a click event without waiting. On a miss it reads a Postgres replica, falls back to the primary if the row is missing and the link might be seconds old, stores the result in Redis with a TTL no longer than the time to expiry, and answers.

Walk one create: validate the URL, get a unique code, insert the row (the unique index is the final guard), write the mapping into Redis, return the short URL.

## Accepted alternatives

- **Code generation.** All of these are fine with a reason:
  - Random 7-character base62 code, insert with a unique constraint, retry on conflict.
  - A counter, encoded in base62. Allocate counter ranges per server so there is no single hot counter, and scramble the number (a bijective shuffle) so codes are not guessable in order.
  - A key generation service that pre-creates codes and hands out batches.
  - A hash of the long URL cut to 7 characters, but only with collision handling.
- **Storage.** Postgres with replicas (later sharded by code) or a key-value store such as DynamoDB or Cassandra. The access pattern is a point lookup by key, so either works. Judge the reason, not the brand.
- **301 versus 302.** 301 lets browsers cache the redirect, which cuts load but loses click counts and breaks expiry and deletion. 302 or 307 keeps control. Either is fine if the candidate states the consequence.
- **CDN caching of redirects.** Fine with a short TTL and a story for deletes.

## Deep dives

### Generating unique short codes
- **Bad:** "Hash the URL and take six characters" with no collision story. Or a single auto-increment ID exposed directly: guessable codes and one hot counter.
- **Good:** random 7-character base62 code, unique index, retry on conflict. Explains why conflicts are rare at under 0.2% fill.
- **Great:** each write server leases a block of counter values (for example a million at a time) from the database, encodes and scrambles them, so there are no retries and no hot spot. Knows that a crashed server wastes its block and that gaps are harmless.

### Fast, highly available redirects
- **Bad:** every redirect reads the primary database.
- **Good:** Redis cache-aside with a TTL, read replicas behind it, and numbers that show the hit ratio matters.
- **Great:** a viral link and the cache stampede it causes (request coalescing or single-flight), replica lag for brand-new links with a primary fallback, deleting the Redis key on delete plus a TTL as the safety net.

### Counting clicks without slowing redirects
- **Bad:** `UPDATE links SET clicks = clicks + 1` inside the redirect. A viral link turns into a row-lock queue.
- **Good:** publish a click event and let a consumer add counts in batches.
- **Great:** states that counts are at-least-once (a little over, never blocking) and why that trade-off is right for analytics.

### Expiry and deletion
- **Good:** check `expiresAt` on read, cache TTL no longer than time to expiry, delete the cache key on delete, background job to clean old rows.

## Curveballs

Use one, at the extension point, unless the candidate already handled it.
1. **Hot link (10x load on one key):** "A celebrity posts one of our links. That single link now gets 200,000 redirects per second for an hour. What breaks first?" Expect: one code lives on one Redis shard, so more shards do not help. Fixes: a small in-process cache on each redirect server, CDN caching for that link, or replicating the hot key.
   Fits: Fast, highly available redirects
2. **Cache failure:** "Redis is down at peak. What happens, and what do you do?" Expect: the replicas take the reads, with capacity math on whether they can; a circuit breaker and load shedding so the database is not crushed; warming the cache back up gradually.
   Fits: Fast, highly available redirects
3. **Global latency:** "Users in Asia see 400 ms redirects. What do you change?" Expect: regional caches and read replicas; writes stay in one home region; codes stay unique across regions through range allocation or a region prefix.
   Fits: Fast, highly available redirects; Generating unique short codes

## Level bar

Hire bar must show:
- Requirements that include the read to write ratio, the latency target and freshness for new links.
- The 40 per second against 4,000 per second math, ending in "which means the read path needs a cache".
- A clean API and a working design: stateless redirect service, cache, database, unique codes.
- One deep dive done properly when the interviewer picks it.
- Names the viral-link hot key when probed, and gives at least one fix.

Stretch signal:
- Raises guessable codes and counter hot spots without a prompt, and reaches range allocation.
- Brings up cache stampede and single-flight on the hot link.
- Spots replica lag for brand-new links.
- Takes click counting off the redirect path without being asked.
- Chooses 301 or 302 with the analytics and expiry consequence.

## Traps

- "Use a hash of the URL" with no collision handling.
- "Use NoSQL, it scales" with no access-pattern reason.
- A synchronous click-count update inside the redirect.
- Forgetting that the creator reads a brand-new link at once, through a lagging replica.
- Kafka and a fleet of microservices for 40 writes per second.
- 301 by default, without noticing that analytics, expiry and deletion break.
