---
id: c2-ecommerce-checkout
track: hld
title: E-commerce Checkout / Inventory
difficulty: hard
tags: [inventory, saga, idempotency, outbox, payments, flash-sale]
tracker:
  section: "### C2. Classic HLD Problems"
  bullet: "E-commerce Checkout / Inventory"
notesFile: notes/c2-ecommerce-checkout.md
---

## Opening prompt

Let's design the checkout and inventory system for a large online store. A shopper turns a cart into a paid order. Where would you like to start?

## Hidden facts

Reveal a fact only when the candidate asks about it, or asks a question whose honest answer needs it. Never volunteer the list.

Terms: a **hold** (also called a reservation) is stock set aside for one order for a limited time.

- **Scope:** the shopper presses "Place order" on a cart. We price it, hold the stock, take payment and mark the order paid. Out of scope: catalogue and search, the cart itself, pricing and tax (a pricing service returns the total for a cart snapshot), shipping, returns, promotions, fraud and bots. A cart service returns the lines for a `cartId` and `cartVersion`. If the cart changed since the shopper last saw it, "Place order" fails with `409 cart_changed` and the shopper reviews the cart. Restocking is a back-office job that adds units.
- **Services:** Order, Inventory and Payment exist as three services, each with its own Postgres. No transaction spans them. Redis and Kafka are available. Shoppers are logged in. One seller, one currency, one region with three zones.
- **Volume:** 3 million "Place order" presses a day. 2 million end in a paid order, and 1 million never get paid. The evening peak is 5 times the daily average. A typical cart has 3 lines (at most 20 lines, 10 units each). Adding to a cart never holds stock.
- **Stock:** 10 million SKUs, one country-wide pool per SKU. A typical SKU holds 20 to 500 units. Outside flash sales, no SKU takes more than about 20 orders per second. Overselling is not allowed: we never confirm an order we cannot fulfil, and a wrong "sold out" harms less than a unit sold twice. A cart is all or nothing. If one line cannot be held, none is, and the shopper learns which line failed.
- **Holds:** stock is held from "Place order" until the order is paid or cancelled. A hold lasts 10 minutes, and flash sales may use as little as 5. A payment attempt in progress keeps the hold until it settles, for at most 30 minutes. When a hold ends, the stock returns to the pool, the cart stays, and the shopper must press "Place order" again.
- **Product pages:** about 100 views per paid order. A page shows "In stock", "Only N left" or "Sold out", up to 5 seconds stale. Only the hold must be exact.
- **Flash sales:** a few a month, one SKU each, announced a week ahead with a fixed start time. A typical sale has 10,000 units and a limit of 1 unit per shopper. About 1 million shoppers press "Place order" in the first minute. First come, first served. A loser sees "sold out" at once. The limit counts units held or bought, so a winner who does not pay loses the hold after 5 minutes, the unit goes back on sale, and that shopper may try again.
- **Platform limits:** one Postgres primary takes about 5,000 simple row writes per second. A write to one hot row commits in about 2 ms with a synchronous standby, and the next update on that row waits for it. The Inventory service has a pool of 100 database connections. One Redis shard takes about 50,000 to 100,000 simple commands per second, and about half that for a script.
- **Targets:** "Place order" answers within 1 second at p99 and runs at 99.95%. The shopper sees a payment result within 3 seconds of the provider reporting it. A shopper who paid never sees a lost order: "we are confirming your payment" is fine, and "failed" after money moved is not. During a flash sale, a winner may wait up to 10 seconds for "Place order" to answer. Every other checkout keeps the 1-second target.
- **Idempotency:** the client sends a UUID `Idempotency-Key` per checkout attempt and retries on a timeout. The same key within 24 hours must return the same order. The same key with a different cart is an error. Two tabs can send two keys for one cart, and product wants one open order per cart.
- **Payment provider:** one external provider, cards and wallets. A card may redirect to the bank for an extra check (3-D Secure) that takes 30 seconds to 3 minutes. A shopper who pays finishes about 2 minutes after "Place order" on average. The client sends a provider token (`methodToken`), never a card number. The provider offers authorize-then-capture and direct charge. An authorization holds the funds for 7 days. A void releases them at once for free. A refund after capture costs a fee and takes days. Finance wants authorize at checkout and capture at shipment. Capture is out of scope.
- **Provider calls:** authorize has a median of about 1.5 seconds and a p99 of about 10 seconds. It can time out with the result unknown. Authorize, void and refund take an idempotency key, and the provider replays the first result for 24 hours. A status call by our reference returns the current state. The limit is 500 authorize calls per second. Webhooks are signed, at least once, one per final result (authorized, declined, failed). They usually arrive within seconds. Some are 15 minutes late, some come twice, and some arrive before the authorize call returns.
- **Payment failures:** about 1 attempt in 6 fails, so about 2.4 million attempts a day. A shopper may retry with another method inside the hold, up to 3 attempts per order. An authorization that appears after the order was cancelled is voided, and so is a second one on an order that already paid. The order is not revived.
- **Events:** fulfilment, notifications and analytics read order events from Kafka. An event goes out if and only if the change committed. None may be lost, and duplicates are fine. Events for one order arrive in order. Fulfilment must see "paid" within 10 seconds at p99.
- **Cancel and records:** a shopper can cancel until a payment starts. Orders stay viewable for 1 year, and an order with all its rows takes about 2 KB. Finance gets a daily settlement file from the provider and wants any authorization without a paid order flagged.

