---
id: c2-web-crawler
track: hld
title: Web Crawler
difficulty: medium
tags: [frontier, politeness, dedup, bloom-filter, partitioning, recrawl]
tracker:
  section: "### C2. Classic HLD Problems"
  bullet: "Web Crawler"
notesFile: notes/c2-web-crawler.md
---

## Opening prompt

Let's design a web crawler, the kind a search engine uses to collect pages. Where would you like to start?

## Hidden facts

Reveal a fact only when the candidate asks about it, or asks a question whose honest answer needs it. Never volunteer the list.

Terms: a **host** is a host name such as `news.example.com`. A **fetch** is one HTTP request that the crawler starts. A **first visit** is the first fetch of a URL. A **refresh** is a later fetch of a URL we already hold.

- **Purpose:** the crawler feeds a search index. It fetches pages and stores the raw HTML. A separate indexer reads that output. Text extraction, ranking and serving search are out of scope.
- **Scale:** 1 billion fetches a month, steady, around the clock. Failed fetches count. Requests for robots.txt and DNS lookups do not. The crawler sets its own pace, so there is no traffic peak. After an outage it must catch up, so plan for about twice the average rate.
- **What we fetch:** HTML over HTTP and HTTPS, `GET` only, public pages only. The scope is the whole public web, in any language, with no domain list. No images, video or PDFs: a response whose `Content-Type` is not HTML is dropped once its headers arrive. No JavaScript rendering: we keep what the server sends.
- **Page size and time:** an average page is 100 KB of HTML, and HTML compresses about 4 to 1. A body over 5 MB is cut off at 5 MB. A fetch gets 10 seconds in total, and a typical one takes about 1 second. Follow at most 5 redirects.
- **What we know today:** about 10 billion URLs on about 50 million hosts. About 1.5 billion of those URLs have been fetched and are in the index. The other 8.5 billion are known but not yet fetched. Most hosts are small. A few hold hundreds of millions of URLs each.
- **Links:** a page has about 50 links on average, after removing repeats within the page. About 99% point to URLs we already know.
- **Mix of fetches:** about 70% are refreshes and about 30% are first visits. This is today's mix. The share of refreshes rises as the index grows, but design for today's mix.
- **Seeds:** about 1 million known good sites start the crawl. Many sites also publish a sitemap. Sitemaps help but are optional.
- **Importance:** an offline job scores each host every week from the links other hosts point at it. Pages have no score of their own. The crawler may use the host score, link depth and observed change rate to set priority.
- **Freshness:** about 5 million pages (news front pages, feeds, listings) change within a day, and we want them refreshed about daily. About 50 million change about weekly, and we want them refreshed about weekly. The other 1.4 billion or so rarely change. No page in the index may be older than 6 months. Change rates are not known in advance, so the crawler must learn them. About half of all pages send an `ETag` or `Last-Modified` header, and the rest do not. A newly found URL has no deadline for its first visit: priority decides when it is fetched.
- **Politeness:** one request at a time per host, and at least 1 second between the start of one request and the start of the next to the same host. This holds across all machines and after a restart. One IP address gets at most 5 requests a second in total, across all hosts on it. Many small hosts share one address: about 20% of hosts sit on an address with 10 or more other hosts, and a few addresses carry 10,000 hosts or more. A `429` or `503` means slow down. Honour `Retry-After`, or else double that host's delay, up to 60 seconds.
- **robots.txt:** obey it for our user agent, which names the crawler and links to a contact page. Fetch it before the first URL of a host, and treat it as valid for 24 hours. Honour `Allow`, `Disallow` and `Crawl-delay`. A host's delay is the larger of its `Crawl-delay` and 1 second. Most hosts set none, and most that do ask for 1 to 10 seconds. A host that asks for more than 60 seconds is crawled at the lowest priority. A `404`, or any other `4xx` except `429`, means everything is allowed. A `5xx`, a `429` or a timeout means treat the host as fully disallowed and try again in an hour. No disguise, and no rotating IP addresses to dodge blocks.
- **DNS:** a lookup that misses every cache takes about 50 ms. A few percent take over a second or fail. Record TTLs run from 5 minutes to 1 hour.
- **Failures:** about 10% of fetches fail (DNS error, timeout or `5xx`). About 5% return `404` or `410`. About 15% answer with a redirect.
- **Duplicates:** about 25% of fetched pages are exact or near copies of a page we already hold under another URL. Examples are mirrors, print views, tracking-parameter variants and syndicated text. One copy should reach the index. One page also has many URL forms: tracking parameters, session ids, trailing slashes, `http` and `https`, `www` and bare host names, fragments.
- **Traps:** the open web has calendars with endless "next month" links, faceted search, session ids in URLs, repeating paths such as `/a/b/a/b/`, and wildcard subdomains that all answer. The product has agreed one limit: a URL is at most 2,000 characters. It has no view on depth or per-host budgets, so accept any reasonable limit that comes with a reason.
- **Storage and output:** keep raw pages for 12 months so the indexer can rebuild from them. Object storage is available. For each fetch the crawler publishes an event with the URL, status, time, checksum and where the body is stored. The indexer wants each new or changed page within an hour of its fetch.
- **Failure tolerance:** the crawler may pause for hours and then catch up. Fetching a page twice is fine. Breaking a politeness rule is not. Losing the list of known URLs is not acceptable either, because it took months to build.
- **Operators:** a small team runs the crawler. They can set a host's delay or monthly budget, or block a host. A block takes effect at once, even for URLs already queued. They watch the fetch rate, the backlog and the error rates.
- **Infrastructure:** one region with three availability zones. Kubernetes, Postgres, Kafka, Redis, object storage and a small etcd cluster for leases are available. Cost matters, so aim for tens of machines, not hundreds.
- **Out of scope:** the indexer, ranking, JavaScript rendering, images and PDFs, logins, `noindex` and `nofollow` tags, and legal review beyond robots.txt.

