---
id: c2-payment-system
track: hld
title: Payment/Transaction System
difficulty: hard
tags: [idempotency, ledger, outbox, state-machine, reconciliation, webhooks]
tracker:
  section: "### C2. Classic HLD Problems"
  bullet: "Payment/Transaction System"
notesFile: notes/c2-payment-system.md
---

## Opening prompt

Let's design the payment service for an online marketplace. Buyers pay by card through an outside payment provider. Where would you like to start?

## Hidden facts

Reveal a fact only when the candidate asks about it, or asks a question whose honest answer needs it. Never volunteer the list.

Terms: a **payment** is one attempt to pay for one order, so an order can have several. A **capture** is the provider taking the money. We are the payment service. The order service calls us, and support tools call us for refunds. "The provider" is the outside payment service provider.

- **Scope:** cards and wallets, one provider, one currency (USD), amounts in whole cents. The create call charges at once: there is no separate hold step in version one. The provider holds card data, so we keep only its token. Service-to-service auth is out of scope. The candidate picks the tech: managed Postgres, Kafka and Redis are all available.
- **Orders and splits:** one payment pays for one order. An order has about 2 sellers. For each seller, the order service sends what we owe the seller and our commission on that share. The parts add up to the order total. The average order is $40.
- **Volume:** 1 million payment attempts a day, about 90% successful. About 30% need a bank step (3-D Secure): the provider sends the buyer to their bank and back. The evening peak is about 5 times the daily average.
- **Refunds:** about 5% of captured payments are refunded (about 45,000 a day), most in full. A payment can have several partial refunds, up to 180 days after capture. A refund belongs to one seller, so a full refund of a two-seller order is two refunds. That makes about 90,000 refunds a day. A refund cannot be more than what is left of that seller's part. It comes out of that seller's share, and our commission on it comes back in the same proportion. A seller's balance can go negative.
- **Refund calls:** a refund call works like the create call. It takes an `Idempotency-Key` and our `reference` (the refund id), and it has the same 24-hour key memory, the same lookup and the same 60-second rule. It answers `pending`, and the result comes by webhook, usually within minutes. After `refund.succeeded`, the provider can still send `refund.failed` days later, when the bank rejects the refund.
- **Out of scope:** payouts and bank matching (we only track what we owe), fraud scoring, disputes (one line on `dispute.opened` is enough), tax, saved cards and other currencies.
- **Keys and the buyer's screen:** the order service makes an idempotency key when the buyer taps Pay, and keeps it for that attempt. It can retry the same call for up to 24 hours. A new try after a decline gets a new key. The checkout page waits up to 10 seconds, then shows "confirming your payment" and keeps polling.
- **Order rules:** an order has at most one open payment (`pending` or `requires_action`), and at most one `succeeded` payment. A second attempt on an order that is already paid must not charge, even under a new key (for example from a stale browser tab). A payment that succeeds after its order was cancelled or expired is refunded in full, automatically. The order service confirms an order only on `payment.succeeded`, and must hear of it within 5 seconds at p99 after our commit.
- **Create call:** it takes an `Idempotency-Key` header and our `reference` (the payment id). The provider remembers a key for 24 hours. The same key and body return the first result, even a failure. The same key with another body is an error. A call whose key is still running gets a 409 and starts nothing.
- **Latency and errors:** p50 0.8 seconds, p99 4 seconds. About 1 call in 2,000 (0.05%) ends with a timeout, a 5xx or a dropped connection and no usable answer. A decline is a normal answer with a decline code. A 4xx (bad request, or 429) means the provider did not process the call. A 429 is safe to resend with the same key after a short wait. A bad request is final. A 5xx or a dropped connection can come after it did. The provider drops a call not finished within 60 seconds and never finishes it later.
- **Lookup:** `GET` by reference returns the charge and its state (`succeeded`, `failed` or `requires_action`). Once 60 seconds have passed since the call, an empty answer is exact: no charge was made. Before that, it proves nothing.
- **3-D Secure:** the create call returns `requires_action` and a redirect URL. The provider expires an unfinished payment after 15 minutes and sends `payment.expired`. It has no cancel call for a payment in the bank step. A buyer who leaves the bank page can return to the same redirect URL within those 15 minutes.
- **Limits and uptime:** 1,000 calls a second in total, across every call type, and 429 above that. The provider is up about 99.9%. A degraded period of 10 to 60 minutes comes about once a quarter.
- **Webhooks:** `payment.succeeded`, `payment.failed`, `payment.expired`, `refund.succeeded`, `refund.failed`. Each has a unique event id and an HMAC signature with a timestamp. Delivery is at least once and in no fixed order, and an event can arrive before the create call returns. The provider waits 10 seconds for a 2xx, then retries with backoff for 3 days. Our endpoint can be down for hours.
- **Report:** a daily CSV, ready by 06:00 UTC for the previous UTC day: one line per capture and per refund, with provider id, our reference, amount, fee, state and a settlement batch id. The fee is about 3% plus 30 cents per capture. The provider takes it from the payout, and it shows only on the report. A refund line has no fee, and the provider keeps the fee of the original capture.
- **Never events:** never charge a buyer twice for one order. Never lose a charge: if the provider took money, we know within 24 hours, and the buyer gets the order or a refund. The books always balance, and nobody edits a money record.
- **Durability and availability:** losing a committed payment is not acceptable, even if the primary database dies. In our environment, a commit that waits for a second copy in another zone takes about 2 ms. The API targets 99.95%, with under 100 ms of our own overhead at p99. One region, three zones. The 99.95% measures our own service. A provider outage does not count against it, but our API must still answer fast and clearly. Payments, refunds and ledger lines are kept 7 years. Balance reads can be a few seconds stale.

