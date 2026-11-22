---
id: c2-news-feed
track: hld
title: News Feed (Twitter/Instagram)
difficulty: medium
tags: [fan-out, read-heavy, caching, pagination, cdn]
tracker:
  section: "### C2. Classic HLD Problems"
  bullet: "News Feed (Twitter/Instagram)"
notesFile: notes/c2-news-feed.md
sources:
  - title: "Hello Interview: Design Facebook News Feed"
    url: "https://www.hellointerview.com/learn/system-design/problem-breakdowns/fb-news-feed"
  - title: "High Scalability: The Architecture Twitter Uses To Deal With 150M Active Users"
    url: "https://highscalability.com/the-architecture-twitter-uses-to-deal-with-150m-active-users/"
confidence: "A write-up of a large microblog's timeline talk backs the core design: fan-out on write into in-memory lists of a few hundred entries, timelines kept only for recently active users, slim entries of post id and author id, and big accounts merged at read time. An interview breakdown agrees on precomputed feeds, async fan-out workers, the hybrid for accounts with many followers and an extra cache for viral posts. It pages by the timestamp of the oldest post seen, where this problem uses a time-ordered post id, because two posts can share a timestamp. The production system kept three copies of each timeline and this problem sizes two; both work. The same breakdown leaves likes out of scope, as this problem does. Scale numbers, the likes curveball and the media figures are this problem's own assumptions."
---

## Opening prompt

Let's design the news feed for a social app, something like Twitter or Instagram. Where would you like to start?

## Hidden facts

Reveal a fact only when the candidate asks about it, or asks a question whose honest answer needs it. Never volunteer the list.

- **Product:** a public microblog with photos and short video, on phone apps and the web. Follows are one-way. Every account is public. Sign-up and login are out of scope.
- **Core features:** create a post (up to 280 characters plus up to 4 photos or 1 video of up to 60 seconds), follow and unfollow, a home timeline of followed accounts and your own posts, and a profile page that lists one account's posts and shows follower and following counts. Those counts may lag a minute.
- **Out of scope:** likes and like counts, comments, search, trending, hashtags, replies, reposts, messages, notifications, ads, editing and deleting posts, blocking and muting, private accounts, live push of new posts, suggested accounts, and moderation beyond a per-user post rate limit of 100 posts a day.
- **Users:** 500 million accounts. 300 million were active in the last 30 days. 200 million are active on a given day. About 40 million of those post, about 2.5 posts each: 100 million posts a day. The server stamps post times.
- **Peak:** about 3 times the daily average for posts and timeline loads. It comes around 8 PM. Live events add short spikes.
- **Timeline reads:** a daily user loads the timeline about 10 times a day, 20 posts per load. A first page, a deeper page and a pull to refresh each count as one load.
- **Follow graph:** 100 billion edges. The average account has 200 followers and follows 200. The median has about 50 followers. An account can follow at most 5,000 others. A daily user follows a new account about once in 10 days: about 20 million follows a day, 230 a second, 700 at peak. Unfollows run at about a quarter of that.
- **Follower spread:** very uneven. About 150,000 accounts have over 10,000 followers, about 10,000 have over 100,000, about 1,500 have over 1 million, and the biggest has 100 million. The 10,000 above 100,000 hold about 5 billion of the 100 billion edges, so a typical account follows about 10 of them. The other 140,000 above 10,000 hold about 4 billion more, so a typical account follows about 8 of those. The 10,000 above 100,000 post about 5 times a day each, so about 50,000 posts a day. Every other account averages about 190 followers and 0.2 posts a day.
- **Ranking:** newest first. No score and no model.
- **Page and depth:** 20 posts a page. The timeline reaches back about 500 posts, then shows "you are all caught up". 99% of loads stay inside the newest 100.
- **Scrolling:** the server keeps no session. The client sends back a cursor. New posts arrive while a user scrolls. Nobody may see a post twice, or miss one, while scrolling down. Pull to refresh shows posts newer than the newest one the client holds.
- **Latency and availability:** a timeline page under 200 ms at p99 on our side. Publishing a post under 500 ms, not counting media processing. Reading the timeline 99.99%, posting 99.9%. A slightly stale or shorter timeline beats an error.
- **Freshness:** a post reaches followers within 5 seconds at p99, or within 30 seconds for accounts above 100,000 followers. The author sees their own post at once. After a follow, that account's latest posts show within 10 seconds. After an unfollow, its posts vanish within 1 minute.
- **Retries:** phones retry on timeouts and send a request id with each post. A retried post must not appear twice.
- **Media:** 1 post in 5 has media: 90% photo posts (about 1 MB per post after processing) and 10% videos (about 10 MB), so about 2 MB per media post. The apps shrink photos and trim video on the phone first, so an upload is about the processed size. The limits are 10 MB for a photo and 100 MB for a video. A photo is ready about 5 seconds after upload, a video within 30. The timeline shows a medium size, about 300 KB per media post. Video plays on tap. Streaming formats are out of scope.
- **Retention and regions:** posts are kept at least 5 years. One region with three availability zones. Users are global, and a CDN may sit in front of media.

