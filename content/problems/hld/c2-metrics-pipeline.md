---
id: c2-metrics-pipeline
track: hld
title: Metrics and Logging Pipeline
difficulty: hard
tags: [time-series, write-heavy, compression, cardinality, alerting, logs]
tracker:
  section: "### C2. Classic HLD Problems"
  bullet: "Metrics and Logging Pipeline"
notesFile: notes/c2-metrics-pipeline.md
sources:
  - title: "Gorilla: A Fast, Scalable, In-Memory Time Series Database (VLDB 2015)"
    url: "https://www.vldb.org/pvldb/vol8/p1816-teller.pdf"
  - title: "Prometheus documentation: Storage"
    url: "https://prometheus.io/docs/prometheus/latest/storage/"
  - title: "Prometheus documentation: Metric and label naming"
    url: "https://prometheus.io/docs/practices/naming/"
  - title: "Grafana Loki documentation: Overview"
    url: "https://grafana.com/docs/loki/latest/get-started/overview/"
  - title: "ByteByteGo: Metric monitoring"
    url: "https://blog.bytebytego.com/p/metric-monitoring"
confidence: "Compression of about 1.4 bytes per sample (delta-of-delta times and XOR'd values), two-hour blocks with an in-memory head and a write-ahead log, the disk sizing formula, the cardinality warning and the labels-only log index all come from first-party papers and documentation. The paper's own numbers check out: 700 million points a minute is about 12 million a second, about 1 trillion a day. The overview article covers only the outline (collectors, Kafka, consumers, a time-series store, query, alerting) and gives no numbers. The scale numbers in this brief are its own assumptions."
---

## Opening prompt

Let's design the platform that collects metrics and logs from all of a company's services, shows them on dashboards and pages the on-call engineer when something goes wrong. Where would you like to start?

## Hidden facts

Reveal a fact only when the candidate asks about it, or asks a question whose honest answer needs it. Never volunteer the list.

- **Users:** about 5,000 engineers. They build dashboards, search logs and own alert rules. The platform is internal.
- **Sources:** 100,000 hosts run the company's services. An agent on each host can collect metrics and logs.
- **Metrics:** a series is a metric name plus labels such as service, host, endpoint and status code. Each host has about 1,000 active series, each sampled every 10 seconds. Teams add labels freely today.
- **Logs:** about 2 million log lines a second in total, about 300 bytes each. Logs compress about 10 times. Each line has a service, a host, a level and free text.
- **Dashboards:** most look at the last 1 to 6 hours and must load in under 2 seconds. Some look at the last 30 days or the last year and may take up to 10 seconds. Data on a dashboard may be up to 30 seconds old.
- **Log search:** an engineer filters by service, level and time, then searches the text. A search over one service's last hour must answer within 10 seconds.
- **Retention:** 10-second metric data for 15 days, then 5-minute data for 13 months. Logs searchable for 14 days, then archived for 1 year and restorable within a few hours.
- **Alerts:** about 50,000 alert rules, each checked every 30 seconds. A page goes out within 1 minute of a rule's condition becoming true. An alert must never go quiet because data stopped arriving.
- **Loss:** losing a few seconds of metrics in a crash is fine. Error logs must not be dropped. Debug logs may be dropped or sampled when the platform is overloaded.
- **Late data:** when a host loses its network, the agent keeps up to 1 hour of data on local disk and sends it later.
- **Outages:** production runs in 2 regions. Monitoring must keep working and paging when production, or one whole region, is down.
- **Numbers:** a compressed sample takes about 1.5 bytes on disk. A sample in transit takes about 30 bytes before compression. A storage node holds about 5 million active series in memory at about 3 KB each. A Kafka broker takes about 100 MB a second of disk writes.
- **Out of scope:** distributed tracing, anomaly detection by machine learning, the dashboard and query UI, billing.

For the interviewer: on the numbers, give them only when the candidate asks what a node, a broker or a sample costs.

## Expected requirements

Core, functional:
1. Collect metrics and logs from every host. *Ask: What data do we collect, and from where?*
2. Query metrics for dashboards and search logs by service, level, time and text. *Ask: How do engineers look at the data?*
3. Evaluate alert rules and page within 1 minute, including when data stops. *Ask: How does someone learn that something is wrong?*

