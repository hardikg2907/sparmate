---
id: c2-distributed-cache
track: hld
title: Distributed Cache (design a Redis)
difficulty: medium
tags: [in-memory, consistent-hashing, replication, failover, eviction, hot-keys]
tracker:
  section: "### C2. Classic HLD Problems"
  bullet: "Distributed Cache (design a Redis)"
notesFile: notes/c2-distributed-cache.md
sources:
  - title: "Scaling Memcache at Facebook (NSDI 2013)"
    url: "https://www.usenix.org/system/files/conference/nsdi13/nsdi13-final170_update.pdf"
  - title: "Redis cluster specification"
    url: "https://redis.io/docs/latest/operate/oss_and_stack/reference/cluster-spec/"
  - title: "Redis: Key eviction"
    url: "https://redis.io/docs/latest/develop/reference/eviction/"
  - title: "Redis: EXPIRE"
    url: "https://redis.io/docs/latest/commands/expire/"
confidence: "The Redis documentation backs up the mechanisms here: 16,384 hash slots with MOVED and ASK redirects, failover decided by a majority of primaries, sampled approximate LRU, and lazy plus active expiry with the primary sending deletes to replicas. A large operator's paper backs up leases against stale sets and thundering herds, and shows a different failure answer (a small spare pool and mostly no replicas) that suits a database with more headroom than this problem has. The expiry-cycle details (about 20 keys a round, repeat above about a quarter expired) match older Redis documentation; the current pages give no numbers. Hardware, traffic and database-headroom numbers are this problem's own assumptions."
---

## Opening prompt

Let's design a distributed in-memory cache, something like Redis, that all of our backend services can share. Where would you like to start?

## Hidden facts

Reveal a fact only when the candidate asks about it, or asks a question whose honest answer needs it. Never volunteer the list.

- **Who uses it:** about 2,000 instances of backend services, written in four languages. They use cache-aside: on a miss they read their own database and write the value back with a TTL. The cache never loads data by itself. When a service changes a database row, it deletes the cached key or sets the new value.
- **Client libraries:** we can ship one client library per language. Any logic inside the client must be written four times. A proxy tier is allowed, but it is new infrastructure to run.
- **When the cache fails:** a service retries once after refreshing its map. If that fails, it returns an error or a degraded answer for that call. It reads the database only after a clean miss, never after a cache error, because the databases could not take the extra load.
- **Operations:** `GET`, `SET` with an optional TTL, and `DELETE`. Values are opaque bytes, and a `SET` replaces the whole value. No lists, counters, transactions or pub/sub.
- **Batch reads:** a batch get of up to 50 keys is nice to have. Keys in one batch often share a user id.
- **Sizes:** keys average 50 bytes, at most 250 bytes. Values average 1 KB, at most 1 MB. Reject anything larger.
- **Live data:** about 1 billion keys today. It doubles within a year.
- **Traffic:** 1 million operations per second at peak, about half that on average. About 90% are reads. Traffic grows more slowly than data: about 50% in the next year.
- **Skew:** about 20% of keys take 80% of reads. During events, one key can spike far above the rest.
- **TTL:** about 70% of keys have a TTL, from 1 minute to 24 hours. Second precision is enough. An expired key must never be returned, even if its memory is freed later. A default TTL of 24 hours can be enforced on keys sent without one.
- **Memory full:** evict something. Never reject a write and never crash. Any key may be evicted, with or without a TTL.
- **Latency:** p99 under 2 milliseconds at the client for a 1 KB value, for reads and writes alike. A network round trip takes about 0.1 ms inside a zone and about 0.5 ms across zones.
- **Hardware:** cache machines have 64 GB of RAM, 8 cores and a 10 Gbps network card. One core serves about 100,000 simple GET or SET operations per second.
- **Durability:** it is a cache. Every value can be rebuilt from a database. Losing some recent writes in a crash is fine. No disk persistence is required.
- **Hit ratio:** about 95% today. At peak that is about 45,000 database reads per second. The databases are sized for about a third more, so a ceiling near 60,000. A sudden large drop in hit ratio takes them down.
- **Consistency:** by default, a `GET` after a `SET` returns the new value, from any client. A caller may opt in, per call, to reads up to 2 seconds stale; a product page is one such caller. Losing the last second or so of writes during a failover is acceptable.
- **Availability:** 99.99%. When a node dies, its keys may fail for up to 10 seconds. One node or one zone failing must never take the whole cluster down.
- **Deploys:** every node restarts about once a week for a deploy or OS patch, one node at a time.
- **Regions:** one region with three availability zones. A second region is out of scope.
- **Tenancy:** many services share one cluster, each with its own key prefix. Per-service quotas are out of scope. There is no key listing, scan or delete by prefix. A service that wants a clean slate switches to a new prefix and lets the old keys expire or be evicted.
- **Security and operations:** the cluster sits on a private network. Each service authenticates with its own token, and TLS is on.