## Expected requirements

Core, functional:
1. Start from seed URLs and follow links. Fetch HTML over HTTP and HTTPS. *Ask: What does the crawler start from, and what does it fetch?*
2. Obey robots.txt and `Crawl-delay`; one request per host at a time, at most one a second. *Ask: What rules must it follow when visiting a site?*
3. Store the raw HTML of every new or changed page durably, and tell the indexer. *Ask: What must it keep for each page, and who uses it?*
4. Never queue a known URL, in any form; keep one copy of duplicate content. *Ask: What if one page is reachable by many URLs, or has copies?*

Core, non-functional:
1. About 400 fetches a second (1 billion a month); 10 billion URLs, 50 million hosts. *Ask: How big is the crawl: pages a month, URLs and hosts?*
2. Politeness is a hard rule: it holds across nodes, restarts and failovers. *Ask: How strictly must the per-site request limit hold?*
3. The list of known URLs is never lost; a lost page body can be fetched again. *Ask: Which data is costly to lose, and which can be rebuilt?*
4. Refresh pages as often as they change; nothing older than 6 months. *Ask: How fresh must stored pages be?*
5. One node failing never stops the crawl; a duplicate fetch is fine. *Ask: What if a crawler node fails mid-crawl?*

Extras (credit when they name one, never a gap):
- Fast-changing pages refresh about daily, the next group about weekly.
- Survive spider traps, slow or broken servers, huge bodies and redirect loops.
- Up to about 300 TB of raw pages kept for 12 months, with room for about 800 fetches a second when catching up.

## Capacity math

Per-node and per-row figures below are assumptions. Accept other reasonable values when the candidate gives a reason.

