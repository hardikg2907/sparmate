---
id: c2-chat-system
track: hld
title: Chat/Messaging System (WhatsApp)
difficulty: medium
tags: [real-time, websockets, ordering, at-least-once, fan-out, partitioning]
tracker:
  section: "### C2. Classic HLD Problems"
  bullet: "Chat/Messaging System (WhatsApp)"
notesFile: notes/c2-chat-system.md
---

## Opening prompt

Let's design a messaging app, something like WhatsApp. Where would you like to start?

## Hidden facts

Reveal a fact only when the candidate asks about it, or asks a question whose honest answer needs it. Never volunteer the list.

- **Users:** 500 million monthly, 200 million daily. Sign-up, login and contact sync are out of scope.
- **Core features:** one-to-one and group text chat, sent, delivered and read ticks, online status and last seen, chat history, and push notifications when the app is closed.
- **Groups:** up to 100 members, 10 on average. Any member can post. Admins add and remove members. A new member sees only messages sent after joining. A removed member gets nothing new and cannot read the group's history from the server.
- **Volume:** each daily user sends about 50 messages a day. 75% go to one-to-one chats and 25% to groups.
- **Chats:** an average daily user is active in about 8 chats a day. That is about 550 million active conversations a day, 50 million of them groups. An average group sends about 50 messages a day and an average one-to-one chat about 15.
- **Busiest chats:** a very active group sends about 1,000 messages a day. A busy one-to-one chat sends about 100.
- **Message size:** text up to 4,000 characters, about 100 bytes on average. Photos and video are out of scope beyond one line (upload to object storage, send a link).
- **Peak:** the evening peak is about 3 times the daily average. About 50 million phones are online at once at the peak.
- **Offline recipients:** about half of all deliveries find the recipient offline.
- **Latency:** an online recipient gets a message within 500 milliseconds at p99, counted from when our servers receive it. A page of 50 older messages loads in under 200 milliseconds on our side.
- **Availability:** 99.99% for send and receive. Presence, typing indicators and receipts may lag or switch off first.
- **Send limit:** one user may send up to 60 messages a minute. Above that, the send fails with a rate-limit error.
- **Durability:** once the sender sees one tick, the message must never be lost.
- **Ordering:** in one conversation, every member sees the same order, and each person's messages keep the order they were sent. No order across conversations.
- **Duplicates:** phones retry on their own while a message shows a clock icon, for up to 24 hours. After that the phone shows a failed mark, and a tap on it sends a new message. Nobody may ever see a message twice.
- **Ticks:** one tick means our servers stored it. Two ticks mean it reached the recipient's phone. Blue means the recipient read it. In a group, two ticks once every other member has it, blue once every other member has read it. A "message info" screen shows each member's state.
- **Presence:** "online" while the app is open on screen, otherwise "last seen" with a time. Shown in one-to-one chats only. It may lag by up to about a minute. Typing indicators are a nice-to-have.
- **Offline phones:** a phone can be offline for weeks. On reconnect it gets everything it missed, in order within each chat. The server holds undelivered messages for 30 days. After that, the phone restores the chat from history. Meanwhile the user gets push notifications. A push is a short alert with the chat id and no message text.
- **History:** the server keeps messages for 1 year. Users scroll back through it, and a new phone restores it. Older messages are deleted.
- **Devices:** one phone per account. Linked web or desktop devices come later.
- **Encryption:** end-to-end encryption comes later. Treat the message body as opaque bytes the server never reads.
- **Out of scope:** calls, editing or deleting messages, search, stories, and spam control beyond a per-user send limit.
- **Regions:** one region with three availability zones. Most users live in one part of the world.

## Expected requirements

Core, functional:
1. Send and receive text in one-to-one chats and in groups of up to 100. *Ask: Which kinds of chats must it support, and how big can a group be?*
2. Messages for an offline user wait and arrive in order on reconnect, with a push. *Ask: What happens to a message when the recipient is offline?*
3. Sent, delivered and read ticks, per member in groups. *Ask: What feedback does the sender get about each message?*

Core, non-functional:
1. 10 billion messages a day and 50 million open connections at peak. *Ask: How many users, how much do they send, how many are online at once?*
2. Under 500 ms at p99 from our servers to an online recipient. *Ask: How fast must a message reach an online recipient?*
3. Nothing is lost once the sender sees "sent": the message is durable before the ack. *Ask: What must be true once the sender sees a message as sent?*
4. One order per conversation, the same for every member; each sender's order is kept. *Ask: In what order must members see messages?*
5. 99.99% for send and receive; presence, typing and receipts may lag first. *Ask: What must stay up if something fails, and what may lag?*