Core, non-functional:
1. 100 million active series at 10-second samples (10 million samples a second) and 2 million log lines a second. *Ask: How much data arrives each second?*
2. Recent dashboards in under 2 seconds; one service's last hour of logs in 10 seconds. *Ask: How fast must queries be, and over what time range?*
3. 10-second data for 15 days, 5-minute data for 13 months; logs 14 days hot, 1 year archived. *Ask: How long do we keep the data, and at what detail?*
4. Keeps paging when production or one region is down. *Ask: What happens to monitoring when production has an outage?*
5. A few seconds of metric loss is fine; error logs are never dropped. *Ask: Which data may we lose under pressure?*

Extras (credit when they name one, never a gap):
- Agents buffer up to 1 hour of data during a network cut.
- Dashboards may be up to 30 seconds behind.
- Teams add labels freely, so the number of series can jump.

## Capacity math

- **Sample rate:** 100,000 hosts x 1,000 series / 10 seconds is 10 million samples a second, which means a write-heavy system where every sample is tiny and individual points matter little.
- **Raw storage:** 10 million x 1.5 bytes x 86,400 is about 1.3 TB a day, about 19 TB for 15 days, which means compression (delta-of-delta times, XOR'd values) makes raw data affordable, but only for weeks.
- **Rollups:** a 5-minute point keeps min, max, sum and count, about 6 bytes. 100 million series x 288 points a day x 6 bytes is about 170 GB a day, about 68 TB for 13 months. Raw plus rollups is about 88 TB, against about 510 TB for 13 months of raw data, which means downsampling cuts storage about 6 times, before replicas.
- **Memory:** 100 million active series / 5 million per node is 20 storage nodes (15 GB of series data each), and 40 with 2 copies, which means series are sharded by a hash of name and labels, and the series count, not bytes, sizes the cluster.
- **Long queries:** a 30-day panel reads 259,200 raw points per series against 8,640 rollup points, which means long ranges must read rollups, or a panel with 100 series reads 26 million points.
- **Transport:** metrics in transit are 10 million x 30 bytes = 300 MB a second, and logs 2 million x 300 bytes = 600 MB a second, about 900 MB a second in total. With 3 copies in Kafka that is 2.7 GB a second of disk writes, about 27 brokers at 100 MB a second and more with headroom, which means the buffer is a real cluster, and logs, not metrics, drive its size.
- **Logs stored:** 600 MB a second is about 52 TB a day raw and about 5.2 TB compressed. 14 days hot is about 73 TB, and a year archived is about 1.9 PB, which means logs cost far more than metrics, archives go to object storage, and a full-text index of every line would add a large share again.
- **Log search:** one service at 1% of traffic writes about 22 GB raw in an hour (about 2.2 GB compressed). Scanning that across 20 workers is about 110 MB each, which means a labels-only index (service, level, time) plus a parallel scan meets the 10-second target without indexing every word.
- **Alerts:** 50,000 rules every 30 seconds is about 1,700 evaluations a second over recent data, which means rule evaluators read the recent in-memory store, never long-term storage.
- **Agent buffer:** a host sends 100 samples (about 3 KB) and about 20 log lines (about 6 KB) a second, about 9 KB a second, so 1 hour is about 32 MB, which means a disk buffer on each host is cheap.

## API and entities

External API:
- `POST /ingest/metrics` (agent) with a compressed batch of `{ series labels, timestamp, value }` returns `202`; `429` with `Retry-After` when the agent must back off. `POST /ingest/logs` works the same way.
- `GET /query` with `expr`, `start`, `end` and `step` returns `200 { series: [{ labels, points }] }`. The step picks raw or rollup data.
- `GET /logs/search` with `service`, `level`, `start`, `end` and `text` returns matching lines, newest first, in pages.
- `POST /alerts/rules` with `{ expr, for, severity, route }` returns `201 { ruleId }`.

Core entities:
- `Series { seriesId (hash of name and labels), name, labels }` in an inverted index from each label value to series ids.
- `Chunk { seriesId, startTime, endTime, compressedPoints }`: recent chunks in memory with a write-ahead log, older ones in blocks on disk or object storage.
- `Rollup { seriesId, bucketStart, min, max, sum, count }` at 5-minute resolution.
- `LogStream { service, host, level }` and `LogChunk { streamId, startTime, endTime, compressedLines, location }`.
- `AlertRule { ruleId, expr, for, severity, route, owner }` and `AlertState { ruleId, state (ok, pending, firing), since }`.
- `SeriesQuota { team, maxSeries, current }`.

## Reference design

```
 Host agent (scrapes local services, tails logs, 1-hour disk buffer, backs off on 429)
   └──> Ingest gateway (auth, series quota check, drops debug logs when told to) ──> Kafka (topics: metrics, logs)
            │                                                          │
            ▼                                                          ▼
   Metric storage (sharded by series hash, 2 copies)          Log writer: groups lines by stream,
     in-memory head + write-ahead log, 2-hour blocks           compresses chunks ──> object storage
     ──> blocks to object storage; compactor makes             labels-only index (service, host, level, time)
         5-minute rollups for long ranges                      14 days hot, 1 year archive tier
            │                                                          │
   Query service (picks raw or rollups by range, fans out to shards)  Log query: index ──> parallel chunk scan
            │
   Rule evaluators (each owns a slice of the 50,000 rules, read recent data every 30 s)
     ──> Alert manager (group, dedupe, silence, route) ──> pager, chat
   Meta-monitoring: a small separate stack in the other region watches this platform and pages if it goes quiet
```

Walk one sample: the agent on a host scrapes `http_requests_total{service="checkout",status="500"}` and sends it in a compressed batch with a thousand others. The ingest gateway checks the checkout team's series quota and writes the batch to Kafka. The storage consumer for that series' shard appends the point to the series' in-memory chunk and its write-ahead log; both copies do the same. After two hours the head is cut into a block on disk and later moved to object storage, where the compactor also writes 5-minute rollups. A dashboard asking for the last hour reads the in-memory chunks; one asking for the last 90 days reads rollups.

Walk one alert: a rule says "checkout 5xx rate above 2% for 2 minutes". Every 30 seconds the evaluator that owns this rule queries the recent store. At 10:00:30 the rate passes 2% and the rule turns pending; at 10:02:30 it has held for 2 minutes and fires. The alert manager groups it with related alerts from the same service and pages the checkout on-call within seconds. If the checkout series stop arriving altogether, a companion "no data" rule fires instead, so the alert never goes quiet.

## Accepted alternatives

- **Push or pull.** Agents that scrape local services and push batches (reference), central servers that scrape every target, or services that push straight to the gateway. Judge the reason: pulling knows when a target is down, pushing crosses networks and short-lived jobs more easily.
- **Buffer before storage.** Kafka (reference) absorbs bursts and lets storage restart. Writing straight to storage with agent retries and disk buffers is fine if the candidate covers storage outages and replays.
- **Time-series store.** An in-memory head with a write-ahead log and immutable compressed blocks in object storage (reference), a wide-column store with custom compression, or a managed service. Fine if compression, sharding by series and rollups are covered.
- **Making rollups.** A compaction job over finished blocks (reference) or a streaming job that aggregates before storage. Both fine; streaming makes late data harder.
- **Log index.** Labels-only with parallel scans (reference). A full-text index is fine if the candidate prices the extra storage and ingest work against faster text search. A columnar store for logs is also fine.
- **Where alerts run.** Evaluators that query the recent store (reference), or rules evaluated on the incoming stream. Both fine if a missing series is itself an alert.

## Deep dives

### Ingestion path and buffering
- **Bad:** every host writes straight into one database, with no batching and no plan for a burst or a storage outage.
- **Good:** agents batch and compress, a gateway authenticates and applies quotas, and Kafka buffers between ingest and storage. Agents keep a disk buffer and back off on `429`.
- **Great:** sizes the transport and sees logs dominate it. Uses priorities: under pressure, debug logs are sampled or dropped first and error logs never. Keeps one series' samples in order by partitioning on the series hash. Accepts a few seconds of metric loss, as the facts allow, rather than paying for synchronous replication.

### Storing time series
- **Bad:** one row per sample in a relational table: 10 million inserts a second and about 864 billion rows a day.
- **Good:** group each series' points into compressed chunks (delta-of-delta times, XOR'd values, about 1.5 bytes a point), keep the recent head in memory with a write-ahead log, cut it into immutable blocks every 2 hours, and shard by series hash.
- **Great:** 5-minute rollups that keep min, max, sum and count, so averages, spikes and dips stay visible (an average alone hides a spike), with the 6 times storage saving. Old blocks in object storage. Queries pick raw or rollups by range. Late data (up to 1 hour) is accepted into the head or into a separate out-of-order block. Two copies, not three, because the facts accept small loss.