For the interviewer: on the follower spread, the candidate picks the rule for which accounts count as big.

For the interviewer: a candidate who adds a light score on top of newest first is fine. Ranking is not part of this problem, so do not probe it.

For the interviewer: on the out-of-scope items, one line each is enough.

## Expected requirements

Core, functional:
1. Create a post: short text with photos or a short video. *Ask: What can a user post?*
2. Follow and unfollow an account, one-way. *Ask: How do users connect: one-way or two-way?*
3. A home timeline of followed accounts and your own posts, newest first, in pages. *Ask: What does a user see on the home timeline?*

Core, non-functional:
1. About 200 million daily users, with about 20 timeline loads for every post. *Ask: How many users, and how often do they post versus read?*
2. Follower counts are very uneven: most accounts have a few hundred, and the biggest has 100 million. *Ask: How many followers can an account have?*
3. A timeline page loads under 200 ms at p99. *Ask: How fast must the timeline load?*
4. Availability over consistency: a new post may take a few seconds to reach followers. *Ask: How fresh must the timeline be, and what matters more if something fails?*

Extras (credit when they name one, never a gap):
- A post reaches followers within 5 seconds at p99, or 30 seconds above 100,000 followers. Publishing takes under 500 ms.
- After a follow, the account's latest posts show within 10 seconds. After an unfollow, they vanish within 1 minute.
- The timeline is about 500 posts deep, 20 a page, with pull to refresh, and scrolling never shows a post twice or skips one.
- A profile page: one account's posts, newest first.
- A retried post never creates two posts.
- Media lives in an object store and is served through a CDN, never from the post database or the API servers.
- The author sees their own post at once.

## Capacity math

Per-node and per-row figures below are assumptions. Accept other reasonable values when the candidate gives a reason.

