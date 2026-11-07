# System Design — Progress Tracker

**Teaching contract for agents:** read `TEACHING.md` before teaching anything from this file. Section 2 (how to write) and section 3 (diagrams) are the two most-violated rules, so read those twice.

## Fill this in before you start

| | |
|---|---|
| **Topic** | System design interviews |
| **Why** | Interview prep for a senior backend role |
| **Depth wanted** | Deep enough to defend under pressure |
| **Started** | 2026-08-26 |

Copy your answers into the profile block at the top of `TEACHING.md` too. The agent reads that file first.

---

## How to use this

Say to any agent:

> Read `TEACHING.md` and `TRACKER.md` in this folder. Teach me **<topic id>**. Update the tracker and notes when we're done.

Or just say **"next"** for a timed problem session, which alternates an LLD problem (B3) and an HLD problem (C2). This is the default session once the basics are in place. See `TEACHING.md` §10, *Problem sessions*.

Say **"next topic"** for a topic session instead. The agent picks the gap most recently found by a problem, or else the next unchecked item.

### Status marks

| Mark | Meaning |
|---|---|
| `[ ]` | Not started |
| `[~]` | Taught, notes written, not yet recalled |
| `[x]` | Taught **and** explained back correctly with the notes closed |

An agent may only move `[~]` to `[x]` after a **recall check**, described in `TEACHING.md` section 8. Never mark `[x]` just because a session happened.

For a **problem** in B3 or C2, `[x]` means it was solved inside the time, the code ran (for LLD), and the debrief found no gap at the target bar. An attempt that falls short is `[~]`, and gets redone cold at least a week later.

When a topic is finished, the agent appends `→ notes/<file>.md · YYYY-MM-DD` to the line.

### Rules for agents editing this file

- Edit **only** the status marks and the note links. Do not rewrite topic text or reorder items.
- Add a sub-bullet under a topic when a real gap turned up, or when the **coverage sweep** (`TEACHING.md` section 9) found
  something an interviewer could ask that this list does not name. Mark it `(added)` and leave it unchecked.
  This list is high-level topics, not an exhaustive syllabus, so expect it to grow.
- Add one row to the Session Log per session, and a row to Gaps Found & Filled whenever you stop to fill a prerequisite.

---

## Building the syllabus

The list below is a **ready example syllabus for system design interviews** (HLD, LLD and practice problems), with every mark empty. If that is your topic, trim it and start. For any other topic, delete everything from *Priority legend* through *References* and ask the agent to draft a new list:

> Draft a syllabus for **<topic>** in this tracker. Group it into sequential sections where later items genuinely depend on earlier ones. If there are two independent skills inside the topic, make them two parallel tracks instead of one long list. Tag each item 🔴 / 🟡 / ⚪ by how much it matters for **<why I'm learning this>**. Keep each item small enough to cover in one session.

Then read it yourself and cut what you do not need. A syllabus you did not agree with is a syllabus you will abandon.

**Two tracks or one?** Use two only when the topic contains two genuinely different skills that are tested separately, the way high-level design and object-oriented design are. Run parallel tracks side by side week to week rather than finishing one first. For most topics, one sequential track is right.

---

## Priority legend
🔴 High — comes up often, invest real time · 🟡 Medium — good to know · ⚪ Lower — if time allows

This example is calibrated for **SDE-2 / senior backend at Series A–C startups** — not junior, not staff, not FAANG-only prep. See `TEACHING.md` §10 for what that bar actually demands.

**Two tracks, equal weight, run in parallel.** Don't finish A before starting B — they're different skills and both get tested.

---

# Track A: HLD Building Blocks

### A1. Networking & Communication Basics 🟡
- [ ] DNS — resolution, TTL, caching
- [ ] HTTP/HTTPS — request lifecycle, headers, status codes
- [ ] HTTP/1.1 vs HTTP/2 vs HTTP/3 tradeoffs
- [ ] TCP vs UDP — when to use which
- [ ] TCP handshake, connection pooling, keep-alive
- [ ] WebSockets vs long polling vs SSE
- [ ] Proxies (forward vs reverse) and API Gateways

### A2. Scalability Fundamentals 🔴
- [ ] Vertical vs horizontal scaling — tradeoffs
- [ ] Stateless vs stateful services
- [ ] Load balancing algorithms (round robin, least connections, weighted, consistent hashing)
- [ ] Load balancer types (L4 vs L7)
- [ ] Horizontal partitioning of traffic / app-layer sharding
- [ ] Auto-scaling basics

