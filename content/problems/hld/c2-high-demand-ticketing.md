---
id: c2-high-demand-ticketing
track: hld
title: High-Demand Ticket Booking
difficulty: medium
tags: [contention, reservations, ttl, waiting-room, consistency, flash-crowd]
tracker:
  section: "### C2. Classic HLD Problems"
  bullet: "High-Demand Ticket Booking (Ticketmaster)"
notesFile: notes/c2-high-demand-ticketing.md
sources:
  - title: "Hello Interview: Design Ticketmaster"
    url: "https://www.hellointerview.com/learn/system-design/problem-breakdowns/ticketmaster"
  - title: "Cloudflare Waiting Room: About"
    url: "https://developers.cloudflare.com/waiting-room/about/"
confidence: "The hold designs (a long database lock is bad, a status with an expiry is good, an expiry checked on read or a lock with a time limit in Redis is great), the waiting queue and the server-sent seat updates come from an interview breakdown. The admission thresholds, first-in-first-out order and cookie-tracked places come from a waiting room product's documentation. The breakdown keeps holds in Redis with the database as a backstop; this brief keeps the hold in the database as the reference and accepts Redis, because both appear in the sources and the database alone carries this load. The random order for people who arrive before the start is this problem's own design choice. Scale numbers are this problem's own assumptions."
---

## Opening prompt

Let's design the booking system for a ticket site that sells seats for concerts and sports. Some shows sell out in minutes. Where would you like to start?

## Hidden facts

Reveal a fact only when the candidate asks about it, or asks a question whose honest answer needs it. Never volunteer the list.

- **Terms:** a hold sets seats aside for one buyer for a limited time while they pay. An on-sale is the moment tickets for a show go on sale.
- **Scope:** a buyer views an event and its seat map, picks seats (or asks for the best available), holds them, pays and gets tickets. Event search, venues setup, resale, refunds and dynamic prices are out of scope. Buyers must sign in to hold seats.
- **Seats:** every ticket is for a numbered seat. A big stadium has 50,000 seats. Most venues have under 5,000.
- **Normal days:** about 100,000 events are on sale. About 1 million tickets sell a day, and event pages get about 100 views per ticket sold.
- **Big on-sale:** a few times a month a show draws far more buyers than seats. The on-sale time is announced a week ahead. For a 50,000-seat stadium, about 2 million people try in the first 10 minutes, and about 1 million of them are there in the first minute.
- **Orders:** at most 6 tickets per account per event. An order averages 2.5 tickets.
- **Holds:** a hold lasts 10 minutes. Once the buyer starts paying, the hold may run up to 5 more minutes. If the hold ends, the seats go back on sale.
- **Never:** a seat is never sold twice. Telling a buyer that a seat they clicked is gone is fine. Charging two buyers for one seat is not.
- **Seat map:** the map may be up to 2 seconds behind. Only the hold itself must be exact.
- **Fairness:** a big on-sale is first come, first served from the start time. Arriving early, or refreshing many times before the start, must give no edge.
- **Waiting:** a buyer in line sees their place and an estimated wait, updated about every 20 seconds. Leaving the page loses the place after a few minutes.
- **Payment:** an outside payment provider. Paying takes 30 seconds to 3 minutes. The provider takes an idempotency key and confirms by webhook. It accepts up to 500 calls a second.
- **Latency:** for a buyer who is through the line, a hold answers within 1 second at p99.
- **Availability:** viewing events targets 99.9%. Holds and payments target 99.95%. When the two conflict, a correct booking beats being up.
- **Numbers:** one Postgres primary takes about 5,000 simple row writes a second. Updating one row takes about 2 ms. One Redis shard takes 50,000 to 100,000 simple commands a second. A CDN is available.
- **Out of scope:** bots and scalpers beyond the 6-ticket limit, seat prices that change, mobile ticket delivery.

For the interviewer: on the numbers, give them only when the candidate asks what one database or cache can take.

## Expected requirements

Core, functional:
1. View an event and its seat map. *Ask: What does a buyer see before choosing seats?*
2. Hold chosen seats for 10 minutes, then pay to confirm or let them go. *Ask: What happens between picking a seat and paying?*
3. Big on-sales let buyers in fairly, in order. *Ask: What happens when far more people want tickets than there are seats?*

Core, non-functional:
1. A seat is never sold twice. *Ask: What must never happen with a seat?*
2. 2 million buyers in 10 minutes for 50,000 seats; 1 million in the first minute. *Ask: How many people come for one big show, and how fast?*
3. A hold answers within 1 second at p99 for a buyer who got through. *Ask: How fast must holding a seat be?*
4. Booking prefers being correct over being up; viewing can be 2 seconds stale. *Ask: Which matters more for booking, being up or being right?*