For the interviewer: on the TTL, give the default TTL of 24 hours only if asked.

For the interviewer: on security and operations, a one-line mention of each is enough: authentication, TLS, metrics and dashboards.

For the interviewer: on tenancy, a mention of per-service quotas is enough.

For the interviewer: on batch reads, placing the keys of one batch together is allowed, not required.

## Expected requirements

Core, functional:
1. Get a key (a value or a miss), set a key with an optional TTL, and delete a key. *Ask: What operations must the cache offer?*
2. An expired key is never returned. *Ask: What must a read do with a key whose time is up?*
3. When memory is full, evict keys by an LRU-like policy instead of failing writes. *Ask: What happens to a write when memory is full?*

Core, non-functional:
1. About 1 billion keys of about 1 KB, doubling within a year, and 1 million operations a second, 90% reads. *Ask: How many keys, how big is a value, how many operations a second?*
2. p99 under 2 ms at the client. *Ask: How fast must a read be?*
3. 99.99% availability. A dead node costs at most 10 seconds of errors on its own keys. *Ask: How much downtime is fine, and what may a dead node cost?*
4. No durability: the database is the source of truth. *Ask: Is the cache the only copy of the data?*
5. Read-after-write by default; up to 2 seconds of staleness only if the caller opts in. *Ask: Must a read always see the latest write?*

Extras (credit when they name one, never a gap):
- Nodes are added online without a hit-ratio drop the databases would feel.
- Losing a whole shard's data at once is still not acceptable, because of the database load.

## Capacity math

The per-entry overhead, the 48 GB memory cap, the connections per client and the copy speeds below are assumptions. Accept other reasonable values when the candidate gives a reason.