## Expected requirements

Core, functional:
1. Create a payment for an order with its seller split, and answer with its status. *Ask: What does a caller send to take a payment, and what comes back?*
2. Handle 3-D Secure and the provider's webhooks; read a payment's status. *Ask: What can the provider send back, and how does a caller check a payment?*
3. Tell the order service once, in effect, how each payment ended. *Ask: How does the order service learn how a payment ended?*
4. Refund in full or in part, more than once, up to the captured amount. *Ask: Can a payment be refunded, and what limits that?*

Core, non-functional:
1. Never charge twice for one order; never lose a charge; none unknown past 24 hours. *Ask: What is the worst that could happen to a customer's money?*
2. The books always balance. Money records are append-only. *Ask: What must always be true about the money records?*
3. Zero data loss on primary failure; 99.95% available; our overhead under 100 ms at p99. *Ask: What must survive a failure, and how fast and available must we be?*
4. About 1 million attempts a day: 12 a second on average, 60 at peak. *Ask: How many payments do we take, and when is the busiest time?*
5. Every effect happens once, although every delivery is at least once. *Ask: What if the same message arrives twice?*

Extras (credit when they name one, never a gap):
- The answer is `succeeded`, `failed`, `requires_action` or `pending`.
- A refund for one seller is capped at that seller's part.
- Keep a double-entry ledger: what we owe each seller, our commission, the provider's fees.
- Reconcile with the provider's daily report.

## Capacity math

