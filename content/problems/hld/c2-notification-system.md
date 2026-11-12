---
id: c2-notification-system
track: hld
title: Notification System
difficulty: medium
tags: [message-queues, fan-out, idempotency, rate-limiting, retries, scheduling]
tracker:
  section: "### C2. Classic HLD Problems"
  bullet: "Notification System"
notesFile: notes/c2-notification-system.md
sources:
  - title: "Firebase Cloud Messaging: Throttling and quotas"
    url: "https://firebase.google.com/docs/cloud-messaging/throttling-and-quotas"
  - title: "Firebase Cloud Messaging: Topic messaging"
    url: "https://firebase.google.com/docs/cloud-messaging/topic-messaging"
  - title: "LinkedIn Engineering: Air Traffic Controller, member-first notifications at LinkedIn"
    url: "https://www.linkedin.com/blog/engineering/messaging-notifications/air-traffic-controller-member-first-notifications-at-linkedin"
confidence: "The FCM documentation sets a per-project send quota whose default is below this problem's figure, so the 15,000 a second for FCM assumes a raised quota; the APNs figure and the rule that each gateway throttles on its own are this problem's assumptions. The same documentation backs topic messaging as a fit only for broadcasts that are the same for everyone. A production write-up of a large notification gateway agrees on caller quotas, per-user caps and channel decisions, and adds a design with local state partitioned by member, accepted here as an alternative. It also covers digests and aggregation, which this problem leaves out. No first-party source gave numbers for SMS or email providers, so those limits, the traffic mix and the receipt behaviour are this problem's own assumptions."
---

## Opening prompt

Let's design the notification system for a large consumer app. It sends push notifications, SMS and email. Where would you like to start?

## Hidden facts

Reveal a fact only when the candidate asks about it, or asks a question whose honest answer needs it. Never volunteer the list.

