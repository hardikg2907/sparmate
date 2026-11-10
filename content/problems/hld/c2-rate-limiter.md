---
id: c2-rate-limiter
track: hld
title: Rate Limiter
difficulty: medium
tags: [rate-limiting, token-bucket, redis, atomicity, fail-open, hot-key]
tracker:
  section: "### C2. Classic HLD Problems"
  bullet: "Rate Limiter"
notesFile: notes/c2-rate-limiter.md
---

## Opening prompt

Let's design a rate limiter for a public API. Where would you like to start?

## Hidden facts

Reveal a fact only when the candidate asks about it, or asks a question whose honest answer needs it. Never volunteer the list.

- **Today:** a public REST API over HTTPS, in one region. A load balancer sends traffic to 40 stateless API servers. Nothing limits requests yet. Auth already maps a key or token to an account and a plan from a local cache, outside the check's budget. Postgres exists. Redis exists as one primary with a replica, used for caching. We may add Redis nodes or a new Redis Cluster for the limiter, and a gateway tier.
- **Who is limited:** developers use an API key. Our own apps use a user token and get the free limits. The limit is per key or user id, not per account. The client IP is used only for `POST /login` and `POST /signup`, where no key or token exists yet. No client is exempt. A request with a missing or bad key gets `401` from auth and is not counted here. Every allowed request counts, whatever the API answers.
- **Client IP:** the load balancer appends the real address as the last `X-Forwarded-For` value. Earlier values can be forged. People behind a shared address (an office, a mobile carrier) share the login limit. The product accepts that.
- **Why we limit:** capacity, so one client cannot starve the rest, and security, so login resists password guessing. The first tolerates small errors. The second does not.
- **Plan limits:** all limits are per minute. Free 100, pro 1,000. Enterprise is per contract: usually 10,000 to 100,000 a minute, and 3 million a minute (50,000 a second) for the largest. Most clients are free, about one in ten is pro, a few hundred are enterprise.
- **Endpoint limits:** login and signup: 5 a minute per IP, one count shared by both, about 1% of requests (1,000 a second at peak). Search and export are costly and use their own limit instead of the plan limit: one tenth of it (free 10, pro 100 a minute). Every request matches exactly one rule.
- **How exact:** over any 60 seconds, about 10% over the limit is fine and twice the limit is not. Bursts are fine, but no saving up an hour of quota. Wrongly blocking a paying client is worse than letting a little extra through.
- **Scale:** 100,000 requests a second at peak, 20,000 on average. About 10 million distinct clients a day, 1 million in a peak minute. Most send a few requests a minute.
- **Traffic skew:** a handful of enterprise clients are large. The largest reaches 50,000 requests a second at peak, about half of all traffic. The next largest is under 2,000 a second. The rest spread evenly.
- **Latency:** the check may add under 5 milliseconds at p99. The API's own median latency is about 50 milliseconds.
- **If the limiter is unhealthy:** its outage must not become an outage of the API, so normal calls keep working. Login must still be limited in some form.
- **Blocked requests:** `429` with `Retry-After`. A blocked request uses no quota and never reaches an API server. Every response should show the limit, what is left and when it resets. "Resets" means when the client is back to a full allowance.
- **Rule changes:** staff change plans, limits and per-client overrides in an admin tool. A change applies everywhere within a minute. There are about 10 rules and a few hundred overrides.
- **State:** counts need no durability. Losing a few seconds of them is fine.
- **Numbers, if asked:** a Redis node does about 100,000 simple commands a second. A script that reads and writes one key costs about two of them. One gateway node takes about 20,000 requests a second. A Postgres node takes 5,000 to 10,000 simple writes a second. A datacenter round trip is about half a millisecond, and 1 to 2 milliseconds at p99.
- **Out of scope:** multi-region (do not volunteer it), network-level attack protection, monthly quotas and billing, limits shared across keys, weighted request costs, a login limit per username, the admin UI.

## Expected requirements