Extras (credit when they name one, never a gap):
- At most 6 tickets per account per event.
- Arriving early or refreshing before the start gives no edge.
- A buyer in line sees their place and an estimated wait.
- Payment by an outside provider, confirmed by webhook.

## Capacity math

The refresh interval, the admission rate, the share of admitted buyers who complete an order and the hold attempts per buyer below are assumptions. Accept other reasonable values when the candidate gives a reason.

- **Demand against supply:** 50,000 seats at 2.5 per order is about 20,000 orders, against 2 million people, which means about 99% of buyers will not get tickets, and the design must say no fast and fairly instead of letting everyone fight for the same rows.
- **No line:** 1 million people in the first minute, each refreshing the seat map every 2 seconds, is 500,000 requests a second for one event, and every click is a write on the same 50,000 rows, which means a waiting room in front of the booking path.
- **Admission rate:** letting in about 3,000 buyers a minute (50 a second), each spending up to about 10 minutes choosing and paying, keeps about 30,000 people in the buying flow. 50 new buyers a second making a few hold attempts each is a few hundred writes a second, far under the 5,000 a Postgres primary takes, which means the database is not the bottleneck once the line exists.
- **Sell-out time:** if about 80% of admitted buyers complete an order, about 25,000 must be admitted to sell 20,000 orders, about 8 minutes at 3,000 a minute, which means the line can stop admitting people early and tell the rest the show is sold out.
- **Waiting room load:** 2 million people checking their place every 20 seconds is about 100,000 requests a second, which means the waiting page and the place check must be cheap: a static page from the CDN plus a signed token, not a database read.
- **Seat map:** 50,000 seats as one bit each is about 6 KB, which means one snapshot per second, served from a cache or the CDN, covers 30,000 buyers polling every 2 seconds (15,000 reads a second) with no database load.
- **Payments:** 20,000 orders in about 10 minutes is about 33 calls a second, which means the provider's 500-a-second limit is not the problem.
- **One row:** a seat row is updated by one buyer at a time, so the 2 ms row lock only matters when many buyers want the same seat at once, which means seats spread the load, and a single shared counter would not.

## API and entities

External API:
- `GET /events/{eventId}` returns the event, venue and prices. `GET /events/{eventId}/seatmap` returns a snapshot of free and taken seats with a `version`, cached for about 1 second.
- `POST /queue/{eventId}/join` returns `200 { token }`, a signed token with the buyer's place. `GET /queue/{eventId}/status` with the token returns `{ place, estimatedWait, admitted, accessToken? }`.
- `POST /events/{eventId}/holds` with header `Idempotency-Key`, the access token and `{ seatIds }` or `{ bestAvailable: n }` returns `201 { holdId, seatIds, expiresAt }`, or `409 { unavailable: [seatId] }` when any seat is taken. `403` without a valid access token.
- `POST /holds/{holdId}/payment` returns `200 { paymentUrl }` and extends the hold by up to 5 minutes. `DELETE /holds/{holdId}` releases it.
- `POST /webhooks/payments` checks the signature and confirms or fails the order.

Core entities:
- `Event { eventId, venueId, onSaleAt, status }` and `Venue { venueId, seatMap }`.
- `Seat { eventId, seatId, status (free, held, sold), holdId?, holdExpiresAt?, orderId? }`, one row per seat per event.
- `Hold { holdId, eventId, userId, seatIds, expiresAt, idempotencyKey }`.
- `Order { orderId, holdId, userId, amount, status, providerPaymentId? }`.
- `QueueEntry { eventId, token, place, joinedAt, admittedAt? }`.

## Reference design

```
 Buyer ──> CDN (event page, waiting page, seat map snapshot)
   │
   ├──> Queue service: join gives a signed token with a place (random before the start, by time after)
   │     │ admitter lets the next 3,000 a minute in: marks them admitted, issues an access token (15 min)
   │
   └──> Booking service (checks the access token)
          │ hold: one Postgres transaction
          │   UPDATE seats SET status = 'held', hold_id = $h, hold_expires_at = now() + 10 min
          │   WHERE event_id = $e AND seat_id = ANY($seats)
          │     AND (status = 'free' OR (status = 'held' AND hold_expires_at < now()))
          │   all rows changed: commit and return the hold; fewer: roll back, return 409 with the gone seats
          ├──> payment provider (idempotency key = holdId) ──> webhook ──> mark seats sold, order paid
          └──> seat map builder: every second, read seat status ──> snapshot ──> cache and CDN
 Sweeper: every minute, set expired held seats back to free (tidiness only; the WHERE clause is the guard)
```

