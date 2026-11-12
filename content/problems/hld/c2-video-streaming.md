---
id: c2-video-streaming
track: hld
title: Video Streaming (YouTube/Netflix)
difficulty: medium
tags: [object-storage, transcoding, adaptive-bitrate, cdn, async-pipeline, hot-counters]
tracker:
  section: "### C2. Classic HLD Problems"
  bullet: "Video Streaming (YouTube/Netflix)"
notesFile: notes/c2-video-streaming.md
sources:
  - title: "Hello Interview: Design YouTube"
    url: "https://www.hellointerview.com/learn/system-design/problem-breakdowns/youtube"
  - title: "Apple: HLS Authoring Specification for Apple Devices"
    url: "https://developer.apple.com/documentation/http-live-streaming/hls-authoring-specification-for-apple-devices"
  - title: "AWS: Amazon S3 multipart upload limits"
    url: "https://docs.aws.amazon.com/AmazonS3/latest/userguide/qfacts.html"
  - title: "Netflix: How Netflix works with ISPs around the globe"
    url: "https://about.netflix.com/en/news/how-netflix-works-with-isps-around-the-globe-to-deliver-a-great-viewing-experience"
confidence: "The sources agree on the shape: multipart upload straight to object storage, chunked parallel transcoding into a ladder of renditions, short segments listed in playlists, and a CDN that serves almost every byte. The multipart limits (10,000 parts, 5 MiB minimum part) come from the storage provider's own documentation. The platform's authoring guide prefers 6-second segments and a higher 1080p bitrate than this problem uses; segment length is accepted as a trade-off, and the bitrates here are given facts. One source leaves view counts out of scope, where this problem makes them a feature. Scale, cost and encoder-speed numbers are this problem's own round assumptions."
---

## Opening prompt

Let's design a video streaming service, something like YouTube. Where would you like to start?

## Hidden facts

Reveal a fact only when the candidate asks about it, or asks a question whose honest answer needs it. Never volunteer the list.

- **What it is:** creators upload videos and anyone can watch them, like YouTube (not a licensed catalog like Netflix). Accounts and login are out of scope. Every video is public: no private or unlisted videos, no access control, no geo-blocking. Viewers and creators are global. Start with one home region for uploads and processing.
- **Core features:** upload with a title and description, adaptive playback, an approximate view count, one thumbnail that we cut from a frame of the video. Search by title exists. The video file cannot be edited or replaced after upload.
- **Out of scope:** live streaming, DRM, recommendations, comments, ads, captions, 4K and HDR, offline downloads, creator payouts, subscriptions, likes, the home feed and notifications. Copyright and abuse scanning is out of scope.
- **Users:** about 100 million viewers a day, about 5 views each. About 2 million creators upload in a month.
- **Views:** about 500 million a day. A view counts after 30 seconds of watching, or the whole video if it is shorter. The average view watches about 3 minutes. About 70% of views are on phones.
- **Uploads:** about 500,000 new videos a day (1,000 views per upload). The average video is 5 minutes and 300 MB (about 8 Mbps). The limit is 12 hours and 50 GB. Creators often upload over weak connections. The same file uploaded twice makes two videos. Accepted inputs are MP4, MOV, MKV and WebM with common video codecs (H.264, HEVC, VP9).
- **Peak and popularity:** the busiest hour is twice the daily average, for views and uploads. About 1% of videos get about 80% of views, and half of all videos are never watched after their first week. A big creator's release can send far more views to one video than the daily peak.
- **Quality ladder:** up to 1080p, in five renditions: 240p at 0.4 Mbps, 360p at 0.8, 480p at 1.3, 720p at 2.5 and 1080p at 5. That is 10 Mbps in total. The average delivered bitrate is about 2 Mbps. Audio is a separate 128 kbps track shared by all renditions. It is not counted in the totals. Playback is H.264 and AAC, which every device decodes, at up to 30 frames a second. Never upscale: a rendition above the source resolution is skipped, and a source above 1080p is scaled down. The math assumes all five renditions.
- **Playback:** starts in under 2 seconds at p95 on a good connection. Rebuffering stays under 1% of watch time. Seeking works anywhere.
- **Processing:** for videos up to 1 hour, the lower renditions are watchable within 5 minutes of the upload finishing, and the full ladder within 15. A 12-hour video may take 2 hours. The creator sees "processing" at once. A corrupt or unsupported file ends as "failed", and the creator is told.
- **Availability and durability:** playback 99.99%, upload and processing 99.9%. An original is never lost after "upload complete".
- **View count:** it may lag a minute and be off by a few percent. Counting every report is fine, with no per-viewer dedup. It never goes down. Exact payout figures come from an offline job and are out of scope.
- **Retention and takedown:** videos stay until deleted, and originals are kept. Plan for 5 years. A removed video stops playing for new viewers worldwide within 15 minutes. People already watching may finish. Its bytes can be deleted from storage within 30 days.
- **CDN:** a commercial CDN gives about a 95% byte hit ratio at the edge before any shield tier.
- **Cost:** standard storage $0.02 per GB-month, cold storage $0.004. CDN delivery $0.02 per GB. Spot compute $0.03 per vCPU-hour. With a common H.264 encoder, the full ladder takes about 10 vCPU-seconds per second of video. These are round assumptions.

