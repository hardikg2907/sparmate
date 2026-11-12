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
sources:
  - title: "Hello Interview: Design a URL Shortener Like Bit.ly"
    url: "https://www.hellointerview.com/learn/system-design/problem-breakdowns/bitly"
  - title: "ByteByteGo: Design a URL Shortener"
    url: "https://bytebytego.com/courses/system-design-interview/design-a-url-shortener"
  - title: "System Design Primer: Design Pastebin.com (or Bit.ly)"
    url: "https://github.com/donnemartin/system-design-primer/blob/master/solutions/system_design/pastebin/README.md"
confidence: "The sources agree on a 7-character base62 code and a point lookup by code. They differ on code generation (a counter with batched ranges, a hash with collision checks), which is why several are accepted, and on how clicks are counted (events, or a batch job over logs). One source ties the 301 or 302 choice to load against analytics, which matches this problem. One source returns 410 for an expired link; the others do not say, so 404 is accepted too. The scale numbers are this problem's own assumptions."
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

The row size and the peak factor below are assumptions. Accept other reasonable values when the candidate gives a reason.

- **Writes:** 100 million a month is about 40 per second on average and about 200 per second at peak, which means a single primary database handles writes with room to spare. Writes are not the problem.
- **Reads:** 100 times that is about 4,000 redirects per second on average and 20,000 or more at peak, which means the redirect path needs a cache in front of the database and must be stateless so it can scale out.
- **Storage:** 100 million a month for 5 years is 6 billion rows. At about 500 bytes a row (the long URL dominates) that is about 3 TB, which means it fits on one large Postgres primary with replicas, or a key-value store. Sharding by code is an option, not a necessity.
- **Hot set:** most clicks go to recent and popular links. If 100 million links are touched in a day at 500 bytes each, that is about 50 GB, which means a small Redis cluster can hold the hot set.
- **Code space:** 62 to the power 7 is about 3.5 trillion codes. 6 billion used is under 0.2% of the space, which means random 7-character codes rarely collide, but uniqueness still has to be enforced.

## API and entities

External API:
- `POST /urls` with `{ longUrl, customAlias?, expiresAt? }` returns `201 { code, shortUrl, expiresAt }`. `409` when the alias is taken, `400` for an invalid URL.
- `GET /{code}` returns `302` with `Location: <longUrl>`. `404` when unknown; `410 Gone` (or `404`) when expired or deleted.
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
                                                            │ 2. on a miss: read a replica; if not found, read the
                                                            │    primary under a rate cap (a new link may lag)
                                                            │ 3. fill Redis with SET NX and a TTL, answer 302;
                                                            │    found nowhere: cache the miss for about 1 s
                                                            └── 4. emit a click event, fire and forget ──> Kafka
                                                                                                          │
                                         click consumer: batch the events, add to ClickCount  <───────────┘
