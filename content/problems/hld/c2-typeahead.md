---
id: c2-typeahead
track: hld
title: Typeahead / Autocomplete
difficulty: medium
tags: [read-heavy, trie, precompute, batch-pipeline, caching, cdn]
tracker:
  section: "### C2. Classic HLD Problems"
  bullet: "Typeahead / Autocomplete"
notesFile: notes/c2-typeahead.md
sources:
  - title: "Engineering at Meta: The life of a typeahead query"
    url: "https://engineering.fb.com/2010/05/17/web/the-life-of-a-typeahead-query/"
  - title: "Elasticsearch reference: Suggesters"
    url: "https://www.elastic.co/guide/en/elasticsearch/reference/current/search-suggesters.html"
confidence: "The core design (precomputed top suggestions per prefix, served from memory, rebuilt offline from the query log, cached at the client and the edge) is the common answer, and the 100 ms stutter limit comes from a production write-up of entity typeahead. No first-party write-up of a query-completion service with measured numbers was found, so the scale numbers are this problem's own assumptions."
---

## Opening prompt

Let's design the suggestions that appear under a search box while the user types, like the completions a large search engine shows. Where would you like to start?

## Hidden facts

Reveal a fact only when the candidate asks about it, or asks a question whose honest answer needs it. Never volunteer the list.

- **What it does:** as the user types, show up to 10 completions of what they typed so far, best first. Picking one runs that search. Matching is on the start of the query only: "new y" matches "new york weather", not "weather in new york".
- **Ranking:** by how often people searched the full query over the last 30 days, with recent days counting more. The same list for everyone. No personal history.
- **Language:** one language for now. Input is lower-cased letters, digits, spaces and a few symbols.
- **Volume:** 1 billion searches a day. A typed search averages 20 characters. The evening peak is about 2 times the daily average.
- **Request pattern:** today the client sends a request on every keystroke. About 15% of suggestion requests are for prefixes of 1 to 3 characters. Requests are very uneven: the 1 million most-requested prefixes get about half of all requests.
- **Query log:** every search already lands in a log in object storage, about 50 bytes a line: the query text, a time and a coarse region.
- **Which queries can be suggested:** only queries that at least 20 different users searched in the last 30 days. That leaves about 50 million distinct queries, with about 400 million distinct prefixes between them.
- **Latency:** once the client asks, suggestions must show within 100 ms at p99. Beyond that the list stutters and users stop reading it. Our servers get at most 20 ms of that.
- **Freshness:** a daily update of popularity is fine for now.
- **Bad suggestions:** a reported offensive or harmful suggestion must disappear everywhere within 1 hour. A list of banned terms already exists.
- **Availability:** 99.9%. If suggestions fail, the search box still works, with no list.
- **Regions:** users are global. We run in 3 regions.
- **Numbers:** a serving server has 128 GB of memory and answers about 20,000 lookups a second. A link between regions moves about 1 GB a second.
- **Out of scope:** spelling correction, personalised suggestions, the search results page, ads, other languages.

For the interviewer: on the numbers, give them only when the candidate asks what one server can do.

For the interviewer: on trending queries, the daily update is the requirement; a faster path is a curveball.

## Expected requirements

Core, functional:
1. Return the top 10 completions for a typed prefix, ranked by popularity. *Ask: What should the list show, and in what order?*
2. Popularity comes from real searches over the last 30 days. *Ask: Where does "popular" come from, and over what time?*
3. A reported bad suggestion is removed everywhere within 1 hour. *Ask: What if a suggestion is offensive?*

Core, non-functional:
1. 1 billion searches a day, 20 characters each; about 460,000 requests a second at peak. *Ask: How many people type, and how often do we get a request?*
2. Suggestions show within 100 ms of the request at p99. *Ask: How fast must the list appear?*
3. Daily popularity updates are fine. *Ask: How quickly must a new popular query show up?*
4. 99.9% available; a failure hides the list but never breaks search. *Ask: What happens to the search box if suggestions fail?*

Extras (credit when they name one, never a gap):
- Only queries searched by at least 20 different users, for privacy.
- Three regions, each serving its own users.
- A small set of popular prefixes gets half the traffic.

