---
id: c2-ride-sharing
track: hld
title: Ride-Sharing (Uber)
difficulty: hard
tags: [geospatial, geo-index, matching, concurrency, state-machine, write-heavy]
tracker:
  section: "### C2. Classic HLD Problems"
  bullet: "Ride-Sharing (Uber)"
notesFile: notes/c2-ride-sharing.md
---

## Opening prompt

Let's design a ride-sharing service, something like Uber. Where would you like to start?

## Hidden facts

Reveal a fact only when the candidate asks about it, or asks a question whose honest answer needs it. Never volunteer the list.

- **Scope:** riders and drivers, each with a phone app. One ride type, one rider per car, one pickup, one drop-off, each sent as a latitude and longitude. The system picks the driver: the free driver with the shortest pickup ETA. Sign-up, payments, fares, ratings, fraud and address search are out of scope.
- **Scale:** 15 million trips a day worldwide, from about 10 million riders. About 500 ride requests per second in the busiest hour, nearly 3 times the daily average. Treat every request as a trip.
- **Drivers:** about 1 million online in the busiest hour, about 500,000 on average. A driver is busy about 20 minutes per trip: 5 minutes to the pickup, 15 riding.
- **Location updates:** every online driver's app sends its position every 4 seconds, idle or on a trip. GPS error is 10 to 20 meters. A lost update does not matter, because the next one replaces it. A free driver silent for 15 seconds counts as offline. A driver who goes silent during a ride keeps that ride, and support handles it by hand.
- **Geography:** the product is global, in about 500 cities. Every trip stays inside one city and cities never interact. The biggest city has about 5% of all trips, and the top 20 cities together about 40%. Start with one region sized for the full load. More regions come later.
- **Offers:** the default is one offer at a time per ride, and 15 seconds to accept. If the candidate proposes offering to a few drivers at once, let them argue the trade-off. A driver sees at most one offer at a time, and none while on a trip. About half of all offers are accepted. The rest are declined or time out. A driver who passed on a ride is not offered it again.
- **Search:** look within 3 km of the pickup, then widen once to 6 km. After 2 minutes without an accept, the ride ends and the rider hears "no drivers nearby". In a busy area at the peak, about 200 free drivers are within 3 km of a pickup.
- **ETA:** from an external routing service. One call takes up to 10 origin and destination pairs, answers in about 100 ms (300 ms at p99), bills per pair and can fail. If it is down, straight-line distance at 25 km/h is an acceptable estimate.
- **Rider's view:** after the match, the map shows the driver's position every 4 seconds, and the pickup ETA refreshed every 30 seconds. A rider sees only their own driver. The driver app keeps a live connection while the driver is online. A rider's app may be in the background, so a push notification is fine for a status change.
- **Latency:** the first offer reaches a driver within 2 seconds at p99, counted from when our servers receive the request. The matcher may read a position up to 5 seconds old.
- **Consistency:** a driver never holds two rides. A ride never has two drivers. A rider has at most one active ride. Positions need none of this.
- **Durability and availability:** once the rider sees "requested", the ride survives any single server failure. Requesting and matching target 99.99%. Tracking and ETAs may lag first. Phones lose signal and retry requests.
- **Cancels:** the rider may cancel until the trip starts. The driver may cancel before pickup, and the ride returns to matching without that driver, with a fresh 2-minute window. After 5 minutes at the pickup, the driver may report a no-show. Nobody cancels a trip in progress.
- **Retention:** trip records live 2 years. The GPS trail of each trip, from accept to drop-off, lives 90 days, for disputes. Idle drivers' positions are not kept.
- **Out of scope:** surge pricing, shared rides and scheduled rides. Accept one sentence about surge and move on. Nearby cars on the rider's map is a stretch goal that reads the same data.

## Expected requirements

Core, functional:
1. A rider requests a ride from a pickup to a drop-off. One active ride per rider. *Ask: What does a rider do to get a ride?*
2. Offer the ride to nearby free drivers, one at a time; the first to accept gets it. *Ask: How is a driver chosen for a ride?*
3. A driver never holds two rides, and a ride never has two drivers. *Ask: What must always be true about drivers and rides?*
4. The rider sees the driver's live position and pickup ETA, then the live trip. *Ask: What does the rider see after a driver accepts?*