### Cardinality control
- **Bad:** no limit on labels, so one team adds `user_id` and the cluster runs out of memory.
- **Good:** a series quota per team checked at the gateway, and a rule against unbounded label values such as user ids, request ids or email addresses.
- **Great:** finds the offending metric and label from the jump in new series, drops or rewrites that label at the gateway instead of rejecting the whole team, and alerts the owner. Shows the math: every unique label combination is a new series at about 3 KB of memory. Moves high-cardinality questions to logs or traces, where per-request detail belongs.

### Alerting you can trust
- **Bad:** alerts run as dashboard queries against long-term storage, or in the same failure domain as production with nothing watching them.
- **Good:** dedicated evaluators read the recent store every 30 seconds, rules have a "for" duration to avoid flapping, and an alert manager groups, dedupes and routes pages.
- **Great:** every critical rule has a "no data" partner, so silence pages. A small separate stack in another region watches the platform itself (a heartbeat alert that must keep arriving). When the whole pipeline stops, one "monitoring is down" page replaces 50,000 "no data" pages. Late data is handled by evaluating slightly behind real time.

### Logs at a sensible cost
- **Bad:** a full-text index on every line, kept hot for a year.
- **Good:** index only labels (service, host, level, time), compress chunks into object storage and scan in parallel for text, with 14 days hot and an archive tier.
- **Great:** sizes the 10-second search (about 2.2 GB for one service's hour) and shows the scan meets it. Keeps label sets small so chunks stay large. Samples debug logs under pressure, never error logs. Offers a full-text index only for a few chosen services when the cost is approved.

## Curveballs

Use one, at the extension point, unless the candidate already handled it.
1. **Cardinality bomb:** "A team deploys a change that adds a `request_id` label to a busy metric. Within 10 minutes the active series count goes from 100 million to 600 million. What breaks first, and what do you do?" Expect: memory, not disk. 500 million new series at about 3 KB is about 1.5 TB of memory, about 100 more storage nodes, so storage nodes run out of memory and crash, taking every team's data with them. Each request id appears once, so the new series hold one point and no value. Fix now: the gateway drops that label (or the metric) for that team, and their quota rejects new series beyond the limit. Fix later: quotas per team, a deny rule for unbounded labels, an alert on the rate of new series. Strong: says the request id belongs in logs or traces, and protects other teams first.
   Fits: Cardinality control; Storing time series
2. **Pipeline outage:** "At peak, the Kafka cluster is down for 30 minutes. What do dashboards and alerts show, and what happens when it comes back?" Expect: agents keep data on local disk (about 16 MB per host for 30 minutes, well inside the 1-hour buffer). Dashboards show a gap. Every rule sees no data, so 50,000 "no data" alerts could fire: the meta-monitoring stack sends one "pipeline down" page and holds the rest. When Kafka returns, about 1.6 TB of backlog (900 MB a second x 1,800 seconds) arrives on top of live traffic; agents send it at a limited rate, newest data first so alerts recover fast, and storage accepts the late points into the head. Strong: alert rules wait for data to catch up before firing on old points.
   Fits: Ingestion path and buffering; Alerting you can trust
3. **Billing from metrics:** "Finance wants to bill customers by the number of API requests they made each month, using the existing `api_requests_total` metric. What do you tell them?" Expect: the metrics path is built to lose a little: a few seconds lost in a crash, rollups that keep only aggregates, and counters that reset when a process restarts. That is fine for dashboards and wrong for money. Billing needs its own path: every request emits an event with an id, stored durably and counted once (dedupe by id), with reconciliation. The metric can stay as a cross-check. Strong: names the exact loss points and keeps the two paths apart instead of making metrics lossless for everyone.
   Fits: Ingestion path and buffering

## Level bar

Hire bar must show:
- Requirements that cover metrics and logs, the sample and line rates, retention at two resolutions, query speed, alert timing and which data may be lost.
- The 10 million samples a second math with compressed bytes, ending in "which means compressed chunks and rollups, not a row per sample".
- A pipeline with agents, a buffer, a time-series store sharded by series and a separate log store.
- Downsampling for long ranges, with the storage saving.
- One alert walked from a sample to a page, with a "for" duration and a "no data" rule.
- When probed, a limit on series per team for the cardinality problem.

Stretch signal:
- Sizes the transport and sees that logs, not metrics, drive the buffer and the storage cost.
- Keeps monitoring in a separate failure domain and watches the watcher.
- Drops a bad label at the gateway instead of rejecting a whole team, with the memory math.
- Plans late data and a backlog after an outage, newest first.
- Keeps billing off the lossy metrics path, with the reasons.

## Traps

- One row per sample in a relational database.
- "Keep everything raw forever" with no rollups or tiers.
- Full-text indexing every log line by default.
- No limit on labels, so one deploy takes the cluster down.
- Alerts that run against long-term storage, or that go quiet when data stops.
- Monitoring hosted in the same failure domain as what it watches, with nothing watching it.
- Synchronous three-way replication for every sample when the facts accept a few seconds of loss.
- Using the metrics path for billing.