- **Posts and loads:** 100 million posts a day is about 1,200 a second, or 3,500 at peak. 200 million users times 10 loads is 2 billion pages a day: about 23,000 a second, or 70,000 at peak. That is 20 page loads per post, and 40 billion post views a day (400 per post), which means the work of building a timeline should happen once, when the post is written, so that a read is a cache lookup.
- **Pull for everyone:** a page merges the recent posts of about 200 followed accounts. 70,000 pages times 200 is about 14 million lookups a second at peak, and each page waits for its slowest call, which means pull for everyone is too costly and too slow at the tail.
- **Push for normal accounts:** 100 million posts times about 190 followers is 19 billion inserts a day. Only followers active in the last 30 days (60%) need one: 11.4 billion a day, about 130,000 a second, or 400,000 at peak. With the 70,000 timeline reads that is about 470,000 operations a second against 14 million for pull, about 30 times fewer, which means push wins for normal accounts. It runs from a queue after the post is stored, never inside the post request.
- **The skew:** 10,000 big accounts post 50,000 times a day, 0.05% of all posts. At 500,000 followers each, pushing them adds 25 billion inserts a day, more than the 19 billion from everyone else, which means big accounts must not be pushed.
- **The biggest post:** 100 million inserts, 60 million of them to active followers. A fleet sized for 400,000 inserts a second needs about 2.5 minutes of its whole capacity for this one post, with everything queued behind it, which means the 30-second target fails for that post and the 5-second target fails for everyone else.
- **The threshold:** a post from an account at 100,000 followers is about 60,000 inserts. One worker at 10,000 a second needs 6 seconds, but the whole fleet of about 40 workers needs 0.15 seconds, which means each post's fan-out is split into chunks of 1,000 followers that many workers take in parallel. Any threshold from 10,000 to 1 million works. A higher one pushes more per post. A lower one makes every read merge more accounts: at 10,000 a viewer follows about 18 big accounts instead of 10, and the memory copy grows to about 120 MB (150,000 lists of 100 ids at 8 bytes), which still fits.
- **Big-account lists:** 10,000 accounts times their latest 100 post ids at 8 bytes is 8 MB, which means every timeline server can hold all of it in memory and merge the 10 or so big accounts a viewer follows with no network call.
- **Feed cache:** 300 million lists times 500 ids at about 10 bytes is 1.5 TB, or 3 TB with a replica: about 30 Redis nodes of 100 GB. At peak, 400,000 inserts at two commands each over 15 primaries is about 53,000 commands a second per primary, which means memory sets the size and a few spare primaries give headroom.
- **Hydration:** 70,000 pages times 20 posts is about 1.4 million post reads a second at peak. At a 95% hit ratio the post store sees about 70,000 reads a second, which means a post cache with batched reads per page. Throughput sizes it (about 14 nodes for bodies), not memory: 2 days of posts at 1 KB is about 200 GB.
- **Storage:** 100 million posts at about 500 bytes is 50 GB a day and about 91 TB over 5 years, which means about 45 shards of 2 TB. The follow graph (100 billion edges at about 24 bytes) is 2.4 TB per direction and 4.8 TB for both views, which means its own sharded store, with the biggest account's 100 million followers split across partitions.
- **Follows:** 20 million a day is about 230 a second, or 700 at peak. Each writes two Follow rows and runs one merge job: about 1,400 writes and 700 jobs a second, which means the follow path is small next to fan-out and needs no special design.
- **Media:** 20 million media posts a day at about 2 MB is 40 TB a day, about 15 PB a year, which means an object store. Uploads are about 460 MB a second, or 11 Gbit/s at peak, which means uploads should go straight to the object store by presigned URL, not through the API servers.
- **Delivery:** a page shows about 4 media posts at about 300 KB, so about 1.2 MB, against about 20 KB of JSON. At peak that is about 84 GB a second (about 670 Gbit/s) of media against 1.4 GB a second of JSON, which means the API tier never carries media, and the CDN hit ratio is the whole game. Each point of hit ratio is about 0.8 GB a second of origin traffic at peak: 95% leaves about 4 GB a second, 99% about 0.8.

## API and entities

External API:
- `POST /media` with `{ kind, contentType, bytes }` returns `201 { mediaId, uploadUrl, expiresAt }`. The client uploads straight to the object store. `GET /media/{mediaId}` returns `{ state }`: `processing`, `ready` or `failed`.
- `POST /posts` with `{ clientRequestId, text?, mediaIds? }` returns `201 { postId, createdAt }`. `400` for an empty post, over 280 characters, over 4 photos, or a video mixed with photos. `422` when media is not `ready` or not the caller's. `429` over 100 posts a day. A repeated `clientRequestId` returns the original `201`.
- `PUT /me/following/{userId}` and `DELETE /me/following/{userId}` return `204` and are idempotent. `409` at 5,000 follows, `404` for an unknown account.
- `GET /timeline?cursor=&limit=20` returns `200 { posts, nextCursor }`, newest first. `GET /timeline?since={postId}`, where `postId` is the highest id the client holds, returns posts newer than it, with `gap: true` when more than a page is newer, and the client then replaces its list. `GET /users/{userId}/posts?cursor=&limit=20` returns the same shape for a profile, and `GET /users/{userId}` returns the profile header `{ handle, displayName, avatarUrl, followerCount, followingCount }`.
- A post: `{ postId, author { userId, handle, displayName, avatarUrl }, text, media [ { url, width, height } ], createdAt }`. A cursor is a post id, or an opaque token that wraps one.