### A3. Caching 🔴
- [ ] Why caching, where it fits (client, CDN, server, DB layer)
- [ ] Eviction policies: LRU, LFU, FIFO
- [ ] Cache invalidation strategies
- [ ] Write-through, write-back, write-around
- [ ] Distributed caching (Redis, Memcached) — internals
- [ ] Cache stampede / thundering herd + mitigations
- [ ] CDN basics — edge caching, cache headers

### A4. Databases 🔴  ← **CURRENT**
- [x] SQL vs NoSQL — when to use which, tradeoffs
- [x] ACID vs BASE
- [x] Indexing — B-Trees, B+ Trees, hash indexes
- [x] DB internals — how writes/reads actually happen (WAL, LSM trees vs B-trees)
- [x] MVCC — row versions, `xmin`/`xmax`, why an UPDATE writes a new row, bloat and VACUUM
- [x] Isolation levels — read committed, repeatable read, serializable; lost update, write skew, phantom reads
- [x] Locking — row locks, `SELECT FOR UPDATE`, deadlocks, optimistic vs pessimistic concurrency
- [x] Partitioning / sharding strategies (range, hash, directory-based) → notes/a4-sharding.md · 2026-08-29
- [x] Replication — leader-follower, multi-leader, leaderless
  - [x] Leader-follower — WAL streaming, sync vs async, failover, split brain
  - [x] How changes are shipped — statement vs physical vs logical
  - [x] Adding a follower with no downtime — base backup + WAL from an LSN, replication slots and the full-disk failure
  - [x] Multi-leader — why, write conflicts and the four rules, merge can't protect a cross-region rule, topologies and ordering, version vectors
  - [x] Leaderless — N/W/R and overlap, read repair / hinted handoff / anti-entropy, the dials, failed writes left behind
  - [x] Sloppy quorums and hinted handoff under a network split
  - [x] Deletes in leaderless — tombstones, `gc_grace_seconds`, deleted data coming back
- [x] Read replicas and replication lag → notes/a4-replication.md · 2026-09-26
  - [x] Consistent prefix reads — the sharded lag bug
- [x] Database connection pooling
  - [x] A connection held across a slow external call — pool exhaustion with an idle database, `idle in transaction`, pending-row + idempotency-key fix
  - [x] The pooler as a single point of failure — several poolers behind a load balancer, pool sizes multiply
- [x] Query optimization basics (N+1, denormalization tradeoffs)
  - [x] Why not index every column — every index adds a write per insert, plus WAL; drop unused indexes
  - [x] Covering indexes and index-only scans — `INCLUDE`, the costs, the visibility map
  - [ ] Why a query ignores an index — a function on the column, such as `lower(email)`, needs an expression index (added)

### A5. Consistency & Distributed Systems Theory 🟡
*Needs A4 — consistency models only make sense after replication + partitioning.*
- [ ] CAP theorem — practical implications, not just the definition
- [ ] PACELC theorem
- [ ] Strong vs eventual vs causal consistency
- [ ] Quorum reads/writes (N, R, W)
- [ ] Consensus — Paxos, Raft (conceptual only)
- [ ] Fencing during failover — stopping the old leader from writing
- [ ] Distributed transactions — 2PC, Saga pattern
- [ ] Vector clocks / logical clocks (conceptual)
- [ ] Idempotency in distributed systems

### A6. Messaging & Async Processing 🟡
- [ ] Message queues — producer/consumer, at-least-once vs exactly-once vs at-most-once
- [ ] Pub-Sub pattern
- [ ] Kafka basics — partitions, consumer groups, offsets
- [ ] Event-driven architecture basics
- [ ] Dead-letter queues, retry strategies for async jobs
- [ ] Batch vs stream processing (conceptual)
- [ ] Transactional outbox + the dual write problem; polling relay vs CDC relay
- [ ] Idempotent consumers — dedupe table in the same transaction, idempotency keys on external calls
- [ ] Producer durability — `acks`, ISR, `min.insync.replicas`, producer idempotence
- [ ] Consumer lag and backpressure — the operational metric; RabbitMQ prefetch / unacked limits
- [ ] Fat vs thin events — event-carried state transfer vs event notification

### A7. API Design 🔴
- [ ] REST API design principles
- [ ] GraphQL — when it beats REST
- [ ] gRPC basics — when to use over REST
- [ ] Rate limiting algorithms (token bucket, leaky bucket, sliding window)
- [ ] API versioning strategies
- [ ] Pagination (offset vs cursor-based)