- **Fetch rate and bandwidth:** 1 billion a month over 2.6 million seconds (30 days) is about 385, so about 400 fetches a second. Catch-up headroom doubles that to about 800. At 100 KB a page, 400 a second is 40 MB a second, about 320 Mbit a second, or a quarter of that with gzip on the wire. Which means the raw rate is modest and bandwidth is not the limit. The crawl is hard because of what surrounds each fetch (politeness, dedup, scheduling).
- **Sockets and nodes:** at about 1 second a fetch, Little's law gives 400 fetches in flight on average and 800 when catching up. At about 50 fetches a second per node (cautious, because TLS, parsing and compression use the CPU), 8 nodes cover the average and 16 cover catch-up. The reference uses 16, so a node holds only 25 fetches in flight on average and 50 when catching up. Which means sockets are not the limit. CPU and failure isolation set the fleet size, and any count from 4 to 40 nodes is fine with a reason.
- **Politeness:** one request a second per host means at most about 2.6 million fetches per host per month (2,592,000 seconds). With one request in flight per host, 400 fetches in flight need 400 different hosts at every instant, and 800 when catching up. Which means the frontier must always hold hundreds of ready hosts, so a queue sorted by priority alone stalls on the big hosts. It also means a host with 300 million URLs would take about 116 months, almost 10 years, so big hosts need a budget by value, not a FIFO.
- **Links:** 400 pages a second at 50 links each is at most 20,000 links a second. Failures, redirects and `304` replies carry no links, so the true rate is nearer 10,000 to 15,000. Accept either. 99% are known, so only about 200 a second (500 million a month) are new at the upper figure. Which means the seen check runs 25 to 50 times as often as the fetch and answers "drop" 99% of the time, so it must be a lookup in batches on the shard that owns the host, not a network call per link.
- **Frontier growth:** about 500 million new URLs a month against 300 million first visits grows the unfetched backlog (8.5 billion today) by about 200 million a month. Which means the frontier never drains, so priority decides which URLs ever get fetched.
- **Seen set:** 10 billion URLs as 8-byte fingerprints is 80 GB exact, about 5 GB per shard over 16 shards. A Bloom filter at 1% false positives needs 9.6 bits a URL (7 hash functions), about 12 GB, or about 18 GB at 0.1%. Its 1% error silently drops about 5 million new URLs a month for good. A filter sized for 10 billion reaches about 16% false positives at 20 billion, which is about 20 months away at 500 million new URLs a month. Which means even the exact set fits in memory across the fleet, so a Bloom filter is an option, not a necessity.
- **URL table:** a row holds the URL text, state, times and validators. At about 150 bytes a row, 10 billion rows are 1.5 TB, which is 16 shards of about 94 GB. Each shard sees about 1,250 seen-checks a second (20,000 over 16) and about 60 writes a second (about 1,000 overall: 200 new URLs, 400 leases and 400 results, plus a few hundred a second of batched host-row saves at most). Which means sharded Postgres carries the load easily. The table is far too big for memory, so only the heads of the back queues sit there.
- **Host table:** 50 million hosts at about 500 bytes (name, IP, robots rules, delay, next allowed time, budget) is 25 GB, about 1.6 GB per node. Which means the host heap, the DNS answers and the robots rules sit in memory, split by host, with no cache shared between nodes.
- **DNS:** at most one lookup per fetch, so at most 400 a second, about 20 in flight at 50 ms. Which means DNS volume is small. The risk is the tail: a few percent take over a second or fail, and a blocking OS resolver call holds a worker. Caching the answer for its TTL leaves about one lookup per host visit.
- **robots.txt:** refreshing all 50 million hosts daily would be about 580 fetches a second, more than the page rate. If the average host gets about 2 visits a month (an assumption; a visit is one sitting that fetches its due URLs), refreshing only when a visit finds the copy over 24 hours old costs about 100 million fetches a month, about 40 a second, or about 10% on top of the page rate. Which means the refresh is lazy and driven by visits, never a daily sweep.
- **Raw storage:** 1 billion fetches at 100 KB is 100 TB a month, or at most 25 TB compressed, which is about 300 TB for 12 months. The true figure is lower, because failed, redirected, unchanged and duplicate fetches store nothing. Which means object storage, not a database. One object per page is 1 billion PUT requests a month, about 400 a second. Archive files of about 256 MB cut that to about 100,000 a month, 10,000 times fewer. A file closes at 256 MB or after 10 minutes. A node at the average rate (25 pages a second at 25 KB, or 625 KB a second) fills one in about 7 minutes, which means the indexer sees each page within about 10 minutes, well inside its hour.
- **Content index:** 1.5 billion pages at about 32 bytes (a 16-byte checksum, an 8-byte simhash and an 8-byte pointer) is about 48 GB. Which means it fits in memory or on SSD across a few nodes. It must be keyed by checksum, not by host, because copies of a page live on different hosts, so it is a second partition key beside the frontier's.
- **Refresh budget:** 70% of 1 billion is 700 million refreshes a month over 1.5 billion pages, which is one refresh per page every 2 months on average. A flat monthly refresh would need 1.5 billion fetches, more than the whole budget. Daily for 5 million hot pages costs 150 million a month (30 each). Weekly for 50 million costs about 200 million (about 4 each). That leaves 350 million for the other 1.445 billion pages, about one visit every 4 months, inside the 6-month limit. A new page starts with a long interval, about a month, because a short start for every new page would use up the cold-tier budget. Which means the tiers are forced, and no flat schedule can work. The month adds up: 700 million refreshes plus 300 million first visits is the 1 billion.

## API and entities

Operator API (internal HTTPS, a few calls):
- `POST /seeds` with `{ urls }` returns `202 { accepted }`. `400` for a malformed URL.
- `PUT /hosts/{host}/policy` with `{ delayMs?, monthlyBudget?, blocked? }` returns `204`. A blocked host stops at once, even for URLs already queued (a takedown).
- `GET /hosts/{host}` returns `200 { importance, queued, fetchedThisMonth, delayMs, nextAllowedAt, robotsStatus }`.
- `GET /stats` returns the fetch rate, the backlog by priority, error rates by class and the oldest overdue refresh.