Core, non-functional:
1. 15 million trips a day, 500 requests a second at peak; 1 million drivers report every 4 s. *Ask: How many rides and drivers, and how often do drivers report?*
2. First offer within 2 seconds at p99. *Ask: How fast must the first offer go out?*
3. Strong consistency for assignment; eventual consistency, even loss, for positions. *Ask: Which data must be exact, and which may be stale or lost?*
4. A requested ride is never lost; 99.99% available for request and match. *Ask: What if the system fails after a rider requests a ride?*
5. The ETA is an external, paid dependency that can fail. *Ask: Where does the pickup ETA come from, and what if it is down?*

Extras (credit when they name one, never a gap):
- A trip moves through its states. Cancels, no-shows and "no drivers" end it early.

## Capacity math

Per-server and per-row figures below are assumptions. Accept other reasonable values when the candidate gives a reason.

- **Requests:** 15 million trips a day is about 175 per second on average and 500 at the peak. Each ride makes about 5 state writes (create, assign, arrive, start, end), so about 2,500 per second at peak (5,000 rows a second with the event log), which means one Postgres primary holds all trip state, and requests are not the hard part.
- **Location writes:** 1 million drivers, one update every 4 seconds, is 250,000 per second at peak (125,000 on average), or 25 MB per second at 100 bytes each. That is 500 times the request rate, which means location is the real load, so it never touches the primary database and lives in memory.
- **Busy and free drivers:** 500 requests per second times 1,200 seconds (20 minutes) is about 600,000 busy drivers at the peak, so 400,000 are free. Busy drivers send 150,000 updates per second to their riders and the trail, which means the geo index holds only the free drivers and takes 100,000 writes per second, not 250,000.
- **Index size and shards:** 400,000 entries at about 100 bytes is 40 MB. One Redis node handles roughly 100,000 simple commands per second, and each update takes 2 commands (the position and the last-seen time), so 100,000 writes need about 200,000 commands per second. About 10 shards by city leave each near 20,000. The biggest city (5% of trips) needs about 5,000 writes per second, which means the index is sharded for write rate and failure isolation, not for size.
- **Search cost:** a 3 km radius is about 28 km². An H3 resolution 8 cell is about 0.74 km², and so is a 6-character geohash (1.2 by 0.6 km). One search reads about 40 cells (up to 60 with the border) and finds about 200 drivers in a busy area, which means a search is a few dozen small lookups, never a city scan.
- **Offers:** 500 requests per second times about 2 offers per ride is about 1,000 offers per second. At 15 seconds each, at most 15,000 are open at once. A ride may need up to 8 offers in its 2 minutes (120 divided by 15), which means reservations and timers are tiny, and the matcher is a loop with a deadline.
- **ETA:** matching sends one call of 10 pairs per request: 500 calls and 5,000 pairs per second. Asking about all 200 free drivers would be 100,000 pairs, 20 times more. Refreshing every 30 seconds for the 150,000 riders still waiting for pickup (a quarter of 600,000, as 5 of 20 minutes) adds another 5,000 pairs per second (500 calls if batched by 10), which means the matcher shortlists by straight-line distance, refreshes are throttled, and every call has a timeout and a fallback.
- **Connections and tracking:** 1 million drivers plus 600,000 riders on a ride is 1.6 million connections, so 32 gateway servers at about 50,000 each, about 40 with spare. Tracking is 150,000 messages per second (15 MB per second), each from one driver to one rider, which means the gateway tier is small but stateful, needs a user-to-gateway registry, and sends tracking point to point, never through the database.
- **Trail:** a ride lasts 1,200 seconds, so 300 points at one per 4 seconds. At about 30 bytes each that is 9 KB per trip, 135 GB per day and about 12 TB for 90 days, which means trails stream through Kafka into object storage and never pass through Postgres.
- **Trip storage:** about 1 KB per trip is 15 GB per day, 5.5 TB per year and 11 TB for 2 years. Active rides are at most 600,000 rows, about 600 MB, which means active rides stay in a small hot table, and history is partitioned by time or city, or archived.

## API and entities

External API (HTTPS):
- `POST /rides` with an `Idempotency-Key` header and `{ pickup, dropoff }` returns `201 { rideId, status }`. The same key returns the same answer. `409` with the existing `rideId` when the rider already has an active ride. `400` for bad coordinates.
- `GET /rides/{rideId}` returns the status and the driver's details. It backs up the live channel.
- `POST /rides/{rideId}/cancel` (rider) returns `200`, or `409` once the trip is in progress or over.