For the interviewer: on the scope, one line each is enough for the out-of-scope items.

For the interviewer: on the services, the candidate may merge or split them with a reason.

For the interviewer: on the platform limits, give a number only if asked.

## Expected requirements

Core, functional:
1. Place an order from a cart: price it, hold every line (all or nothing), start payment. *Ask: What happens to the stock when a shopper starts an order?*
2. Take payment through the provider, with a retry on another method inside the hold. *Ask: How does the shopper pay, and what if a payment fails?*
3. Paid on authorization. Cancel on failure, shopper cancel or hold end, and return the stock. *Ask: When does an order count as paid, and what ends it early?*

Core, non-functional:
1. 3 million placements a day; 175 a second at peak, 17,000 on one SKU in a flash sale. *Ask: How many orders a day, and what is the busiest moment?*
2. Never oversell: committed plus held units never exceed the stock. *Ask: What must never happen to the stock?*
3. A cancelled order never keeps a shopper's funds; one payment attempt never authorizes twice. *Ask: What must always be true about a shopper's money?*
4. A retried "Place order" never makes a second order or hold. *Ask: What if the shopper's request arrives twice?*
5. "Place order" under 1 second at p99, 99.95% available. *Ask: How fast and how available must placing an order be?*

Extras (credit when they name one, never a gap):
- The order is created from a cart snapshot.
- Void every authorization that does not pay its order.
- Publish order events to fulfilment, notifications and analytics.
- Show stock status and order status.
- No lost events, in order per order, and fulfilment sees "paid" within 10 seconds.
- The stock display is at most 5 seconds stale.

## Capacity math