Core, functional:
1. Identify the caller: API key, user id from a token, or client IP for login and signup. *Ask: Who or what do we count requests against?*
2. Apply one rule: free 100, pro 1,000 a minute, enterprise custom; login 5 a minute per IP. *Ask: Do all callers and endpoints share one limit?*
3. Answer blocked requests with `429` and `Retry-After`, before an API server does work. *Ask: What does a blocked caller see?*

Core, non-functional:
1. 100,000 checks a second at peak, 1 million active clients a minute. *Ask: How many checks a second, and how many different clients?*
2. The check adds under 5 ms at p99. *Ask: How much delay may the check add to a request?*
3. One shared count on every server; at most about 10% over in any minute, never 2x. *Ask: How exact must a limit be, and must every server agree?*
4. A limiter failure never takes the API down. Login stays limited. *Ask: What happens to requests if the limiter itself fails?*
5. One huge client (50,000 a second) cannot slow anyone else. *Ask: What if one client sends a huge amount of traffic?*

Extras (credit when they name one, never a gap):
- Search and export get a tenth of the plan's limit.
- A blocked request uses no quota. Every response shows limit, remaining and reset.
- Change rules at run time, with no deploy, within a minute.

## Capacity math

- **Shared count:** every request needs one check: 100,000 a second at peak. If each of 40 API servers counted alone, a pro client could send 40 x 1,100 = 44,000 a minute against a limit of 1,000, which means the count must sit in one shared store.
- **Redis throughput:** a node does about 100,000 simple commands a second, and a script that reads, computes and writes costs about two, so about 50,000 checks a second. At 50% target load, 100,000 / (50,000 x 0.5) = 4 shards (accept 3 to 6 when the formula and assumptions are stated; a candidate who counts a check as one command gets 2, so ask them to price the script), which means one node cannot carry the peak and the start is 4 primaries, each with a replica.
- **Memory:** a bucket is 100 to 200 bytes, and a TTL equal to the refill time (6 seconds) drops idle clients. So 1 million active clients is at most 100 to 200 MB, which means throughput forces the cluster, not memory.
- **Latency:** a round trip is about 0.5 ms median and 1 to 2 ms at p99. The timeout is 3 ms, just above p99 (accept 2 to 5 ms; hundreds of ms or seconds is wrong). One call fits the 5 ms budget, which means a chain of three or four does not, and a read then a write would also be a race.
- **Slow Redis:** at peak the fleet holds 100,000 x 0.05 s = 5,000 requests in flight. If every check waits 200 ms, that is 25,000. With a 3 ms timeout it is about 5,300, which means a slow Redis can exhaust worker pools and take the API down, and a short timeout caps the damage at 6%.
- **Burst:** a bucket of C tokens lets C plus one minute of refill through in the worst minute. Pro (1,000 a minute, 16.7 a second) with C = 100 gives 1,100, which is 10% over. Free with C = 10 gives 110. A refill from empty takes C / rate = 6 seconds, which means C = 10% of the per-minute limit meets the rule on every plan.
- **Sliding log:** one entry (about 64 bytes) per allowed request for 60 seconds. Login (60,000 attempts a minute) needs about 4 MB, so exact counting is cheap there. For plan limits, 1 million clients at the pro limit would need 64 GB, the real peak of 6 million requests a minute about 400 MB, and one client at 3 million a minute about 190 MB in one key, which means the cost follows the limit and each check runs several commands, so the log is wrong for plan limits.
- **Hot client:** 50,000 checks a second hit one key, so one shard. The other 50,000 spread over 4 shards is 12,500 each. Splitting the hot bucket over the 4 shards would put each at 25,000 (50%). Left on one shard, it sees 62,500 against about 50,000 (125%), and with 8 shards still 56,250 (over 110%), which means more shards cannot fix a hot key.

## API and entities