### A8. Reliability & Fault Tolerance 🟡
*If your day job has a strong fault-tolerance model (Erlang/Elixir supervision trees, Go contexts and cancellation, a pager rotation), this section is free depth. Say so explicitly in interviews.*
- [ ] Redundancy and failover strategies
- [ ] Circuit breaker pattern
- [ ] Retry with exponential backoff + jitter
- [ ] Timeouts and bulkheading
- [ ] Health checks and heartbeats
- [ ] Graceful degradation
- [ ] Disaster recovery basics (RTO/RPO)

### A9. Observability 🟡
- [ ] Logging at scale (structured, centralized)
- [ ] Metrics and monitoring (latency, traffic, errors, saturation)
- [ ] Distributed tracing basics
- [ ] Alerting strategy basics

### A10. Security Basics 🟡
- [ ] Authentication vs Authorization
- [ ] OAuth 2.0 / JWT basics
- [ ] Encryption at rest vs in transit
- [ ] DDoS protection concepts, rate limiting as defense

### A11. Storage Systems ⚪
- [ ] Object/blob storage concepts (S3-like)
- [ ] File vs block vs object storage
- [ ] CDN + storage for media-heavy systems

### A12. Search Systems ⚪
- [ ] Inverted index basics
- [ ] Elasticsearch / Lucene — conceptual overview

### A13. Capacity Estimation 🟡
*Needs A1–A4 as inputs.*
- [ ] Back-of-the-envelope — QPS, storage, bandwidth
- [ ] Practice: one read-heavy and one write-heavy system

### A14. Microservices vs Monolith 🔴
*Needs A1–A9 — you can't reason about service boundaries without scaling, DBs and messaging first.*
- [ ] Monolith vs microservices — real tradeoffs
- [ ] Service decomposition — business capability, bounded contexts (DDD, conceptual)
- [ ] Distributed monolith anti-pattern
- [ ] Shared-database anti-pattern
- [ ] Inter-service comms — sync (REST/gRPC) vs async (messaging)
- [ ] API Gateway pattern in practice
- [ ] Service discovery basics
- [ ] Strangler Fig — migrating a monolith incrementally

### A15. Infra & DevOps Basics 🟡
- [ ] Docker basics — images, containers, why containerization matters
- [ ] Kubernetes fundamentals — pods, services, deployments
- [ ] CI/CD pipeline basics
- [ ] Cloud basics (AWS/GCP) — LBs, managed DBs, object storage, serverless
- [ ] Infrastructure as Code — conceptual (Terraform-level)
- [ ] Prometheus/Grafana — conceptual
- [ ] Environment management — dev/staging/prod, feature flags

---

# Track B: LLD / OOP Design

*Equal priority to Track A. Independent skill — runs in parallel, not after. Practised as timed machine coding in the language from the profile block, typed by the learner. See `TEACHING.md` §12.*

### B1. Foundations
- [ ] SOLID principles — with real examples, not definitions
- [ ] Composition over inheritance — when and why
- [ ] Basic UML — class diagrams, relationships (association, aggregation, composition)
- [ ] When NOT to apply SOLID — the indirection tax, picking the axis that varies, the rule of three
- [ ] DIP vs dependency injection — the shape vs the plumbing

### B2. Design Patterns
*Learnt inside B3 problems, never as a list. Mark a pattern once a problem has used it for real.*
- [ ] Creational: Singleton, Factory, Builder
- [ ] Structural: Adapter, Decorator, Facade
- [~] Behavioral: Strategy, Observer, State, Command → notes/b3-vending-machine.md · 2026-10-19 · notes/b3-parking-lot.md · 2026-10-25

### B3. Applied Practice — Classic LLD Problems
*The core of Track B. Each problem is a timed machine coding round: 90 minutes in your chosen language, then one new requirement.*
- [ ] LRU Cache (code-level)
- [ ] Parking Lot
- [ ] Vending Machine
- [ ] Tic-Tac-Toe / Chess
- [ ] Elevator System
- [ ] Library Management System
- [ ] Splitwise (expense sharing)
- [ ] Notification Service (class-level)
- [ ] Hotel/Movie Ticket Booking System

---

# Capstone: Application & Interview Practice

*Runs now, alongside both tracks. Timed problems are the default session, and topic sessions fill the gaps they expose.*

### C1. Interview Framework / Process 🔴
*Learnt by doing C2 problems, not in separate sessions.*
- [ ] Requirements gathering (functional vs non-functional)
- [ ] Structure: high-level design → deep dive → bottleneck identification
- [ ] Trade-off articulation — practice saying "why X over Y" out loud