Event contracts (Kafka, keyed by a hash of the host, 256 partitions):
- `discovered { url, fromUrl, depth, discoveredAt }` goes from a parser to the node that owns the host.
- `fetched { url, finalUrl, status, fetchedAt, bytes, checksum, simhash, etag?, lastModified?, duplicateOf?, archive?: { file, offset, length } }` is published for every fetch. When the fetch stored a body, the event waits until the archive that holds it is sealed. The indexer reads the events that carry `archive`. The owner node reads all of them.

Object storage: `raw/{date}/{node}/{n}.warc.zst`. Each record is compressed on its own, so a ranged read of (offset, length) returns one page.

Core entities:
- `Host { hostId, host, registeredDomain, importance, ip, ipExpiresAt, robotsRules, robotsStatus, robotsFetchedAt, delayMs, nextAllowedAt, monthlyBudget, fetchedThisMonth, blocked }`, partitioned by `hostId`. `importance` is the weekly host score. `nextAllowedAt` and `fetchedThisMonth` live in memory on the owner and are saved to the table in batches, so after a takeover the new owner cannot trust them. It treats every host as just hit.
- `UrlRecord { hostId, urlFingerprint, url, state, priority, depth, leaseUntil?, lastFetchedAt?, nextFetchAt?, intervalDays, etag?, lastModified?, checksum?, failCount }`. The primary key is `(hostId, urlFingerprint)`. `state` is `queued`, `leased`, `fetched`, `dead` or `parked`. Partial indexes: queued rows by `(hostId, priority desc, nextFetchAt)`, leased rows by `leaseUntil`, fetched rows by `nextFetchAt`.
- `Content { checksum, simhash, canonicalFingerprint, archive }`, keyed by checksum, with the simhash lookup tables beside it.
- In memory on each node: the host heap and the small back queues, both rebuilt from the tables.
- Redis: `ip:{address}` holds a token bucket for the 5-requests-a-second cap per IP address.

## Reference design

```
 discover:  Parser ──> normalise, filter ──> Kafka `discovered` (key: hash of host)
              owner node of that host, in batches per host:
                seen check in the URL table; a new URL becomes a `queued` row with a priority

 crawl loop, on each node (it owns about 16 of the 256 host partitions):
   front queues   P1 hot refreshes and important hosts | P2 normal | P3 long tail
        │ refill, highest priority first, a few URLs per host at a time
        v
   back queues    one small FIFO per host          host heap: (nextAllowedAt, host)
        │ pop a host whose time has come and take one URL. The host stays out of the heap while its
        │ fetch runs, then goes back, ready at the later of (start + delay) and the end of the fetch
        v
   fetch pool     async I/O, workers never sleep
     1. host record: robots rules older than 24 h? fetch robots.txt first, as this turn's request.
        URL disallowed, host blocked or over budget? park the URL.
     2. DNS: the IP is in the host record. Expired? resolve through the node's caching resolver.
     3. IP limiter (Redis, key: IP): more than 5 a second? push the host back 200 ms and move on.
     4. GET, conditional if we hold an ETag. 10 s in total, 5 MB cap. A redirect on the same host goes
        to the front of that host's back queue with its hop count, at most 5, so the host's delay
        still holds between hops. A redirect to another host goes to `discovered`.
   parse pool     checksum and simhash ──> content index (key: checksum): exact copy? skip the body
                  links ──> normalise ──> Kafka `discovered`
   archive writer append the body to the node's open archive file (256 MB or 10 minutes)
        │ file sealed ──> object storage ──> one `fetched` event per page in it
        v
   owner node reads `fetched`: set state, nextFetchAt, etag, checksum. The indexer reads the same topic.
   A URL stays `leased` for 30 minutes until its `fetched` event arrives. A reaper requeues the rest.
```

Setup: 256 partitions by a hash of the host name. About 16 crawler nodes own about 16 partitions each, assigned through a lease in etcd, and each node reads exactly the Kafka partitions it holds leases on. The URL table and host table use the same 256 partitions, stored on 16 Postgres shards, each a primary with a replica in another zone. The front queues are not a separate store. They are the `(priority, nextFetchAt)` order of the `queued` rows, and the node refills each back queue from it. Each owner also runs two periodic jobs: a reaper that requeues expired leases, and a sweep that requeues fetched URLs whose `nextFetchAt` has passed.