Core entities:
- `User { userId, handle, displayName, avatarUrl, followerCount, followingCount, lastActiveAt }`. Both counts lag and serve the profile header. `followerCount` also drives the "big" decision. The 5,000-follow check counts the follower's own `Follow` partition, which is exact.
- `Follow { followerId, followeeId, createdAt }`, stored by `followeeId` and by `followerId`. One view is the truth and the other is derived.
- `Post { postId, authorId, text, mediaIds, createdAt, state }`, sharded by `postId`. The 64-bit id sorts by time (a millisecond timestamp, a machine id, a counter).
- `AuthorPost { authorId, postId }`, partitioned by `authorId`, newest first. It serves profiles, rebuilds and big-account lists.
- `PostRequest { authorId, clientRequestId, postId }`, kept 24 hours, for dedup. `Media { mediaId, ownerId, kind, state, renditions }`. A post holds media ids, not URLs.
- Redis: `feed:{userId}` is a list of up to 500 post ids, newest first, expiring 30 days after the last read. `following:{userId}` caches the follow list. `post:{postId}` holds the body. Big-account lists live in memory on each timeline server, with a copy in Redis.

## Reference design

```
 upload:   Client ── POST /media ──> presigned URL ──> Client ── bytes ──> Object store ──> processor (resize, transcode) ──> ready

 post:     Client ── POST /posts ──> LB ──> Post service (stateless)
             1. claim (authorId, clientRequestId) in PostRequest with a new time-ordered postId; a repeat reuses the old id and skips the insert if the row exists
             2. media all ready and owned by the author?
             3. one transaction on the post's shard: Post row and an outbox row
             4. write AuthorPost (the fan-out worker repeats it); push the id into the author's own feed list ──> 201
             outbox relay ──> Kafka "post-created"

 fan-out:  Kafka ──> worker: chunk tasks of 1,000 followers
             big author?  yes ──> publish to "big-posts" (every server reads all of it); each server adds the id to its memory list; stop
             no ──> read followers, skip those inactive for 30 days, group by Redis shard,
                    LPUSHX feed:{follower} postId, then LTRIM 0 499

 timeline: Client ── GET /timeline?cursor ──> LB ──> Timeline service (stateless, many)
             1. head of feed:{viewer} (100 ids, more for deep pages) and following:{viewer} in one round trip; no list? rebuild
             2. followed big accounts = following ∩ big accounts (memory); take their latest ids
             3. merge, sort by id, drop duplicates and ids at or above the cursor, take 20 plus a few spare
             4. hydrate in batches: bodies and authors; drop missing posts
             5. nextCursor = oldest id examined; media URLs point at the CDN

 rebuild:  following:{viewer} + viewer ──> latest ids per author (AuthorPost) ──> merge ──> newest 500 ──> feed:{viewer}
             one rebuild per viewer at a time; a global budget protects the stores

 follow:   write both Follow views and refresh following:{viewer}. Big account: nothing more, the read merges it. Normal account: a job merges its
           latest 20 ids into feed:{viewer}. Unfollow: the read drops posts whose author is no longer followed
```

Walk one post. The client uploads its photos first, then sends `POST /posts` with a new `clientRequestId`. The post service stores the post and an outbox row in one transaction, writes the author index and the author's own list, and answers `201`. A relay publishes the event. A worker sees the author is not big, reads the 190 followers, skips the 40% who are inactive, and pushes the id into about 114 lists with `LPUSHX`. That command does nothing when a list is missing, so an expired list never becomes a short list that looks complete. Every step is safe to repeat. A crash ends with one post, and a repeated push puts one id in a list twice, which the reader drops.

Walk one timeline read. The service reads the viewer's list and follow list in one round trip, adds the latest ids of the viewer's big accounts from memory, merges by id and cuts at the cursor. It hydrates the next 20 ids in batches, drops missing posts and returns the oldest id examined as `nextCursor`. A missing list triggers a rebuild. A big account's post skips fan-out: one small event updates every timeline server's memory list within about a second.

## Accepted alternatives