- **Rate and writes:** 1 million attempts a day is about 12 per second (1,000,000 / 86,400 = 11.6) and about 60 at the evening peak. A payment makes about 9 row writes in 3 commits: the `pending` row (1), one transaction with the status update, ledger header, 4 ledger lines and outbox row (7), and the stored webhook event (1). Peak is about 540 row writes and 180 commits per second, which means one stateless API tier and one Postgres primary carry it. Scale is not the problem. Correctness is. The order service must hear of a result within 5 seconds, so an outbox relay that polls every second is enough.
- **Calls in flight:** a provider call takes about 1 second on average, so 60 calls a second keep about 60 in flight (rate times time), and 240 if every call took 4 seconds. This means no connection or transaction stays open across the call (a pool of 50 to 100 would run dry), and the provider client needs its own concurrency limit. A timeout of about 8 seconds fits: above the 4-second p99, under the buyer's 10-second wait, far under the provider's 60-second drop time.
- **Unknown outcomes:** 0.05% of 1 million is about 500 a day, one every 3 minutes (86,400 / 500 = 173 seconds), which means a timeout is routine and the resolver runs all day, with a metric and an alarm. The exact lookup works 60 seconds after the call, and a same-key replay returns the first result for 24 hours only. So the first check runs at about 90 seconds. An answer from the lookup, empty or not, settles the payment. Later checks happen only when the lookup itself fails, and they back off (5 minutes, 30 minutes, 2 hours, then every 6 hours). The next-check time lives in the payment row, not in memory.
- **Webhooks:** 1 million final results plus about 90,000 refund results (45,000 refunded payments, about 2 refunds each) is about 1.09 million events a day, about 13 per second and about 63 at peak, which means one small endpoint is enough. The limits are the 10-second answer time and the 3-day retry window, so store the event, answer 200, then process.
- **Ledger size:** a capture posts 4 lines (1 debit, 2 seller credits, 1 commission credit) at once and 2 fee lines the next morning. A refund posts 3. So 900,000 × 6 + 90,000 × 3 is about 5.7 million lines a day and about 2.1 billion a year. At about 150 bytes a line with indexes, that is about 310 GB a year. Each posting also has a header row (about 1.9 million a day at about 100 bytes), which adds about 70 GB a year. Payment rows (about 500 bytes) add about 180 GB a year. The total is about 560 GB a year and about 3.9 TB over 7 years. This means one Postgres primary works if the ledger lines are partitioned by month: about 13 months online (about 0.6 TB), older months archived. A unique index on a partitioned table must contain the partition key, so the unique keys on payments, refunds and headers live in ordinary tables that hold only the online window, and older rows move to the archive. No sharding in version one.
- **Hot rows:** every capture debits `psp_receivable` and credits `platform_revenue`: 54 captures a second at peak (60 × 90%) on each row. If each account keeps a balance column, one row changes one transaction at a time, so with a 2 ms commit it tops out near 500 updates a second (1 / 0.002). A balance column has about 9 times headroom today, which means it breaks first at about 10 times the load (first curveball).
- **Reconciliation:** the report has about 990,000 lines (900,000 captures, 90,000 refunds) of about 200 bytes, about 200 MB, which loads in about 100 seconds at 10,000 lines a second. The books move about $36 million a day (900,000 × $40), and a 1 in 10,000 error is 90 payments, about $3,600, a day, which means the check must be automatic and daily. A nightly batch job with a SQL join is enough.

## API and entities

External API (callers are the order service, and support tools for refunds):
- `POST /payments` with header `Idempotency-Key` and `{ orderId, amount, splits: [{ sellerId, sellerAmount, commission }], paymentToken, returnUrl }` returns `201 { paymentId, status, redirectUrl?, failureCode? }`. The outcome is in `status`, not the HTTP code. A repeated key returns the stored result. `422` for the same key with a different body, or parts that do not add up. `409` when the order already has an open or paid payment under another key.
- `GET /payments/{paymentId}` returns `{ status, amount, refundedAmount, redirectUrl?, failureCode? }`.
- `POST /payments/{paymentId}/refunds` with `Idempotency-Key` and `{ amount, sellerId }` returns `201 { refundId, status }`. `422` when the amount is more than that seller's refundable rest, `409` when the payment has not succeeded.
- `POST /webhooks/provider` checks the signature, stores the event, answers `200`.
- Events out: `payment.succeeded`, `payment.failed`, `payment.expired`, `refund.succeeded`, `refund.failed`, each with a unique `eventId`.
- `GET /ledger/accounts/{accountId}/balance` serves finance and sellers.

Core entities:
- `Payment { paymentId, clientId, idempotencyKey, requestHash, orderId, amount, splits, status, failureCode?, redirectUrl?, providerChargeId?, refundedAmount, nextCheckAt?, createdAt }`: unique on `(clientId, idempotencyKey)`, with a partial unique index on `orderId` for the live statuses (`pending`, `requires_action`, `succeeded`), so an order has one open or paid payment. `splits` holds each seller's part and what has been refunded from it.
- `Refund { refundId, paymentId, idempotencyKey, amount, sellerId, status, nextCheckAt? }`
- `InboxEvent { providerEventId, type, body }` and `OutboxEvent { eventId, type, payload, publishedAt? }`
- `Account { accountId, type }`: `psp_receivable`, `seller_payable:<id>`, `platform_revenue`, `psp_fees`
- `LedgerTransaction { transactionId, sourceType, sourceId }`, unique on `(sourceType, sourceId)`. `LedgerEntry { transactionId, accountId, direction, amount }`, append-only. `BalanceSnapshot { accountId, upToEntryId, balance }`.
- `ReconciliationItem { reportDate, providerChargeId, kind, detail, resolution? }`

