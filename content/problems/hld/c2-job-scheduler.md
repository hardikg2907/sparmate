---
id: c2-job-scheduler
track: hld
title: Distributed Job Scheduler
difficulty: medium
tags: [scheduling, leases, at-least-once, job-queue, fairness]
tracker:
  section: "### C2. Classic HLD Problems"
  bullet: "Distributed Job Scheduler"
notesFile: notes/c2-job-scheduler.md
---

## Opening prompt

Let's design a distributed job scheduler. Teams submit jobs that must run at a set time, once or on a cron schedule, and the jobs run on a fleet of workers. Where would you like to start?

## Hidden facts

Reveal a fact only when the candidate asks about it, or asks a question whose honest answer needs it. Never volunteer the list.

Terms: a **job** is what a tenant submits, one-off or cron. A **run** is one execution of a job at one due time. An **attempt** is one try at a run.

- **Who submits:** about 2,000 tenants (teams and their services) through an API. Auth is out of scope.
- **What a job is:** a task type, a JSON payload (at most 64 KB, typically under 1 KB) and options: priority, retry policy, timeout. There are about 500 task types. Every worker already has the code for every task type. Deploying code and placing containers on machines are out of scope.
- **Kinds:** one-off (run now, or at a set time up to 30 days ahead; a time in the past runs at once) and cron (a standard cron expression plus a time zone, at most once a minute).
- **Volume:** 100 million one-off jobs a day. 5 million active cron schedules, which together fire 100 million runs a day. So 200 million runs a day.
- **Lead time:** 90% of one-off jobs are due within an hour of creation. The other 10% are spread evenly up to 30 days ahead.
- **Submit rate:** about 3 times the daily average at peak, so about 3,500 submits a second across all tenants.
- **Hourly burst:** schedules bunch on the hour. At minute 0 of every hour, about 600,000 runs fall due at the same second, on top of the normal flow.
- **Start-time target:** outside the first minute of each hour, 99% of runs start within 5 seconds after their due time. In that first minute, high priority keeps 5 seconds and the rest must start within 60 seconds. A run must never start early.
- **Run time:** about 5 seconds on average, 99% under a minute. Timeout per job: default 10 minutes, maximum 1 hour.
- **Workers:** Kubernetes pods. One pod runs up to 20 runs at once. The fleet can autoscale, but a new pod takes about 2 minutes to be ready.
- **Guarantee:** at least once. A job the API accepted must never be lost, even if a zone dies. A rare duplicate run is fine if it carries the same run id, so the handler can drop it. Exactly once is not required.
- **Failures:** about 1% of attempts fail. A downstream outage can make every run of one task type fail for minutes.
- **Retries:** default 5 attempts in total, waiting 30 seconds, then 1, 2 and 4 minutes, with jitter. A tenant can set 1 to 10 attempts. A handler can mark an error permanent, which skips the remaining attempts. A run that passes its timeout counts as a failed attempt. After the last attempt the run is dead: the tenant sees it with its last error and can re-run it for 30 days.
- **Priorities:** high, normal and low. High is about 5% of runs, for work a person is waiting on. Low is about 10%, and the rest is normal. Low must not starve.
- **Fairness:** each tenant may have at most 2,000 runs in flight (raisable) and may create at most 1,000 jobs per second. A tenant's flood may delay that tenant's own runs, never other tenants'. The start-time targets count only runs inside the tenant's limit. Apart from that, no run waits more than 10 minutes past its due time.
- **Cron rules:** if the previous run of a schedule is still going (queued, running or waiting to retry), skip the new one, and the schedule carries on with its next fire. After an outage, run a missed schedule once, not once per missed fire. A daylight-saving gap runs at the next valid minute; a repeated hour runs once.
- **Cancel and pause:** a tenant can cancel a job or pause a schedule. A run that has not started must not start after the cancel returns. Stopping a run in progress is best effort. A pause cancels the waiting run, and a resume picks the next fire after that moment. Editing a job is out of scope: the tenant cancels it and submits a new one.
- **Status:** a tenant can see each job's state and attempts (times, worker, error) for 30 days. About 500 status reads a second at peak, mostly for jobs from the last hour.
- **Results:** the scheduler records success, or the last error (at most 4 KB). It keeps no job output and sends no callback; tenants poll the status API.
- **Availability:** the submit API at 99.99%. Losing one machine or one whole zone may delay some runs by up to 2 minutes, no more.
- **Clocks:** servers use NTP and agree within about 10 ms, but a paused process can wake up a minute late.
- **Regions:** one region with three zones.
- **Out of scope:** job dependencies (run B after A succeeds), a UI and billing.