External API (the limiter adds no endpoints; it changes what every endpoint returns):
- Every response carries `RateLimit-Limit`, `RateLimit-Remaining` and `RateLimit-Reset` (the `X-RateLimit-` forms are fine). For a bucket, reset is the seconds until it is full again, at most 6.
- A blocked request gets `429 Too Many Requests`, `Retry-After` in whole seconds rounded up, and a body such as `{ "error": "rate_limited", "retryAfter": 1 }`. A token bucket's wait is the time until one token exists, at most 0.06 s on pro, so the header says `1`. The login log's wait is the time until the oldest attempt leaves the window.
- If login fails closed because the limiter is down, answer `503` with `Retry-After`, never `429`.

Internal API:
- Gateway to Redis, one script call: `check(key, rate, burst, now) -> { allowed, remaining, retryAfterMs }`. Gateways read rules from memory, never from Postgres on a request.

Core entities:
- `Rule { id, group (default, expensive, auth), plan, ratePerMinute, burst, algorithm, failMode }` in Postgres, copied into every gateway and reloaded about every 30 s.
- `ClientOverride { clientId, ratePerMinute, burst, bigClient }` in Postgres.
- `Bucket` in Redis: key `rl:<clientId>:<group>`, value `{ tokens, lastRefill }`, TTL = burst / rate. Login: a sorted set of attempt times at `rl:login:<ip>`, TTL 60 s. A flagged big client has 4 sub-buckets, with key names picked so each lands on a different shard (a plain hash does not promise that).

## Reference design

```
 rules:    Postgres (plans, limits, overrides) ── reload every 30 s ──> memory of every gateway

 request:  Client ──> Load balancer ──> Gateway (stateless, about 5) ── allowed ──> API servers (40)
                                          │ 1. identify: key or token -> account -> plan (auth cache)
                                          │              login and signup: client IP
                                          │ 2. pick the one matching rule from memory
                                          │ 3. one Lua call on one key, timeout 3 ms
                                          │ 4. blocked: answer 429 + Retry-After here, nothing goes on
                                          │ 5. timeout or breaker open: apply the rule's fail mode
                                          ▼
                                   Redis Cluster: 4 shards, each a primary and a replica
                                   key rl:<clientId>:<group>
```

Walk one allowed request: the load balancer sends `GET /v1/orders` to a gateway. It reads the API key, takes the plan from the auth cache (pro) and the rule from memory (1,000 a minute, burst 100), and makes one script call to the shard that owns `rl:<clientId>:default`. The script refills the bucket from the elapsed time, takes one token if there is one, and returns allowed, remaining and the wait. The gateway forwards the request and adds the `RateLimit-*` headers.

Walk one blocked request: the script takes nothing and returns blocked with the wait. The gateway answers `429` with `Retry-After: 1` at once, and no API server sees it.

Walk one big client: a client flagged `bigClient` in its override, such as the 50,000-a-second client, is the one exception. The gateway sends each check to one of 4 sub-buckets at random, one per shard, each with a quarter of the rate and burst. Every shard then carries 12,500 of its checks. All other clients keep the single key.

If the call passes 3 ms, the gateway applies the rule's fail mode. Capacity rules let the request through and count the failure. Login uses a local limit of 5 a minute per IP on each gateway, at most 5 x 5 = 25 a minute per IP. A breaker per shard skips a failing shard for a few seconds, then probes.

## Accepted alternatives

- **Algorithm.** Judge the reason, not the name.
  - Token bucket is the reference. A leaky bucket used as a meter, or one stored timestamp per client (GCRA), behaves the same.
  - Sliding window counter: fine when the near-2x worst case for a timed burst is stated and weighed against "never 2x". Calling it exact is wrong.
  - Sliding log for plan limits: a candidate who computes 400 MB instead of 64 GB is right. The better reasons against it are several commands per check and millions of entries in one key for a big client. It suits login.
  - Fixed window: only for coarse limits where a boundary burst is harmless, such as a daily quota.