## Capacity math

The share of requests a pause in typing removes, the bytes per index entry, the answer size and the 50% target load per server below are assumptions. Accept other reasonable values when the candidate gives a reason.

- **Requests:** 1 billion searches x 20 keystrokes is 20 billion requests a day, about 230,000 a second on average and about 460,000 at peak. Waiting for a short pause in typing (about 100 ms) before sending is assumed to remove about half of them, leaving about 115,000 a second on average and about 230,000 at peak, which means the client sends fewer requests before any server work starts. The pause comes before the request, so it does not count against the 100 ms.
- **Edge caching:** with about 37 symbols (26 letters, 10 digits and a space) there are 37 + 37² + 37³ = about 52,000 prefixes of 1 to 3 characters, about 15% of requests. The 1 million most-requested prefixes get about half of all requests, and their answers (under 1 KB each) total under 1 GB, which means they fit in any CDN. About half of the requests (about 115,000 a second at peak) can be served from the browser or a CDN, with a TTL of an hour for short prefixes and minutes for longer popular ones.
- **Index size:** 400 million prefixes x (10 query ids of 4 bytes, the prefix key and overhead, about 100 bytes) is about 40 GB, plus 50 million query strings at about 20 bytes (1 GB), which means the whole index fits in one 128 GB server. Each server holds a full copy; shards are not needed for size.
- **Servers:** about 115,000 requests a second at peak reach our servers after the edge, split over 3 regions. At 20,000 a second per server that is 6 servers in total at full load, and 12 at 50% load (4 per region), which means replicas give the throughput and a lost server costs little.
- **Lookup cost:** with the top 10 stored at each prefix, an answer is one hash or trie lookup. Walking a whole subtree at request time for "s" would touch millions of queries, which means the ranking must happen before the request, not during it.
- **Build input:** 1 billion lines x 50 bytes is 50 GB a day, and 30 days is 30 billion lines (1.5 TB), which means a daily batch job (counting, filtering, top 10 per prefix) is a normal-sized data job, not a streaming problem.
- **Shipping:** a 41 GB index at 1 GB a second takes about 41 seconds per region, which means a daily rollout is easy, and loading a new version beside the old one and switching atomically needs about twice the memory, which 128 GB allows.

## API and entities

External API:
- `GET /suggest` with `q` (the typed prefix) and `limit` (default 10) returns `200 { prefix, suggestions: ["new york weather", "new york times", ...], version }` with `Cache-Control: max-age=3600` for short prefixes and a shorter age for longer ones. An empty list is a normal answer.
- `POST /suggest/blocks` (staff) with `{ query or term }` returns `202`; the block applies everywhere within minutes.

Core entities:
- `QueryStat { query, windowCounts, distinctUsers, score }` built daily from the log.
- `PrefixEntry { prefix, topQueryIds[10] }` in the in-memory index (a trie or a hash map of prefixes).
- `IndexVersion { version, createdAt, location, checks }` in object storage.
- `Block { term or query, createdAt }`, a small table pushed to every server.

## Reference design

```
 serving:  Client (wait ~100 ms after a keystroke, keep recent answers)
             ──> CDN (caches popular prefixes: TTL 1 hour for 1 to 3 characters, minutes for longer ones)
             ──> LB ──> Suggest server (full in-memory index, 4 per region)
                          1. look up the prefix: 10 query ids
                          2. drop anything that matches the block list
                          3. answer with the strings and the index version

 building: query log (object storage) ──> daily batch job: count per query over 30 days, decay old days,
                                          keep queries with 20+ distinct users, remove blocked ones,
                                          compute the top 10 for every prefix ──> IndexVersion files
           ──> checks (size, sample prefixes, diff with yesterday) ──> each region pulls, loads beside
               the live copy, switches atomically, keeps the last 3 versions for rollback

 blocks:   staff tool ──> Block table ──> pushed to every server within minutes (applied at read time)
```