- **Callers and channels:** internal services only: login (OTPs), orders, payments, and a marketing tool for campaigns. We send push (APNs for iOS, FCM for Android), SMS and email. The caller names the channels, or the template's defaults apply. No fallback from one channel to another in the first version. Each caller has a request quota, a ceiling above its normal peak: login 2,000 requests per second, orders 10,000, payments 5,000. Campaigns use the campaign API, not per-user requests.
- **Users:** 50 million registered, 20 million daily active. 40 million of them allow push, on 60 million devices; a push goes to every device the user has. 45 million have a verified email, and 20 million of those opted in to marketing email. Everyone has a phone number, because login is a phone number plus an OTP. Roughly half the push devices are iOS.
- **A typical day** (one count is one message to one device, number or address): 400 million pushes (280 million triggered, plus two broadcasts of 60 million devices each); 30 million emails (10 million transactional, plus one 20 million marketing campaign); 10 million SMS (6 million OTPs, 3 million transactional, 1 million marketing).
- **Peaks:** triggered traffic runs at 3 times its daily average from 7 to 10 PM. Push broadcasts start at noon and at 7 PM. The email campaign starts at 10 AM.
- **Templates and categories:** about 2,000 templates, each with a version per channel and per language (5 languages; English is the fallback). Callers pass a template id and variables, and we render. An edit creates a new version. Each template belongs to one category: security (OTPs, login alerts), transactional (orders, payments) or marketing (offers). The category sets the priority; a caller cannot raise it.
- **Latency and durability:** security messages reach the provider within 1 second at p99, transactional within 10 seconds. Marketing is best effort, but a push broadcast must finish within 1 hour of its start and the email campaign within 4 hours of its start. An accepted request must never be lost; the accept API targets 99.99%.
- **OTPs:** the login service makes the code and puts it in the request. A code is valid for 5 minutes. An OTP SMS not sent within 60 seconds is useless: drop it and mark it failed. The user can tap resend after 30 seconds, and a resend carries the same code.
- **Expiry and retries:** a caller can set an expiry. The default is 60 seconds for an OTP, 5 minutes for other security messages, 1 hour for transactional and 24 hours for marketing. A message past its expiry is dropped and marked failed. Retries stop at the expiry.
- **Preferences:** on or off per channel and per category. Security and transactional cannot be turned off, on any channel; the switches change marketing only. Marketing is on by default for push and email, and off for SMS until the user opts in. An opt-out must take effect within 1 minute, even for a broadcast already running.
- **Quiet hours and caps:** quiet hours default to 10 PM to 8 AM in the user's time zone, and the user can change them. They hold marketing only. A held message goes out when quiet hours end, unless it has expired. At most 3 marketing pushes per user per day, counted per notification, so a push to two devices counts once; extra ones are dropped. No cap on marketing email or SMS; the marketing tool plans those.
- **Ordering:** no strict order. Two messages to one user a few seconds apart may arrive swapped, and that is acceptable.
- **Provider limits:** APNs accepts about 15,000 pushes per second from us, and FCM about 15,000. Each gateway throttles on its own above its limit. SMS provider A (primary, cheaper) takes 500 per second. Provider B (backup, about 30% dearer) takes 300 per second. One email provider takes 2,000 per second. There is no backup email provider; email can wait out a short outage.
- **Provider behaviour:** an error is throttling, temporary or permanent (invalid number, uninstalled app, hard bounce). Some calls time out, and then nobody knows whether the message went out. SMS and email providers do not deduplicate: a repeated call sends again. Push takes a collapse id: a second push with the same id replaces the first on the device. Keep mailing bounced addresses and the email provider suspends us.
- **Receipts:** SMS providers post a delivery receipt to our webhook, usually within a minute, but sometimes hours later, twice, or never. The email provider posts delivered, bounced, opened and complaint events. Push gateways only confirm they accepted a message; "opened" comes from our app.
- **Duplicates:** callers retry on timeout. Every request carries an idempotency key. A repeated key within 24 hours must not produce a second notification.
- **Scheduling:** a caller can schedule a send up to 30 days ahead, and cancel it until it goes. It must go out within 1 minute of its time. About 30 million wait at any time. Times cluster on round minutes: about 1 million notifications, mostly push reminders, fall due at 9:00 AM. At 1.5 devices a user, that is up to 1.5 million pushes.
- **Campaigns:** the marketing tool picks a segment: a stored list of up to 50 million user ids, built by the data team. It sits as a file in object storage, about 400 MB at 8 bytes an id, and the campaign service can read it in ranges. A cancelled campaign must stop sending within 1 minute. A full-size push broadcast is the 60 million devices above; opt-outs make it smaller.
- **Status:** callers do not wait for delivery; they read a notification's status by id later. Support lists what a user got in the last 30 days. Marketing sees totals per campaign (targeted, suppressed, sent, delivered, opened, failed), at most 5 minutes old. Keep message status for 30 days and campaign totals for a year.
- **Regions:** one country and one time zone today, served from one region.
- **Out of scope:** an in-app inbox, A/B tests, building the segment and template tools, and rich media.

For the interviewer: on the regions, the design should still store a time zone per user.

For the interviewer: on the out-of-scope items, one line each is enough.

## Expected requirements

Core, functional:
1. Accept a send request (user, template, variables, channels, time) and return an id. *Ask: What does a caller give us to send one message, and what comes back?*
2. Send a campaign to a segment of up to 50 million users. *Ask: Do we send to one user at a time, or to whole groups?*
3. Apply preferences, quiet hours and the marketing cap before sending. *Ask: What can stop a message from reaching a user?*
4. Track the status of each send from sender results and provider receipts; callers read it by id. *Ask: How does a caller learn what happened to a message?*

Core, non-functional:
1. About 440 million sends a day, with broadcast bursts close to the push quota. *Ask: How many messages a day, and how big is the biggest broadcast?*
2. Security within 1 s at p99, transactional within 10 s; a push broadcast within 1 hour. *Ask: How fast must each kind of message go out, and how long may a broadcast take?*
3. Marketing volume never delays security or transactional messages. *Ask: What if a big marketing broadcast runs next to urgent traffic?*
4. Stay under every provider's limit, and survive the loss of an SMS provider. *Ask: What limits do providers set, and what if one goes down?*
5. An accepted request is never lost, and a retried request never sends twice. *Ask: What if a request is retried, or we crash after accepting it?*