## Expected requirements

Core, functional:
1. Submit a job to run now or at a set time: task type, payload, priority, retry policy. *Ask: What can a tenant submit, and when can it run?*
2. Create, pause and delete cron schedules with a time zone. *Ask: Are all jobs one-off, or can they repeat?*
3. Run each due run on workers; retry failures with backoff; mark it dead after the last try. *Ask: What happens when a run fails?*

Core, non-functional:
1. About 200 million runs a day: 2,300 a second on average, 12,000 at the top of the hour. *Ask: How many runs a day, and when is the busiest moment?*
2. At least once: an accepted job is never lost, even when a zone dies. *Ask: Can an accepted job ever be lost?*
3. Outside the top of the hour, 99% of runs start within 5 seconds of due time, never early. *Ask: How close to its due time must a run start?*
4. One tenant cannot delay other tenants, and low priority does not starve. *Ask: What if one tenant submits far more than the others?*
5. No single point of failure; losing a machine or zone delays runs by 2 minutes at most. *Ask: What happens to runs if a machine or a zone fails?*

Extras (credit when they name one, never a gap):
- A dead run can be inspected and re-run by the tenant.
- Cancel a job before it starts. Stopping a run already in progress is best effort.
- Show each job's state and attempt history for 30 days.
- Rare duplicate runs carry the same run id.
- In the first minute of each hour, high priority starts within 5 seconds and the rest within 60.
- The submit API is 99.99% available.

## Capacity math

- **Runs:** 200 million a day is about 2,300 per second on average. At the top of the hour, 600,000 runs started within 60 seconds add 10,000 per second, so the peak is about 12,000 per second, which means the store and the dispatch path are sized for the burst, about 5 times the average.
- **Store writes:** each run costs about 4 transactions on its shard: create, hand to the queue, claim by a worker, and finish (which also moves the run to history). That is about 9,000 per second on average and 48,000 at peak, which means this system is write-heavy, unlike most read-heavy designs. A queue table churns: every update leaves a dead row for vacuum and moves index entries. At a planning budget of about 4,000 such writes per second per Postgres primary, the peak needs 12 primaries, which means sharding the store: 16 shards by a hash of the job id, about 3,000 writes per second each at peak.
- **Heartbeats:** at peak about 60,000 runs are in flight (12,000 per second times 5 seconds). One heartbeat per run every 10 seconds adds up to 6,000 writes per second, about 375 per shard, which means per-run leases still fit the budget. Tracking liveness per worker instead (3,000 pods every 10 seconds, 300 writes per second) is the cheaper option if the store gets tight.
- **Workers:** on average, 2,300 per second times 5 seconds is about 11,500 runs in flight, about 600 pods at 20 runs each. The burst needs 60,000 in flight, so 3,000 pods. A new pod takes 2 minutes, which means the fleet scales up a few minutes before each hour, from the count of runs due next, not in reaction to the burst. A fixed fleet of 600 pods has about 500 free slots and would need about 100 minutes to clear one burst (600,000 runs times 5 seconds is 3 million slot-seconds).
- **Waiting runs:** by Little's law (count equals rate times wait), 90 million a day waiting about 30 minutes is about 2 million, and 10 million a day waiting about 15 days is 150 million. Each cron schedule keeps one future run: 5 million more. About 160 million waiting rows at about 1 KB is about 160 GB, 10 GB per shard, which means a partial index on due time finds the due slice without a scan, and far-future rows only cost disk.
- **History:** 200 million finished runs a day at about 1 KB is 200 GB a day and 6 TB for 30 days, which means finished runs leave the hot runs table for history in day partitions. Dropping a day partition is cheap; deleting 200 million rows a day is not.
- **Status reads:** about 500 a second at peak, about 30 per shard, which means reads are small next to 48,000 writes, and the design is write-bound.
- **Dispatch:** 12,000 per second over 16 shards is 750 per shard, about 375 per 500 ms tick, which means one dispatcher per shard keeps up easily. The store is the limit, not the dispatcher.