## Reference design

```
 Order service ── POST /payments + Idempotency-Key ──> Payment API (stateless, many)
   1. T1: insert Payment(pending), unique (clientId, key), nextCheckAt = now + 90 s, commit
   2. call the provider with no transaction open: key = reference = paymentId, timeout 8 s (only while the row is under 30 s old)
   3. T2, one Postgres transaction, compare-and-set on status:
        payment status + ledger transaction and lines (on success) + outbox row
   4. reply to the caller with the status

 Provider ── webhook ──> Webhook endpoint: verify signature, insert event id (unique), answer 200
                              └──> processor: runs the same T2 (a duplicate or late event changes nothing)

 Resolver (claims due rows with SKIP LOCKED): pending rows past nextCheckAt, requires_action rows at 20 min ──> look up ──> T2
 Outbox relay (polling or change capture) ──> Kafka ──> order service (inbox row + effect, one transaction)
 Refunds: the same pattern with their own key, row and states.   Status reads go to the primary.
 Database: one primary with a synchronous standby in another zone (a commit waits for it, about 2 ms) and automatic failover.
 The API tier runs in all three zones.
 Every day: provider report ──> reconciliation job ──> mismatch table, and fee lines in the ledger
```

```
 pending ──────────────────────────> succeeded
    │  └────────────────────────────> failed       (declined, or lookup empty 60 s after the call)
    └──> requires_action ──────────> succeeded
              ├────────────────────> failed
              └────────────────────> expired      (provider event after 15 minutes)

 A timeout, a 5xx or a crash leaves the row in pending. The resolver owns it through nextCheckAt.
 Terminal: succeeded, failed, expired. Moves are one-way compare-and-set updates:
   UPDATE payments SET status = $new WHERE id = $id AND status IN ($allowed)    -- 0 rows: someone got there first
 Refund: pending ──> succeeded | failed, and succeeded ──> failed when the provider reports a later bank rejection
```

Walk one timeout: the call times out at 8 seconds, the API answers `pending`, and the page shows "confirming". Nothing is marked failed. At 90 seconds the resolver looks up the reference. A found charge goes through T2. An empty answer means no charge was made, so the payment becomes `failed` and the buyer can try again. A webhook that arrives first does the same job through the same T2.

Crash points (steps: 1 insert, 2 provider call, 3 T2, 4 publish, 5 order service applies the event). No row below can lead to a second charge, because the provider key is the payment id and an order has one open or paid payment.

| Failure | Left behind | Repaired by |
|---|---|---|
| Before 1 commits | nothing | the caller retries with the same key |
| After 1, before 2 | `pending`, no charge | resolver: lookup empty after 60 s, so `failed` |
| After 1, a stall of over 90 s, then 2 | the resolver closed the row as `failed`, and then a charge appears | the API sends the call only while the row is under 30 s old, which keeps the 90 s lookup exact. A stall that still slips through shows up as a success webhook for a closed payment. It is not applied to the order. It is refunded in full by its charge id, automatically, and an alert fires |
| During or after 2 (timeout, lost answer, crash before 3) | `pending`, charge may exist | webhook, or resolver lookup |
| After 3, before 4 | `succeeded`, outbox row committed | the relay publishes later |
| Event delivered twice at 5 | effect applied once | inbox row keyed by event id |
| Our webhook endpoint is down | `pending` | provider retries for 3 days, resolver, daily report |

Where a duplicate can enter, and what stops it:

| Source | Stopped by |
|---|---|
| Buyer double tap, caller retry | unique `(clientId, idempotencyKey)`, stored result replayed |
| Our own retry of the provider call | provider key = payment id |
| A second attempt on an order already paid (stale tab, new key) | the partial unique index on `orderId` over the live statuses |
| Webhook sent twice or late | unique provider event id, one-way compare-and-set |
| Webhook and API response race to post the result | ledger post in the same transaction as the status change, unique `(sourceType, sourceId)` |
| Outbox relay publishes twice | consumer inbox row keyed by event id, in the same transaction as its effect |
| Refund retried or raced | its own key, and a conditional update of `refundedAmount` |