Extras (credit when they name one, never a gap):
- Render each template per channel and language.
- Schedule a send for later, and cancel a scheduled send or a running campaign.
- Totals per campaign, at most 5 minutes old.
- The email campaign finishes within 4 hours.
- An opt-out takes effect within 1 minute, even for a running broadcast.
- A scheduled send goes within 1 minute of its time, and a cancel takes effect within 1 minute.

## Capacity math

- **Average:** 400 million pushes, 30 million emails and 10 million SMS make 440 million sends a day, about 5,000 per second, which means the average is easy. Bursts and provider limits shape the design.
- **The 7 PM broadcast:** 60 million devices in 1 hour is about 17,000 pushes per second. Triggered push averages about 3,200 per second (280 million a day), so about 10,000 per second at the evening peak. Together that is about 26,400 per second. Half the devices sit on each gateway, so each sees about 13,200 per second against its own 15,000, which means the provider quota, not our server count, is the ceiling.
- **Priority inside the quota:** give transactional push first claim (about 5,000 per second on each gateway) and about 10,000 per second is left on each. Each gateway's 30 million devices then take about 50 minutes, which means the 1-hour deadline holds only with a pacer that runs one token bucket per gateway, fills the leftover quota and never competes with transactional push.
- **SMS:** 10 million a day is about 120 per second on average and 350 at the evening peak, which provider A (500) carries alone. At peak, OTPs need about 210 per second and transactional SMS about 105, so about 315, more than provider B's 300, which means a failover to B must shed by priority: OTPs first, then transactional, and marketing SMS waits for A.
- **Email:** the 20 million campaign at 2,000 per second takes 10,000 seconds, nearly 3 hours. Transactional email runs about 120 per second on average and 350 at peak, which means the campaign is paced over hours, and the 4-hour deadline holds only if it leaves a reserved share of the cap (about 400 per second) for order and payment emails: 20 million at 1,600 per second takes about 3.5 hours.
- **Accept path:** 280 million triggered pushes over about 1.5 devices per user is about 190 million requests, so about 200 million requests a day in all. That is about 2,300 per second, and about 7,000 at peak, which means a small stateless API fleet that writes to a durable queue and replies. Fan-out and sending happen after the reply.
- **Lookups and dedupe:** preferences for 50 million users plus 60 million device tokens, at about 200 bytes each, are about 22 GB. Send ids kept 24 hours for dedupe are 440 million at about 100 bytes, about 44 GB. Both fit in a Redis cluster, which means no per-message Postgres reads on the hot path, and a fan-out worker that reads 1,000 users per call needs only tens of calls per second.
- **Status:** at least 2 writes per send (queued, then sent or failed), plus receipts for SMS and email, is about 900 million writes a day: about 10,000 per second on average and over 50,000 per second during the 7 PM broadcast. Thirty days is 13 billion rows (one per send, updated in place), about 4 TB at 300 bytes each, which means a write-optimised store with built-in expiry (Cassandra with a TTL, or daily partitions that are dropped), never a row update in the main Postgres per event.
- **Scheduled sends:** 30 million waiting at about 500 bytes is 15 GB, which fits one Postgres table indexed by due time. The 1 million due at 9:00 must go within a minute, about 17,000 claims per second. After fan-out to devices that is up to 1.5 million pushes, about 750,000 on each gateway. With about 1,500 per second of morning traffic on each, a gateway has about 13,500 per second left, so its share takes about 56 seconds. That means the minute barely holds: workers claim due rows a few minutes early and release them on time, instead of scanning the table at 9:00, and an uneven split between the two gateways pushes the tail past the minute.

## API and entities

External API (callers are internal services):
- `POST /notifications` with `{ idempotencyKey, userId, templateId, variables, channels?, sendAt?, expiresAt? }` returns `202 { notificationId }`. A repeated key returns the same id. `400` for an unknown template or a missing variable. `429` when a caller passes its own quota.
- `DELETE /notifications/{id}` cancels a scheduled send: `204`, or `409` if it already went.
- `POST /campaigns` with `{ idempotencyKey, segmentId, templateId, channels, startAt, finishBy }` returns `202 { campaignId }`. `POST /campaigns/{id}/cancel` stops it.
- `GET /notifications/{id}` returns the status of each send. `GET /users/{userId}/notifications?since=` serves support. `GET /campaigns/{id}/stats` returns the totals.
- From the app: `PUT /users/{userId}/preferences`, and `POST` or `DELETE /users/{userId}/devices` for push tokens. `POST /notifications/{id}/opened` (idempotent) records an open and produces a status event.
- `POST /webhooks/{provider}` takes receipts.