- **Where the check runs.** A gateway tier (reference). Middleware in each API server after auth: no new tier, but a blocked request still holds a connection, and the login fallback grows to 40 x 5 = 200 a minute. A separate limiter service adds a hop of about 1 ms.
- **Shared store.** Redis Cluster (reference). Independent Redis primaries picked by hashing the client id. A limiter fleet that owns key ranges in memory, if restarts, resizing and the hot client are handled. A store with atomic increment but no scripts suits window counters only. Postgres is too slow.
- **Local counts with a periodic sync.** Each gateway counts in memory and merges into the shared store every 100 ms to 1 s. Fine if the candidate sizes the error (about the client's rate times the delay) against the 10% rule. It suits large clients best.
- **No shared state.** Each instance enforces limit / instances. A free client at 100 a minute reaches each of 40 servers about 2.5 times a minute, so uneven spread blocks it early. Fine as the fallback and for the largest clients only.
- **Failure policy.** Capacity limits let traffic through and login uses a local limit (reference). Local approximate limits for every rule is fine. Login blocked outright during an outage is acceptable if the cost is named. Login unlimited is wrong.

## Deep dives

### Choosing the algorithm and what it costs

```
 scheme                  state per client       worst minute for a limit of 100      fit
 fixed window            1 counter              200 (burst across the boundary)      breaks "never 2x"
 sliding log             1 entry per request    100 (exact)                          login only
 sliding window counter  2 counters             about 197 for a timed burst          only if 2x is accepted
 token bucket (C = 10)   2 numbers              110                                  plan limits
```

- **Bad:** a fixed window with no word on the boundary, or the boundary waved away when the rule is never 2x. Or the sliding log for everything "because it is exact".
- **Good:** a token bucket per client and rule. The worst minute is C plus one minute of refill, so C = 100 on pro gives 1,100, the 10% allowance. The state is two numbers, refilled lazily from the elapsed time.
- **Great:** picks per rule by what the limit protects: a bucket for capacity limits, where small error is fine, the sliding log for login, where exactness is cheap. Shows that C sets the overshoot. Sees that a bucket suits a 5-a-minute limit badly: C = 1 means one attempt per 12 seconds, and C = 5 allows 10 in a minute.

### One atomic call to the shared count

- **Bad:** each server counts in memory, so the limit multiplies. Or the gateway does `GET`, computes and `SET`s: two gateways both read 1 token, both allow and both write 0 (a lost update), at two round trips.
- **Good:** one shared store and a Lua script that refills, checks and takes a token as one command. Redis runs it without interleaving, so there is no race, and it is one round trip inside the 5 ms budget.
- **Great:** the script decides and takes a token only when it allows, so a blocked client that keeps hammering never drives the bucket negative. Computes `Retry-After` in the script. Uses one clock (Redis's, or the caller's with elapsed time never negative) because gateway clocks differ. Keeps one key per check, so a cluster script never spans slots. Says replicas add failover, not capacity, because every check is a write.

### Redis slow or down

- **Bad:** plans only for a Redis that refuses connections, with no timeout or a default of seconds, so a slow dependency is treated as if it were down. Or fails closed on everything (a Redis blip is a full outage), or open on everything (login guesses are unlimited). Or answers "slow Redis" with "add shards".
- **Good:** a tight timeout of about 3 ms, then a fail mode per rule: capacity limits let the request through, and login fails closed or uses a local in-memory limit. A circuit breaker skips Redis for a few seconds after repeated timeouts.
- **Great:** explains why slow is worse than down with the in-flight numbers (5,000 against 25,000). One breaker per shard, so 3 of 4 shards keep enforcing. No retry on timeout, because the budget has no room and a retry doubles the load in an incident.

### The hot client

- **Bad:** "add more shards" or "add replicas". One key lives on one shard, and replicas cannot take writes.
- **Good:** sizes it (one shard at 62,500 a second against about 50,000). Fixes it with sub-buckets on different shards, each with limit / N; or gateways leasing tokens in batches (500 a call is about 100 Redis calls a second instead of 50,000); or a local limit per gateway.
- **Great:** applies the fix only to flagged big clients and keeps the exact single-key path for the rest. States the rule: the bigger the client, the less a few percent of error matters (5 gateways x 500 tokens is 2,500 out of 3 million a minute, 0.08%). Names each cost: sub-buckets need key names picked by shard (a plain hash may put two on one shard) and block a client whose sub-bucket is empty while others have room, leases lose tokens when a gateway crashes, local limits suffer from uneven balancer spread.

## Curveballs

Use one, at the extension point, unless it was already handled. Prefer 2 or 3.
1. **Hot client (already seen in an earlier attempt; use it only if both of the others were handled):** "One enterprise client sends 50,000 requests a second for an hour. What breaks first?" Expect the Good and Great answers of the hot client deep dive.
2. **Shard failure:** "At peak, one Redis primary dies. Its replica takes over after about 20 seconds and is about 1 second behind. What do clients on that shard see, and what is different afterwards?" Expect: the blast radius first: 1 of 4 shards, a quarter of clients. Calls time out at 3 ms, a breaker stops the waiting, and the other 3 shards keep enforcing. Capacity limits let those clients through for about 20 seconds, and login uses the local limit. About 1 second of updates is lost: a pro client at its limit (17 a second) gets about 17 extra requests, under 2% of a minute. A shard that returns empty gives every bucket full: one extra burst of at most C (10%). So synchronous replication and persistence are not needed. Weak: retrying on timeout, failing closed, or "Redis Cluster handles it".
3. **Second region:** "We add a second region. Clients call either one, and a client's limit of 1,000 a minute must hold across both. The 5 ms budget stays. What changes?" Expect: the other region is tens of ms away (over 100 ms between continents), so a cross-region check on every request is out. Options: split rate and burst between regions and rebalance by usage in the background (two full limits allow 2 x 1,100 = 2,200, halving both gives 2 x (50 + 500) = 1,100); pin each client to a home region; or count locally and merge every 1 to 5 seconds, so the overshoot is about the client's rate times the delay (17 a second x 1 s, about 2%). Strong: a fixed 50/50 split wrongly blocks a client that calls one region, and a lost region's share must expire. Weak: calling the first region's Redis on every request.

## Level bar

Hire bar must show:
- Requirements that cover identity, limits per plan and endpoint, how exact (burst, about 10% over, never 2x), what a blocked client sees, the 5 ms budget and what happens when the limiter fails.
- The math of 100,000 checks a second against what one node does, with the script cost and some headroom stated, ending in "which means a cluster of a few shards" (about 4; 3 to 6 is fine).
- An algorithm chosen with a reason, including why a fixed window fails the 2x rule.
- One shared count, updated by one atomic call in one round trip.
- One request traced with both outcomes: `429` with `Retry-After`, and no API server involved.
- A timeout and a fail mode per rule when probed on Redis (capacity limits let traffic through, login never unlimited), and a breaker for slow.
- A hot-client fix that is not "more shards", once the traffic skew comes up or the interviewer asks where it breaks first.

Stretch signal:
- Says slow is worse than down unprompted, with in-flight numbers, and sizes the blast radius of a lost shard first.
- Picks the algorithm per rule by what it protects, and shows that C sets the overshoot.
- Fixes a hot key only for flagged clients, with the error as a number.
- Raises identity weaknesses unprompted: a forged `X-Forwarded-For`, shared office addresses, one account attacked from many IPs.
- Raises clock differences between gateways, or safe rule changes (validated limits, an alert on a jump in blocked share, a switch that lets everything through).
- Names the debt: about a second of counts lost on failover, up to 10% over.

## Traps

- "Use `INCR` with `EXPIRE`": a fixed window lets 2x through, and two separate calls can leave a counter with no expiry after a crash, which blocks that client for ever.
- `GET`, compute, `SET` from the gateway: a lost update and two round trips.
- Each server counts on its own, so the limit multiplies (40 x 1,100 = 44,000).
- "Add more shards" or "add replicas" for a hot client or for capacity. One key stays on one shard, and every check is a write.
- "Fail closed to be safe" everywhere, or fail open everywhere.
- The sliding log for every limit "because it is exact", or a sliding window counter called exact.
- Postgres for the counters, or counting through Kafka and enforcing later (fine for a monthly quota, too slow for a minute limit).
- Trusting `X-Forwarded-For` as sent, or limiting everyone by IP.
- Answering `429` when the limiter itself failed.