Ledger lines for one order of 10,000 cents. S1 has gross 6,000 (seller 5,400, commission 600). S2 has gross 4,000 (seller 3,600, commission 400):

```
 Capture:   debit  psp_receivable       10,000
            credit seller_payable:S1     5,400
            credit seller_payable:S2     3,600
            credit platform_revenue      1,000
 Next morning, the report shows a fee of 330 (3% of 10,000 is 300, plus 30):
            debit  psp_fees                330
            credit psp_receivable          330
 Refund of 2,000 for S1 (seller part 1,800, commission part 200):
            debit  seller_payable:S1     1,800
            debit  platform_revenue        200
            credit psp_receivable        2,000
```

## Accepted alternatives

- **Where the provider call runs.** Inline after the `pending` commit (the reference), or from a worker that reads an outbox command row while the API answers `202`. Judge the crash story.
- **Settling an unknown outcome.** Look up by reference after the 60 seconds, or replay the same call with the same key inside 24 hours (a replay gets a 409 while the first call still runs, and it also completes a charge the provider never made, so check the buyer still waits). A hybrid is fine, and so is an explicit `unknown` state.
- **Idempotency store.** A unique index on the payment row, or a keys table kept at least 24 hours. Redis can sit in front, but Postgres decides. Redis alone fails: eviction forgets keys, and it cannot join the transaction.
- **State machine.** A status column with compare-and-set, an event-sourced payment, or a durable execution engine with timers, if the candidate explains crash recovery.
- **Ledger store and balances.** Postgres tables or a purpose-built ledger database. Balances from a snapshot plus recent lines, from rows updated in the same transaction (fine at normal load), or from sub-accounts summed on read.
- **Smaller choices.** Relay: a polling relay with `SKIP LOCKED`, or change data capture from the write-ahead log, on Kafka, RabbitMQ or SQS. Webhooks: inline if the whole handler fits well inside 10 seconds, otherwise stored and queued. Reconciliation: a nightly SQL job or a streaming match. Refund limit: a row lock, a conditional update or a serializable transaction.
- **Database and second provider.** Relational fits because the status change and ledger lines commit together. A key-value store with multi-item transactions works if the ledger invariants hold. A second provider is not required, and if proposed it takes new payments only.

## Deep dives

### Idempotency end to end, and exactly-once effects
- **Bad:** a fresh UUID per request, so a retry is a new payment. The order id as the key, so a buyer cannot retry after a decline. A Redis `GET` then `SET`, where two concurrent calls both pass. No key on the provider call, so our own retry after a timeout charges twice.
- **Good:** one key per attempt, reused on every retry. A unique `(clientId, key)` index on the payment row, plus a hash of the request: the same body gets the stored result, a different body gets `422`. The provider call carries its own key. Webhooks are deduped by event id.
- **Great:** the provider key comes from the payment id, not the caller's key, so it stays stable across our retries and cannot clash between callers. Names every place a duplicate enters (the table above) and gives each an owner who dedupes in the same transaction as the effect. Says exactly-once delivery does not exist, and at-least-once delivery with an idempotent receiver gives an exactly-once effect. Knows a key names one attempt, so a decline is final, and that the provider forgets a key after 24 hours.

### The dual write, unknown outcomes and the state machine
- **Bad:** call the provider, then write the row, so a crash leaves a charge with no record. Or hold a transaction across the call "to make it atomic": a rollback does not undo a charge, and 60 calls in flight hold 60 connections. Or treat a timeout as a failure and retry with a new key.
- **Good:** commit `pending` first. Call with no transaction open and a timeout of about 8 seconds. Apply the result in a second transaction with a compare-and-set on status. A timeout leaves `pending`, and a resolver settles it by lookup. Webhooks are verified, stored, answered fast and applied through the same transaction.
- **Great:** states the invariant: no provider call without a committed row, and no terminal state without the provider's word (the one exception is an empty lookup 60 seconds after the call). Sorts errors into definitive (decline, bad request), not processed (429, connection refused: resend with the same key after a wait, never mark failed) and unknown (timeout, 5xx, reset after send). Sees that a webhook can beat the API response, and the same compare-and-set makes the second arrival a no-op. Keeps `nextCheckAt` on every pending row, so the resolver is the single recovery path, with an alarm on the oldest one. Sweeps stale `requires_action` rows by asking the provider at 20 minutes. Sees two dual writes: database and provider (pending row first), database and event bus (outbox).