Core entities:
- `Notification { id, callerId, idempotencyKey, userId, templateId, templateVersion, category, variables, sendAt?, expiresAt?, campaignId? }`
- `Send { sendId, notificationId, channel, deviceToken or address, provider, providerMessageId?, status, attempts, lastError }`: one per channel per device or address. It is the unit of sending, dedupe and status.
- `Preference { userId, channel, category, enabled }` and `UserSettings { userId, timeZone, language, quietStart, quietEnd }`
- `Device { userId, token, platform, lastSeenAt }`
- `Template { id, version, category, channel, language, body }`
- `Campaign { id, segmentId, templateId, startAt, finishBy, state, chunksDone, totals }`
- `ScheduledSend { dueAt, notificationId, state }`, which also holds quiet-hour holds and delayed retries

## Reference design

```
 login, orders, payments ── POST /notifications ──> Notification API (stateless, many)
   priority from the template's category; notificationId = hash(caller, idempotency key)
   sendAt later ──> Scheduled sends (Postgres) ──> Scheduler ──┐
   now ──> produce to Kafka, acks from all replicas, reply 202 │
        ▼                                                      │
 Kafka requests.security | .transactional | .marketing <───────┘
        ▼
 Routers, one pool per priority
   preferences, quiet hours, cap, devices (Redis cache, Postgres behind)
   render per channel and language; sendId = hash(notificationId, channel, device)
   (campaign notificationId = hash(campaignId, userId), so a redone chunk makes the same ids)
        ▼
 Kafka send topics, one per channel and priority  <── campaign fan-out workers: chunks of 10,000 users,
   push.*, sms.otp, sms.transactional,                 router checks in bulk, paced to finishBy,
   sms.marketing, email.*                              progress saved per chunk
        ▼
 Senders: dedupe on sendId; marketing sends re-check opt-out and cancel flags (cache at most 30 seconds old);
          token bucket per provider, higher priority first; circuit breaker;
          retries with backoff through delay topics; dead-letter topic after the last try
        ├──> APNs 15,000 per second, FCM 15,000 per second, one token bucket each
        ├──> SMS provider A, 500 per second ── on failover ──> SMS provider B, 300 per second
        └──> email provider, 2,000 per second

 status: routers and fan-out workers (queued, suppressed), senders (sent, failed),
         webhook receiver (delivered, failed on a bounce), app (opened)
           ──> Kafka status ──> status writer ──> Cassandra, 30-day TTL
                            └──> stream counters ──> campaign totals
```

Walk one OTP: the login service posts a request with an idempotency key. The template is in the security category, so the API produces to `requests.security` and replies `202` with an id derived from the caller and the key. A security router skips the preference and quiet-hour checks, renders the SMS and produces one send to `sms.otp`. An OTP sender checks that the send id is new, takes a token from provider A's bucket and calls A with a 2-second timeout. On success it records `sent` with A's message id, and A's receipt later moves it to `delivered`. On a timeout or an open breaker it sends through B with the same code, and gives up once the OTP is 60 seconds old.

Walk one scheduled send: a caller posts a request with a `sendAt` in the future. The API stores a `ScheduledSend` row in Postgres and replies `202` with the notification id. Until the row is due, `DELETE /notifications/{id}` cancels it and answers `204`, and after the send went the same call answers `409`. When `dueAt` passes, the scheduler produces the request to the Kafka requests topic for the template's priority. A router checks preferences, quiet hours, the cap and the devices, renders the message and produces one send per device or address to the channel's send topic, and a send held by quiet hours waits in the same scheduled table. A sender dedupes on the send id, calls the provider and produces the result to the Kafka status topic, where the status writer records it in Cassandra.