- **Orders:** 3 million presses a day is about 35 per second on average and about 175 at peak. 2 million paid orders is about 23 per second and about 115 at peak, which means normal checkout is small and the flash sale is the only hot spot.
- **Row writes:** a paid 3-line order writes about 21 rows: order and lines 4, hold and lines 4, stock updates 3, state updates 4 (the order three times, the hold once), payment rows 2 (an insert and one update), outbox rows 4 (hold, order placed, payment authorized, order paid). At 175 per second that is about 3,700 row writes per second. Order and Inventory are the busiest, each with 9 rows per order (Inventory: 4 + 3 + 1 + 1). That is about 1,600 per second, a third of the 5,000 budget, which means no service needs sharding for normal traffic.
- **Live holds:** the 2 million paid orders hold for about 2 minutes and the 1 million unpaid ones for 10 minutes. That is 2 million × 120 seconds plus 1 million × 600 seconds, 840 million hold-seconds a day, about 10,000 live holds (one per order) on average and 50,000 at peak. The unpaid orders make 600 of the 840 million, about 70%. This means holds cost ordinary SKUs almost nothing, and an index on the order's `expiresAt` finds due orders without a scan. It also means a shorter hold matters more than faster payment for a flash sale.
- **Payments:** 2.4 million attempts a day is about 28 per second and about 140 at peak. A flash sale adds about 10,000 attempts over 2 minutes, about 80 per second. Against a limit of 500, which means a normal day has 3.5 times headroom and a flash sale still fits (140 + 80 = 220).
- **Events:** 4 outbox rows per order is about 700 events per second at peak. A relay that reads 500 rows every 100 ms moves up to 5,000 per second, which means one relay per service has about 7 times headroom.
- **Reads and storage:** 100 views per paid order is 200 million a day, about 2,300 per second and about 11,500 at peak, which means the stock display comes from a cache with a 5-second TTL, never from the hold path. 3 million orders a day for a year is about 1.1 billion orders, about 2.2 TB at 2 KB each across three databases, which means ordinary Postgres primaries with replicas hold a year, partitioned by month.
- **Flash sale:** 1 million attempts in 60 seconds is about 17,000 per second on one SKU. 10,000 units are gone in about 0.6 seconds, so 99% of attempts (990,000) get "sold out", which means the reject path must cost almost nothing: an in-memory flag, then at most one Redis read. A Redis script at 17,000 per second uses between a third and two thirds of a shard (a script runs at about half the simple rate), which means one shard carries today's sale.
- **Flash winners' writes:** the 10,000 winners arrive within about 0.6 seconds. Each writes about 7 rows: 4 on the Order database (order, line, state move, outbox) and 3 on the Inventory database (hold, line, outbox). That is 40,000 rows on the Order database, and at 5,000 per second the last winner waits about 8 seconds. This means the gate is not the only limit. Winners queue behind a bounded worker pool with its own connections, so a sale cannot starve ordinary checkouts, and the sale gets the looser 10-second target.
- **One hot row:** at 2 ms a commit, one row takes about 500 updates per second. 17,000 arrivals per second is 34 times that, and a pool of 100 connections fills in about 6 ms (100 divided by 16,500 net arrivals per second), which means the damage is not only a slow sale: the exhausted pool stalls every checkout for every SKU.

## API and entities

External API:
- `POST /orders` with `Idempotency-Key` and `{ cartId, cartVersion }` returns `201 { orderId, status, total, expiresAt }`. A repeated key returns `200` with the stored order. `409 out_of_stock` lists the failed lines, `409 cart_changed` means the cart version is stale, `409 in_progress` carries `Retry-After`, and `422` means the key was used with a different cart.
- `POST /orders/{orderId}/payments` with an `Idempotency-Key` and `{ methodToken }` returns `202 { paymentId, redirectUrl? }`, or `409` when the order is not `PENDING_PAYMENT` or 3 attempts are used.
- `GET /orders/{orderId}`, `POST /orders/{orderId}/cancel` (`200` in `PENDING_PAYMENT`, else `409`), `GET /products/{sku}/availability` (from a cache), and `POST /webhooks/payments` (provider only, signature checked, store and answer `200` at once).

Internal calls: Inventory `POST /holds` with `{ holdId (= orderId), lines }` returns `200` or `409 { failedLines }`, and a repeat returns the first answer. Payment `POST /payments` with `{ paymentId, orderId, methodToken, amount }` starts one attempt. Commit, release and void run on the `OrderPaid` and `OrderCancelled` events, idempotent on `holdId` and `paymentId`.