### Double-entry ledger and refunds
- **Bad:** a `balance` column updated in place. Floats. A single signed amount with no other side. Fixes by UPDATE or DELETE. A refund as a smaller amount on the payment row, or two partial refunds that race past the captured amount.
- **Good:** immutable lines in integer cents. Debits equal credits per transaction, checked in code and by the database. Lines post in the same transaction as the status change. A mistake gets a reversing entry. A refund reverses the seller's share and our commission in the original proportion. `refundedAmount` grows through a conditional update. A refund has its own key, row, states and unknown-outcome handling.
- **Great:** the post is idempotent through the unique `(sourceType, sourceId)`. Rounding is a rule: round the commission part and give the seller part the rest. A refund that fails later gets a compensating transaction. Fees come from the report as their own transactions. Balances are a snapshot plus recent lines, so no mutable balance sits on the payment path and there is no hot row. The snapshot job stays a few seconds behind the newest lines, because a line with a lower id can commit later. A nightly check proves debits equal credits and `psp_receivable` ties to the report.

### Reconciliation with the provider's report
- **Bad:** "webhooks are reliable, so we do not need it". Or compare daily totals only, where errors cancel. Or fix a mismatch by editing a row.
- **Good:** a daily job loads the report, matches each line to a payment or refund by provider id and reference, compares state and amount, stores each difference and alerts.
- **Great:** three buckets, each with a safe action. (1) In the report, not ours: a charge we have no record of. Alert, then refund it or create the record after review. (2) Ours as `succeeded`, not in the report: the worst case, since we may have shipped unpaid. Hold fulfilment and investigate. (3) In both, with a different state, amount or fee: alert. A `pending` row the report shows as captured goes through the normal transition, never a direct edit. Fixes post adjustment transactions. Days are cut by the provider's batch ids, not our clock, and a day can be re-run with the same result. Expected outcome: the roughly 500 daily unknowns are settled by the resolver in minutes, and the report is the independent proof that none was settled wrongly.

## Curveballs

Use one, at the extension point, unless the candidate already handled it.
1. **Flash sale (load, hot spot):** "A flash sale starts. For 10 minutes buyers try to pay 600 times a second, and about 40% of the orders are for one seller. The provider allows 1,000 calls a second, and a commit takes about 2 ms. What breaks first?" Expect: 600 is under 1,000, so the provider limit is not first. In-flight calls rise to about 600, so the provider client needs a concurrency limit, and the API sheds the excess fast. The database as a whole copes: about 5,400 row writes and 1,800 commits a second fit one well-sized primary. If balances are columns updated inside the payment transaction, the shared rows do not: 540 captures a second (600 × 90%) update `psp_receivable` and `platform_revenue`, and one row tops out near 500. Locks queue up, calls time out and `pending` rows pile up. Fix: no balance update inside the payment transaction. Use a snapshot plus recent lines, a job that rolls the new lines into each balance once a second, or sub-accounts (16 give about 34 updates a second each) summed on read. A candidate who already uses a snapshot plus recent lines has no hot row, and the answer is the in-flight limit and fast shedding. Stretch: the busy seller's row takes about 216 a second (540 × 40%) and survives, while the platform rows do not. Sharding by payment id does not help by itself, because every shard still posts to the same platform accounts. Per-shard account rows summed on read do work, and that is the sub-account fix.
2. **Provider outage (failure):** "The provider degrades for 30 minutes at the evening peak. 30% of calls time out after 8 seconds, 20% return 503 at once and the rest work. Buyers keep tapping Pay and the order service retries. What happens?" Expect: payments stay `pending`, not failed. A circuit breaker opens on the timeout and error rate. While it is open, the API answers "temporarily unavailable" before it creates any row, so the caller retries later with the same key. Buyers with open payments see "confirming". Only the payments in flight before the breaker opened are unknown, and they settle by lookup under the resolver's own rate limit. Without a breaker there would be about 54,000 (60 × 50% × 1,800 seconds), which is about 9 minutes of lookups at 100 a second. The webhook backlog arrives in a burst: answer fast, process later, dedupe. Stretch: never send an unknown payment to a second provider, because the first may have charged. A second provider takes new payments only. A 503 does not prove nothing was charged. In-flight calls rise from about 60 to about 175 (60 × (30% × 8 s + 50% × 1 s)), so a per-provider limit protects the rest of the service.
3. **Charge on shipment (change in requirements):** "Product wants to hold the buyer's money at checkout and charge it when the seller ships, up to 7 days later. An order can ship in several parcels, and each parcel is charged when it ships. What changes?" Expect: a new `authorized` state (funds held, nothing captured) that counts as live for the one-payment-per-order index, a new `payment.authorized` event so the order service can accept the order, and a capture per parcel. Each capture is its own provider call with its own key (from the payment id and the parcel), its own split from the order service, its own unknown-outcome handling and its own ledger transaction. The captured total never passes the authorized amount. A `voided` state covers a cancel before capture. If asked: the provider allows several partial captures of one authorization, each with its own key, and it expires an authorization after 7 days, so a sweep at day 6 captures or voids it. Nothing posts to the ledger at authorization, because no money moved. Refunds apply to captured money only. Stretch: the state machine is a table of allowed moves, so a new state is a data change. A silent authorization expiry is caught by the sweep and the report, and the order never ships unpaid.