Extras (credit when they name one, never a gap):
- Online status and last seen in one-to-one chats.
- One year of history on the server, paged 50 messages at a time, a page in under 200 ms.
- No duplicates on screen: at-least-once delivery plus dedup.

## Capacity math

Per-server and per-row figures below are assumptions. Accept other reasonable values when the candidate gives a reason.

- **Sends:** 200 million users times 50 is 10 billion messages a day. That is about 115,000 a second on average and 350,000 at peak, which means every message is a durable write far beyond one database primary, so the store must be partitioned.
- **Deliveries:** a message reaches 3 people on average (0.75 times 1, plus 0.25 times 9 for a 10-member group). That is about 350,000 deliveries a second on average and 1 million at peak, which means fan-out, not sending, is the main load, so it runs after the sender's ack.
- **Receipts:** each delivery later brings back a delivered receipt and a read receipt, so two per delivery. Sent one by one, that is about 700,000 a second on average and 2 million at peak, which means receipts outnumber messages, so they travel as "up to seq N" watermarks per conversation.
- **Connections:** at about 100,000 connections per gateway server, 50 million phones need about 500 servers plus spare, which means the gateway tier is stateful, so a registry must map each user to a server. Anything from 50,000 to 1 million per server is fine with a reason.
- **Heartbeats:** a ping every 30 seconds from 50 million phones is about 1.7 million a second, which means pings end in gateway memory and never become a Redis or database write.
- **Registry:** 50 million entries at about 100 bytes is about 5 GB, read about 1 million times a second at peak (once per delivery) and written about 170,000 times a second when each gateway refreshes its entries' TTL every 5 minutes, which means a Redis cluster of about 12 shards at roughly 100,000 operations a second each, with a group's lookups batched.
- **Sequencer:** one counter increment per message is 350,000 a second at peak. At about 100 bytes a counter, the 550 million conversations active in a day are about 55 GB, and a few billion conversations alive over a year are a few hundred GB, which means the counters fit a Redis cluster, and speed alone needs only about 4 shards.
- **Inbox:** one small row (ids only, about 30 bytes) per delivery, so about 350,000 writes a second on average and 1 million at peak, plus about as many deletes on ack. That is three times the message writes, which means the inbox is the busiest table by write count, so it is partitioned by user, kept to ids, and cleared with one range delete per ack.
- **Storage:** at about 200 bytes a row (the body plus ids and timestamps), that is 2 TB a day, 730 TB a year and about 2.2 PB with 3 replicas, which means hundreds of storage nodes, so the partition key decides whether a chat page touches one node or all of them.
- **Partition size:** a busy one-to-one chat grows about 7 MB a year. A very busy group grows about 73 MB a year (365,000 rows), which means one partition per conversation works, but groups near the usual 100 MB comfort limit of a Cassandra partition, so a bucket in the key (per month, or per 10,000 seq values) is the safe default for groups.
- **Push:** half the deliveries is about 175,000 pushes a second on average and 500,000 at peak before collapsing, which means push is its own asynchronous pipeline, collapsed per conversation, that never blocks a send.

## API and entities

External API:
Real-time API, one WebSocket per phone, authenticated on connect:
- Phone to server: `send { clientMsgId, conversationId, body }`. Reply: `sent { clientMsgId, seq, sentAt }` (one tick), or `error { clientMsgId, code }` with `NOT_MEMBER`, `TOO_LONG` or `RATE_LIMITED`. A repeated `clientMsgId` gets the original `sent`.
- Phone to server: `ack { conversationId, seq }` (this phone holds everything up to `seq`), `read { conversationId, seq }`, `watch { userId }` and `unwatch { userId }` for presence in an open chat, and `ping` every 30 seconds.
- Server to phone: `message { conversationId, seq, senderId, clientMsgId, body, sentAt }`, `receipt { conversationId, userId, kind: delivered | read, seq }`, `presence { userId, online, lastSeenAt }`.

HTTPS API:
- `POST /conversations` with `{ memberIds, name? }` returns `201 { conversationId }`, or `400` above 100 members. A one-to-one id is derived from the two user ids, so a repeat returns the same chat.
- `POST /conversations/{id}/members` and `DELETE /conversations/{id}/members/{userId}` (admins) return `204`. `403` for a non-admin, `409` when the group is full.
- `GET /conversations/{id}/messages?beforeSeq=&limit=50` returns `200 { messages }`, newest first, never older than the member's `joinedAtSeq`. `403` for a non-member.
- `PUT /me/push-token` with `{ platform, token }` returns `204`.