Core entities:
- `Order { orderId, userId, cartId, idempotencyKey, requestHash, status, cancelReason?, total, expiresAt, attempts }` with `OrderLine { orderId, sku, qty, unitPrice }`. Unique `(userId, idempotencyKey)`. A partial unique index on `cartId` while the status is `NEW`, `PENDING_PAYMENT`, `PAYING` or `PAID` gives one open order per cart.
- `Stock { sku, available }`: units free to sell. A hold takes units out, a release puts them back, and a commit changes nothing.
- `Hold { holdId (= orderId), state, backstopExpiresAt }` with `HoldLine { holdId, sku, qty }`. States: `ACTIVE`, `COMMITTED`, `RELEASED`. An order lives at most about 40 minutes (a 10-minute hold, then one attempt of up to 30 minutes). The backstop is far beyond that (for example 2 hours), and Inventory asks the Order service before it releases anything.
- `Payment { paymentId, orderId, attemptNo, amount, state, providerRef? }`. States: `CREATED`, `PROCESSING`, `AUTHORIZED`, `FAILED`, `UNKNOWN`, `VOIDED`. The provider key is the `paymentId`.
- `OutboxEvent { eventId, orderId, type, payload, publishedAt? }`, one table in each service's database.

Order states: `NEW → PENDING_PAYMENT → PAYING → PAID`. `NEW`: the row exists and nothing is held, so it anchors idempotency. `PENDING_PAYMENT`: stock is held and the shopper can pay. `PAYING`: an attempt is in flight, and expiry does not apply. `PAID`: the provider authorized the payment, and fulfilment owns the order from here. `CANCELLED` (reason `OUT_OF_STOCK`, `PAYMENT_FAILED`, `EXPIRED` or `SHOPPER`) is the other terminal state. A failed attempt sends `PAYING` back to `PENDING_PAYMENT`, or to `CANCELLED` if the hold has ended or it was the third attempt. Every move is a conditional update (`UPDATE orders SET status = :next WHERE id = :id AND status = :expected`), and zero rows means someone else moved first.

## Reference design

```
 place:   Shopper ──> LB ──> Order service (stateless, many) ──> Order Postgres
            0. flash lines only: in-memory sold-out flag, then a Redis script (limit, check, decrement). A loser stops here.
               The shopper's marker stores the Idempotency-Key. A repeat of a winning key skips the decrement and goes on to step 1.
               With the flag up, one Redis read of the marker still runs before a request is turned away.
            1. INSERT order NEW, unique (userId, idempotencyKey). A repeat returns the stored order.
            2. price the cart snapshot (pricing service, a read)
            3. hold all lines ──> Inventory service ──> Inventory Postgres, one transaction, lines in SKU order:
                 ordinary lines: UPDATE stock SET available = available - q WHERE sku = ? AND available >= q
                   (0 rows for a line: note it and go on. If any line failed: roll back, give any flash units back to the
                    counter and clear the shopper's marker, order CANCELLED OUT_OF_STOCK, reply 409 with every failed line)
                 flash lines: no stock update, because the counter already took the units
                 INSERT hold + lines (ACTIVE) + outbox row
            4. order NEW to PENDING_PAYMENT, expiresAt = now() + 10 min, outbox OrderPlaced; reply 201

 pay:     Shopper ──> Order service: PENDING_PAYMENT to PAYING (conditional) ──> Payment service ──> provider
                                                                     (authorize, Idempotency-Key = paymentId)
          webhook ──> Payment service: verify, update the payment, outbox PaymentAuthorized or PaymentFailed
          Order service consumes it: PAYING to PAID + outbox OrderPaid, or back to PENDING_PAYMENT, or CANCELLED
          payment sweeper: PROCESSING or UNKNOWN for over 60 s ──> provider status call by reference

 expire:  Order sweeper, every 10 s, FOR UPDATE SKIP LOCKED ──> CANCELLED + outbox OrderCancelled for
            PENDING_PAYMENT past expiresAt, NEW for over 60 s, PAYING for over 30 min (after a status check)

 events:  every service writes its outbox row in the same transaction as the state change
            relay (one poller per service, or read the WAL) ──> Kafka, key = orderId
            OrderPaid      ──> Inventory commits the hold; Payment voids any other authorization of the order; fulfilment; notifications; analytics
            OrderCancelled ──> Inventory releases the hold; Payment voids every authorization; notifications
```