- **Memory and shards:** each entry costs about 1.2 KB: the 1 KB value, the 50-byte key and about 150 bytes for the hash-table entry, expiry time, access clock and allocator rounding. 1 billion entries is about 1.2 TB. Capped at 48 GB of data per 64 GB machine (the rest is for the operating system, replication buffers and fragmentation), that is 25 primary shards, and 50 machines with one replica each. A candidate who picks another cap or adds headroom lands on 20 to 30 shards, which is fine; the later numbers scale with the shard count. The data doubles within a year to about 50 primaries, which means the data must be partitioned and adding nodes is routine work, not a rare event.
- **Load per shard:** 1 million operations per second over 25 primaries is 40,000 per primary at peak, against about 100,000 per core. Each shard holds about 40 million keys at random, so even the popular keys spread out and every shard gets close to 4% of reads, which means memory, not CPU, sets the shard count, and only one very hot key can overload a shard.
- **Network:** 40,000 operations per second at about 1 KB is about 40 MB per second per node, about 3% of the 10 Gbps card, which means the network card is no limit for normal keys. It only matters for a hot key with a large value.
- **Connections:** 2,000 app instances with 2 connections to each of 25 primaries is 4,000 connections per node and 100,000 in total, which means each node needs an event loop that handles thousands of mostly idle connections, not a thread per connection. A proxy tier would cut each node's count to a few dozen.
- **Replication:** writes are 100,000 per second, so 4,000 per shard, about 4 MB per second to each replica, which means async replication is cheap. Its cost is the lag window: a failover loses the writes in flight, usually milliseconds' worth and at most about a second, or about 4,000 writes. Building a new replica copies up to 48 GB, about 3 minutes at a throttled 250 MB per second, so a shard runs without a spare for a few minutes after a failover.
- **A shard that comes back empty:** 900,000 reads per second with 5% misses means the databases see 45,000 reads per second and top out near 60,000. One shard serves 4% of reads, or 36,000 per second. If it restarts empty, about 34,000 more reads per second miss, and the databases see about 79,000, which means a dead or restarting primary must hand over to a warm replica. Replicas protect the databases, not the data.
- **Rebalancing:** with `hash(key) mod N`, going from 25 to 26 nodes keeps only one key in 26 in place, so about 96% of keys move and the hit ratio collapses. With consistent hashing, only the new node's share moves: 1.2 TB divided by 26 is about 46 GB, or about 8 minutes at a throttled 100 MB per second, which means placement must be consistent hashing or hash slots, and data moves in small throttled pieces in the background.
- **Per-node bookkeeping:** each primary holds about 40 million keys, and about 28 million have a TTL, which means expiry cannot use a timer per key or a full scan, so it works by sampling. Exact LRU needs two pointers per key, about 640 MB per node, plus a list update on every read, which means eviction should sample too.

## API and entities

External API:
Data API, sent by the client library over persistent TCP connections with a compact binary protocol and pipelining. HTTP and JSON on every call would cost more than the lookup itself.
- `GET key` returns the value or `nil`. A caller that asks for a lease gets `nil` plus a lease token on a miss.
- `SET key value [ttlSeconds] [leaseToken]` returns `OK`. It replaces the value and replaces or clears any old TTL. A value over 1 MB returns an error. A `SET` whose lease a `DELETE` voided is dropped.
- `DELETE key` returns 1 if the key existed, else 0.
- `MGET key1 ... keyN` (optional) returns the values in order. The client splits it by shard and sends the parts in parallel.
- Redirect replies name the right node: `MOVED node` when ownership changed for good (update the map), and a one-time redirect for a key that has already moved during a migration (do not update the map).

Control plane:
- Cluster map: `{ epoch, vnode -> shard, shard -> { primary, replica } }`, owned by the cluster manager. Clients fetch it at start, on a `MOVED` reply, and every few seconds.
- Replication stream: primary to replica as `(offset, write)` records. A replica that reconnects asks to resume from its last offset.

Core entities:
- `Entry { key, value, expiresAt? (absolute time in ms), lastAccess (a small clock) }`
- `Shard { id, vnodes[], primary, replica, replicationOffset }`
- `Node { id, address, zone, role, memoryUsed }`
- `ClusterMap { epoch, vnode -> shard, shard -> nodes }`

## Reference design

```
 app instance (2,000 of them)
   service code ──> cache client library
                      hash(key) onto the ring ──> vnode ──> shard ──> primary address
                      holds the cluster map and its epoch; pooled, pipelined TCP
                      local cache for opted-in hot keys (1 s TTL)
                         │ GET / SET / DELETE
                         ▼
 shard 1:  primary (zone A) ──async──> replica (zone B)
 shard 2:  primary (zone B) ──async──> replica (zone C)
 ...       25 shards, about 150 vnodes each on the ring
 shard 25: primary (zone C) ──async──> replica (zone A)
                         ▲
                         │ health checks from all three zones; promotions; new map + epoch
 cluster manager (3 instances, one per zone, leader elected through etcd)
   owns the map, detects failures, runs failover and rebalancing

 inside one node (one event loop per shard):
   hash table    key ──> { value, expiresAt, lastAccess }, grown by incremental rehash
   TTL index     keys that have a TTL, sampled by the expiry cycle
   memory cap    48 GB; a write that needs memory first evicts by sampled LRU
   repl buffer   every write streamed to the replica, plus a backlog for quick resume
```