Core entities:
- `Conversation { conversationId (primary key), kind: direct | group, name?, createdAt }`
- `Member { conversationId, userId, role, joinedAtSeq, deliveredSeq, readSeq }`, keyed by both ids, plus a reverse index by `userId` to list a user's chats. A new member's `deliveredSeq` and `readSeq` start at `joinedAtSeq`.
- `Message { conversationId, seq, senderId, clientMsgId, body, sentAt }`: partition key `conversationId` (plus a bucket for groups), clustering key `seq` descending.
- `Inbox { userId, conversationId, seq }`: partition key `userId`, clustering key `(conversationId, seq)`, one row per message not yet on that phone, kept up to 30 days.
- `SentLog { senderId, clientMsgId, conversationId, seq, sentAt }`: kept 7 days, for sender-side dedup. The insert happens only if no row exists.
- Redis: `conn:{userId}` holds `{ gatewayId, connId }` with a TTL (the registry), `seq:{conversationId}` is the counter, and `lastSeen:{userId}` backs presence.

## Reference design

```
 send:     Phone A ──WebSocket──> L4 LB ──> Gateway G1 ──> Chat service (stateless)
             1. is A a member? (cached)
             2. SentLog has (A, clientMsgId)? reuse that seq. Else INCR seq:{conversationId}, insert it if absent
             3. write Message at (conversationId, seq)           Cassandra, quorum
             4. publish {conversationId, seq}                    Kafka, keyed by conversationId
             5. "sent" ──> G1 ──> Phone A                        one tick

 deliver:  Kafka ──> Fan-out worker, for each member except the sender:
             a. write Inbox row (userId, conversationId, seq)    Cassandra, partitioned by userId
             b. look up conn:{userId}                            Redis registry
             c. online:  G7 ──> Phone B ──ack──> delete Inbox rows, raise deliveredSeq, receipt to A
             d. offline: Push service ──> APNs / FCM ──> B wakes, connects, drains its Inbox

 history:  Phone ──HTTPS──> History service ──> Cassandra: conversationId = ? AND seq < ? LIMIT 50
 presence: connect / disconnect ──> lastSeen:{userId} in Redis ──> only phones that watch that user
```

Walk one message to an online user. Phone A sends `send` with a new `clientMsgId`. G1 forwards one send per connection at a time, so A's own order holds. The chat service checks membership and `SentLog`. A miss takes the next `seq` from Redis and inserts it into `SentLog` only if no row exists yet, so two racing retries end with one `seq`. A hit, meaning a retry, reuses the stored `seq`. It writes the message at quorum, publishes to Kafka, and only then sends A `sent`. Each step is safe to repeat, so after a crash anywhere, A's retry still ends with one message. A fan-out worker writes B's inbox row, finds B on G7 and calls it. B's phone inserts the message by `seq` and acks. The server deletes B's inbox rows for that chat up to that `seq`, raises `deliveredSeq`, and sends A a delivered receipt.

Walk one history page: phone B sends `GET /conversations/{id}/messages?beforeSeq=&limit=50` over HTTPS. The History service checks that B is a member and answers `403` if not. It reads one Cassandra partition with `conversationId = ? AND seq < ?` and `LIMIT 50`, and the clustering order returns the newest rows first. The read never goes below B's `joinedAtSeq`, so a new member sees nothing sent before joining. The service answers with the page, and the phone uses the lowest `seq` it received as the next `beforeSeq`.

Walk B offline. The registry has no entry for B, so the worker hands the event to the push service. When B opens the app, the gateway registers the connection and streams B's inbox in `seq` order. B acks. A sees two ticks at once, or reads the watermarks on its next connect.

Walk a read. B opens the chat and sends `read { seq: 57 }`. The server raises B's `readSeq` to 57 and tells A once, so every message up to 57 turns blue. In a group, a message turns blue when the lowest `readSeq` among the other current members reaches it. A new member starts at `joinedAtSeq`, so older messages are not held back.

## Accepted alternatives