Walk one keystroke: the user has typed "new y". The client waited 100 ms with no new key, has no cached answer for "new y", and calls `/suggest?q=new y`. "new y" is a popular prefix, but its few-minute CDN copy has just expired, so the load balancer sends it to a suggest server in the nearest region. The server finds the entry for "new y" in memory, reads its 10 query ids, drops any that match the block list, turns the ids into strings and answers in about a millisecond. The client shows the list and keeps it, so a backspace to "new " is free if it asked for that before.

Walk one daily build: at 02:00 the batch job reads the last 30 days of logs, counts each query and its distinct users, gives yesterday more weight than last month, drops queries under 20 users and anything on the block list, and for each of the 400 million prefixes keeps the 10 best queries. It writes the index files with a new version number. A check job compares sizes and sample answers against yesterday's index. Each region downloads the files, loads them beside the live copy, switches when the load is complete, and keeps the old version for a quick rollback.

## Accepted alternatives

- **Index structure.** All fine with a reason:
  - A trie where every node stores its top 10 (reference), or a plain hash map from every prefix to its top 10. The map is simpler and uses more memory for the prefix keys.
  - A search engine's completion suggester, which keeps a compact in-memory structure and a weight per suggestion. Fine if the candidate checks the memory and the query rate.
  - Prefix keys in Redis or a key-value store. Fine, but it adds a network hop, so the 20 ms budget and the extra servers need stating.
- **Full copy or shards.** A full copy per server (reference, the index is about 41 GB). Sharding by prefix is fine when the index outgrows memory, but splitting on the first letter is uneven ("s" is far bigger than "x"), so split by ranges with similar load.
- **How often to rebuild.** Daily (reference). Hourly batches, or a streaming count with a small overlay for trending queries, if the candidate explains the cost.
- **Ranking.** Raw counts over 30 days, counts with a decay so recent days weigh more (reference), or a model with more signals. All fine; the ranking runs offline.
- **Fewer requests.** Waiting for a pause in typing, caching answers in the client, filtering the previous list on the client while the next answer comes, and CDN caching. Any mix is fine, with a number.

## Deep dives

### Precomputing the top suggestions per prefix
- **Bad:** `SELECT query FROM queries WHERE query LIKE 'new y%' ORDER BY count DESC LIMIT 10` on every keystroke. Or a plain trie that walks the whole subtree under "s" for each request.
- **Good:** compute the top 10 for every prefix ahead of time and store them at the prefix, so a request is one lookup. Keep the whole index in memory.
- **Great:** sizes the index (about 41 GB) and decides on a full copy per server from that. Stores query ids, not strings, at each prefix. Limits the prefix length or stops storing entries once only one query is left below a prefix. Says the trade: memory and an offline job in exchange for a constant-time read.

### Building and shipping the index
- **Bad:** updating counts in the serving index on every search, so 12,000 searches a second become locked writes on the read path.
- **Good:** a daily batch job reads the log, counts queries, applies the 20-user rule and the block list, builds the top 10 per prefix and ships versioned files.
- **Great:** immutable versions loaded beside the live copy and switched atomically. Checks before rollout (size, sample prefixes, a diff with yesterday) and the last few versions kept for rollback. A decay on old counts. Knows the build can lag a day, and names what would need a faster path.

### Cutting the request load
- **Bad:** one request per keystroke straight to the origin, with no caching anywhere.
- **Good:** wait for a short pause in typing, cache answers in the client, and cache popular prefixes at the CDN. Gives the numbers: about 460,000 a second at peak falls to about 115,000 at the origin.
- **Great:** sets cache times by prefix length (short prefixes for an hour, long ones briefly), puts the index version in the answer so a cache refresh is clean, and lets the client filter its last list locally while it waits. Notes that a block must also clear the CDN copies, not just the servers.

### Removing a bad suggestion fast
- **Bad:** wait for the next daily build.
- **Good:** a block list on every server, applied at read time, pushed within minutes. The next build also drops the query.
- **Great:** blocks by term, so variants are caught too, and over-fetches a few spare suggestions per prefix (for example 15 stored, 10 shown) so a removal does not leave a short list. Purges the CDN for the affected prefixes. Meets the 1-hour rule with time to spare.

## Curveballs