Walk one order: the Order service inserts O1 as `NEW`, prices the cart and asks Inventory for hold O1, which runs one transaction. O1 moves to `PENDING_PAYMENT`. The shopper pays and O1 moves to `PAYING`. The webhook says authorized, the Order service moves O1 to `PAID`, and `OrderPaid` commits the hold and starts fulfilment.

Walk one cancellation: the shopper sends `POST /orders/{orderId}/cancel` while O1 is `PENDING_PAYMENT`. The Order service makes one conditional update to `CANCELLED` with the reason `SHOPPER` and writes the `OrderCancelled` outbox row in the same transaction. It replies `200`. If O1 has already moved to `PAYING`, the update changes no row and the shopper gets `409`. The relay publishes the event to Kafka with the key `orderId`. Inventory releases hold O1 and puts its units back into `Stock.available`, and Payment voids every authorization of the order.

Walk the flash sale: before the start, Inventory records the sale's 10,000 units as an allocation in Postgres, takes them out of `Stock.available`, and loads them into a Redis counter. A request meets the in-memory sold-out flag, then one script that checks the shopper's limit and decrements. The shopper's marker stores the `Idempotency-Key`. A winner whose reply was lost retries with the same key, and the script does not decrement again. The flow resumes at the insert, which returns the stored order, so a winner is never told "sold out". Only a winner inserts the order and the hold row, and the flow above resumes. The winners queue for the database, as the capacity math shows. A cart that mixes flash and ordinary lines takes the flash units first, and gives them back if an ordinary line fails. A release also clears the marker, so the limit counts only held or bought units. After about 0.6 seconds the counter hits 0 and the flag goes up. The other 990,000 attempts then get "sold out" after one Redis read of the marker, with no script and no database write. The flag lasts 1 to 2 seconds, so stock from expired holds sells again. At the end, the unsold counter moves back into `Stock.available`.

## Accepted alternatives

- **Holding stock.** All fine with a reason: a Postgres conditional update (reference for ordinary SKUs; under the default READ COMMITTED level a second update waits for the first, then re-checks the condition); `SELECT ... FOR UPDATE` with rows locked in SKU order; a Redis counter with a check-and-decrement script and durable hold rows (reference for flash SKUs); a hot SKU split over N counters or rows; a single writer per SKU fed by a Kafka topic keyed by SKU; one row per unit claimed with `SKIP LOCKED` (scarce SKUs only). A version check with retries suits ordinary SKUs only, because it collapses under contention.
- **Hold versus decrement at payment.** A hold with expiry is the reference. A soft check at "Place order" and a hard decrement at payment is acceptable for plentiful stock, if the candidate says what happens to "paid but sold out" (void, apologise). It fails for flash SKUs. A hybrid by scarcity is strong.
- **One database.** Merge Order and Inventory so the order and the hold commit in one local transaction, and run the saga only around payment. Valid at 175 per second. The flash path still needs its own handling, and payment stays an external step.
- **Saga and payment style.** The saga can be orchestrated by the Order service (reference), choreographed through events, or run by an orchestration engine such as Temporal. Two-phase commit is not an answer, because the provider cannot join it. Rejecting it for that reason is good. For payment: authorize then capture with void as the compensation (reference), or direct charge with refund if the candidate says a refund is slower, costs a fee and shows on the statement. Extra states such as `CONFIRMED` are fine.
- **Other choices: hold expiry, idempotency and events.** Expiry by a sweeper on `expiresAt` with `SKIP LOCKED` (reference), a delayed message as the trigger with the database as the truth, or lazy expiry for ordinary SKUs. Redis TTL keys as the only expiry are not acceptable. Idempotency by a unique index on the order (reference) or a keys table kept 24 hours. Events by an outbox with a polling relay or a WAL reader such as Debezium.
- **Payment results and flash admission.** Webhook plus a status sweeper (reference). Polling alone is fine if the candidate sizes the rate. A webhook alone is not, and the redirect back from the bank only triggers a refresh. For a flash sale: the counter alone (reference), a waiting room that admits shoppers at a fixed rate, or a lottery if product agrees.