## API and entities

External API:
- `POST /jobs` with `{ taskType, payload, runAt?, priority?, maxAttempts?, timeoutSeconds?, idempotencyKey }` returns `201 { jobId, runAt }`. The `jobId` is derived from the tenant and the `idempotencyKey`, so a retried submit hashes to the same shard, where the unique index catches it. A repeated `idempotencyKey` returns the first job with `200`. `400` for a bad payload or a `runAt` over 30 days ahead, `429` over the tenant's create rate.
- `POST /schedules` with `{ taskType, payload, cron, timeZone, priority?, maxAttempts?, timeoutSeconds?, idempotencyKey }` returns `201 { jobId, nextRunAt }`. `PATCH /schedules/{jobId}` pauses or resumes it; `DELETE /schedules/{jobId}` removes it.
- `DELETE /jobs/{jobId}` returns `204` if the run had not started, `202` if it is running (stopping is best effort).
- `GET /jobs/{jobId}` returns the job, its runs and each run's attempts (worker, start, end, outcome, error).
- `GET /runs?state=dead` lists dead runs; `POST /runs/{runId}/retry` re-runs one: it creates a fresh run of the same job due now, so the re-run has a new run id.

Worker API (internal, same stateless tier):
- A worker pulls `{ runId }` from a ready queue, then calls `POST /runs/{runId}/claim { workerId }`: `200 { attempt, leaseUntil, payload }`, or `409` when the run is no longer queued (a duplicate message or a cancel), so the worker drops it.
- `POST /runs/{runId}/heartbeat { attempt }` returns `200 { leaseUntil, stop }`, or `409` when that attempt lost its lease.
- `POST /runs/{runId}/finish { attempt, outcome: ok | retry | permanent, error? }` returns `200`, or `409` when fenced.

Core entities:
- `Job { jobId (a hash of tenantId and idempotencyKey), tenantId, kind (once | cron), taskType, payload, priority, maxAttempts, timeoutSeconds, cron?, timeZone?, pausedAt?, idempotencyKey }`, unique `(tenantId, idempotencyKey)`.
- `Run { runId (jobId plus fireAt, so it names its shard), jobId, tenantId, priority, fireAt, dueAt, state, attempt, queuedAt?, leaseOwner?, leaseUntil?, lastError? }`, unique `(jobId, fireAt)`. `fireAt` is the scheduled time; `dueAt` starts there and moves later on each retry. Partial indexes: `dueAt` where state is `SCHEDULED`, `leaseUntil` where state is `LEASED`, `queuedAt` where state is `QUEUED`.
- `Attempt { runId, attempt, workerId, startedAt, finishedAt, outcome, error }`, in day partitions, kept 30 days.

Run states: `SCHEDULED → QUEUED → LEASED → SUCCEEDED`. A failure or a lost lease sends `LEASED` back to `SCHEDULED` with a later `dueAt`, or to `DEAD` after the last attempt. Cancel moves `SCHEDULED` or `QUEUED` to `CANCELLED`. A cron run whose previous run is not finished (queued, leased or waiting to retry) becomes `SKIPPED`, and its next run is still inserted. Pausing a schedule cancels its waiting run; resuming inserts the next one.

## Reference design

```
 submit:   Tenant ──> LB ──> API (stateless, 3 zones) ──> insert Job + first Run, one transaction
                                                            │
           Postgres, 16 shards by hash(jobId); each shard a primary and two standbys in the other zones, commit waits for one of them

 dispatch: Dispatcher pods (4 or more). Each shard is owned by one pod at a time, via a lease in etcd.
           Every 500 ms per owned shard, in one transaction:
             1. pick due runs: SCHEDULED and dueAt <= now(), high priority first, rotating across
                tenants under their limit, FOR UPDATE SKIP LOCKED, only as many as the ready queues lack
             2. set QUEUED; for a cron run, insert its next run at the first cron time after now()
                (one catch-up run after an outage, not one per missed fire)
             3. reaper: LEASED and leaseUntil < now()  ──> SCHEDULED with backoff, or DEAD
                        QUEUED for over 60 s           ──> SCHEDULED, no attempt counted
           After commit: publish run ids ──> ready queues (high / normal / low), a few seconds deep

 execute:  Worker pods (20 slots, autoscaled) <── pull high first; low gets at least 1 pull in 10
             claim:     QUEUED to LEASED, attempt + 1, leaseUntil = now() + 30 s   (409: drop it)
             run the handler with runId as its idempotency key
             heartbeat: every 10 s, extend leaseUntil WHERE attempt matches
             finish:    SUCCEEDED, retry later, or DEAD, WHERE attempt matches     (409: fenced)

 history:  finished runs and attempts ──> day partitions, dropped after 30 days
```