Walk the 7 PM broadcast: the campaign service splits a 50 million user segment into 5,000 chunks. A fan-out worker takes a chunk, reads preferences and tokens for its 10,000 users in bulk, drops opted-out and capped users, renders once per language, and produces sends to `push.marketing`. Marketing push senders use only the quota that transactional push leaves, about 20,000 per second, so the backlog waits in Kafka, not in front of OTPs. Because sends can wait in the topic for many minutes, a marketing sender checks the user's opt-out and the campaign's cancel flag again just before each send, from a cache at most 30 seconds old (or one that a preference write invalidates). A finished chunk is recorded, so a crashed worker's chunk is redone, and the same send ids stop duplicates. A cancel sets a flag in Redis that senders check.

## Accepted alternatives

- **Queue technology.** Kafka with a topic per channel and priority, RabbitMQ with a queue per channel and priority, or SQS. Judge the isolation and retry story, not the brand. SQS can delay a message by up to 15 minutes, and RabbitMQ can delay through TTL queues or a delayed-message exchange; Kafka needs delay topics or the scheduled-sends table.
- **Priority.** Separate queues per priority, or a broker with real priority queues such as RabbitMQ. A single Kafka topic with a priority field does not work, because a partition is first in, first out.
- **Where dedupe lives.** Redis `SET NX` with a TTL, a unique index in Postgres, or a conditional insert in Cassandra. Any is fine if it sits right before the provider call and the candidate handles the crash window.
- **Accept path.** Produce to Kafka and then reply, or insert into Postgres with an outbox row in the same transaction and relay it to Kafka. Both are durable. The outbox gives a queryable request record at the cost of one more hop.
- **Status store.** Cassandra or DynamoDB with a TTL, or Postgres partitioned by day with old partitions dropped. Keeping only counts and failures for broadcasts, instead of 60 million rows each, is fine.
- **Scheduled sends.** A Postgres table with `SKIP LOCKED`, a Redis sorted set scored by due time, or a timer service or workflow engine. SQS delays alone stop at 15 minutes, so they cannot cover 30 days.
- **Preference checks.** At send time, from a cache at most 30 seconds old or one that a preference write invalidates. A check only at fan-out is fine only if the fan-out is paced so that no more than about a minute of sends waits in the topic; a long backlog needs the recheck.
- **Preference and device store.** Postgres with a Redis cache, or a key-value store such as DynamoDB or Cassandra. About 22 GB fits either. Local state in a stream processor partitioned by user id (for example RocksDB backed up to a Kafka log) also works: caps and preferences become local reads, but every preference write and every request for a user must reach that user's partition.
- **Provider-side fan-out.** FCM topic messaging reaches every device subscribed to a topic with one call. It fits only a broadcast that is the same for everyone: it skips per-user preferences, quiet hours, the daily cap, language and per-user status, and it covers only the devices on FCM. Accept it for that case if the candidate names those costs. As the whole broadcast design it misses the requirements.
- **Rate limiting.** A shared Redis token bucket, a fixed share of the quota per worker that rebalances when workers change, or adaptive backoff on throttling errors.

## Deep dives

### Priority, provider limits and failover
- **Bad:** one queue for every notification, senders running as fast as they can, and "switch provider when it is down" with no way to detect it.
- **Good:** a topic per channel and priority, each with its own worker pool. A token bucket per provider sized to its limit. A circuit breaker that moves SMS from A to B on errors and timeouts.
- **Great:** transactional traffic has first claim on each quota, and marketing borrows only what is left. Senders lease tokens from Redis in batches: 100 at a time is about 300 Redis calls per second at 30,000 pushes per second over both gateways. The send rate halves on throttling errors and creeps back up. Each provider has its own connection pool, so a slow one cannot stall the rest. Failover sheds by priority, because B is smaller than the evening peak: marketing first, then some transactional, OTPs last. Health includes the delivery-receipt rate, because a provider can accept messages and silently drop them.