Use one, at the extension point, unless the candidate already handled it.
1. **Breaking news:** "A major event happens. A new query goes from nothing to 5 million searches in 30 minutes. With the daily build it shows up tomorrow. Product wants it in the suggestions within 10 minutes. What changes?" Expect: a streaming path next to the batch path. Count queries in short windows (for example 5 minutes) from the live log stream, find the ones rising fast, and publish a small trending overlay (thousands of queries, not millions) to every server every few minutes. The overlay holds an entry for each prefix of each trending query (about 20 per query, so tens of thousands of entries), and the server merges it with the daily top 10 for that prefix at read time. Apply the 20-user rule and the block list on this path too, or abuse gets fast-tracked. The CDN TTL for short prefixes must drop, or the edge serves old lists for an hour. Strong: caps how much the overlay can push out, and lets it expire when interest fades.
   Fits: Precomputing the top suggestions per prefix; Building and shipping the index; Cutting the request load
2. **Bad build:** "This morning's build had a bug. For every prefix that starts with 's' the list is empty. Users noticed within 15 minutes. What would you have needed, and what do you do now?" Expect: now, roll back to yesterday's version, which is still on disk beside the live copy, so the fix takes seconds per region. Before: checks before rollout (index size against yesterday, list counts per first letter, a set of known prefixes that must answer), a canary region or a few servers first, and an alert on the share of empty answers. The CDN keeps bad lists until their TTL ends, so purge it.
   Fits: Building and shipping the index
3. **TV moment:** "A TV show asks 20 million viewers to search the same phrase in the same minute. What happens to suggestions?" Expect: about 333,000 extra searches a second, and about 3.3 million suggestion requests a second at 10 requests per search. They all share the same few prefixes, so the client and CDN caches take almost all of it; request coalescing at the edge sends one origin request per prefix while it waits. The origin sees few misses. Strong: says the danger is a cold or purged CDN at that moment, and keeps the short-prefix TTL long during the event.
   Fits: Cutting the request load
4. **Brigading:** "5,000 new accounts each search an insulting phrase about a public figure 200 times over two days. By this morning it is in the top 10 for every prefix of that person's name. It is reported at 09:00. What happens, and what stops it coming back tomorrow?" Expect: 5,000 distinct users pass the 20-user rule, so that rule alone does not stop it. Now: a block entry for the phrase reaches every server within minutes and is applied at read time; the CDN still holds the lists for the affected prefixes (a dozen or two, one per prefix of the name) for up to an hour, so purge them; with a few spare suggestions stored per prefix the list stays full. Tomorrow: the build reads the block list and drops the query. Blocking by term also catches spelling variants. Strong: weighs distinct users by account age or trust, so 1 million searches from a burst of new accounts count for little, and alerts on a query that climbs that fast.
   Fits: Removing a bad suggestion fast

## Level bar

Hire bar must show:
- Requirements with numbers for the request rate per keystroke, the 100 ms target and how fresh popularity must be.
- The request math (about 460,000 a second at peak) and what it forces: fewer requests from the client and caching before any server work, with one keystroke traced through every layer that can answer it.
- Top suggestions precomputed per prefix and held in memory, built from the query log away from the read path and swapped in as versions, never ranked at request time.
- When probed, a removal path for a bad suggestion that does not wait for the daily build.

Stretch signal:
- Sizes the index and picks a full copy per server over shards from the number.
- Sets cache times by prefix length and counts how much load the edge removes.
- Checks a build before rollout and keeps old versions for rollback.
- Adds a trending overlay without touching the daily path.
- Explains the 20-user rule as a privacy guard (a rare query can expose one person's search) and applies it on every path, including a fast one.

## Traps

- A database `LIKE 'prefix%'` query or a subtree walk on every keystroke.
- Updating counts in the serving index on every search.
- "Shard by first letter" without noticing how uneven letters are. A common textbook first step, so partial credit, not a red flag: full credit once they split by load or see that 41 GB needs no shards.
- A request on every keystroke straight to the origin, with no client or edge cache.
- Personalising every list at request time when the requirement is one global list.
- Waiting for tomorrow's build to remove an offensive suggestion.
- Calling Kafka and stream processing a must for a daily popularity update.