Walk one run: a tenant submits a one-off job due at 10:00:00. The API derives the job id from the tenant and the idempotency key, hashes it to shard 7 and inserts the job and its `SCHEDULED` run in one transaction. At 10:00:00.4 the dispatcher that owns shard 7 marks the run `QUEUED` and publishes its id to the normal queue. A worker pulls it and claims it: attempt 1, lease until 10:00:30. The handler finishes at 10:00:05, and finish with attempt 1 marks the run `SUCCEEDED` and moves it to history.

Walk the burst: at 09:00:00, 600,000 runs fall due. Dispatchers queue only as many as the ready queues lack, so most runs wait as `SCHEDULED` rows, and no lease ticks while a run waits. High priority goes first on every tick. The fleet scaled up at 08:55.

Walk a crash: the worker dies at 10:00:02. The lease passes at 10:00:30, and the reaper moves the run back to `SCHEDULED`, due 30 seconds later plus jitter. Attempt 2 runs elsewhere with the same run id, so a step the first attempt finished is not repeated. A lost message leaves the run `QUEUED`; after 60 seconds it goes back to `SCHEDULED` with no attempt counted. A duplicate message fails its claim. A cancel moves a `SCHEDULED` or `QUEUED` run to `CANCELLED`, so a later claim fails and the run never starts.

Walk a cron fire: the dispatcher queues the 09:00 run of a schedule and inserts the 10:00 run in the same transaction; the unique `(jobId, fireAt)` stops a second insert. If the 08:00 run is still unfinished at 09:00, the 09:00 run becomes `SKIPPED` and the 10:00 run is inserted all the same. After a three-hour outage, the dispatcher queues the 09:00 run late and inserts the next run after the current time, so the schedule runs once to catch up.

## Accepted alternatives

- **Store.** Postgres sharded by job id (the reference) or MySQL. DynamoDB or Cassandra with a time-bucket partition key plus a shard suffix (for example `2026-10-29T09:00#17`) and due time as the sort key. What matters is a range read on due time and a conditional write for the claim. Any shard count from about 8 to 32 is fine when the stated per-primary write budget covers 48,000 writes per second divided by the shard count. With fewer than 12 primaries at the 4,000 budget, the candidate must defend a higher budget or cut the writes per run.
- **Finding due runs.** Polling an index on due time every second or faster (the reference). Or two layers: the store plus a near-term delay queue loaded a few minutes ahead, such as a Redis sorted set scored by due time, SQS delay messages (up to 15 minutes) or an in-memory timing wheel. This is fine if a crash rebuilds the near-term layer from the store, and a job created inside the loaded window goes straight into it.
- **Who dispatches.** One owner per shard through a lease in etcd, ZooKeeper, a Kubernetes Lease or a Postgres advisory lock. Or no owner: several dispatchers per shard competing through `SKIP LOCKED`. A single leader with a hot standby is acceptable as a first version if the candidate shows it can claim 12,000 runs per second in batches and accepts a failover gap of seconds.
- **Hand-off to workers.** Any at-least-once queue (RabbitMQ, SQS, Redis Streams, Kafka), because the state lives in the store: a lost message costs a 60-second wait, and a duplicate fails its claim. Workers long-polling the dispatchers also works. Workers claiming straight from Postgres with `SKIP LOCKED`, as Postgres job-queue libraries do, is fine at smaller scale. Here 3,000 pods times 16 shards means 48,000 connections and as many polls per second.
- **Priority.** One ready queue per priority with a pull ratio (the reference), or a separate worker pool per priority sized to its share. Pools are simpler but waste idle slots, so the candidate should say how low and high borrow from each other.
- **Lease granularity.** A lease per run (the reference), or liveness per worker: one heartbeat per pod, each run records its worker, and the reaper recovers the runs of a dead worker. A per-run timeout still catches a hung handler.
- **Cron expansion.** One future run per schedule (the reference), or a periodic job that creates the next hour of runs for every schedule. Both need the unique `(jobId, fireAt)`. The periodic job is fine only if the overdue runs of one schedule collapse into one at dispatch.
- **Existing engines.** Naming Quartz in cluster mode, Temporal or Airflow is fine as an aside. The candidate still designs the internals.