## Deep dives

### Holding stock without overselling
- **Bad:** reads the stock, checks it in code, then writes it back, so two shoppers both see "1 left" and both win. Or decrements only after payment, so a flash sale takes 1 million payments for 10,000 units.
- **Good:** a hold at "Place order": one conditional update per line (`WHERE sku = ? AND available >= q`), where zero rows means sold out. All lines in one transaction, in SKU order to avoid deadlock, rolled back if one fails. A hold row with an expiry, released on cancel or expiry and committed on payment. Says why it is correct: the row lock orders the writers, and the condition is re-checked after the wait. On the flash sale, names the hot row (500 per second against 17,000) and offers a fix: a counter, a queue or a split row.
- **Great:**
  - Keeps ordinary SKUs on Postgres and gives flash SKUs a Redis counter. The script enforces the one-unit limit with a marker per shopper, so a retry cannot take a second unit. An in-memory sold-out flag with a 1 to 2 second life absorbs the losers.
  - Makes the durable hold rows the truth and Redis the gate. Orders the writes so a crash loses units but never invents them: decrement Redis before inserting the row, and on release update the row before incrementing Redis.
  - Runs a reconciler that recomputes allocation minus active and committed holds. It lowers the counter at once and raises it only after two matching checks, because requests in flight make the counter look low. Lowering cannot oversell, and raising can. After a Redis restart or failover (replication is asynchronous) it rebuilds the counter from Postgres before the sale reopens.
  - Limits hoarding with one unit per shopper and a shorter flash hold.

### Payment failures, timeouts and the saga

The authorization is the pivot: before it, a failure runs the compensations backwards. After it, the saga only moves forward.

| Step | Compensation | If the compensation fails |
|---|---|---|
| Create the order (`NEW`) | Cancel it, conditional update | A sweeper cancels any `NEW` order older than 60 seconds |
| Hold the stock | Release it, on `OrderCancelled` | Redelivery, idempotent on `holdId`. The backstop expiry frees it in the end |
| Authorize the payment | Void it, on `OrderCancelled`, with its own key derived from the `paymentId` | Retry with the same key and backoff. A sweeper voids any authorization that did not pay its order after 30 minutes. Alert |
| Mark paid, commit the hold | None, it only moves forward | Redelivery. A `PAID` order with an `ACTIVE` hold after 60 seconds raises an alert |

- **Bad:** one transaction or two-phase commit across order, stock and provider. Treats a timeout as a failure and releases the stock, so the card may be charged for nothing. Retries a timed-out call with a new idempotency key, which authorizes twice. Takes the redirect back from the bank as proof of payment.
- **Good:** the state machine with conditional moves, and the table's compensations, idempotent and retried. A timeout means unknown. Retries the same call with the same key, asks for the status by reference, waits for the webhook, and keeps the order in `PAYING`. A sweeper checks payments in `PROCESSING` over 60 seconds, so a lost webhook is covered. A decline returns the order to `PENDING_PAYMENT`, or cancels it at the third attempt.
- **Great:**
  - The order row decides every race. A click just after the hold ended races the expiry sweeper: both make a conditional move out of `PENDING_PAYMENT`, and the first to commit wins. If the sweeper wins, the click gets `409`. If the click wins, the order is `PAYING` and the sweeper skips it. Take a late authorization. An attempt timed out, the status call said "unknown reference", the hold ended and the order was cancelled. Then the webhook comes 20 minutes later. It finds a cancelled order, so the move to `PAID` changes zero rows. The rule "a cancelled order voids every authorization, whenever it appears" then voids it, in either event order. The same rule voids a second authorization that arrives after another attempt already paid the order. Stock is released only after the order row flips, and the order is never revived.
  - The provider key belongs to the payment attempt: the same key retries one attempt, and a new card gets a new key. One key per order replays the first decline for 24 hours.
  - Authorize-then-capture makes the compensation a free, instant void. Alerts cover stuck states: `NEW` or `PAYING` too long, `UNKNOWN` over 10 minutes, an authorization that did not pay its order.