## Level bar

Hire bar must show:
- Asks what the provider offers (idempotency keys, webhooks, lookup, report), and names the two never events: a double charge and a lost charge.
- The rate math (about 12 per second, about 60 at peak), ending in "which means one database is enough and the hard part is correctness".
- An idempotency key per attempt under a unique index, with the stored result returned on a repeat, and a stable key on the provider call, so our own retry cannot charge twice. Says exactly-once delivery does not exist, and at-least-once delivery needs idempotent receivers.
- Writes the `pending` row before the provider call, and keeps the call outside any database transaction. Says a timeout is not a failure, and settles it by lookup, same-key replay or webhook.
- A one-way state machine. Webhooks verified and deduped by event id.
- An append-only double-entry ledger in integer cents, posted with the status change. A refund is a reversal.
- When probed: a daily check against the provider's report, a fix for at least one crash point, and a synchronous standby in another zone so a primary failure loses no committed payment.

Stretch signal:
- Names the dual write and the unknown outcome as the hard part in the first ten minutes, unprompted, and walks every crash point.
- Uses the 60-second and 24-hour facts correctly, and says only the provider's word moves a payment to a terminal state.
- Lists every dedupe point and puts each in the transaction of its effect. Derives the provider key from the payment id.
- Spots the hot ledger accounts and takes balance updates off the write path. Knows sharding by payment id does not help by itself.
- Splits reconciliation into three buckets with a safe action each, and books fees from the report.
- Handles refund races, a refund that fails later and a negative seller balance.
- Never routes an unknown payment to a second provider.
- Uses rate times time to show why no connection is held across the provider call.

## Traps

- "Kafka has exactly-once, so there are no duplicates." That covers reads and writes inside Kafka, not an HTTP call to the provider or a webhook.
- "The call timed out, so mark it failed and let the buyer retry." A retry with a new key charges twice if the first call went through.
- One transaction around the provider call and the database write, or the provider call first and the row after. There is no two-phase commit with an HTTP API, a rollback does not refund, and a crash between the two steps leaves a charge with no record.
- Idempotency in Redis alone, or a check followed by an insert with no unique constraint.
- A random key per request (no protection), or the order id as the key (no second try after a decline).
- Trusting webhooks: no signature check, no event-id dedupe, or an assumption that events arrive in order.
- Skipping reconciliation because "we have webhooks", or comparing daily totals only.
- A balance column changed in place, floats for money, a refund as a smaller amount on the payment row, or fixing a mistake with an UPDATE.
- "Shard by payment id to scale the ledger." The shard key alone does not remove the hot accounts: every shard still posts to them.
- Failing an unknown payment over to a second provider.
- Reading the status from a lagging replica right after the create.
- A service per box, and a queue before the provider call "for scale", at a peak of 60 requests a second. A worker that sends the call from a stored command row for crash safety is fine (see the alternatives). Scale is not the reason.