Walk one buyer: the buyer opened the page 5 minutes before the start and got a random place among the early arrivals: 9,200. At the start the admitter lets 3,000 people in each minute, so after about 3 minutes the status call returns `admitted` with an access token. The buyer loads the seat map snapshot from the CDN and picks seats C14 and C15. The booking service checks the access token and the 6-ticket limit, then runs the conditional update. Both rows change, so it commits and returns the hold with an expiry 10 minutes away. The buyer starts paying, which extends the hold by up to 5 minutes. The provider's webhook arrives, and one transaction marks both seats sold, the order paid and the hold done.

Walk one abandoned hold: a buyer holds A1 and A2 and closes the tab. Nothing happens at once. At minute 10 the seats are still marked held, but the expiry is in the past, so the next buyer's conditional update treats them as free and takes them. The next seat map snapshot, at most a second later, shows them free. The sweeper tidies any expired rows nobody touched. If a late webhook says the first buyer paid after their seats went to someone else, the order is refunded automatically.

## Accepted alternatives

- **Holding seats.** All fine with a reason:
  - A conditional update with an expiry in the seat row (reference). Correct without any background job.
  - A lock per seat in Redis with a time limit (`SET seat NX EX 600`), with the database's own check as the final guard when marking seats sold. Fast, but Redis is then a second source of truth, and a failover can lose recent locks.
  - A status column plus a sweeper that frees expired holds. Fine only if the candidate notices that seats stay blocked until the sweep runs.
- **Waiting room.** A queue service with signed tokens (reference), a managed waiting room at the edge, or a sorted set of arrival times in Redis. All fine if admission is paced and the waiting page never touches the booking database.
- **Seat map freshness.** Polling a cached snapshot every 2 seconds (reference), or server-sent events that push changes. Pushing every change to 30,000 buyers works for normal shows. For a big on-sale, a snapshot with a version is cheaper.
- **Best available.** Choosing seats on the server from the snapshot, then trying a conditional update and retrying with the next block on a conflict. Fine.
- **Store.** Postgres with one row per seat (reference). Any store with conditional writes on a row works. A document per event holding all 50,000 seats makes every hold fight over one record.

## Deep dives

### Holding seats without double booking
- **Bad:** read that a seat is free, then write it as held, in two steps, so two buyers both read free. Or `SELECT ... FOR UPDATE` held open while the buyer pays for minutes. Or a hold that only ends when a background job runs.
- **Good:** one conditional update that takes the seat only if it is free or its hold has expired, inside one short transaction for all seats of the order. A buyer who loses the race gets a clear `409`. The hold expires by time, not by a job.
- **Great:** all seats of an order in one transaction, so no buyer gets half their seats, with rows locked in seat order so two overlapping orders cannot deadlock. Idempotency keys so a double tap makes one hold. The final "sold" update checks that the hold still belongs to this buyer, so a webhook after expiry cannot sell a reassigned seat, and that payment is refunded. If Redis locks are used, says the database check stays as the guard.

### The waiting room
- **Bad:** no line, so a million people refresh and click at once. Or a line that lets everyone in at once when the sale starts. Or a line stored in the booking database.
- **Good:** a waiting room in front of the booking path that admits buyers at a fixed rate, gives each a place, and lets only admitted buyers hold seats. The waiting page is static and cached.
- **Great:** sets the admission rate from how many people the booking flow can serve (about 3,000 a minute) and from the 2 million to 50,000 ratio. Signed tokens so the place check needs no database read. Random places for early arrivals. Stops admitting and says "sold out" once holds plus sales cover every seat. Admitted buyers get a short-lived access token that the booking service checks.

### Showing the seat map under load
- **Bad:** every buyer's map reads every seat from the primary database every 2 seconds.
- **Good:** build one snapshot a second and serve it from a cache or the CDN with a version number. Buyers accept that a seat may vanish when they click.
- **Great:** sizes the snapshot (about 6 KB) and the read rate. Treats held seats as taken in the map, and expired holds as free. For normal shows, server-sent events can push changes; for a big on-sale, the snapshot is cheaper. Offers best available so buyers do not chase the same seats.

### Paying inside the hold
- **Bad:** charge the card first and then try to take the seat. Or keep a database transaction open while the provider works.
- **Good:** hold first, then pay with the hold id as the idempotency key. The webhook confirms, and one transaction marks seats sold and the order paid.
- **Great:** extends the hold when payment starts so a slow bank step does not lose the seats. Handles a webhook that arrives twice (idempotent) or after the hold ended (refund). Never lets a payment that arrives late take a seat that was reassigned.