For the interviewer: on search, a mention is enough.

For the interviewer: on copyright and abuse scanning, one line is enough.

For the interviewer: on spikes, give the spike fact only if asked, and give no figure until the curveball.

For the interviewer: on the CDN, give the fact only if asked.

For the interviewer: on the cost, give the numbers only if asked.

## Expected requirements

Core, functional:
1. Upload a video (up to 50 GB) with a title and description; a dropped upload resumes. *Ask: What can a creator upload, and what if the connection drops?*
2. Process it into several quality levels, with a visible status. *Ask: What happens to a video after the upload finishes?*
3. Play it on any device, with quality that adapts to the network and working seeks. *Ask: How is a video played on different devices and networks?*
4. Show a view count that may lag a minute and be off by a few percent, but never goes down. *Ask: How exact and how fresh must the view count be?*

Core, non-functional:
1. 500 million views a day, 1,000 views per upload; about 2 Tbps on average, 4 Tbps at peak. *Ask: How many videos are watched and uploaded a day?*
2. Playback starts in under 2 seconds at p95; rebuffers under 1% of watch time. *Ask: How fast must playback start, and how smooth must it stay?*
3. 99.99% availability for playback, 99.9% for upload and processing. *Ask: Which matters more if something fails, watching or uploading?*
4. Originals are never lost after "upload complete". *Ask: What must be true once an upload is complete?*
5. Watchable within 5 minutes and fully processed within 15 (videos up to 1 hour). *Ask: How soon after upload must a video be watchable?*

Extras (credit when they name one, never a gap):
- Delete a video. Removed videos stop playing within 15 minutes.
- About 900 million videos and 600 PB in 5 years, so storage and egress cost shape the design.

## Capacity math

Per-server, per-row and per-link figures below are assumptions. Accept other reasonable values when the candidate gives a reason.