## Deep dives

### Finding due runs without one scheduler
- **Bad:** one scheduler process that selects every job with `runAt <= now()` each second and keeps timers in memory. It is a single point of failure, and a second copy "for safety" runs every job twice. Or partitioning the store by due hour, which puts every current read and write on one partition.
- **Good:** a partial index on due time over waiting runs only. Dispatchers claim a batch with `FOR UPDATE SKIP LOCKED` and change its state in the same transaction, so two dispatchers never take the same run. Several dispatcher pods with shard ownership or leader election. A tick of a second or less meets the 5-second target.
- **Great:** shards by job id, so each shard's due slice is small and the burst spreads evenly. Says shard ownership is only for efficiency: the row-level claim gives correctness, so two dispatchers on one shard during a handover cause no double run. Keeps the runs table small (finished runs move to history) so the due index and vacuum keep up. Uses the database's `now()` as the one clock. Knows when a near-term delay layer earns its place (sub-second precision) and how it is rebuilt after a crash.

### Leases, heartbeats and at-least-once
- **Bad:** the worker acks or deletes the message, then runs the job, so a crash loses it (at most once). Or "exactly once with Kafka transactions". Or a fixed visibility timeout with no heartbeat, so a job longer than the timeout gets a second copy while the first still runs.
- **Good:** a claim gives the worker a 30-second lease, heartbeats every 10 seconds renew it, and the reaper returns runs whose lease passed. Explains the duplicate window (the effect happened, then the worker died before finish) and makes handlers idempotent on the run id: a unique key in the handler's own table, or the run id as an external API's idempotency key.
- **Great:** the attempt number is a fencing token. Heartbeat and finish update only `WHERE attempt = :mine`, so a late finish from a paused worker is rejected. The worker stops itself when it cannot renew before its own deadline. Knows the fence cannot recall an external call already made, so the downstream must dedupe on the run id. Adds a hard timeout per run, because a heartbeat thread can keep a hung handler alive forever.

### Retries, backoff and dead runs
- **Bad:** retry at once, in a loop, with no cap, or keep the retry timer in worker memory where a crash loses it. A downstream outage then becomes a retry storm.
- **Good:** a retry is the same run rescheduled: `dueAt = now + backoff`, exponential with jitter and a cap. After the last attempt the run is `DEAD` with its last error, visible and re-runnable. Permanent errors skip the rest. A dead cron run does not stop its schedule.
- **Great:** counts the attempt at claim, before the handler runs, so a poison run that crashes its worker (out of memory) still reaches `DEAD` instead of looping forever. A per-task-type circuit breaker pauses dispatch when most attempts of one type fail, so a downstream outage neither burns every run's attempts nor hammers the downstream. Alerts the tenant on dead runs, and pauses a schedule after several dead runs in a row.

### Priorities, tenant fairness and the hourly burst
- **Bad:** one global queue ordered by due time, so one tenant's 5 million runs block everyone. Strict priority with no guard, so low starves. Pushing every due run into a deep queue at once: priority stops mattering once runs are in line, and nothing holds a tenant back.
- **Good:** a per-tenant in-flight limit checked at dispatch. The claim takes high priority first. One ready queue per priority, with a reserved share for low.
- **Great:** keeps the ready queues a few seconds deep, so priority and fairness are decided at dispatch, just before a run starts. Rotates across tenants that have due work, with an index on `(tenantId, dueAt)`, so a flooded tenant's rows are not read and skipped every tick. Splits each tenant's limit across shards (2,000 over 16 is 125 per shard), which works because hashing by job id spreads every tenant evenly. Scales workers up before each hour from the count of runs due next. Offers stable jitter, spreading a schedule's fire time across the minute by a hash of its id, where the tenant allows.