Walk one URL. A page links to `https://Example.com/a/?utm_source=x#top`. The parser normalises it to `https://example.com/a` and publishes it, keyed by the host. The node that owns `example.com` checks the URL table. No row exists, so it inserts one as `queued` at priority 2. Days later the host reaches the top of the heap. Its robots rules are 3 hours old and allow the URL, and its IP is cached. A fetch worker gets the page in 700 ms. The content index has no copy of the checksum. The body goes into the open archive, and the host goes back on the heap, ready 1 s after its fetch started. Within ten minutes the archive is sealed and uploaded, and the `fetched` event goes out. The owner marks the row `fetched` and sets `nextFetchAt` a month ahead, the starting interval for a page with no history. The indexer reads the page.

Walk one refresh. A hot page's `nextFetchAt` passes, and the sweep sets its row to `queued` at priority 1, because its interval is short. The fetch sends `If-None-Match`, and the server answers `304`. The event carries no archive pointer, and the owner lengthens the interval by half. A changed page would answer `200`, and the owner would halve the interval, down to a floor of 1 day.

## Accepted alternatives

- **Frontier shape.** All of these are fine with a reason:
  - Priority front queues feeding per-host back queues, with a heap on next allowed time (the reference).
  - One priority queue per host and a global heap of hosts. Host importance then orders the hosts.
  - One lightweight worker or actor per active host that holds its queue head and next allowed time (an actor under a supervisor, such as an Elixir process or an Akka actor, is also accepted). This is valid and strong if the candidate says where the state is saved.
  - A shared queue (SQS or RabbitMQ) plus a per-host limiter in Redis. The candidate must say that a host that is not ready goes back with a delay, not a busy loop. They should see that a backlog full of a few big hosts makes most pops fail.
  - Kafka as the frontier itself is not fine, because a consumer cannot hold back one message and serve the next on the same partition. Kafka between stages is fine.
- **Partition key.** Host name (the reference). Registered domain, so a site and its subdomains share an owner, is fine. IP address needs DNS before routing, and a move when the IP changes. A hash of the whole URL spreads load evenly but scatters one host over every node. It works only with a shared per-host limiter, which then becomes a hot dependency.
- **Partition ownership.** An etcd lease per partition (the reference), Kafka consumer-group assignment, or a lease row in Postgres. A fixed split by StatefulSet number is fine if a replacement pod waits out the politeness cool-down before it fetches. Whatever the choice, a node that cannot renew its lease must stop fetching before the lease runs out.
- **Where fetchers run.** Inside the node that owns the frontier slice (the reference), or as stateless workers that lease URLs from a frontier service. The second scales fetchers on their own but adds a hop and a lease protocol.
- **Frontier store.** Sharded Postgres (the reference), RocksDB on each node with replication, or Cassandra or DynamoDB keyed by host. Judge the access pattern: point lookups by `(host, fingerprint)` and a range read by priority and due time within a host. One large Postgres primary is fine if the candidate shows that 20,000 point reads and 1,000 writes a second fit, and says what changes at 10 times the size. Redis as the only copy is not fine: failover can lose writes, and 1.5 TB is too big for memory.
- **Politeness delay.** A fixed 1 second, the robots `Crawl-delay`, or an adaptive rule. A delay of 10 times the last response time is a classic rule. At 1-second responses it means 11 seconds a page, so one host gets only about 235,000 fetches a month. The candidate should say so.
- **Seen set.** The exact URL table (the reference), or exact 64-bit fingerprints in RocksDB or a sorted file. A Bloom filter, or a cuckoo filter that can delete, is fine when the candidate names the false-positive loss and keeps recrawl state elsewhere.
- **Content dedup.** An exact checksum is enough for an SDE-2 if the candidate says that near copies pass through, because a changed ad or timestamp changes the hash. Simhash or MinHash with shingles is the full answer.
- **Page storage.** Archive files in object storage, WARC-style (the reference). One object per page is fine if the candidate states the request count. HDFS is fine. A relational table or a wide-column store that holds 5 MB bodies is not.
- **DNS and recrawl.** DNS: a cache in the host record plus a caching resolver on each node (the reference), a shared resolver fleet, or an in-process cache. The plain OS resolver on every fetch is not fine unless it stays off the fetch path. Recrawl: an adaptive interval per URL (the reference), or fixed tiers by page class if the class comes from observed change. Sitemap `lastmod`, feeds and push pings are extra signals.
- **Order and tools.** Plain breadth first is fine for a first version if per-host politeness holds. Naming Scrapy, Nutch, Heritrix or StormCrawler is fine as an aside. The candidate still designs the internals.