- **Views:** 500 million a day is about 5,800 a second on average and 11,600 at peak, which means the API behind video pages is a small load for a cache and a few replicas.
- **Bandwidth:** 500 million views times 180 seconds is 90 billion viewing seconds a day, or about 1.04 million concurrent streams on average and 2.1 million at peak. At 2 Mbps, that is about 2.1 Tbps on average, 4.2 Tbps at peak and 22.5 PB a day, which means no origin or application fleet can serve this, so the CDN serves almost every byte.
- **Segments:** one 4-second segment per stream every 4 seconds is about 260,000 requests a second on average and 520,000 at peak, which means segment requests must be plain cacheable GETs on static files.
- **Uploads:** 500,000 a day is only 6 a second, but at 300 MB it is 150 TB a day, about 14 Gbps on average and 28 at peak. A 5 GB file takes 33 minutes at 20 Mbps. In 8 MB parts, an average file is 38 parts and a 50 GB file about 6,250 (many stores cap a multipart upload at 10,000), which means the bytes must not pass through our API, and drops are normal, so devices send parts straight to object storage and resume at the last stored part.
- **Transcode:** 500,000 videos times 300 seconds is 150 million video seconds a day. At 10 vCPU-seconds each, that is about 17,400 vCPUs busy on average and 35,000 at peak (about 270 and 540 machines of 64 vCPUs), which means a large elastic fleet on spot capacity, so every task must be safe to retry.
- **Chunking:** a 1-hour video is 36,000 vCPU-seconds, or 75 minutes on one 8-vCPU machine against a 15-minute target. In 20-second chunks it is 180 chunks times 5 renditions, or 900 tasks of 40 vCPU-seconds on average. Cost follows pixel count roughly, so a 1080p chunk is about half the ladder's work (about 110 vCPU-seconds) and a 240p chunk about 5; the 1080p tasks are the long ones. An average video is 75 tasks, about 430 a second across the platform, which means chunking meets the target for long videos, and the queue choice rests on semantics (ack, retry, delay), not throughput.
- **Storage:** a 5-minute video at 10 Mbps is 375 MB of renditions plus the 300 MB original, or 675 MB. At 500,000 a day, that is 337.5 TB a day, 123 PB a year and about 616 PB in 5 years (912 million videos), which means the library is hundreds of petabytes, so what we keep and on which tier matters.
- **Objects and metadata:** 5 renditions times 75 segments is 375 objects per video, about 342 billion in 5 years. Metadata is 912 million rows at about 1 KB, or about 0.9 TB, which means manifests are stored, never built by listing a folder, and one Postgres primary with replicas and a Redis cache holds the metadata.
- **Hot head and origin:** 1% of 912 million videos is 9 million videos, or about 3.4 PB at 375 MB each, far more than one edge site holds, so each edge keeps a recent and regional slice. Each 1% of bytes the CDN misses is about 21 Gbps at the origin (42 at peak): a 95% hit ratio leaves about 100 Gbps and 99% about 21, which means the hit ratio is the number to protect, and a shield tier with request collapsing moves it from 95% toward 99%.
- **View events:** 5,800 a second on average and 11,600 at peak is easy for Kafka, but 1 million views of one video in 5 minutes is about 3,300 a second, and one database row takes at most about a thousand updates a second, which means the total is easy but one video's counter needs batching or sharding.
- **Cost:** egress is 22.5 PB a day, about 675 PB a month, or about $13.5M a month at $0.02 per GB. Storage is about $2.5M a month after year 1 (123 PB) and about $12M at year 5 if all of it stays hot. Compute is 12.5 million vCPU-hours a month at $0.03, about $0.4M, which means the money is in cutting bytes (hit ratio, a better codec, caches inside internet providers' networks), then in tiering storage.
- **Savings:** a 30% smaller delivered bitrate saves up to about $4M a month, ten times the encode bill. The 274 PB of originals at year 5 cost about $5.5M a month in standard storage and $1.1M in cold, which means extra encode compute on popular videos pays for itself, and originals, which only a re-encode reads, belong in cold storage.

## API and entities

External API:
- `POST /uploads` with `{ title, description?, sizeBytes, contentType }` returns `201 { uploadId, videoId, partSizeBytes }`. `413` above 50 GB, `415` for an unsupported type.
- `POST /uploads/{id}/part-urls` with `{ partNumbers }` returns pre-signed `PUT` URLs. The client sends each part straight to object storage and keeps the ETag.
- `GET /uploads/{id}` returns `{ status, parts: [{ partNumber, etag }] }`. This is the resume call.
- `POST /uploads/{id}/complete` with `{ parts }` returns `202 { videoId, status }`. A repeat returns the same answer. `409` when parts are missing.
- `GET /videos/{id}` returns `{ title, ownerId, durationSec, status, viewCount, thumbnailUrl, manifestUrl }`. `manifestUrl` appears once the video is playable. `404` for unknown or removed videos.
- `POST /videos/{id}/views` with `{ sessionId }` returns `202`, sent once after 30 seconds of play (or at the end, for a video shorter than that). `DELETE /videos/{id}` (owner) returns `204`.
- Playback is `GET {manifestUrl}`, then a `GET` per segment: plain HTTP to the CDN, with no API server in the path. Search is `GET /search?q=` (mention only).

Core entities:
- `Video { videoId (primary key), ownerId, title, description, status: uploading | processing | playable | ready | failed | removed, durationSec, createdAt }`, indexed on `(ownerId, createdAt)`. Ids are random, not sequential.
- `Upload { uploadId, videoId, objectKey, sizeBytes, partSizeBytes, expiresAt }` and `Task { videoId, rendition, chunkIndex, status, attempts, leaseUntil }`.
- `VideoStats { videoId, shard, views }`. `ViewEvent { videoId, sessionId, ts }` lives in Kafka.
- Object keys: `raw/{videoId}/original` and `media/{videoId}/v1/{rendition}/{n}.m4s`, plus an init segment per rendition, a `master.m3u8` and one playlist per rendition.

## Reference design

```
 upload:   Client ──> API ──> Postgres (Video: uploading) + object storage (start multipart upload)
             │ 1. get part URLs, PUT 8 MB parts straight to the raw bucket, 4 at a time
             │ 2. after a drop: GET /uploads/{id}, send only the missing parts
             └ 3. POST complete ──> API checks parts, Video = processing, one job on the queue (outbox)

 process:  Queue ──> Planner: probe, cut a thumbnail, split at keyframes into 20 s chunks, create tasks (chunk x rendition)
                     Encode workers (stateless, spot, scaled on queue age): take a task under a lease, encode one
                       chunk, write 4 s segments to a fixed key in the media bucket, mark the task done
                     Packager: a rendition has all its chunks ──> write its playlist
                     The two lowest renditions that apply are done: master playlist with them, Video = playable
                     All renditions done: master playlist rewritten with every rung, Video = ready

 watch:    Player ──> API: GET /videos/{id} (Redis, then replica) ──> manifestUrl
           Player ──> CDN edge ──miss──> shield tier ──miss──> media bucket (origin): master playlist, then segments
           every 4 s: pick the next rung from measured throughput and buffer level
           after 30 s of play ──> POST /views ──> Kafka ──> consumers add up per video for 5 s ──> counter store
```

Walk one upload: the client sends parts straight to object storage and, after a drop, asks which parts exist. On complete, the API checks the parts, sets the status and writes the job in one transaction (outbox), so a crash cannot leave a video that never starts. The original is safe once complete succeeds, because object storage keeps copies in several zones and nothing in the pipeline deletes it. Workers write segments under a key built from video, rendition and chunk, so a retry overwrites the same objects. Every rendition puts keyframes at the same positions. Low renditions run first. A rendition joins the master playlist only after all its segments exist, so a player never sees a rung with missing segments. The master is first written at "playable" with the two lowest renditions that apply (a 240p source has only one), and rewritten when all are done. Until then it has a short TTL, so the CDN picks up the new rungs.

Walk one watch: the player fetches the master playlist from the CDN and starts on a low rung, so the first segment arrives fast. It then picks each next rung from throughput and buffer level, switching at segment boundaries. Every request is a plain GET for a file that never changes, so the edge answers almost all of them. On an edge miss, the shield tier answers, and only a shield miss reads the media bucket; the segment arrives later but still arrives. If a segment comes slowly and the buffer drains, the player steps down a rung for the next segment instead of stalling.

Metadata and search (a mention): Postgres keyed by `videoId`, behind Redis. Change events feed a separate search index that runs a minute or two behind, off the playback path.

## Accepted alternatives

- **Upload.** Pre-signed multipart upload straight to object storage (the reference), or a stateless resumable upload service sized for 14 to 28 Gbps. Parts of 8 to 16 MB are fine with a reason. Most stores need at least 5 MB per part (except the last), and a 50 GB file needs parts of about 5.4 MB or more to stay under 10,000.
- **Packaging.** HLS only, DASH only, or both from one set of fMP4 (CMAF) files. Separate segment files, or one fMP4 file per rendition with the playlist listing a byte range for each segment (about 75 times fewer objects, but the CDN must cache ranges). Either way the player switches at segment boundaries. Segments of 2, 4 or 6 seconds if the trade-off is stated.
- **Ladder.** A fixed ladder or per-title encoding. Eager encoding of every rendition, or lazy: top rungs only once a video gets views. Lazy saves compute on videos that get few or no views, but lowers quality for the first viewers.
- **Job queue.** A task queue with ack and lease (RabbitMQ or a cloud queue), a pipeline orchestrator, or Kafka with an answer for one slow or poison task blocking its partition. A managed transcoding service is fine if the candidate still explains split, encode and package.
- **Metadata and counts.** Postgres with replicas (sharded by `videoId` later) or a key-value store. Counters by stream aggregation into delta writes (the reference), sharded Redis counters, or a wide-column store, if the raw events stay the source of truth.
- **CDN.** One commercial CDN, several, or own caches inside internet providers' networks (a valid cost answer at 2 Tbps, not expected at the hire bar). Pre-warming before a known release is a bonus.

## Deep dives

### Resumable upload to object storage
- **Bad:** one HTTP request through an application server. A failure at 99% restarts from zero, and 14 Gbps of video crosses the API fleet.
- **Good:** about 8 MB parts, sent with pre-signed URLs straight to object storage, a few in parallel. A resume asks which parts exist and sends the rest. A complete call joins them and starts processing.
- **Great:** a checksum and backoff retries per part. Part size follows from the 10,000-part cap. Complete is idempotent, and the job reaches the queue through an outbox (or a sweeper for stuck videos), never by polling. The file is probed before any encode compute is spent. A lifecycle rule aborts abandoned multipart uploads, because stored parts are billed until aborted.

### The transcoding pipeline
- **Bad:** encode inside the upload request, or one worker runs ffmpeg on the whole file, one rendition after another. A 1-hour video holds a worker for over an hour, and a crash restarts everything.
- **Good:** a job on a queue, workers pulling tasks, the file split into chunks, each chunk encoded per rendition in parallel, segments and playlists written to object storage. Workers scale on queue depth, failed tasks retry, status lives in a database.
- **Great:** a split on keyframes into chunks of about 20 seconds (75 tasks for an average video, 900 for a 1-hour one). Keyframes at the same positions in every rendition, so the player switches cleanly. Output keys built from video, rendition and chunk, so a retry is safe. A lease returns a dead worker's task. A retry limit and a dead-letter queue stop one corrupt file from killing every worker. Low renditions first, and a rendition enters the master playlist only when all its segments exist. Separate queues by video length, so a 10-hour upload cannot starve short ones.

### Adaptive playback and CDN hit ratio
- **Bad:** the application server streams the file, or serves one MP4 for byte-range fetches. Or the server picks each viewer's quality. Or segments get a short TTL "for freshness".
- **Good:** short segments in several renditions, listed in a playlist. The player picks the highest rung that fits within about 80% of its measured download speed, steps down when the buffer runs low and switches at segment boundaries. Segments and playlists are static files on a CDN in front of object storage.
- **Great:** the numbers: each 1% of misses is about 21 Gbps at the origin, so 99% needs a shield tier and request collapsing. Immutable segments get a TTL of a year and a versioned path for a re-encode. The cache key is the path only, because a per-viewer token left in the cache key gives every viewer a private copy (a token the edge checks and leaves out of the key is fine). The player starts low (a 360p first segment is 400 KB, under a second at 5 Mbps), ramps up and stops fetching at about 30 seconds of buffer, because video fetched and never watched is paid egress. A short TTL on the playlist while processing, and a purge by prefix or tag, meet the 15-minute takedown.

### View counts without hot rows
- **Bad:** `UPDATE videos SET views = views + 1` per view, so a viral video queues on one row lock.
- **Good:** the player sends one event after 30 seconds, the event goes to Kafka, and a consumer adds up events per video every few seconds and writes one update.
- **Great:** says the count is at-least-once, slightly high and never blocking, and why that suits a number on a page. A viral video is a hot key, so its counter splits into sub-counters (a shard suffix on the key) summed on read. Raw events stay the source of truth. An offline job reconciles from them and only ever raises the shown count (it keeps the larger of the two), so the count never goes down even when the job finds duplicates.

## Curveballs

Use one, at the extension point, unless the candidate already handled it.
1. **Hot release (1 million viewers on one video):** "A creator with a huge audience releases a video at a set time. One million people press play in the first five minutes. What breaks first?" Expect: one million plays in five minutes is about 3,300 views a second on one video and up to 2 Tbps, about the platform's whole average, and every edge misses on the same first segments together. Request collapsing at the edge and shield, so the origin sees one read per segment per tier. Pre-warming the first minute of every rendition before the release, starting rungs first, because players start low. Metadata cached for seconds. A sharded, batched counter. ABR stepping down under congestion instead of failing.
   Fits: Adaptive playback and CDN hit ratio; View counts without hot rows
2. **Encode fleet failure (nothing encodes for 2 hours):** "The cloud provider reclaims all the spot workers at once, and nothing encodes for 2 hours. What happens?" Expect: uploads and playback are unaffected, because uploads land in object storage and the queue holds the jobs. Leases expire, and fixed output keys make re-runs safe. The backlog is about 42,000 videos, or 125 million vCPU-seconds, so a fleet twice as big clears it in about 2 hours. The two lowest renditions (about a tenth of the work) go first. An alert on the age of the oldest task. If time remains: one corrupt file crashes every worker that reads it. Expect a retry limit and a dead-letter queue.
   Fits: The transcoding pipeline
3. **New market (slow, costly mobile data):** "We launch where most viewers are on slow, expensive mobile connections and the nearest CDN site is far away. What changes?" Expect: lower rungs (for example 144p, or audio only, at 100 to 150 kbps) and a data-saver default that starts low. Smaller first segments. Caches closer to viewers (a regional shield, or caches inside local internet providers' networks) and a regional copy of popular videos. Upload parts at the store's 5 MB minimum and more retries on weak phone connections. Smaller than that needs a resumable upload service in front of storage. Startup time and rebuffering measured per region.
   Fits: Adaptive playback and CDN hit ratio; Resumable upload to object storage

## Level bar

Hire bar must show:
- Requirements that cover the view and upload volume, the video size, and the startup and processing targets.
- The math, ending in "which means": about 2 Tbps against about 6,000 requests a second means the CDN carries the bytes, and 14 Gbps of uploads means devices upload straight to object storage.
- A clean API and a working design: resumable chunked upload, a queue with workers, renditions cut into segments with a manifest, a CDN in front of object storage, a metadata service.
- A correct account of adaptive bitrate: the player measures and decides, and the server only serves static files.
- When probed on a dead worker or the view count: retries and idempotent tasks, and a fix for the hot view-count row.
- One deep dive done properly when the interviewer picks it.

Stretch signal:
- Raises cost unprompted: egress is the biggest bill, with levers (hit ratio, a better codec on the hot head, own caches) and cold storage for originals.
- Chunk-parallel encoding with aligned keyframes, deterministic output keys, a dead-letter queue and progressive publish.
- Cache design with numbers: immutable segments, a path-only cache key, a shield tier, request collapsing, takedown by purge.
- Upload details: part checksums, cleanup of abandoned uploads, an outbox between complete and the queue.
- A counter design that states at-least-once, shards a viral video's key and reconciles offline.
- Sees the cold-cache stampede on a hot release before being asked.

## Traps

- Uploading through the application servers, or storing video bytes in Postgres or Kafka.
- Transcoding inside the upload request, or on one machine for a whole long video.
- One plain MP4 per quality that the player seeks into by byte range, with no segment playlist: no aligned segments, no real adaptive bitrate.
- The server choosing each viewer's quality. It cannot see the viewer's network, and per-viewer responses break CDN caching.
- "The CDN hit ratio is about 100%." The long tail and cold starts miss.
- Short TTLs on segments for freshness, or a per-viewer token in the cache key. Both wreck the hit ratio. Year-long TTLs with no takedown story are the opposite mistake.
- `views = views + 1` per view, or "exactly-once view counting". A displayed count needs neither.
- An offline reconcile that lowers the shown count after it removes duplicates. The count must never go down.
- Leaving the view count out of scope, as some popular write-ups do. Here it is a core feature with its own freshness rule, so leaving it out is a gap.
- WebSockets or WebRTC for stored video. Plain HTTP GETs on cacheable files are cheaper.
- Encoding every upload up to 4K in many codecs, when half the videos go quiet after their first week. Or a fleet of microservices for 6 uploads a second.