Live connection (one WebSocket per phone):
- Driver to server: `online`, `offline`, `location { lat, lon, ts, rideId? }` every 4 seconds (`rideId` is set while the driver has a ride), `accept { offerId }`, `decline { offerId }`, `arrived`, `start`, `end`, `cancel { reason }` (the reason `no_show` is the 5-minute no-show and ends the ride; any other reason sends it back to matching).
- Server to driver: `offer { offerId, rideId, pickup, etaSeconds, expiresAt }`, and `gone` when an accept loses.
- Server to rider: `status { rideId, status }` and `driverLocation { lat, lon, etaSeconds }`.

- ETA service (external): `etaBatch([{ from, to }, ...])` takes up to 10 pairs and returns seconds for each.

Core entities:
- `Ride { rideId (primary key), riderId, requestKey, city, pickup, dropoff, status, driverId?, matchDeadline, timestamps }`. `requestKey` is the idempotency key, unique per rider. `matchDeadline` is the end of the current 2-minute window, and a driver cancel resets it. Two partial unique indexes: one active ride per rider (`riderId` while REQUESTED, ASSIGNED, ARRIVED or IN_PROGRESS) and one per driver (`driverId` while ASSIGNED, ARRIVED or IN_PROGRESS).
- `RideEvent { rideId, seq, from, to, actor, at }`: an append-only log written with every transition. It feeds the `trip.completed` event.
- Redis, all soft state: `free:{city}` (the geo index of free drivers), `seen:{city}` (last update time per driver), `offer:{driverId}` (the open offer, with a 20-second TTL; after an accept it is re-set as the driver's busy marker, with a 2-hour TTL), `tried:{rideId}` (drivers already offered the ride; losing it risks one repeat offer and nothing worse), `lease:{rideId}` (a live matcher), `conn:{userId}` (the user's gateway).

## Reference design

Two kinds of state. Positions are soft state in Redis: losing them costs 4 seconds. Assignments are hard state in Postgres, guarded by conditional updates and unique indexes.

```
 location: Driver app ──WebSocket──> Gateway ──> Location service (stateless)
             no rideId:  GEOADD into free:{city}, refresh seen:{city}        Redis, sharded by city
             rideId set: forward to the rider's gateway; append to Kafka ──> trail in object storage

 request:  Rider app ──HTTPS──> Ride service
             1. INSERT ride (REQUESTED) with the idempotency key             Postgres, sync replica
             2. queue {rideId}, keyed by city; answer 201
             3. status changes reach the rider over the WebSocket

 match:    Matcher (stateless; takes lease:{rideId}; a sweeper re-queues REQUESTED rides with no live lease)
             1. read free drivers within 3 km of the pickup (6 km once, if none are left), drop those in tried:{rideId}
             2. keep the 10 nearest by straight line, one batch ETA call, sort by pickup ETA
             3. SET offer:{driverId} {offerId} NX PX 20000      nil -> that driver is taken, try the next
             4. push the offer through the driver's gateway, wait up to 15 s
             5. decline or timeout -> delete the key only if it still holds my offerId, add to tried, go to 3
                (when the shortlist runs out, go to 1)
                2 minutes with no accept -> ride EXPIRED, tell the rider

 accept:   Driver app ──> Ride service: reject if the offer expired on the server clock, then one transaction
             UPDATE rides SET status='ASSIGNED', driver_id=:d WHERE ride_id=:r AND status='REQUESTED'
             0 rows, or a unique-index violation on active driver_id -> answer "gone"
             after commit: remove :d from free:{city}, re-set offer:{driverId} as the busy marker
             (2-hour TTL), tell the rider, stop the matcher
```

Postgres runs with a synchronous standby and automatic failover, so a committed ride survives the loss of the primary. The queue consumer only takes the lease and starts a per-ride loop, because an offer loop can run for 2 minutes and must never block a partition.

The trip states. Every move is `UPDATE ... WHERE status = :from`, so zero rows means the event is late or illegal. COMPLETED, CANCELLED and EXPIRED are final. Any move that frees the driver, a final state or a driver cancel, deletes the busy marker.

