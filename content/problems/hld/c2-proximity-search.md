---
id: c2-proximity-search
track: hld
title: Proximity Service (Nearby Places)
difficulty: easy
tags: [geospatial, geohash, quadtree, read-heavy, replication, caching]
tracker:
  section: "### C2. Classic HLD Problems"
  bullet: "Proximity Service (Yelp / nearby places)"
notesFile: notes/c2-proximity-search.md
sources:
  - title: "Hello Interview: Proximity search deep dive"
    url: "https://www.hellointerview.com/learn/system-design/deep-dives/proximity-search"
  - title: "Uber Engineering: H3, a hexagonal hierarchical geospatial indexing system"
    url: "https://www.uber.com/blog/h3/"
confidence: "The index options, the geohash boundary problem and the cell sizes agree across the sources read. The scale numbers are this problem's own assumptions, not measurements of a real product. A full public breakdown of a place-review product was behind a paywall and was not used."
---

## Opening prompt

Let's design a service that finds places near a user, such as restaurants or petrol stations within a few kilometres. Where would you like to start?

## Hidden facts

Reveal a fact only when the candidate asks about it, or asks a question whose honest answer needs it. Never volunteer the list.

- **Users:** a mobile app and a website. The client sends its own latitude and longitude with each search. Sign-in is not needed to search.
- **Core features:** search for places within a radius of a point, with an optional category filter (for example "cafe"). Results come sorted by distance, 20 at a time, with a "next page" option. Open one place to see its details (name, address, hours, phone, photos).
- **Radius:** the user picks 0.5, 1, 2, 5, 10 or 25 km. The default is 1 km.
- **Places:** 100 million places worldwide. A place almost never moves.
- **Owners:** business owners add, edit or close their own place. About 1 million adds, edits and closures a day in total.
- **Freshness:** a new or edited place may take up to 1 hour to show in search. A closed place must stop showing within 1 hour.
- **Search volume:** 100 million daily users, about 5 searches each a day. The busiest hours carry about 3 times the daily average.
- **Density:** the busiest square kilometre in a big city holds about 5,000 places. A rural search of 25 km may find fewer than 5.
- **Latency:** a search answers in under 200 ms at p99 on our side.
- **Availability:** search targets 99.9%. Owner edits can be 99.5%.
- **Sizes:** a place's full record is about 1 KB. Its location, category and id fit in about 40 bytes.
- **Numbers:** one search server answers about 5,000 nearby searches a second from memory. Postgres is available, and so is Redis.
- **Regions:** users are global. One home region holds the source of truth; read copies in other regions are fine.
- **Out of scope:** reviews and ratings, ranking by personal taste, text search by name, map tiles, routing and travel time, ads.

For the interviewer: on the numbers, give them only when the candidate asks how fast one server is.

## Expected requirements

Core, functional:
1. Search places within a radius of a point, with an optional category, nearest first. *Ask: What does a user search by, and how are results ordered?*
2. View the details of one place. *Ask: What happens when a user taps a result?*
3. Owners add, edit and close places. *Ask: Who changes the place data, and how often?*

Core, non-functional:
1. 100 million places; about 6,000 searches a second, about 18,000 at peak. *Ask: How many places and how many searches?*
2. A search answers in under 200 ms at p99. *Ask: How fast must a search feel?*
3. A changed or closed place shows correctly in search within 1 hour. *Ask: How fresh must the results be after an owner edits a place?*
4. Search stays up at 99.9%; eventual consistency is fine. *Ask: Which matters more, fresh data or search being up?*

Extras (credit when they name one, never a gap):
- Read-heavy: about 500 searches for each place change.
- Paging through results 20 at a time.
- Very dense and very sparse areas behave differently.
- Global users with read copies near them.

## Capacity math

- **Search rate:** 100 million users x 5 searches is 500 million a day, about 6,000 a second on average (500,000,000 / 86,400 = 5,787) and about 18,000 at peak, which means the read path decides the design.
- **Write rate:** 1 million changes a day is about 12 a second, which means one Postgres primary carries all writes with room to spare. Read to write is about 500 to 1.
- **Index size:** 100 million places x 40 bytes is about 4 GB, which means the whole geo index fits in the memory of one server. Sharding is not needed for size.
- **Search servers:** 18,000 a second / 5,000 per server is about 4 servers at full load. At a 50% target load that is 8, spread over zones, which means each server holds a full copy of the index and more copies add throughput. Replication, not sharding.
- **Full records:** 100 million x 1 KB is about 100 GB, which means place details live in Postgres (or a key-value store) with read replicas and a cache, separate from the small geo index.
- **Cell size:** a geohash of 6 characters is a cell of about 1.2 km x 0.6 km, and 5 characters about 4.9 km x 4.9 km. For a 1 km radius, a 3 x 3 block of 5-character cells covers about 216 km² against a circle of about 3.1 km², while covering the circle's 2 km x 2 km bounding box with 6-character cells (about 0.74 km² each) takes 8 to 15 cells (6 to 11 km²), which means the cell size must follow the radius.
- **Dense areas:** in the busiest part of a city, 11 km² at up to 5,000 places per km² is up to about 55,000 candidates for one search, which means a category filter inside the index and a radius that shrinks or a search that stops early at 20 results.
- **Startup:** loading a 4 GB index snapshot at about 500 MB/s takes about 8 seconds, which means a restarted server can rebuild its copy quickly from a snapshot instead of from the database.