Walk one GET: the client hashes `user:42:profile` onto the ring. The first virtual node clockwise belongs to shard 7, so the client sends `GET` to shard 7's primary on a pooled connection. The node finds the entry. If `expiresAt` has passed, it deletes the entry, tells the replica to delete it, and answers a miss. Otherwise it stamps `lastAccess` and returns the value. On a miss the service reads its database and calls `SET` with a TTL. That fill can arrive after a writer's `DELETE` and put back the old row. The optional lease closes the race: the miss returns a token, the `SET` carries it, and a `DELETE` in between voids it, so the late fill is dropped. If the node replies `MOVED`, the client refreshes its map and retries once.

Walk one SET: the client routes the same way. If memory is above 48 GB, the primary evicts sampled-LRU entries until the write fits. It stores the entry with `expiresAt` set to now plus the TTL, appends the write to the replication buffer, and answers `OK` without waiting for the replica. Each evicted key goes into the same buffer as a delete, so the replica never evicts on its own. The replica applies it a few milliseconds later.

Walk one crash: shard 7's primary dies. Checkers in two of the three zones agree it is down after 5 seconds. The manager promotes the replica, bumps the epoch and publishes the map. Clients get errors from the dead address, refresh the map and reconnect. Shard 7's keys, 4% of the total, see about 5 to 10 seconds of errors, and the cache stays warm. The manager then builds a new replica in another zone, which takes about 3 minutes.

## Accepted alternatives

- **Placement.** Any of these is fine if adding a node moves only its fair share and load stays even:
  - A consistent hash ring with virtual nodes.
  - A fixed table of hash slots (for example 16,384), each owned by one shard. Rebalancing moves whole slots.
  - Rendezvous (highest random weight) hashing.
- **Routing.** A smart client that connects straight to the owner, a proxy tier, a proxy sidecar on each app host, or "ask any node and follow its redirect". Judge the trade-off against the facts: four languages, 2,000 instances and a 2 ms p99.
- **Who owns the map and failover.** A cluster manager on etcd or ZooKeeper, or the nodes themselves gossiping and voting by a majority of primaries. Both are fine if the candidate explains the majority and how the old primary is fenced.
- **Node internals.** A single-threaded event loop per shard, with several shard processes per machine to use the 8 cores, or a multi-threaded node with lock striping.
- **Eviction policy.** Sampled LRU, LFU with decay, CLOCK or segmented LRU. Exact LRU with a linked list is fine on a single-threaded node if the candidate counts the cost: about 640 MB of pointers per node and a list update on every read.
- **Rebalancing.** Copy the data with a redirect during the move, or hand over a few slots at a time without copying and let the new owner fill from misses. The second is valid for a cache only if the pace keeps extra database reads inside the headroom of about 15,000 per second.
- **Reads from replicas.** Fine as an opt-in for callers that accept up to 2 seconds of staleness, and as relief for a hot key.
- **Snapshots for a warm restart.** None, or periodic snapshots so a restart comes back warm. Not required.
- **Two replicas per shard.** Fine with the cost stated (50% more machines) and the reason (a spare during the minutes of a rebuild).
- **Leaderless quorum replication.** Three copies, write to two, read from two. Fine if the candidate shows the memory cost (three copies instead of two, 50% more machines), that two plus two over three copies keeps read-after-write, and that the extra cross-zone round trip still fits the 2 ms p99. It removes the failover pause.
- **Client behaviour on a cache error.** Fail the call, or fall back to the database with a rate cap and a circuit breaker. An unbounded fallback breaks the headroom of about 15,000 reads per second.