### C2. Classic HLD Problems 🔴
- [ ] URL Shortener
- [~] Rate Limiter → notes/c2-rate-limiter.md · 2026-10-24
- [ ] Notification System
- [ ] Chat/Messaging System (WhatsApp)
- [ ] News Feed (Twitter/Instagram)
- [ ] Ride-Sharing (Uber)
- [ ] Video Streaming (YouTube/Netflix)
- [ ] Distributed Cache (design a Redis)
- [ ] Distributed Job Scheduler
- [ ] Payment/Transaction System
- [ ] Web Crawler
- [ ] E-commerce Checkout / Inventory

---

# References — vetted

**For agents:** prefer these over generic search. When you cite one, cite the *specific* chapter, post or talk — never just the homepage. If a topic below has no listed source, say so rather than inventing one.

Tiers: ⭐ **start here** · ◆ go deeper · ○ reference / lookup

## The three that matter most

- ⭐ **Designing Data-Intensive Applications**, Martin Kleppmann *(book)* — the single best source for A4–A6. Ch 3 storage engines, Ch 5 replication, Ch 6 partitioning, Ch 7 transactions, Ch 9 consistency & consensus, Ch 11 streams. If only one thing gets read, this.
- ⭐ **Amazon Builders' Library** — https://aws.amazon.com/builders-library/ — free, written by AWS principal engineers about systems that actually carry load. Best free source for A8 (timeouts, retries with jitter, health checks, load shedding) and A2 (load balancing, shuffle sharding).
- ⭐ **Google SRE Book** — https://sre.google/books/ — free. Ch 21 handling overload, Ch 22 cascading failures, Ch 6 SLIs/SLOs. Best for A8 + A9.

## By topic

**A1 Networking**
- ◆ Hussein Nasser — https://www.youtube.com/@hnasr — TCP/TLS/HTTP internals, protocol-level depth. Best video source for this section.
- ○ *High Performance Browser Networking*, Ilya Grigorik — free at https://hpbn.co — Ch 1–2 (latency, TCP), Ch 12 (HTTP/2). Authoritative on why HTTP/2 and /3 exist.

**A2 Scaling · A3 Caching**
- ⭐ AWS Builders' Library — "Workload isolation using shuffle-sharding", "Using load shedding to avoid overload".
- ◆ Arpit Bhayani — https://www.youtube.com/@AsliEngineering — caching, consistent hashing, backend internals. Startup-relevant depth, not interview theatre.
- ○ Redis docs, "Client-side caching" and "Redis persistence" pages — short, and correct.

**A4 Databases**
- ⭐ DDIA Ch 3 — B-trees vs LSM trees, the whole chapter is the topic.
- ⭐ **The Internals of PostgreSQL**, Hironobu Suzuki — https://www.interdb.jp/pg/ — free. Ch 9 WAL, Ch 5 concurrency control, Ch 6 vacuum. Directly relevant if Postgres is the database you run.
- ◆ **Database Internals**, Alex Petrov *(book)* — Part I goes deeper on B-tree/LSM mechanics than DDIA does.
- ⭐ **Use The Index, Luke** — https://use-the-index-luke.com — free, the best indexing resource anywhere. Read it before saying anything about indexes in an interview.
- ○ Postgres docs, "Write-Ahead Logging" and "EXPLAIN" chapters.

**A5 Consistency & distributed systems**
- ⭐ DDIA Ch 5, 7, 9.
- ⭐ **Jepsen analyses** — https://jepsen.io/analyses — real databases making consistency claims and failing them under test. The best "wait, *really*?" material in the whole field.
- ◆ **Marc Brooker's blog** — https://brooker.co.za/blog/ — AWS principal engineer. Consistency, retries, timeouts, why exactly-once is a lie.
- ◆ Martin Kleppmann — https://martin.kleppmann.com — his free Cambridge *Distributed Systems* lecture series (video + notes) is linked there; also "How to do distributed locking", the Redlock critique.
- ○ **MIT 6.5840 Distributed Systems** — https://pdos.csail.mit.edu/6.824/ — free lectures, papers, labs. Only if the itch gets serious; this is a semester, not an evening.
- ○ *The Raft paper* ("In Search of an Understandable Consensus Algorithm") — readable, unlike Paxos. Plus https://raft.github.io for the visualisation.

**A6 Messaging**
- ⭐ Jay Kreps, **"The Log"** — https://engineering.linkedin.com/distributed-systems/log-what-every-software-engineer-should-know-about-real-time-datas-unifying — long, free, and it connects A4's WAL to Kafka to CDC to event sourcing in one idea. Read after A4.
- ⭐ Kafka docs, **Design** section — https://kafka.apache.org/documentation/#design — short and unusually honest about tradeoffs and delivery semantics.
- ○ Confluent Developer — https://developer.confluent.io — free courses, good structure, mildly vendor-flavoured.