### Idempotent order creation
- **Bad:** no key, so a timeout retry makes a second order and hold. Or a `SELECT` for the key and then an `INSERT`, which two concurrent retries both pass.
- **Good:** a key per checkout attempt, and the order inserted first under a unique index on `(userId, idempotencyKey)`. A repeat finds the row and returns the stored outcome. A hash of the request catches the same key with a different cart (`422`). Internal calls use ids derived from the order (hold id = order id, payment id), so they are idempotent too.
- **Great:**
  - Walks the in-between states. A crash after the hold but before `PENDING_PAYMENT` leaves a `NEW` order. A retry replays the same steps, each idempotent on the order id, and they converge through conditional moves with no lock. With no retry, a sweeper cancels the order and the event releases the hold.
  - Adds one open order per cart (a partial unique index on `cartId`) for two tabs with two keys.
  - Says idempotency protects effects. A sold-out reply has no effect, so a flash-sale loser needs no row, and a retry may win if stock came back. A winner's retry with the same key must get the stored order, not "sold out", so the flash gate checks the key before it treats a request as a loser.

### The outbox and events
- **Bad:** commits to Postgres and then publishes to Kafka in the same request, so a crash between the two loses the event and fulfilment never hears of a paid order. Or "Kafka transactions make it atomic", which they cannot, because Postgres cannot join them.
- **Good:** a transactional outbox. The state change and an outbox row commit in one local transaction. A relay publishes unpublished rows to Kafka and marks them. Delivery is at least once, so consumers dedupe on `eventId`.
- **Great:**
  - Keeps events in order per order: Kafka key = `orderId`, and one poller per service or a WAL reader. Several pollers using `SKIP LOCKED` can reorder one order's events.
  - Publishes first and marks second, so a crash gives a duplicate, never a loss.
  - Uses the outbox for the saga's own steps too, so a Kafka outage only delays events and checkout keeps working.
  - Sizes it (700 events per second against 5,000 per second for one relay) and alerts on the age of the oldest unpublished row.

## Curveballs

Use one, at the extension point, unless the candidate already handled it.
1. **Hot spot (load):** "Marketing plans a sale ten times bigger: 100,000 units of one SKU, and 10 million shoppers press the button in the first minute. What breaks first?" Expect: 10 million shoppers in one minute is about 170,000 attempts per second on one SKU, and one counter key lives on one Redis shard that takes about 25,000 to 50,000 scripts per second. More shards alone do not help, so the units split over N counter keys on different shards. With N = 10, each key holds 10,000 units and sees about 17,000 per second, today's rate. A request picks a random key and tries the next when it is empty, and sold-out flags work per key and overall. Stretch: the front door breaks before Redis, so a waiting room or edge limit admits only a few times the stock (for example 300,000 shoppers). Also, 100,000 winners write about 400,000 rows on the Order database, which is 80 seconds at 5,000 per second, so order creation is paced or spread over several databases. And 100,000 authorizations at 500 per second take 200 seconds, so the pay step is paced under the limit and the hold must outlast the wait.
   Fits: Holding stock without overselling