## Deep dives

### Partitioning and routing
- **Bad:** one huge machine, which cannot hold 1.2 TB and is a single point of failure. Or `hash(key) mod N`. Or a lookup service called on every request, which adds a hop and a new bottleneck.
- **Good:** consistent hashing or hash slots. The client library holds the map and sends each request straight to the owner, and refreshes the map when a node says the key is not its own.
- **Great:** explains virtual nodes with numbers. With one point per shard on the ring, the biggest shard can own three to four times its fair share. With about 150 virtual nodes per shard, a typical shard lands within about 10% of its share, and a leaving node's load spreads over all the others instead of one neighbour. Weighs smart client against proxy using the facts. A smart client is one hop, but it must be written in four languages and it puts 4,000 connections on every node. A proxy works with any language and pools connections, but it adds a hop of 0.1 to 0.5 ms and a tier that must scale and fail over. Versions the map with an epoch, so a stale client is corrected by a redirect. For batch gets, splits by shard and sends in parallel, or places one user's keys together with a shared hash tag such as `{user42}`.

### Rebalancing when nodes join or leave
- **Bad:** `hash(key) mod N`, so one new node moves about 96% of keys and the databases fall over. Or "stop the cluster, reshuffle, start again".
- **Good:** consistent hashing moves only about one key in 26 to a new node. The data copies in the background, and the candidate accepts a small, short dip in hit ratio.
- **Great:** moves one slot or one vnode range at a time. While a range moves, the source serves the keys it still holds and sends a one-time redirect for keys already copied, so no key goes missing. When the range is done, the manager bumps the epoch and clients switch. The copy is throttled (100 MB per second, about 8 minutes for the 46 GB a new node takes) and pulls from many sources in parallel. Adds capacity when evictions start to pull the hit ratio below 95%, not after the databases feel it. A node that leaves on purpose hands off its ranges first.

### Replication, failover and node crash
- **Bad:** no replicas because "it is only a cache", so a crash empties a shard and database reads jump to about 79,000 per second against a ceiling of 60,000. Or a replica that promotes itself when it stops hearing the primary, which gives two primaries on a network partition. Or synchronous replication, which adds a cross-zone round trip to every write and blocks writes when a replica is slow.
- **Good:** one async replica per shard, in a different zone. Health checks detect a dead primary, the replica is promoted automatically, and clients pick up the new map. States that writes still in flight can be lost.
- **Great:** a failure needs agreement from checkers in at least two zones, so one checker's network fault cannot trigger a failover. Fences the old primary with a lease or an epoch: it stops serving reads and writes when its lease lapses (say 3 seconds), before the manager promotes (5 seconds), so a stale primary cannot break read-after-write, and it steps down when it sees the higher epoch. Notices that a lost `DELETE` brings a stale value back after failover, and keeps TTLs on everything as the safety net, or waits for the replica to confirm deletes. Runs a manual failover before each planned restart, so the weekly deploy never empties a shard. Resumes short disconnects from the backlog and rebuilds a lost replica with a throttled full copy.