## Curveballs

Use one, at the extension point, unless the candidate already handled it.
1. **Tenant flood (hot spot):** "A tenant imports 5 million one-off jobs, all due at 09:00:00 tomorrow. What happens at 09:00?" Expect: hashing by job id spreads them over 16 shards, about 312,000 each, so no single shard takes the spike. A time-bucket key with no suffix would put all 5 million on one partition. The tenant's limit of 2,000 in flight at 5 seconds a run allows 400 runs per second, so the import drains in about 3.5 hours (5 million divided by 400 is 12,500 seconds). Other tenants see no delay, because dispatch skips a tenant at its limit without rereading its rows, and the 2,000 slots the flood holds (100 pods) come from fleet headroom or a scale-up. Product options: warn the tenant at submit time, raise its limit for the window with pre-scaled workers, or spread the due times.
2. **Paused worker (failure):** "A worker running a job that charges customers freezes for 90 seconds, then wakes up and finishes the job." Expect: its lease passed at 30 seconds, the reaper rescheduled the run, and attempt 2 ran on another worker. The old worker's finish carries attempt 1, fails the check and gets `409`. But both attempts may have charged: the store's fence cannot recall an external call, so the charge must send the run id as the payment provider's idempotency key. Self-fencing (stop when the lease cannot be renewed in time) narrows the window but cannot close it, because a pause can start right after the check.
3. **EU region (geography):** "We are opening an EU region. EU tenants' payloads and history must never leave the EU. What changes?" Expect: a full, independent copy of the stack per region (API, store shards, dispatchers, queues, workers). Each tenant gets a home region, and a thin global routing layer sends its calls there. No shared cross-region store: every claim would pay a cross-region round trip, and residency forbids it. If the EU region goes down, EU runs wait for it, or fail over to a second EU region through async replication. That can re-run work finished just before the failure, and run-id idempotency covers it. Cron time zones do not depend on the region.

## Level bar

Hire bar must show:
- Requirements that cover one-off versus cron, the start-time target and at least once with no loss after accept. Asks about peak load, and sizes for the hourly burst once told.
- The math: about 2,300 runs per second on average and about 12,000 at the top of the hour, several writes per run, ending in "which means the store needs sharding" or a stated per-node budget that fits.
- A clean API with an idempotency key on submit, a run state machine, and a working design: a durable store with an index on due time, dispatchers that claim due runs without a scan, a hand-off to workers, and leases that expire.
- When probed on a worker crash mid-run: the lease expires and the run comes back, so handlers must be idempotent on the run id.
- Retries with exponential backoff and a dead state.
- No single scheduler instance: shard ownership, leader election with failover, or competing dispatchers.
- One deep dive done at the Good level when the interviewer picks it.

Stretch signal:
- The attempt number as a fencing token, and the limit of fencing for external side effects.
- Counts the attempt at claim so a poison run still ends `DEAD`.
- Raises the hourly burst without a prompt, and pre-scales from the known due count or spreads cron fires.
- Keeps the ready queues shallow so priority and fairness hold, and makes tenant limits work across shards.
- Moves finished runs out of the hot table; uses the database clock.
- States cron overlap and catch-up rules without being asked.

## Traps

- "Exactly once with Kafka transactions." That covers reads and writes inside Kafka, not an email or a charge.
- Ack or delete the job, then run it: a crash loses the job.
- One scheduler box, or a leader that fires runs from its own memory: after a failover the old leader can still fire them, so runs happen twice.
- Partitioning by due time (an hour or a minute bucket) with no suffix: the current bucket is a hot partition.
- A Redis sorted set as the only store: replication is asynchronous, so a failover can lose accepted jobs.
- Every due run pushed at once into one long FIFO queue: priority and fairness vanish.
- Immediate retries with no backoff, jitter or cap.
- A heartbeat thread with no run timeout: a hung handler holds its slot forever.
- Comparing lease times against each worker's own clock.
- A Kubernetes CronJob or a crontab line per schedule, for 5 million schedules.