### Retries, duplicates and idempotency
- **Bad:** "Use exactly-once delivery." Retrying every failure at once and forever. Deduping only at the API, so a redelivered queue message still sends twice.
- **Good:** an idempotency key checked at the API for 24 hours. At-least-once queues, with a sent-check on the send id before the provider call. Exponential backoff with jitter for temporary errors and throttling, no retry for permanent errors, a maximum number of attempts, then a dead-letter topic. Dead push tokens are deleted and hard-bounced emails suppressed.
- **Great:** ids derived from the key (the notification id from caller and key, the send id from notification, channel and device), so every retry and redelivery collapses onto one id. Names the window that cannot be closed: the call succeeded but the sender died before recording it, or the call timed out. The providers do not deduplicate, so this is a choice per category. Resend an OTP with the same code, because a duplicate costs only a little money and a missing one blocks a login. Give a push a collapse id, so the device shows it once. Do not resend marketing; settle it from receipts. Each category has a deadline: an OTP gives up at 60 seconds and tells the caller. A delayed retry is just a scheduled send.

### Broadcast fan-out and scheduled sends
- **Bad:** the API loops over 50 million users inside the request. Or one job produces 60 million messages at once, with no pacing, no saved progress and no cancel. Or a consumer that sleeps until a scheduled time.
- **Good:** a campaign row. The segment is split into chunks of 10,000 users (5,000 chunks). Workers read preferences and tokens in bulk, filter, render once per language and produce sends to the marketing topics. Progress is saved per chunk, so a crash redoes one chunk. Scheduled sends sit in a Postgres table indexed by due time; workers claim due rows in batches with `FOR UPDATE SKIP LOCKED`; a cancel deletes the row.
- **Great:** the campaign is paced to its finish time inside the marketing share of the quota. A cancel flag in Redis, checked before every send, stops the rest within a minute. Opt-outs are read at send time from a cache at most 30 seconds old, or one that a preference write invalidates, so the 1-minute limit holds. Quiet-hour holds and delayed retries reuse the scheduler. The scheduler claims rows a few minutes early, so the 1 million due at 9:00 are already in memory and go out on the minute. Held marketing gets a few minutes of jitter, so the end of quiet hours at 8 AM is not a spike.

### Delivery status tracking
- **Bad:** `UPDATE notifications SET status = ...` in the main Postgres for every event, or polling the providers for status.
- **Good:** senders and a webhook receiver publish status events to Kafka. A writer stores them by notification id with a 30-day TTL, plus a table by user for support. Campaign totals are counters fed from the stream.
- **Great:** status moves one way only (queued, sent, then delivered or failed, then opened), so a late or duplicate receipt cannot move it back. Receipts match on the provider message id saved at send time. The webhook endpoint stores the event and answers at once, because providers retry slow webhooks. Hard bounces and dead tokens feed a suppression list. Knows that push has no "delivered"; "opened" comes from the app.

## Curveballs

Use one, at the extension point, unless the candidate already handled it.
1. **OTP storm:** "A flash sale starts at 8 PM. Logins jump, and OTP SMS demand goes from about 200 to 1,000 per second for 15 minutes. Your two SMS providers together take 800 per second. What happens to an OTP?" Expect: OTPs on their own topic and workers, with first claim on both providers; marketing SMS paused and transactional SMS delayed; any OTP older than 60 seconds dropped. Stretch: even if OTPs get all 800 per second, a first-in-first-out queue grows by 200 a second, so every OTP that arrives after about 4 minutes waits more than 60 seconds. Serve the newest first, keep one queued OTP per phone number (a resend carries the same code), limit resends per user, and raise provider limits before a planned sale. Interviewer note: this is the load and hot-spot curveball.
   Fits: Priority, provider limits and failover
2. **Slow provider (failure):** "Provider A slows down. 30% of calls time out after 10 seconds, and for those you do not know if the SMS went out. Errors stay rare, so your error alarm is green. What happens, and what do you change?" Expect: a timeout sized to the target (about 2 seconds for OTPs), a breaker that counts timeouts and slow calls, and failover to B with priority shedding. Stretch: at the evening peak about 105 calls a second hang. With a 10-second timeout that is about 1,000 calls in flight, and even with a 2-second timeout it is about 200. Either can drain a shared connection pool and stall OTPs bound for B, so each provider gets its own pool and a short timeout. Timed-out OTPs are resent with the same code, timed-out marketing is not resent and is settled by receipts, and traffic moves back to A slowly through half-open probes.
   Fits: Retries, duplicates and idempotency; Priority, provider limits and failover