### Memory limits, eviction and expiry
- **Bad:** reject writes when memory is full. Or a timer per key (28 million per node), or a full scan of 40 million keys every second. Or a memory limit equal to the 64 GB of RAM, which ends in swapping or the out-of-memory killer.
- **Good:** a memory cap well below RAM, and least-recently-used eviction when a write would cross it. Every read checks `expiresAt` and returns a miss for an expired key. A background job removes expired keys that nobody reads.
- **Great:** sampled LRU. Each entry stores a small access clock. To evict, the node samples 5 to 10 random keys and evicts the oldest, keeping a small pool of good candidates between rounds. The result is close to true LRU, with no pointer pair per key and no list update on reads. Mentions LFU with decay, so one batch job that reads every key once cannot flush the hot set. Expiry is lazy plus sampled: a few times a second, sample about 20 keys from the TTL index, delete the expired ones, and repeat while more than about a quarter were expired, up to a CPU budget. The primary decides expiry and sends the deletes to the replica, and a replica still checks `expiresAt` on reads. Stores `expiresAt` as an absolute time, and asks callers to add jitter to TTLs so a batch written together does not expire together. Sees the stale-set race under cache-aside: a reader misses, reads the old row, and its `SET` lands after the writer's `DELETE`, so the stale value lives until its TTL and breaks read-after-write. Fixes it with leases: a miss returns a lease token, a `SET` must carry a valid token, and a `DELETE` voids it, so a late fill is dropped. The node hands out one lease per key every few seconds, and other callers that miss wait briefly and retry, so a hot miss reaches the database once. One large operator saw its peak database load on such keys fall more than tenfold. A versioned `SET` (only a newer version wins) is fine too.

## Curveballs

Use one, at the extension point, unless the candidate already handled it.
1. **Hot key:** "A flash sale starts. One key, a 20 KB product page, now gets 500,000 reads per second for 30 minutes." The page may be up to 2 seconds stale. "What breaks first?" Expect: 500,000 reads of 20 KB is 10 GB per second against a card that moves about 1.25 GB per second, so one node is 8 times over on the network, and a primary plus replica is still 4 times over. The single core that serves the key is also 5 times over its 100,000 operations per second. More shards do not help, because one key lives on one shard. Detect hot keys with top-key counters in the client or on the node. Then either turn on a local cache in each app instance with a 1-second TTL, which cuts the shard to at most 2,000 fetches per second (about 40 MB per second), or keep about 20 copies under suffixed keys on different shards, read one at random, and write all of them on update. A strong answer also covers the moment the key expires: refresh it ahead of time, or let one caller rebuild it while the others serve the stale copy.
   Fits: Partitioning and routing
2. **Zone outage:** "Zone A goes dark at peak. It held a third of the cache nodes." User traffic moves to the other zones. "Walk me through the next ten minutes." Expect: cache load stays the same, because user traffic moves to the other zones. Each primary's replica sits in another zone, so about a third of the primaries (8 or 9) fail over to warm replicas in 5 to 10 seconds, and nothing goes cold. Failure detection still works, because two of three zones and two of three manager instances are a majority. Afterwards about two-thirds of the shards have no replica: the promoted ones, and the ones whose replica lived in zone A. Each rebuild takes about 3 minutes, and the surviving zones need spare machines for it. If the candidate placed a primary and its replica in the same zone, a third of the keys go cold: about 285,000 extra database reads per second against a ceiling of 60,000, which is a full outage. A strong answer adds that a zone-A node cut off but still alive must stop serving once its lease lapses.
   Fits: Replication, failover and node crash
3. **Durable sessions:** "A team wants to keep login sessions in the cache as the only copy: 50 million sessions of 2 KB, written 5,000 times a second. A lost session logs the user out. What changes?" Expect: the sessions take about 100 GB, so 3 shards with replicas. A separate cluster, because this data must not share an eviction policy with cache data. Eviction is off for it: full memory rejects writes and alerts, so size it with headroom. Add an append-only log of writes, synced to disk once a second (10 MB per second is easy for an SSD), plus periodic snapshots so a restart does not replay days of log. Either accept up to a second of loss or make writes wait for the replica's acknowledgement, and say that async failover still loses acknowledged writes. Stretch: asks whether a cache is the right home at all, and proposes Postgres or a durable key-value store as the source of truth with the cache in front.
   Fits: Replication, failover and node crash; Memory limits, eviction and expiry