## Deep dives

### The URL frontier: priority, politeness and partitioning by host
- **Bad:** one FIFO queue (plain breadth first), or one queue sorted by priority. The next 400 URLs belong to a few big hosts, so the politeness rule breaks or workers sit idle. Or a `sleep(1)` inside the fetch worker, which wastes the worker. Or any machine takes any URL, so two machines hit one host together.
- **Good:** two layers. Front queues by priority (3 to 5 levels) decide what matters. Back queues, one per host, decide when. A min-heap keyed by each host's next allowed time hands out only hosts that are ready. While a fetch runs the host stays out of the heap, so only one request is ever in flight. Afterwards it goes back, ready at the later of the fetch's start plus the delay and the fetch's end. Nodes own hosts by a hash of the host name, so one node enforces each host's delay in memory, with no cross-node locks. The delay is the larger of 1 second and the robots `Crawl-delay`. Workers never sleep. They ask for the next ready URL. The queues sit in a durable store, because 10 billion rows do not fit in memory.
- **Great:** does the arithmetic. 400 fetches in flight need 400 different ready hosts, and one host gives at most 2.6 million fetches a month. Keeps each back queue to a small window that the priority tiers refill, so a first-priority URL never waits behind a million low-priority URLs of one host. Adapts the delay: doubles it on `429` or `503`, honours `Retry-After`, eases back after good answers. Uses far more partitions than nodes (256 over 16), so a dead node's share spreads out. Hands URLs out under a lease, so a dead worker's URLs come back. Limits requests per IP address as well, with a small shared limiter, because hosts on one IP can sit on different nodes. Checks robots.txt when a URL is handed out, not when it is found, because the backlog is months old.

### Duplicates and spider traps
- **Bad:** compares raw URL strings, so `http://Example.com/a?utm_source=x#top` and `http://example.com/a` count as two pages. Looks up each link with a database round trip on one unsharded table, or keeps the set in one process's memory. Hashes the whole page with MD5 and calls that near-duplicate detection, though one changed ad or timestamp defeats it. Fights traps with a depth limit alone. That hides legitimate deep pages and does nothing about a trap that is wide, not deep (a calendar has thousands of pages at depth 3).
- **Good:** normalises first: lowercase scheme and host, drop the fragment and the default port, resolve `.` and `..`, sort query parameters, strip tracking and session parameters, drop a trailing slash on the path, resolve relative links. Variants that a text rule cannot merge safely, such as `http` and `https` or `www` and the bare host name, are caught later by the redirect and the content checksum. Fingerprints the result to 64 bits and checks a seen set split by the same host hash as the frontier, so the check and the enqueue happen on the owner node. Sizes it: 80 GB exact, or about 12 GB as a Bloom filter at 1%. For content, a body checksum catches exact copies. A similarity fingerprint such as simhash catches near copies: two 64-bit fingerprints that differ in 3 bits or fewer count as near copies. Caps URL length, path depth, repeated path segments and pages per host to limit traps.
- **Great:** knows what a Bloom filter cannot do. It loses 1% of new URLs for good (about 5 million a month), it cannot delete, it holds no recrawl state, and it decays as it fills (about 16% false positives at 20 billion for a filter sized for 10 billion). A filter in front of an exact table saves only the lookups for new URLs, about 1% of links, so the exact table that recrawl needs anyway can serve as the seen set. Batches a page's links by host before the lookup. Versions the normalisation rules, because changing a rule changes every fingerprint. Strips menus, ads and timestamps before hashing content. Keeps the content index keyed by checksum, not by host, because copies sit on different hosts. Finds near copies through a few permuted copies of the fingerprint table instead of comparing against every page. Detects traps from behaviour: groups a host's URLs by path template (digits replaced, such as `/calendar/{n}/{n}`), and when one template keeps yielding new URLs with a rising share of duplicate or near-empty bodies, demotes and caps it. Caps hosts per registered domain and requests per IP, so a wildcard-DNS farm cannot mint a billion hosts.