- **Fan-out strategy.** The hybrid is expected. Any threshold from 10,000 to 1 million works with a reason. An adaptive rule also works, such as a push budget per author, or pushing only to followers active in the last day. Pull for everyone with per-author recent-post caches is defensible only with the numbers: about 14 million lookups a second, and a plan for the slowest call. "It is simpler" is not enough. Push for everyone fails at this skew.
- **Timeline store.** A capped Redis list of ids (reference). A sorted set scored by timestamp gives native cursor reads at 5 to 10 times the memory per id, so it needs a bigger cluster or a shorter list. A durable per-user timeline in Cassandra or DynamoDB (partition by user, post id descending, with a TTL) survives a cache loss but needs 400,000 durable writes a second at peak. A slim entry (post id plus author id) costs about twice the memory and allows filtering before hydration.
- **Post store.** Sharded Postgres or MySQL, or Cassandra or DynamoDB. Partition by post id with an author index (reference), or by author. Not by time range: the newest shard takes every write and most reads.
- **Follow graph.** Two views in sharded Postgres, or two wide-column tables (reference). A graph database is fine with a reason. Both queries are one hop.
- **Fan-out transport.** Kafka (reference), RabbitMQ, SQS or Redis streams. Judge the retry story, not the brand. Workers must be safe to repeat. An outbox or change data capture closes the stored-but-not-published gap. Writing to Kafka first and storing from a consumer is valid if the candidate says what the author sees meanwhile.
- **Big-account merge.** In memory on each timeline server (reference), from a small shared cache, or in a separate service. Fine if a read makes no remote call per big account at 70,000 pages a second. A per-viewer list of followed big accounts, updated on follow and unfollow, also works if the candidate handles an account crossing the threshold.
- **Media.** Presigned direct upload, a processing queue and a CDN (reference). Proxying small photos through the API tier is acceptable if sized (11 Gbit/s at peak), never video. Accepting the post at once in a pending state and starting fan-out when processing ends also works, if the candidate says what the author and the followers see meanwhile and what happens when processing fails.

## Deep dives