## Curveballs

Use one, at the extension point, unless the candidate already handled it.
1. **Ten times the crowd:** "A reunion tour announces one stadium show, and 20 million people join the line in the first 10 minutes. Same 50,000 seats. What breaks first?" Expect: joins come at about 33,000 a second (20,000,000 / 600), and place checks every 20 seconds are about 1 million requests a second. The booking path is unchanged, because admission stays at about 3,000 a minute. The waiting room must scale: join returns a signed token with a time and a random number made at the edge, place checks are answered from the token plus a published "admitted up to" number, and nothing per person touches a central database. Strong: tells most people early that the show is very likely to sell out before their turn, and stops admitting once seats run out.
   Fits: The waiting room
2. **Cache failover:** "Your team moved holds into Redis for speed: one key per seat with a 10-minute expiry. During the on-sale the Redis primary dies, and its replica takes over about a second behind. What can go wrong?" Expect: holds from the last second are gone, so another buyer can take seats that someone else was shown as held. If the database's final "sold" step checks the seat's status and owner, nobody is sold a seat twice; one buyer gets an error at payment, and an automatic refund if they were charged. If Redis was the only guard, two buyers can pay for one seat. Strong: keeps the database as the source of truth, or makes the sold step a conditional update keyed on the hold.
   Fits: Holding seats without double booking; Paying inside the hold
3. **Standing area:** "The venue adds a standing area of 20,000 tickets with no seat numbers. Product wants to admit 2,000 buyers a second for it. What changes?" Expect: with no seats, every hold updates one counter row. At about 2 ms a row that is about 500 updates a second, so 2,000 a second queue up and time out. Fixes: split the 20,000 into 20 buckets of 1,000 and pick one at random (moving to another bucket when it runs out), keep the count in Redis with an atomic decrement and confirm in the database, or create 20,000 ticket rows and claim one with `FOR UPDATE SKIP LOCKED`. Strong: says buckets can say "sold out" while others still have stock, and handles it by trying the others.
   Fits: Holding seats without double booking
4. **Live map:** "Product wants seat changes to show on every admitted buyer's map within 1 second during a big on-sale, not 2. What changes?" Expect: polling a cached snapshot every second doubles the reads to about 30,000 a second, still cheap from the CDN, but the snapshot must be built more often and its cache time cut below a second, so the worst case is about 1.5 seconds; tight. Pushing: about 50,000 seats change state about twice each (held, then sold or freed) in about 8 minutes, about 200 changes a second. Sending every change to 30,000 buyers one by one is about 6 million messages a second, so batch changes every 500 ms into one small diff with a version: 2 messages a second per buyer, about 60,000 a second in all, over server-sent events from a fleet of connection servers that read one change stream. A client that misses a version reloads the snapshot. Strong: says a fresher map does not stop two buyers clicking the same seat, so the `409` path stays, and best available cuts the chasing more than freshness does.
   Fits: Showing the seat map under load

## Level bar

Hire bar must show:
- Requirements with numbers for the size of a big on-sale and the 10-minute hold, and the rule that a seat is never sold twice.
- The demand math (about 2 million people for about 20,000 orders, about 500,000 requests a second with no line) and the decision it forces: a waiting room in front of booking.
- An atomic hold that ends by time: one conditional update with an expiry, or a lock with a time limit plus a database guard, with the seats back on sale when it lapses.
- When probed, a seat map served from a snapshot or cache, not the database.

Stretch signal:
- Sets the admission rate from the booking flow's capacity and stops admitting once seats run out.
- Checks the hold's owner in the final sold step, and refunds a late payment.
- Signed tokens so the waiting room scales without a database.
- Random places for early arrivals, with the reason.
- Spots the single counter row for a standing area and splits it.

## Traps

- Read the seat, then write it, in two steps.
- A database lock held open while the buyer pays.
- A hold that ends only when a cron job runs. Some guides teach a status plus a cron sweep as a good answer, so it is partial credit, and an accepted alternative once the candidate sees that seats stay blocked until the sweep runs.
- "Add more servers" for a million people clicking the same 50,000 seats.
- Charging the card before the seats are held.
- Redis as the only record of who holds a seat. A Redis lock with a time limit is widely taught and is an accepted alternative when the final sold step still checks the database. It is a red flag only when Redis alone decides who gets charged, because a failover can then sell one seat twice.
- A waiting room that reads and writes the booking database for every person in line.