**A7 API design**
- ○ Stripe and GitHub public API docs — the best worked examples of versioning, pagination and idempotency keys in existence. Read them as *design specimens*.
- ◆ AWS Builders' Library, "Making retries safe with idempotent APIs".

**A8 Reliability**
- ⭐ AWS Builders' Library: "Timeouts, retries and backoff with jitter", "Implementing health checks", "Avoiding fallback in distributed systems".
- ◆ Google SRE Book Ch 22, cascading failures.
- ○ *Release It!*, Michael Nygard *(book)* — where the circuit breaker and bulkhead patterns come from. Ch 4–5.

**A9 Observability**
- ⭐ Google SRE Book Ch 6 (SLIs/SLOs) and Ch 10 (monitoring).
- ◆ Brendan Gregg — https://brendangregg.com — the USE method; how to reason about saturation.

**A13 Capacity estimation**
- ⭐ Latency numbers, interactive by year — https://colin-scott.github.io/personal_website/research/interactive_latency.html — memorise the shape of it.

**A14 Microservices**
- ⭐ Martin Fowler — https://martinfowler.com/microservices/ — including "MonolithFirst" and the Strangler Fig article. The honest case, not the hype.
- ○ *Building Microservices* 2nd ed., Sam Newman *(book)* — Ch 1–4 on boundaries.

**Track B — LLD**
- ⭐ **Refactoring.Guru** — https://refactoring.guru/design-patterns — clearest pattern reference, with C++ examples for every one.
- ⭐ **awesome-low-level-design** — https://github.com/ashishps1/awesome-low-level-design — the problem set for B3. Solutions are mostly Java; the class design transfers to C++ almost line for line.
- ◆ *Head First Design Patterns* *(book)* — the best book for actually *getting* why a pattern exists. Java examples, ignore the syntax.
- ○ *Design Patterns* (Gang of Four) — reference only. Don't read it front to back.
- ◆ Dan North, **"CUPID — for joyful coding"** — https://dannorth.net/cupid-for-joyful-coding/ — the serious critique of SOLID. Knowing the counter-argument is what separates someone who understands the principles from someone who memorised the acronym.

**Interview format & practice**
- ⭐ **Hello Interview** — https://www.hellointerview.com/learn/system-design — free, written by ex-FAANG staff engineers, and unusually good on *how to run the 45 minutes*. Best source for C1.
- ○ *System Design Interview* Vol 1 & 2, Alex Xu *(book)* — good for problem structure and the shape of an answer. Shallow on internals — use it for C2 format, not for learning A4–A6.
- ○ **System Design Primer** — https://github.com/donnemartin/system-design-primer — use as a coverage checklist, not as a teacher. Broad and thin.

**War stories** — for the "wait, really?" moment in every session
- ⭐ **post-mortems collection** — https://github.com/danluu/post-mortems — a curated index of real public outages. Pick one that matches the topic being taught.
- ◆ Cloudflare and GitHub engineering blogs — both publish genuinely detailed incident write-ups.

---

# Gaps Found & Filled

Fundamentals that surfaced mid-session and got taught. **This is ground covered, not a list of failures.** It is often the most valuable part of a session.

| Date | Gap | Came up while | Filled? |
|---|---|---|---|
| 2026-08-27 | `fsync` vs `write()` — page cache and the drive's own volatile cache | Why a write-ahead log exists at all | Yes |
| 2026-09-26 | Why a replica can show a newer row before an older one | Read replicas and replication lag | Yes |
| 2026-10-25 | `enum class` values compare in declaration order, so `size >= type` is the fit rule | "why does that comparison work?" | Yes — taught directly |

---

# Session Log

*One line per session, newest at the bottom.*

| Date | Topic(s) | Outcome | Notes file |
|---|---|---|---|
| 2026-08-26 | — | Folder and tracker set up | — |
| 2026-10-19 | **C2 Rate Limiter**, part 1 — requirements, then fail open versus fail closed and fixed windows | Guided session; the algorithms were new, so it turned into teaching | notes/c2-rate-limiter.md |
| 2026-10-22 to 2026-10-24 | **C2 Rate Limiter**, part 2 — sliding window counter, token bucket, shared counter and a Lua script | `[~]` (guided; redo cold later). Strong on the capacity math. Missed the hot-key case | notes/c2-rate-limiter.md |
| 2026-10-25 | **B3 Parking Lot** — timed, 120 minutes | `[~]` — the entrance search was unwritten at the deadline; redo cold in a week | notes/b3-parking-lot.md |