### Fan-out: on write, on read and the hybrid
- **Bad:** one method for every account. Either "build every follower's timeline on each post" with no word on the account with 100 million followers, or `WHERE author_id IN (200 ids) ORDER BY id DESC LIMIT 20` at 70,000 pages a second. Or the fan-out runs inside the post request.
- **Good:** costs both with numbers. Push for normal accounts, through a queue, after the post is stored. Pull and merge for accounts above a follower threshold (about 100,000, with a reason): 100 million inserts for one big post against merging about 10 small lists per read.
- **Great:** shows the skew: 0.05% of posts would be over half the push work. Splits fan-out into chunks of 1,000 followers so the 5-second target holds. Skips followers inactive for 30 days (a bitmap of 500 million bits is about 60 MB) and rebuilds their timeline on return. Marks "big" from a stored follower count with a gap between up (100,000) and down (80,000), so an account at the line does not flap. The read merges both sources and drops duplicate ids, so the flip needs no migration. Handles follow (backfill the account's latest posts) and unfollow (drop at read using the current follow list). Closes the stored-but-not-published gap with an outbox, and makes every push safe to repeat.

### The feed cache, hydration and cursors
- **Bad:** whole post bodies copied into every follower's list, so edits and deletes go stale and memory explodes. Or `OFFSET 40` paging, which repeats or skips posts as new ones arrive.
- **Good:** a Redis list of post ids per active user, capped at 500 (`LPUSH`, `LTRIM`). A page's 20 ids become full posts through batched reads from a post cache, not 20 calls. The cursor is the last post id seen, so new arrivals cannot shift the next page. Pull to refresh uses a separate `since` cursor. Sizes it: 300 million lists times 500 ids times 10 bytes is 1.5 TB.
- **Great:** uses the oldest id examined as the cursor, so a page of dropped posts cannot stall the scroll. Uses `LPUSHX` (or a marker) to tell a missing list from a short one, and closes the race where a post lands during a rebuild by re-checking posts newer than the rebuild's start. Rebuilds on a miss with one rebuild per viewer and a global budget. Over-fetches to fill a page after dropping missing posts. Keeps the post cache and the feed cache on separate clusters.

### Media behind a CDN
- **Bad:** photos or video in the post database, or media served by the API servers, or large uploads proxied through them. Or a post that points at a file that does not exist yet.
- **Good:** the client gets an upload URL and sends the bytes straight to an object store. A processing job makes the smaller sizes and video renditions. The post is accepted only when all its media is ready. It stores media ids, and the response carries CDN URLs.
- **Great:** immutable files with a content hash or random id in the key, so the CDN caches for a year and nothing is purged. Resumable multipart upload for video. Sizes the CDN (a 95% hit ratio leaves about 4 GB a second at the origin, 99% about 0.8). Deletes uploads that no post claims after 24 hours. Processing is a queue with retries and a visible failed state. Picks a rendition per screen. Says what a delete does to a file already cached.

## Curveballs

Use one, at the extension point, unless the candidate already handled it.
1. **Likes on a big post (hot spot):** "Product now adds likes. Each post shows a like count and whether you liked it. At 8 PM the account with 100 million followers posts. In the first minute, 10 million followers load their timeline, and 1 in 20 of them likes the post. What changes, and what breaks first?" Expect: a like row unique on `(userId, postId)`, so a second tap changes nothing, and a count kept apart from the post row. The post brings about 167,000 extra page loads a second on top of 70,000 (3.4 times the normal peak), and 500,000 likes in a minute, about 8,300 a second on average and up to 20,000 at the peak. One hot SQL row takes about 1,000 updates a second, so no like may update a counter column on the post row: batch the adds per post each second, or split the count into sub-counters summed on read. The count may lag a few seconds, and the viewer's own tap shows at once. Fan-out is not the issue, because the hybrid skips this account. Every page reads the same body, count and author, so each of those keys takes about 167,000 reads a second against about 100,000 for a node. More nodes do not help, because a key lives on one node. Fixes: a short-lived copy in each timeline server's memory (200 servers with a 1-second life send at most 200 reads a second), copies of the key under several names, and one fetch per miss. For the 3.4 times load: headroom, then shedding (serve slightly old counts, drop the liked flag first). Stretch: counts transitions, so only a new like row adds one and retries cannot drift the count; reconciles the counter against the like rows; sees that a hot key hurts the other keys on its node, and that autoscaling is too slow for a one-minute spike. Interviewer note: if the candidate pushes every account, ask the fan-out question for this account first.
   Fits: Fan-out: on write, on read and the hybrid; The feed cache, hydration and cursors
2. **Feed cache lost (failure):** "A bad config push empties the whole feed cache at the evening peak." The post and author stores carry about 100,000 reads a second. "What happens, and what do you do?" Expect: all 70,000 pages a second now miss. A rebuild costs about 200 lookups, so about 14 million a second against the post and author stores, which carry about 100,000 reads a second: about 140 times too much. Protect the stores first, because if they fall, posting and profiles fall too. One rebuild per viewer and a global budget: at most about 500 full rebuilds a second (100,000 lookups over 200), and fewer in practice, because normal reads still need the stores. Everyone else gets a cheaper answer: a partial rebuild from the 20 most recently active followed accounts, the big-account posts from memory plus the viewer's own posts, or the last page the client holds. Rebuild the newest 100 ids first, on demand, not for 300 million users at once. Pushes skip missing lists, so no short lists appear. Clients back off with jitter. Stretch: separate clusters for the post cache and the feed cache, and a bulkhead so rebuilds cannot starve posting. Notes that full rebuilds cannot carry the recovery: the peak hour holds about 250 million loads (3/24 of 2 billion), so at least 25 million distinct viewers even if each made all 10 daily loads in it, and at 500 rebuilds a second that takes at least 14 hours. The cheap partial answer is the main path, not a stopgap, and prevention matters: a replica in another zone, snapshots, staged config rollouts. Interviewer note: if the candidate keeps timelines in a durable store, pick another curveball.
   Fits: The feed cache, hydration and cursors; Fan-out: on write, on read and the hybrid
3. **Deletes and blocks (change):** "Product now lets users delete a post and block an account. A deleted post must leave every timeline within 1 minute. A blocked account's posts must stop showing for the blocker within 1 minute. A block list holds up to 1,000 accounts. What changes?" Expect: the lists hold ids, not bodies, so nothing is rewritten. A delete marks the post deleted in the store (a tombstone), drops its cached body, and for a big author removes the id from the big-account lists. Hydration drops deleted posts, and the dead id ages out of the lists. A block adds the author to the blocker's block list, kept with the follow list, and the server drops that author's posts after hydration. Pages come back short, so the server over-fetches, and the cursor moves to the oldest id examined, not returned, so a page of dropped posts cannot stall. Memory copies live a few seconds, so 1 minute holds. Stretch: caches the tombstone, so a deleted post costs no store read on each page that still lists it. Notes that full bodies in every list would need a rewrite of every follower's list per delete. Says media files may stay reachable by URL until purged.
   Fits: Fan-out: on write, on read and the hybrid; The feed cache, hydration and cursors
4. **Video goes viral:** "A new 60-second video is played 50 million times in its first hour, from every region. What breaks?" Expect: 50 million plays in an hour is about 14,000 a second, and at about 10 MB each that is about 140 GB a second, about 1.7 times the whole normal media peak (84 GB a second), for one file. The origin is not the problem once the edges hold the file: a few hundred edge sites times 10 MB is a few GB in all. The risk is the first minutes, when hundreds of edge sites miss at once and each one, with many viewers waiting, can send many fetches to the origin. Fixes: a shield tier between the edges and the origin, request collapsing so one miss per site reaches the shield, range requests so a player fetches only what it plays, and immutable keys so nothing is purged and the file stays cached. The edge capacity itself is the CDN's limit, so say the spike out loud. Stretch: serves a smaller rendition on slow networks to cut bytes, and notes the video is ready within 30 seconds of upload, so the post never points at a file that does not exist yet.
   Fits: Media behind a CDN

## Level bar

Hire bar must show:
- Requirements that cover one-way follows, the read to write ratio, the freshness target and the skew (a few accounts with millions of followers). The skew may come up as late as the first design. Scopes out likes, search, replies and the rest.
- The math unprompted: about 1,200 posts a second against about 23,000 timeline pages on average (3,500 against 70,000 at peak), ending in "which means build the timeline when the post is written". Fan-out of about 19 billion inserts a day, or a figure within a factor of two.
- A clean API (`POST /posts`, `GET /timeline` with a cursor, follow) and entities: post, follow edges readable both ways, and a feed list of ids.
- One post traced through a queue and fan-out into a follower's list, and one timeline read: list, hydrate, return.
- Asked about an account with 100 million followers, sees the write explosion and gives the hybrid with a threshold and a reason.
- Cursor paging, not offset, because new posts shift offsets.
- When media comes up, media in an object store behind a CDN, never in the post database.
- A first bottleneck with a number, and one fix.

Stretch signal:
- Raises the 100-million-follower post as the hard part in the first 15 minutes, unprompted, with minutes of fan-out as the number.
- Quantifies the skew (0.05% of posts, over half the push work) and picks the threshold from push cost against merge cost.
- Skips inactive followers, and tells a missing list from a short one.
- Keeps ids, not bodies, in the lists, so deletes and blocks are read-time filters.
- Keeps the cursor valid under new arrivals and dropped posts, with separate cursors for older and newer.
- Treats a hot key as a replication problem, not a shard-count problem.
- Budgets rebuilds after a cache loss, degrades instead of failing, and protects posting.
- Closes the stored-but-not-published gap with an outbox, and makes pushes safe to repeat.
- Names the rejected option and when it wins: pull wins when viewers follow few accounts or reads are rare.

## Traps

- "Fan-out on write for everyone, so reads are trivial." One post from the biggest account is 100 million inserts (60 million to active followers), about 2.5 minutes of the whole fleet at peak rate.
- "Fan-out on read for everyone, nothing to precompute." About 14 million lookups a second at peak, and each page waits for its slowest call.
- Copying whole post bodies into each follower's list. 1 KB times 500 entries times 300 million users is about 150 TB, and counts, edits and deletes go stale.
- `OFFSET` or page numbers on a list that changes while the user scrolls.
- When likes come up: `UPDATE posts SET like_count = like_count + 1`, or `COUNT(*)` on each render.
- "Add more Redis nodes" for a hot key. One key lives on one node.
- Putting the timeline behind the CDN. Every viewer's page differs, so nothing is shared. The CDN is for media.
- Storing images in the post database, or serving media bytes from the API servers.
- A graph database for follows with no access-pattern reason. The two queries are one-hop lists.
- A Kafka topic or queue per user. That is hundreds of millions of them.
- Sharding posts by creation time, so the newest shard takes every write and most reads.
- `LPUSH` onto a missing list, so a lost list becomes a short list that looks complete.
- Ordering by the phone's clock.
- Pushing to followers inactive for 30 days. That wastes about 40% of the fan-out writes and the cache memory.
- A machine-learning ranker before the chronological feed works.