### Recrawl scheduling
- **Bad:** refetches everything every N days. That is 1.5 billion fetches a month against a 1 billion budget, and it treats a news front page like a page that never changes. Or crawls until the frontier is empty and then starts over, though the frontier never empties.
- **Good:** each URL has a `nextFetchAt` and an interval that adapts to what the last fetches saw. A changed page halves the interval (floor 1 day). An unchanged page grows it by half, up to a cap of about 5 months, so a late sweep still meets the 6-month limit. A page with no history starts at about a month. A conditional `GET` with `ETag` or `If-Modified-Since` makes an unchanged page cost a `304` and no body. Without validators, the body checksum shows the change. A sweep puts due URLs back into the frontier at a priority taken from the host's importance and the page's change rate.
- **Great:** starts from the budget. 700 million refreshes over 1.5 billion pages means an uneven split: 150 million for the daily tier, 200 million for the weekly tier, 350 million for the rest. Knows that refresh frequency should not simply track change rate, because a page that changes every few minutes is stale again almost at once and extra visits buy little. Finds new pages through hubs (front pages, category pages, feeds, sitemaps with `lastmod`), refreshes the hubs often, and then fetches each new URL once. Adds jitter so due times do not bunch. Keeps a due-time index per partition, so the sweep is a range read. Sets a hard deadline for the 6-month limit, so cold pages never slip past it.

### The fetch path and raw storage
- **Bad:** uses the OS resolver on every fetch, so a dead name server blocks a worker for seconds. Fetches robots.txt for every URL, or never refreshes it. Treats a `5xx` on robots.txt as "no rules". Reads whatever comes back with no cap on time or size, so a server that sends one byte a second pins a worker and a gzip bomb fills memory. Stores pages as database rows or Kafka messages, or writes one object per page.
- **Good:** resolves with an async resolver and a cache. The IP lives in the host record and honours the record's TTL, with a floor of a few minutes. Caches robots.txt for 24 hours per host, refreshes it only when a visit finds it stale, and follows the failure rules (`404` allows all, a `5xx` or timeout disallows and retries in an hour). Caps total time (10 seconds), body size (5 MB) and redirects (5). Stores raw pages in object storage, with the URL table holding the pointer. Retries transient failures with growing waits and a limit, and marks a URL dead after repeated `404` or `410`.
- **Great:** runs a caching resolver on each node, with negative caching and stale answers during a resolver outage. Measures the decompressed size, and aborts a transfer that runs below a minimum rate. Sends a redirect to another host back through the frontier instead of following it inline, so that host's delay holds. Treats a host that keeps failing as one unit, with a host-level breaker and growing back-off, so a dead site's million URLs do not each wait out 10 seconds. Packs pages into archive files of about 256 MB, with each record compressed on its own, so a ranged read of (file, offset, length) returns one page. Counts requests: 1 billion PUTs against about 100,000. Marks a URL `fetched` only after its archive is sealed, with a lease longer than the roll time (30 minutes against 10), so a node that dies with an open file loses nothing for good. Puts the pointer in the `fetched` event, so the indexer never lists the bucket.

## Curveballs

Use one, at the extension point, unless the candidate already handled it.
1. **Giant host (hot spot):** "One forum site holds 300 million URLs and ranks high in your priorities. What happens to the crawl, and what do you change?" Expect: politeness caps that host at about 2.6 million fetches a month, under 1% of its URLs, so full coverage takes about 10 years. More fetchers do not help, because more load on one host is what the rule forbids. The rest of the crawl keeps its rate while at least 400 other hosts are ready, because the heap hands out ready hosts only. The fix is a budget by value: choose which 2.6 million URLs matter (shallow, many in-links, recent `lastmod`), and collapse parameter variants, since most of the 300 million are probably facets and sort orders. A queue for this host held fully in memory is about 30 GB, so back queues must be small windows over the table. Its rows would put one shard at about 135 GB, about 45% above the 94 GB average. That is storage skew, not load skew, and it is acceptable. Faster crawling needs the owner's agreement (a smaller `Crawl-delay`) or an adaptive delay on a fast host. Senior: names the IP cap for a site behind a shared address, and treats most of the 300 million as a trap.
2. **Node failure:** "At 3 am a crawler node dies. It owned 16 of the 256 partitions, about 6% of the hosts. It had about 25 fetches in flight and held its heaps and back queues in memory. What happens?" Expect: the etcd lease expires in under a minute, and the other nodes take the 16 partitions. The state that matters sits in the URL and host tables, so the new owners rebuild their heaps from it, and nothing discovered is lost. The 15 remaining nodes can do 750 fetches a second against a need of 400, so the crawl keeps its rate. The in-flight URLs and the open archive (up to about 10,000 pages that exist nowhere else) are still `leased`. Their 30-minute leases expire and the URLs return to `queued`, so they are fetched again. That is a duplicate or late fetch, and it is acceptable. Politeness: the new owners do not know when each host was last hit, so they wait one full delay before the first fetch to each host. A failover must never break the 1-a-second rule. The old owner must also never overlap with the new one: a node that cannot renew its lease stops fetching before the lease runs out. Senior: runs the same drill for a rolling deploy, with a graceful drain (seal the archive, release the partitions). Notes that robots rules and IPs live in the host table, so they survive. The general rule: let the worker crash, and rebuild its partition from durable state ("let it crash" in OTP terms).
3. **News in 5 minutes (change in requirements):** "Product now wants new articles from 20,000 news sites in the index within 5 minutes of publication. What changes?" Expect: do the math first. Polling a front page plus two section pages per site every 5 minutes is 60,000 URLs over 300 seconds, which is 200 fetches a second, half the crawler. One feed or news sitemap per site is 20,000 over 300 seconds, about 67 a second, 17% of the budget. The articles are cheap: 20,000 sites at about 30 articles a day is about 7 fetches a second. So the cost is polling, not fetching. Use feeds and sitemaps, conditional `GET`, and push pings where a site offers them. Poll every 5 minutes only while a site is publishing, and back off to hourly at night, learned per site. Give new article URLs top priority, and give this lane its own fetch capacity so the bulk crawl cannot starve it. Politeness is safe, because one request every 5 minutes is far below one a second. The archive roll breaks the target: a 10-minute roll plus upload cannot meet 5 minutes, so the fast lane rolls small archives every 30 seconds, or sends the event with the body inline. Senior: sees that the lane takes about 170 million fetches a month from the refresh tiers, so the split changes, and watches publish-to-indexed lag as the measure.