2. **Provider outage (failure):** "Two minutes into a flash sale the payment provider goes down for 20 minutes. All 10,000 units are held. What happens?" Expect: a circuit breaker on provider errors and timeouts opens. While it is open, no new holds are made, because nobody should hold stock they cannot pay for, and shoppers see "payments are unavailable, try again soon". Existing holds are kept for up to 30 minutes in all. A payment in flight stays `PAYING`, and the sweeper does not expire `PENDING_PAYMENT` orders while the breaker is open, because the winners cannot pay through no fault of their own. After recovery, timed-out calls retry with the same keys after a status check, paced under 500 per second (10,000 attempts take 20 seconds). Late webhooks arrive in a burst, and the conditional moves make each one harmless. Stretch: names the cost of the cap (stock locked for shoppers who may never pay), and says a second provider is safe only if the first provider's status is known for every unknown call, or it authorizes twice.
   Fits: Payment failures, timeouts and the saga; Holding stock without overselling
3. **Change (warehouses):** "Product wants stock in 8 warehouses. Ship from the nearest warehouse that can fill the whole order, and show the delivery promise before payment. What changes?" Expect: the stock key becomes `(sku, warehouseId)`. The hold call takes candidate warehouses, nearest first, from a serviceability lookup by delivery address, and takes the first that covers every line (splitting lines only if product allows). It stays one transaction with conditional updates, rows locked in `(sku, warehouseId)` order, all or nothing. Hold lines carry the warehouse, and the product page shows the sum over warehouses that serve the shopper's area. Order, payment, idempotency and outbox do not change. Stretch: an uneven spread means shoppers near an empty warehouse see "sold out" while others have stock, so the fallback list matters, and the hold comes before the promise.
   Fits: Holding stock without overselling

## Level bar

Hire bar must show:
- Requirements that cover flash sales, the hold rules (when, how long, expiry), zero overselling, an idempotent "Place order", and what a failed or slow payment does.
- Math that ends in design: 175 placements per second is easy for one database, and 17,000 attempts per second on 10,000 units is too much for one row.
- A clean API with an idempotency key, entities for order, hold, stock and payment, and a state machine with legal moves.
- A working design: a conditional update (never read then write) to hold stock, a hold with expiry and release, payment with a provider idempotency key and a webhook, and "paid" only after the provider says so.
- One traced failure: a timeout means unknown, so retry with the same key or ask for the status, and never release stock on a guess.
- The outbox or an equivalent when asked how a paid order reaches fulfilment. On the flash sale, the hot row and at least one fix.
- One deep dive done properly when the interviewer picks it.

Stretch signal:
- Raises the pay-versus-expire race unprompted and settles it with one conditional move on the order row.
- Keys the provider call per payment attempt, and prefers authorize-then-capture so the compensation is a void.
- On flash SKUs: durable holds as the truth with Redis as the gate, a safe write order, reconcile down at once and up slowly, a sold-out flag and a waiting room.
- Says a hot row exhausts the connection pool and stalls every SKU.
- Keeps events in order per order, dedupes in consumers, and watches outbox lag. Adds sweepers and alerts for stuck states. Credits the one-database design at this volume.

## Traps

- Read the stock, check it, write it back.
- A distributed lock (Redlock) as the oversell guard. A lock that expires during a pause re-opens the race, and a conditional update needs no lock.
- Two-phase commit across the services and the provider.
- "Kafka has exactly-once, so we cannot double charge." It covers Kafka reads and writes, not the provider call or Postgres.
- A timeout treated as a failure (release the stock) or as a success (ship).
- A new idempotency key on each retry of a timed-out call. The reverse is one key per order, which replays the first decline for every later attempt.
- The redirect back from the bank taken as proof of payment.
- Decrementing only at payment for a flash SKU, or holding stock at add-to-cart.
- Redis TTL keys as the only expiry, or a Redis counter as the only record with no durable holds.
- Commit, then publish to Kafka in the same request.
- A `SELECT` for the key and then an `INSERT`, in place of a unique index.
- "Add replicas or shards" for the flash sale. One hot row stays one hot row.
- A dozen services for 175 orders per second.