## API and entities

External API:
- `GET /places/search` with `lat`, `lng`, `radiusKm` (default 1), optional `category` and `pageToken` returns `200 { places: [{ placeId, name, lat, lng, distanceM, category }], nextPageToken? }`. `400` for a bad coordinate or radius.
- `GET /places/{placeId}` returns `200 { placeId, name, address, lat, lng, category, hours, phone, photos }`, `404` when unknown or closed.
- `POST /places` (owner) returns `201 { placeId }`. `PATCH /places/{placeId}` and `DELETE /places/{placeId}` (owner) return `200` and `204`.

Core entities:
- `Place { placeId (primary key), name, address, lat, lng, category, hours, phone, ownerId, status, updatedAt }` in Postgres, the source of truth.
- `GeoEntry { cellId, category, placeId, lat, lng }` in the in-memory index on each search server, keyed by cell.
- `IndexSnapshot { version, createdAt, location }` in object storage, so a new search server can start from a file.

## Reference design

```
 search:  Client ──> LB ──> Search service (stateless) ──> any search server (full in-memory index copy, 8 of them)
                              │                                 1. cells that cover the circle at the right precision
                              │                                 2. read those cells (filtered by category)
                              │                                 3. exact distance, drop those outside, sort, take 20
                              └──> Place service ──> Redis cache ──> Postgres replicas (details for the 20 ids)

 writes:  Owner ──> Place service ──> Postgres primary ──> change stream (outbox or change data capture)
                                                               └──> index updater ──> every search server
 nightly: job dumps all active places ──> new IndexSnapshot in object storage
```

Walk one search: the client sends its position, radius 1 km and category "cafe". The search service picks the cell precision for 1 km and lists the 6-character cells that cover the circle's bounding box, 8 to 15 of them. A search server reads the cafe entries of those cells from memory, computes the exact distance to each, drops the ones outside 1 km, sorts by distance and returns the first 20 ids with a page token. The service fetches names and addresses for those 20 ids from Redis, falling back to a Postgres replica, and answers.

Walk one owner edit: the owner changes the address and position of a cafe. The place service writes the row to the Postgres primary and an outbox row in the same transaction. The index updater reads the change within seconds and sends "move place 42 from cell A to cell B" to every search server, which removes and inserts the entry. The cache entry for the place is deleted. A server that missed the message catches up from the change stream, and the nightly snapshot resets any drift.

## Accepted alternatives

- **Geo index.** Judge the reason, not the name.
  - Geohash cells in a sorted map or ordinary index, querying the covering cells (reference). Simple and works on any key-value store.
  - A quadtree that splits a cell once it holds more than about 100 places. It adapts to density and suits an in-memory index for places that rarely move. Pointer-heavy and less friendly on disk.
  - Hierarchical cells such as S2 or H3 on an integer index. Fine; H3 hexagons give one distance from a cell to each neighbour.
  - PostGIS with a spatial index, or a search engine with geo queries, if the candidate shows it meets 18,000 searches a second with replicas.
  - A plain B-tree on latitude and longitude with a bounding box: only for tiny data. It returns a strip of the map, not nearby places.
- **Where the index lives.** In-memory on each search server (reference), Redis GEO commands, or the database's own spatial index. All fine if the full copy versus sharded choice follows the 4 GB size.
- **Keeping the index fresh.** A change stream to every server (reference), a rebuild every hour from the database, or both. An hourly rebuild alone meets the 1-hour rule.
- **Paging.** A page token that holds the last distance and id, or caching the sorted candidate list for a minute. Offset paging that recomputes everything is weak but works at this size.
- **Caching search results.** Caching by rounded position (a small cell), radius and category is fine for popular spots. Caching place details is the bigger win.

## Deep dives