4. **Early growth:** "A new service starts writing as many keys as all the others together, months before the planned growth. Every node is at its memory cap, evictions are climbing, and the hit ratio has fallen from 95% to 94% in a week. What do you do?" Expect: 6% misses on 900,000 reads a second is 54,000 database reads against a ceiling near 60,000, and below about 93.3% the databases are past it, so this is urgent. Twice the keys is about 2.4 TB, so about 50 primaries at 48 GB. Add primaries with replicas a few at a time. Each new node takes only its share of keys from the others, under 48 GB, about 8 minutes at a throttled 100 MB a second; one node at a time takes about 3 hours for 25 nodes, and a few at once, each pulling from different sources, cut that to about an hour. Copy with a redirect while a range moves. Handing over ranges with no copy is now unsafe, because the databases have only about 6,000 reads a second of headroom left. Strong: sees that one service's keys push out other services' hot keys under one shared LRU, so per-prefix memory limits or a separate cluster now matter, and alerts on eviction rate and the hit-ratio trend so capacity arrives before the databases feel it.
   Fits: Rebalancing when nodes join or leave; Memory limits, eviction and expiry

## Level bar

Hire bar must show:
- Requirements that pin down the operations, value size, the TTL rule (an expired key is never returned), behaviour when memory is full, the latency target, and that the database stays the source of truth.
- The memory math (keys times entry size, over the memory one machine can use), ending in a shard count of about 20 to 30 and a memory cap below the machine's RAM. The load math shows CPU per shard is well under one core's limit.
- A placement scheme that moves only a small share of keys when a node joins, with the reason `hash mod N` fails (nearly every key moves).
- A routing choice, client or proxy, with one trade-off stated.
- A primary and an async replica per shard with automatic failover, and an honest line on what async replication loses.
- Eviction with an LRU-like policy under a memory cap, and expiry that checks on read plus a background cleanup.
- One deep dive done properly when the interviewer picks it.
- When probed, names the hot key and gives at least one fix above the shard, such as a local cache or copies on several shards.

Stretch signal:
- Links replicas to the databases without a prompt, with "an empty shard adds about 75% to database reads, past their ceiling", so failover lands on a warm replica and planned restarts fail over first.
- Majority-based failure detection, a lease or epoch that fences the old primary, and each replica in a different zone from its primary.
- Sampled LRU and lazy-plus-sampled expiry with a CPU budget, with the reason: no per-key timers and no list update on every read.
- Online migration with a redirect while a range moves, throttled so client latency holds.
- Spots that a lost `DELETE` on failover brings back a stale value, and uses TTLs as the safety net.
- Raises the stale-set race under cache-aside and fixes it with leases or a versioned `SET`.
- Sizes the memory cap (about 75% of RAM) and says why: the operating system, replication buffers and fragmentation.
- Raises hot-key detection and a bounded-staleness local cache before the curveball.

## Traps

- `hash(key) mod N` for placement. One new node moves about 96% of keys.
- "Add shards" to fix a hot key. One key always lives on one shard.
- "It is only a cache, so no replicas." One empty shard adds about 75% to database reads, past their ceiling. Some large operators run caches mostly without replicas and send a dead node's keys to a small pool of spare nodes with short TTLs. That pool starts cold, so here it does not stop the spike (about 34,000 extra reads against about 15,000 of headroom). Partial credit only when the candidate checks that number and adds replicas or a warm-up.
- A `SET` after a miss that can land after a writer's `DELETE`, with no lease or version, so a stale value lives until its TTL.
- A replica that promotes itself when it loses the primary. A network partition then gives two primaries.
- Raft or synchronous replication on every write. It adds a cross-zone round trip to every write, blocks writes when a replica is slow, and buys nothing for data the database can rebuild. Consensus belongs to the cluster map and failover decisions.
- Reading the database after every cache error. A failed shard then sends its whole load to databases that are sized for 15,000 extra reads per second.
- A timer per key, or a full scan every second, for expiry.
- A memory limit equal to the machine's RAM.
- Reading from async replicas by default, which breaks read-after-write.
- A REST and JSON API on the hot path, which costs more than the lookup it wraps.
- Restarting a node for a deploy and letting it refill from the database.