| From | Event | To |
|---|---|---|
| REQUESTED | a driver accepts | ASSIGNED |
| REQUESTED | the rider cancels | CANCELLED |
| REQUESTED | 2 minutes pass with no driver | EXPIRED |
| ASSIGNED | the driver reaches the pickup | ARRIVED |
| ASSIGNED or ARRIVED | the rider cancels | CANCELLED |
| ASSIGNED or ARRIVED | the driver cancels | REQUESTED (`driverId` cleared, that driver excluded) |
| ARRIVED | the driver waits 5 minutes and reports a no-show | CANCELLED |
| ARRIVED | the rider boards and the driver starts the trip | IN_PROGRESS |
| IN_PROGRESS | the driver ends the trip | COMPLETED |

Walk one ride: the ride service stores a `REQUESTED` ride and queues it. A matcher reserves the best driver and pushes the offer, and on accept one conditional update makes the ride `ASSIGNED`.

Walk a race: two matchers pick the same driver. Only one `SET NX` returns `OK`, and the other matcher moves on. Suppose a failover lost the key and both offers go out. The driver accepts both. The first update commits, and the second hits the unique index on active `driver_id`, so the driver hears `gone`. A late accept at 15.3 seconds fails the server clock check. If it slips through, the conditional update still lets only one driver have the ride.

Walk a crash: a matcher dies mid-wait. The ride is still `REQUESTED` in Postgres, and the reservation expires by itself. The lease lapses, the sweeper re-queues the ride, and the next matcher reads `tried:{rideId}` and carries on.

## Accepted alternatives

- **Geo index.** Redis GEO (a sorted set with geohash scores) per city (reference). Cell keys in Redis: a geohash (6 characters), H3 (resolution 8) or S2 cell id as the key, a set of driver ids as the value, and a search of the rider's cell plus its neighbors. A quadtree or grid in a stateful per-city service: it adapts to dense downtowns and refills from 4 seconds of updates after a restart, but it needs safe splits and merges, or one writer per region. A wide-column store keyed by geohash prefix with a TTL works but costs more than memory for data rewritten every 4 seconds. Not accepted: one relational primary with PostGIS at this write rate.
- **Location transport.** WebSocket (reference), MQTT or gRPC streaming. Plain HTTPS posts are 250,000 requests per second with TLS and header cost: accept only if the candidate names that cost. Mobile push (APNs or FCM) is a fallback, not a path for a 15-second offer.
- **Matching style.** One offer at a time (reference). Offering to the top 3 at once, first accept wins, is fine if all 3 are reserved and the losers hear `gone`. The candidate should name the cost: two drivers lose a race. Batch matching is fine too: collect an area's requests and free drivers for about 1 second, then assign them together (greedy by ETA is enough). A longer window needs the candidate to name the cost against the 2-second first-offer target.
- **Exclusive assignment.** A Redis `SET NX PX` reservation plus a conditional update in Postgres (reference). A Lua script that checks and sets in one step. Postgres alone, with a conditional `UPDATE` on a driver row (one write to reserve and one to release, so about 1,500 extra writes per second). A DynamoDB condition expression. One matcher per city that decides every assignment in one thread, with a lease for ownership and the database constraint as the guard if two owners overlap. A consensus lock (etcd or ZooKeeper) works but is heavier than needed.
- **Ranking.** Straight-line distance alone is a fair first cut. It reaches Good only once the candidate adds the ETA call.
- **Other choices: queue and trip store.** Queue: Kafka keyed by city (reference), RabbitMQ or SQS, or Postgres `FOR UPDATE SKIP LOCKED` over `REQUESTED` rows. At 500 requests per second this is about operations, not capacity. Trip store: Postgres (reference) or DynamoDB with conditional writes. Judge the reason, not the brand.
- **Actor framing.** One lightweight worker or actor per ride request that runs the offer loop with a timeout, restarted by a supervisor if it dies, is a strong answer. The same idea as an Elixir process with a receive timeout, or an Akka actor with a receive timeout, under a supervisor is also accepted. The ride lives in Postgres and the tried list in Redis, so a restarted process reloads both. One process per city that owns its geo index fits too.

## Deep dives