## Level bar

SDE-2 (hire) must show:
- Requirements that pin down scale, freshness, politeness and robots.txt, what is fetched (HTML only, no JavaScript) and what happens to duplicates.
- The math without being asked: about 400 fetches a second, about 40 MB a second, about 20,000 links a second (10,000 to 20,000 is fine), and 25 TB a month compressed (100 TB raw). That math ends in "which means bandwidth is not the limit, politeness is".
- One URL traced end to end through frontier, fetcher, parser, dedup and storage, with raw pages in object storage, not a database.
- Per-host queues with a next allowed time, not a FIFO and not a `sleep`, and hosts split across nodes so one node enforces each host's delay.
- robots.txt cached, `Crawl-delay` honoured, and a stated rule for when robots.txt fails.
- URL normalisation before the seen check, a sized seen set (Bloom filter or exact), and the trade-off named.
- Exact duplicates found by a body checksum, with the near-duplicate idea (simhash) named when asked.
- A refresh schedule that follows how pages change, not a fixed cycle, and two trap types with limits when probed.
- When asked where it breaks first, a real limit with its number (politeness per host, frontier size on disk, or the seen-check rate) and one fix.

Senior signal:
- Raises the 400-ready-hosts arithmetic and the 2.6 million per-host monthly cap without a prompt, and gives big hosts a budget by value.
- Keeps back queues small and refilled by priority, so important URLs do not wait behind one host's backlog.
- Limits requests per IP address and hosts per registered domain, for shared hosting and wildcard subdomains.
- Explains the Bloom filter's silent loss, its false positives growing as it fills, and that it holds no recrawl state.
- Sees that content dedup is a cross-host lookup with its own partition key.
- Packs pages into archive files and counts the requests saved. Marks a URL fetched only after its archive is durable.
- Splits the refresh tiers with the budget math and conditional `GET`, and does not chase pages that change faster than it can visit.
- Checks robots.txt at hand-out, refreshes it lazily, and gets the `404` versus `5xx` rule right.
- Plans a takeover: leases, a durable frontier and a politeness cool-down after failover.

## Traps

- A Kafka topic or a plain queue as the frontier. It cannot hold one message back while serving another, so it cannot enforce a per-host delay or a priority.
- `sleep(1)` in the worker, or one global rate limit. The rule is per host, not global.
- Hashing the URL, not the host, to pick a node. One host spreads over every node, and no node can enforce its delay.
- "A Bloom filter solves dedup", with no word on false positives, growth or recrawl state.
- An MD5 of the whole page as near-duplicate detection.
- "A depth limit of 5 stops traps."
- Refetching everything every N days.
- Treating a `5xx` on robots.txt as "no rules", or a `404` as "everything blocked". Or checking robots.txt only when the link is found.
- Storing pages in a relational table or in Kafka messages, or as one object per page.
- The OS resolver on every fetch, with no cache.
- "More fetchers on that host to go faster."
- A thousand fetchers and a dozen microservices for 400 fetches a second.
- "Exactly-once crawling." At-least-once with a lease is right, because a duplicate fetch costs one request.