- **Transport.** WebSockets, MQTT or a custom TCP protocol. Long polling, or server-sent events plus HTTP for sends, is fine with a reason. Short polling is not: a 5-second poll from 50 million phones is 10 million mostly empty requests a second.
- **Reaching the recipient's gateway.** A registry plus a direct call (reference). Pub/sub with a channel per connected user, or a queue per gateway, works only with a durable inbox behind it, because pub/sub drops a message when nobody is subscribed. Hashing users to fixed gateways works if the candidate handles a gateway dying.
- **Presence.** Connect and disconnect events from the gateway (reference). Or a Redis key per user with a short TTL that the gateway refreshes about once a minute, if the candidate counts the writes: 50 million entries is about 830,000 writes a second. Writing every 30-second ping straight to Redis or a database is a trap.
- **Ordering.** A per-conversation counter in Redis (reference), or in a SQL row updated in the same transaction as the insert. A single owner per conversation that hands out numbers in memory, with a failover story. Time-ordered unique ids (timestamp, machine, counter), if everyone sorts by the id, server clock skew is milliseconds (far below human reply time), and one user's sends are stamped in one place. That loses gap detection, so delivery leans on the inbox.
- **Message store.** Cassandra, ScyllaDB, HBase or DynamoDB keyed by conversation (reference). Postgres sharded by `conversationId`, with the shard math for 730 TB a year. Per-user mailboxes with a copy per member: about 4 copies per message (2 for a one-to-one chat, 10 for an average group), so about 2.9 PB a year before replication, but a phone's sync is one partition read.
- **Offline sync.** A per-user inbox deleted on ack (reference). An append-only per-user log with a cursor per phone and a TTL, which avoids deletes and suits more devices later. Per-conversation watermarks, if the candidate says how the server finds the chats that changed.
- **Fan-out.** Kafka between the write and the fan-out (reference), or direct fan-out from the chat service with retries, since groups cap at 100. The inbox rows must be written before the sent tick, or a repair job must find messages with no inbox row. Direct fan-out loses the burst buffer.
- **Delete after delivery.** Some messengers keep history only on the phone. That breaks the one-year history fact here. Credit a candidate who names it as the privacy-friendly option and then meets the fact.
- **Actor framing.** One handler per connection, or one actor per conversation as its sequencer, is a valid and strong framing. The same idea in other runtimes (such as Elixir processes or Akka actors under a supervisor) is also accepted.

## Deep dives

### Real-time delivery, routing and presence
- **Bad:** phones poll for new messages. Or "the load balancer routes it to the recipient", which no load balancer can know. Or one chat server for everyone.
- **Good:** a WebSocket from each phone to a gateway tier behind a layer-4 load balancer, about 100,000 connections per server. A Redis registry maps `userId` to gateway, set on connect and removed on disconnect. The fan-out looks up the recipient and calls that gateway. Pings every 30 seconds find dead connections. Presence comes from the same events: online while connected, `lastSeen` on disconnect.
- **Great:** keeps gateways thin, with no business logic, so they rarely redeploy, and drains them in small batches when they do. Registry entries carry a connection id and a TTL. A disconnect deletes the entry only if the id still matches, so a late cleanup cannot erase a newer connection. A stale entry costs one failed call, and the inbox covers it. Presence goes only to phones that `watch` that user, never to every contact, and "offline" waits a few seconds so a flaky network does not flicker.

### Ordering, retries and duplicates
- **Bad:** sorting by the sender's phone clock. Promising exactly-once delivery. Retries with no id, so a flaky network posts a message twice.
- **Good:** the server assigns `seq` per conversation and every phone sorts by it. The phone retries `send` with the same `clientMsgId` until `sent`, and the server dedups on it. The recipient acks, the server redelivers anything unacked, and a phone ignores a `seq` it already holds.
- **Great:** says exactly-once delivery to a phone is impossible over a lossy network, and at-least-once plus idempotent steps gives effectively-once. Keeps each sender's order by handling one connection's sends one at a time. The recipient inserts by `seq`, not arrival order, and fetches the range when a gap does not fill within a second or two. Knows a Redis failover can hand out a recent `seq` again, so the insert must never overwrite a different message (a conditional insert that accepts the same `clientMsgId`, or a tie-breaker in the key). Gaps are harmless.

### Offline delivery, receipts and push
- **Bad:** undelivered messages kept in gateway memory. "Send a push and we are done", though pushes get dropped and delayed. A receipt row per message per member, updated one by one.
- **Good:** a durable inbox row per recipient before delivery. On reconnect the phone drains its inbox in order and acks. Delivered on ack, read when the chat opens. Offline users get a short push alert through APNs or FCM. The inbox guarantees delivery; the push only wakes the phone.
- **Great:** receipts as per-member watermarks (`deliveredSeq`, `readSeq`) that only move forward, so one write covers a burst, against about 2 million a second if sent per message. Group ticks come from the lowest watermark. Pushes collapse per conversation and back off when the provider throttles. Names the cost of a delete-heavy inbox in Cassandra (tombstones slow reads) and offers an append-only log with a cursor per phone.