```

Walk one redirect: the load balancer sends `GET /aZ3kq9P` to any redirect server. It asks Redis for the code. On a hit it answers `302` at once and publishes a click event without waiting. On a miss it reads a Postgres replica. If the replica has no row, the link might be seconds old, so it reads the primary, but only under a rate cap per server. A code alone does not show its age, so without the cap a bot that scans random codes would send its whole load to the one primary. It stores the result in Redis with `SET NX` and a TTL no longer than the time to expiry, so a late fill never overwrites a delete's tombstone. A code found nowhere is cached as a miss for about a second, also with `SET NX`, so a scan stops at Redis and a brand-new link still works within a second or two. A tombstone or an expired link gets `410`, an unknown code `404`.

Walk one create: validate the URL, get a unique code, insert the row (the unique index is the final guard), write the mapping into Redis, return the short URL.

A delete sets `deletedAt`, then overwrites the Redis entry with a tombstone that lives a few minutes, longer than any replica lag. A plain key delete would leave a gap: a redirect that misses could read a lagging replica that still has the link and put it back.

## Accepted alternatives

- **Code generation.** All of these are fine with a reason:
  - Random 7-character base62 code, insert with a unique constraint, retry on conflict.
  - A counter, encoded in base62. Allocate counter ranges per server so there is no single hot counter, and scramble the number (a bijective shuffle) so codes are not guessable in order.
  - A key generation service that pre-creates codes and hands out batches.
  - A hash of the long URL cut to 7 characters, but only with collision handling. Many write-ups teach this one. A hash of the URL alone gives the same code each time the same URL is sent, which breaks the "new code each time" fact, so it needs a salt such as the creator id or a counter. Partial credit without that.
- **Storage.** Postgres with replicas (later sharded by code) or a key-value store such as DynamoDB or Cassandra. The access pattern is a point lookup by key, so either works. Judge the reason, not the brand.
- **301 versus 302.** 301 lets browsers cache the redirect, which cuts load but loses click counts and breaks expiry and deletion. 302 or 307 keeps control. Either is fine if the candidate states the consequence.
- **CDN caching of redirects.** Fine with a TTL under a minute (or a purge on delete), and a story for clicks: a CDN hit never reaches the redirect service, so its click is never sent. Count from CDN logs, or accept an undercount. The same choice sits under click counting in general: events to Kafka with a batching consumer (reference), a Redis counter per code (a viral link makes it a hot key), or a batch job over access or CDN logs. All are at-least-once or approximate, and all are fine with that stated.

## Deep dives

### Generating unique short codes
- **Bad:** "Hash the URL and take six characters" with no collision story. Or a single auto-increment ID exposed directly: guessable codes and one hot counter.
- **Good:** random 7-character base62 code, unique index, retry on conflict. Explains why conflicts are rare at under 0.2% fill.
- **Great:** each write server leases a block of counter values (for example a million at a time) from the database, encodes and scrambles them, so there are no retries and no hot spot. Knows that a crashed server wastes its block and that gaps are harmless. Keeps custom aliases and generated codes apart, so a later generated code can never equal an existing alias: a different length or a character the generator never uses, or a check of the alias table before a generated code is used. Reserves words such as `api` and `urls`.

### Fast, highly available redirects
- **Bad:** every redirect reads the primary database.
- **Good:** Redis cache-aside with a TTL, read replicas behind it, and numbers that show the hit ratio matters.
- **Great:** a viral link and the cache stampede it causes (request coalescing or single-flight). Replica lag for brand-new links with a primary fallback, bounded so a scan of random codes cannot reach the primary: a rate cap on fallback reads and a miss cached for about a second (a Bloom filter of issued codes also works, about 7 GB at 1% false positives for 6 billion codes). A delete that cannot be undone by a late fill: a tombstone in Redis and fills with `SET NX`, plus a CDN TTL under a minute.

### Counting clicks without slowing redirects
- **Bad:** `UPDATE links SET clicks = clicks + 1` inside the redirect. A viral link turns into a row-lock queue.
- **Good:** publish a click event and let a consumer add counts in batches.
- **Great:** states that counts are at-least-once (a little over, never blocking) and why that trade-off is right for analytics.

### Expiry and deletion
- **Bad:** a cron job is the only check, so an expired link redirects until the job runs. Or a cache TTL of a day with no word on deletes.
- **Good:** check `expiresAt` on read, cache TTL no longer than time to expiry, delete the cache key on delete, background job to clean old rows.
- **Great:** a delete writes a short-lived tombstone into Redis instead of a plain key delete, and fills use `SET NX`, so a redirect that read a lagging replica cannot put the link back. The CDN TTL stays under a minute, or a delete purges the CDN. An expired or deleted link answers `410 Gone`. States the minute budget and shows each cache layer fits inside it.

## Curveballs

Use one, at the extension point, unless the candidate already handled it.
1. **Hot link (10x load on one key):** "A celebrity posts one of our links. That single link now gets 200,000 redirects per second for an hour. What breaks first?" Expect: one code lives on one Redis shard, so more shards do not help. Fixes: a small in-process cache on each redirect server, CDN caching for that link, or replicating the hot key. The clicks follow the same key: 200,000 events a second for one code land on one Kafka partition when keyed by code, so each redirect server adds up its clicks in memory and sends one count a second, or the events are keyed randomly and the consumer adds them up. Clicks served by the CDN are counted from its logs or accepted as missing.
   Fits: Fast, highly available redirects
2. **Cache failure:** "Redis is down at peak. What happens, and what do you do?" Expect: the replicas take the reads, with capacity math on whether they can; a circuit breaker and load shedding so the database is not crushed; warming the cache back up gradually.
   Fits: Fast, highly available redirects
3. **Global latency:** "Users in Asia see 400 ms redirects. What do you change?" Expect: regional caches and read replicas; writes stay in one home region; codes stay unique across regions through range allocation or a region prefix. A delete must still stop the link everywhere within a minute: the home region sends the tombstone to every regional cache, or regional cache TTLs stay under a minute, and a regional replica that lags must not refill a deleted link. Clicks now start in several regions: each region adds up its own counts and ships them to the home region in batches, so a redirect never waits on a call across the world, and the total runs a little behind.
   Fits: Fast, highly available redirects; Generating unique short codes; Counting clicks without slowing redirects; Expiry and deletion

## Level bar

Hire bar must show:
- Requirements that include the read to write ratio, the latency target and freshness for new links.
- The 40 per second against 4,000 per second math, ending in "which means the read path needs a cache".
- An API with create and redirect, their inputs, outputs and main errors (409 for a taken alias, 404 for an unknown code), and a working design: stateless redirect service, cache, database, unique codes.
- One deep dive done properly when the interviewer picks it.
- When probed, names the viral-link hot key and gives at least one fix.

Stretch signal:
- Raises guessable codes and counter hot spots without a prompt, and reaches range allocation.
- Brings up cache stampede and single-flight on the hot link.
- Spots replica lag for brand-new links, and bounds the primary fallback so a scan of random codes cannot reach the primary.
- Sees that a late cache fill can bring back a deleted link, and fixes it with a tombstone.
- Takes click counting off the redirect path without being asked.
- Chooses 301 or 302 with the analytics and expiry consequence.

## Traps

- "Use a hash of the URL" with no collision handling.
- "Use NoSQL, it scales" with no access-pattern reason.
- A synchronous click-count update inside the redirect.
- Forgetting that the creator reads a brand-new link at once, through a lagging replica.
- Kafka or a fleet of microservices on the create path for 40 writes per second. Kafka for click events is fine.
- A primary fallback for every unknown code, with no cap: a scan of random codes then lands on the one primary.
- 301 by default, without noticing that analytics, expiry and deletion break.