### Location ingestion and the geo index
- **Bad:** writes every update to Postgres and finds drivers with `WHERE lat BETWEEN ... AND lon BETWEEN ...`, or scans all online drivers and sorts by distance. At 250,000 writes per second the database falls over.
- **Good:** keeps the live position in memory (Redis), since the next update replaces it in 4 seconds. Maps positions to cells (geohash, H3 or a quadtree leaf) and searches the rider's cell plus its neighbors, because a driver 100 meters away can sit in the next cell. Sizes cells against the 3 km radius, shards by place (a city or a range of cells), and drops drivers silent for 15 seconds.
- **Great:** indexes only free drivers. Clears stale entries on purpose: a sorted set has no per-member TTL, so a last-seen set is swept every few seconds. Calls the index soft state that refills within one 4-second cycle after a failover. Shards by place, never by driver id. Knows a hot cell with thousands of drivers costs thousands of reads, so it caps the candidates read.

### Finding and ranking candidates
- **Bad:** offers the ride to the nearest driver by straight line with no check that the driver is free. Or offers to every driver in range and takes the first reply. Or calls the ETA service for every free driver, or lets one slow call stall the match.
- **Good:** reads free drivers near the pickup, keeps the 10 nearest, makes one batch ETA call with a timeout a little above the 300 ms p99 (about 500 ms) and sorts by pickup ETA. Offers to one driver at a time with a 15-second timer, adds each decliner to a tried set, and loops until someone accepts or 2 minutes pass, widening from 3 km to 6 km if nobody is in range.
- **Great:** puts numbers on the ETA bill (5,000 pairs per second, against 100,000 for all 200 drivers). Falls back to straight-line distance at 25 km/h when the ETA service is slow, so matching degrades instead of stopping. Accepts that a straight-line shortlist can miss a driver closer by road. Throttles rider ETA refreshes. Shows the 2-second budget holds: one geo read, one ETA call (300 ms at p99) and one reserve take well under 1 second.

### Never giving one driver two riders
- **Bad:** reads "driver is free" then writes "driver is busy" as two steps, so two matchers both assign. Or holds a lock with no expiry, so a dead app locks the driver forever. Or trusts the phone's clock for when an offer ends.
- **Good:** reserves the driver atomically before offering (`SET NX PX`, or a conditional `UPDATE` on a driver row), with a TTL a little over 15 seconds so a dead app frees itself. Accepts with a conditional update on the ride, `WHERE status = 'REQUESTED'`, which also covers a rider who just cancelled. A decline or timeout releases the reservation.
- **Great:** treats the Redis reservation as a cheap filter and Postgres as the truth. A unique index on active `driver_id` blocks a double assignment even after a failover, or when a paused matcher wakes after its reservation expired. Releases with compare-and-delete. Explains the late accept: the server checks expiry on its own clock and the conditional update settles the rest. Makes accept idempotent on `offerId`.

### The trip state machine and recovery
- **Bad:** `UPDATE rides SET status = :new WHERE ride_id = :r` with no check of the old status, so a late "arrived" overwrites "cancelled". Or keeps state in the matcher's or the phone's memory.
- **Good:** names the states and legal moves (the table above) and enforces each as `UPDATE ... WHERE status = :from`. Zero rows means a late or illegal event. Final states stay final. A rider's cancel and a driver's accept race on the same conditional update, so exactly one wins. Each move is durable before the phone sees it.
- **Great:** makes transitions idempotent, so a retried "arrived" from a phone that lost signal succeeds without acting twice. A driver cancel returns the ride to `REQUESTED`, clears `driverId`, excludes that driver and restarts matching. A sweeper re-queues `REQUESTED` rides whose lease lapsed and expires rides past 2 minutes. Writes a `RideEvent` in the same transaction as each move and emits `trip.completed` from it (an outbox), so payments never miss a trip.

## Curveballs