### Storing messages
- **Bad:** one Postgres table at 730 TB a year. "NoSQL scales" with no key design. Partitioning by `messageId`, which scatters every chat page across all nodes.
- **Good:** a wide-column store partitioned by `conversationId` and clustered by `seq` descending, so the latest 50 is one partition read, and paging is `seq < X LIMIT 50`. Three replicas and quorum writes before the sent tick. Membership in its own table, cached.
- **Great:** sizes partitions (73 MB a year for a very busy group) and buckets groups. Expires rows with a one-year TTL. Notes that quorum reads after quorum writes let a new phone restore history without missing recent messages. Sees that one very hot conversation is a hot partition, which more nodes do not fix.

## Curveballs

Use one, at the extension point, unless the candidate already handled it.
1. **Load spike:** "It's midnight on New Year's Eve, and for ten minutes people send ten times the normal peak. What breaks first, and what do you protect?" Expect: the spike is 3.5 million sends and about 10 million deliveries a second. The date is known, so pre-scale gateways, services, Kafka and the store. Protect durability and let delivery slow to seconds, with Kafka buffering the fan-out (ten minutes at 3.5 million a second is 2.1 billion events; at about 30 bytes of ids each that is about 60 GB, while the store takes about 420 GB of rows in the same ten minutes). Shed typing, presence and frequent receipts first, and collapse pushes. Stretch: makes the Kafka append the durability point, with the body in the event (about 420 GB held), so the store catches up after the spike.
2. **Gateway loss:** "One gateway holding 100,000 connections dies at peak. What happens to those users, and to the messages on their way to them?" Expect: phones see a reset or missed pings and reconnect with exponential backoff and jitter, spread over about 30 seconds (about 3,300 a second) instead of hitting auth, the registry and inbox reads at once. The other 499 gateways take about 200 connections each. In-flight messages were never acked, so they wait in the inbox. The users' own unacked sends retry with the same `clientMsgId`. Stale registry entries expire, and a call to the dead gateway fails fast and falls back to push. Stretch: the same drain plan for deploying all 500 gateways, and the compare-and-delete race on the registry.
3. **Big groups:** "Product now wants community groups of up to 50,000 members, where anyone can post. What changes?" Expect: one message becomes up to 49,999 inbox rows, so one message a second in one group is about 50,000 writes a second. Groups above a threshold (a few hundred members) switch to fan-out on read: store once, send online members a collapsed "new activity" signal, and let phones pull the latest page on open. Per-member receipts and presence go for big groups (a read count at most). Cache a hot group's latest page and bucket its partition. Small groups keep fan-out on write.

## Level bar

Hire bar must show:
- Requirements that pin down group size, offline delivery, what each tick means, the ordering rule and durability after the sent tick.
- The math without being asked, within a factor of two of: about 350,000 sends and 1 million deliveries a second at peak, and 50 million connections needing hundreds of gateways. Each step ends in "which means".
- WebSocket gateways plus a registry, with one message traced to an online and to an offline recipient.
- Server-assigned order per conversation (a sequence or a time-ordered id), never the phone's clock.
- At-least-once with dedup: a client message id, server dedup, recipient acks, redelivery, and dedup on the phone.
- The message stored before the sent tick, in a store keyed so that one chat page reads one partition (by conversation, or by user with a copy per member). Offline users get a push and catch up from the server on reconnect.
- When asked where it breaks first, a real limit with its number (fan-out, receipts, a reconnect storm or the store's write rate) and one fix.

Stretch signal:
- Sees that receipts outnumber messages and makes them per-member watermarks.
- Raises the reconnect storm and jittered backoff without a prompt.
- Explains why exactly-once to a phone is impossible and how effectively-once is reached.
- Keeps each sender's order and handles out-of-order arrival at the recipient.
- Sizes partitions and buckets busy groups, or names the tombstone cost of a delete-heavy inbox.
- Sends presence only to phones viewing that chat, with a short delay before "offline".
- Keeps gateways thin and separate from stateless logic, so deploys do not drop connections.

## Traps

- Ordering by the phone's timestamp.
- "Kafka gives us exactly-once." That covers Kafka-to-Kafka processing, not the hop to a phone.
- A Kafka topic or partition per user or per conversation: hundreds of millions of them.
- Redis Pub/Sub as the delivery guarantee. A message published while nobody listens is gone.
- "Sticky sessions solve routing." They pin a phone to a server; they do not tell the sender's server where the recipient is.
- Acking the sender before the durable write, or keeping undelivered messages only in gateway memory.
- Treating the push notification as the delivery path.
- Broadcasting every presence change to every contact, or writing every ping to a database.
- Short polling from 50 million phones.
- Deleting messages on delivery after being told history stays for a year.