3. **New countries (geography, change):** "Next quarter we launch in 15 countries across 10 time zones, including the EU. Good SMS providers differ by country, and EU users' data must stay in the EU. What changes?" Expect: the user's time zone drives quiet hours and "9 AM local" campaigns, which turns one broadcast into hourly waves and flattens the push peak; a routing table of primary and backup SMS providers per country, with a breaker per provider and country; templates per locale with a fallback language. Stretch: a separate EU stack (API, queues, stores), a small global directory from user to home region, callers routed to it, campaigns fanned out per region, and only totals without personal data leaving the region. States what stays the same: the pipeline.
   Fits: Priority, provider limits and failover; Broadcast fan-out and scheduled sends
4. **Receipt storm:** "SMS provider A had a 6-hour fault on its side. When it recovers, it replays all 6 hours of delivery receipts to our webhook in 10 minutes. Many come twice, and many arrive out of order. What happens?" Expect: 6 hours of SMS at about 120 a second is about 2.6 million receipts, perhaps 4 million with repeats, so about 7,000 a second for 10 minutes, 20 to 60 times the normal receipt rate, but well under the 50,000 status writes a second the store takes during a broadcast. The webhook stores each receipt and answers at once, because a slow answer makes the provider retry and adds to the storm. Kafka absorbs the burst and the status writer drains it. Each receipt matches its send by the provider message id saved at send time. Status moves one way only, so a duplicate or a receipt older than the current status changes nothing. Campaign counters move only on a real status change, so repeats do not inflate totals. Stretch: during the fault the receipt rate per provider dropped to zero while calls still succeeded, which is the silent-drop signal to alarm on. Notes that support views and campaign totals are stale until the backlog drains.
   Fits: Delivery status tracking

## Level bar

Hire bar must show:
- Requirements that separate security, transactional and marketing traffic with their own latency targets, cover preferences, and ask for the provider limits and the broadcast size.
- The broadcast math against the push quota, ending in "the quota is the ceiling, so the broadcast is paced and transactional traffic goes first".
- A working async design: an API that accepts durably and replies `202`, queues per channel and priority, stateless senders, preference and template steps, and a status store. One request traced to the provider and back through its receipt, including a failed call.
- Retries with backoff, jitter, a cap and a dead-letter queue, and no retry on permanent errors. An idempotency key plus a dedupe check right before the provider call.
- One deep dive done properly when the interviewer picks it.
- For a provider failure: a circuit breaker and failover to B, shedding low-priority traffic (marketing first) because B is smaller.

Stretch signal:
- Raises without a prompt that one first-in-first-out queue lets a broadcast block OTPs, and isolates priority in topics, worker pools and quota.
- Says exactly-once delivery is impossible, finds the timeout window, and decides per category: same-code OTP resend, a push collapse id, no marketing resend.
- Drops stale OTPs, and serves OTPs newest first under a backlog.
- Paces a broadcast to its deadline, gives it a kill switch, and checks opt-outs at send time.
- Watches delivery-receipt rates per provider to catch silent drops, and uses rate times latency to show why a slow provider needs its own pool.
- Keeps status transitions one way, so late or duplicate receipts cannot move a status back.

## Traps

- "Kafka has exactly-once, so there are no duplicates." Kafka's exactly-once covers reads and writes inside Kafka, not an HTTP call to an SMS provider.
- One queue, or one Kafka topic with a priority field, for everything. A 60 million message broadcast then sits in front of the OTPs.
- "Add more senders" to send faster. Past the provider quota, more senders only collect throttling errors and put the account at risk.
- Retrying everything the same way: permanent errors, OTPs for minutes, or no jitter, so every worker hits a recovering provider at the same moment.
- Quiet hours or opt-outs applied to OTPs, so a user cannot log in at 11 PM.
- Looping over 50 million users inside the API request, or a broadcast with no pacing and no cancel.
- Checking preferences only when a campaign is created, so an opt-out during the hour-long send is ignored.
- Updating a status row in the main Postgres for every webhook.
- A cron that scans the whole scheduled table every minute, a poll once a minute that sends the 9:00 batch late, or a consumer that sleeps until the due time.