Use one, at the extension point, unless the candidate already handled it.
1. **Hot spot (a concert ends):** "A concert ends. In 10 minutes, 4,000 people request a ride from the same few blocks. About 200 free drivers are within 3 km. What breaks first?" Expect: 4,000 requests in 10 minutes is about 7 requests per second, small next to the 500 the system already handles. Supply is the problem: 20 requests for every free driver. Every matcher ranks the same nearest drivers, so reservations collide and rides walk down lists of mostly reserved drivers, repeating paid ETA calls. The candidate sees that load is small and contention is the trouble. Fixes: skip reserved drivers when reading candidates. Batch the area's requests for a second or two so the nearest driver goes to the nearest rider. Tell riders the wait instead of cycling offers. Give the area its own queue partition so it cannot starve the city. Stretch: names price (surge, out of scope) as the real lever.
2. **Failure (the index shard dies):** "The Redis shard that holds the free-driver index and the offer reservations for the biggest city fails over at the peak. The replica is a few seconds behind." Assume a 30-second failover. "What happens to rides in flight, and can a driver get two riders?" Expect: the biggest city sees about 25 requests per second, so about 750 arrive meanwhile. Rides are safe, because they are `REQUESTED` rows in Postgres and the sweeper re-queues them. Matchers tell "index unavailable" from "no drivers" and retry with backoff inside the 2-minute window. The index is soft state: every free driver reports within 4 seconds, so it refills in about one cycle. Location writes during the gap are dropped, not queued, because an old position is worse than none. Reservations may vanish, so a driver can see two offers, but the conditional update and the unique index on active `driver_id` still allow one ride. Stretch: says anything held only in Redis, locks included, can vanish, so Postgres holds the assignment. Notes a just-assigned driver may still show as free after replica lag: the entry ages out within 15 seconds, because busy drivers stop refreshing it.
3. **Change in requirements (shared rides):** "Product wants shared rides. One car carries up to 3 riders going the same way, and no rider's trip may grow by more than 5 minutes. What changes?" Expect: "one active ride per driver" breaks, so the unique index on `driver_id` goes. Seats become a counter on a driver-level row, guarded by a conditional update (`UPDATE ... SET seats_taken = seats_taken + 1 WHERE seats_taken < 3`), and each rider keeps their own ride row and states. Busy drivers with free seats stay in the index, so index writes rise from 100,000 toward 250,000 per second. The ETA call must cover the detour with the new stops inserted, for each rider already on board, so more pairs per request: prefilter by direction and cell. The state machine becomes a journey with ordered stops, and one rider's cancel ends only that rider's leg. Not expected at the hire bar: optimal route planning. A greedy insertion checked with the ETA service is enough.

## Level bar

Hire bar must show:
- Requirements that pin down the update interval, drivers online, the offer rules (one at a time, 15 seconds), the never-two-riders rule and what is out of scope.
- The math without being asked: about 250,000 location updates per second against about 500 requests per second, ending in "which means positions live in memory, not in the primary database".
- A clean flow: apps, gateway, location service and geo index, ride service with Postgres, matcher with offers, and one ride traced from request to accept.
- A real geo index (geohash, H3 or quadtree) searched with neighbor cells, partitioned by place, with a rule for stale drivers.
- A guard against two riders taking one driver (an atomic reserve, a conditional update or one owner per area), a conditional accept, and a timeout path (release, then the next driver). Names the race when probed.
- The trip states and who moves each one. Enforcement by conditional update, when probed.
- The ETA service treated as an external call: shortlist first, then a timeout and a fallback.
- When asked where it breaks first, the location write rate or hot-spot contention, with its number and one fix.
- Real depth in one or two of the four deep dives. Nobody covers all four in 45 minutes.

Stretch signal:
- Separates soft state (positions) from hard state (assignments) without a prompt, and uses a database constraint as the last guard against double assignment.
- Keeps busy drivers out of the index (250,000 down to 100,000 per second).
- Handles the late accept, the cancel racing the accept, and matcher crash recovery with the tried list intact.
- Puts a number on the ETA bill and throttles rider refreshes (5,000 pairs per second).
- Offers batch matching or per-area queues for hot spots.
- Uses idempotency keys on the request and on accept, and a unique index for one active ride per rider.
- Scopes surge out in one sentence and moves on.

## Traps

- "Store locations in Postgres with PostGIS." At 100,000 to 250,000 writes per second, one primary cannot keep up.
- Searching only the rider's own cell, so drivers just across the border are missed.
- A lock with no expiry, so a dead driver app blocks that driver forever.
- A lock with an expiry and no database guard, or "Redis already prevents double assignment": a paused matcher wakes after the expiry, or a failover loses the key, and the driver gets two riders.
- Offering the ride to every driver in range at once, then taking the first reply.
- Persisting every location update for durability, or sending positions through a slow queue so the index runs minutes behind.
- Calling the ETA service for every free driver, or blocking matching on it with no timeout.
- Sharding the geo index by driver id, so every search hits every shard.
- Updating `status` with no `WHERE status = :from`, so late events overwrite cancels.
- One global lock or leader for all matching, or Paxos for location data that is rewritten every 4 seconds.
- Ten microservices and Kafka everywhere for 500 requests per second, when the load is location writes.
- Designing surge pricing in detail instead of the core flow.