### Indexing location for nearby search
- **Bad:** `WHERE lat BETWEEN .. AND lng BETWEEN ..` on two plain indexes, or computing the distance to every place. A B-tree sorts on one value, so the database scans a long strip of the map.
- **Good:** turn a position into a cell id (geohash, quadtree node, S2 or H3 cell). Look up the cell and its 8 neighbours, because a place 10 metres away can sit across a cell edge with a different prefix. Then compute the exact distance and drop anything outside the radius.
- **Great:** picks the cell size from the radius, and says why a 3 x 3 block of cells only covers a radius as large as one cell. Says the index only produces candidates and the exact distance makes the answer. Knows the edge cases: cells near the poles shrink in width, and the line where longitude jumps from 180 to -180 needs care.

### Dense and sparse areas
- **Bad:** one fixed cell size for every search. Downtown returns up to 55,000 candidates, the countryside returns nothing.
- **Good:** stop once 20 results are found by searching nearest cells first, and grow the search ring by ring in sparse areas up to the user's radius. Filter by category inside the index, not after.
- **Great:** a quadtree that splits by count, or per-cell counts that choose the precision, so the work per search stays about the same everywhere. Sizes the worst case (5,000 places per km²) against the 200 ms budget. Pages with a token that remembers the last distance.

### Keeping the index fresh and the servers healthy
- **Bad:** search servers query Postgres for every search, or the index is rebuilt by hand.
- **Good:** Postgres is the source of truth. Changes flow to the search servers through a change stream, and a nightly snapshot resets drift. A closed place leaves the index within the hour.
- **Great:** the outbox or change data capture so no change is lost between the database and the stream. Updates are idempotent (set place 42 to cell B, not "move by"), so replays are harmless. New servers start from the snapshot plus the stream from the snapshot's position. Read copies in other regions use the same stream.

## Curveballs

Use one, at the extension point, unless the candidate already handled it.
1. **Moving drivers:** "Product wants to show nearby delivery drivers on the same map. 1 million drivers are online at peak, and each sends its position every 5 seconds. A driver is offline after 30 seconds without an update. What changes?" Expect: 200,000 position updates a second (1,000,000 / 5), against 12 place changes a second today. The static index with a nightly snapshot is the wrong tool. A separate store keyed by cell, updated in place with a short expiry (Redis GEO per city, or cell sets with a 30-second expiry), so a silent driver drops out by itself. Updates go to the shard that owns the city, not to every server. Strong: says a moving point only needs a cell change when it crosses a cell edge, and keeps place search and driver search apart.
   Fits: Indexing location for nearby search; Keeping the index fresh and the servers healthy
2. **Holiday night peak:** "On New Year's Eve, searches in three city centres jump to 10 times normal for two hours. Overall traffic doubles. What breaks first, and what do you do?" Expect: overall 36,000 a second needs about 8 servers at full load, so the 8 already running are at the edge; add copies (the index is only 4 GB, so a new server starts in seconds from the snapshot). The hot centres are dense, so each search does more work: stop at 20 results, keep the category filter in the index, and cache results by small cell and category for a minute. Place details come from the cache, not Postgres.
   Fits: Dense and sparse areas; Keeping the index fresh and the servers healthy
3. **Search inside the map view:** "Product wants a 'search this area' button: the user drags the map, and we return places inside the visible rectangle, up to 50, best known first, even when the rectangle covers a whole country. What changes?" Expect: a rectangle query maps to a set of cells at a precision chosen from the rectangle's size, never thousands of tiny cells. A country-sized view cannot list every place, so precompute a small set of top places per large cell, or sample. The radius search stays as it is. Strong: a hierarchy of cells (quadtree levels, S2 or H3 resolutions) answers both kinds of query from one structure.
   Fits: Indexing location for nearby search; Dense and sparse areas

## Level bar

Hire bar must show:
- Requirements that cover radius, category, sort order, the search rate, the latency target and how fresh results must be.
- The math that the index is about 4 GB, ending in "which means a full copy per server, scaled by replicas, not shards".
- A geo index with a reason, and why a plain latitude and longitude index fails.
- The neighbour cells and an exact distance check after the index lookup.
- One search walked through every box, and one owner edit reaching the index.
- When probed, a fix for dense areas that is not "add servers".

Stretch signal:
- Matches the cell size to the radius, with the coverage numbers.
- Adapts to density (a count-based quadtree or a ring-by-ring search) without a prompt.
- Uses the outbox or change data capture so no edit is lost on the way to the index.
- Separates the static place index from a fast-moving index when moving objects come up.
- Raises the edge of the map (the 180-degree line, the poles) on their own.

## Traps

- "Shard the index by region" before doing the math: 4 GB fits in one server's memory.
- A B-tree on latitude and longitude, or computing the distance to every place.
- Looking up only the user's own cell, so nearby places across an edge go missing.
- Calling the cell lookup the answer, with no exact distance check.
- One cell size for every radius and every density.
- Updating the search index synchronously inside the owner's request, or reading Postgres on every search.
- Treating drivers and restaurants as the same index without noticing the 200,000 updates a second.
