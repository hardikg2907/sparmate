---
id: c2-collaborative-editing
track: hld
title: Collaborative Document Editing (Google Docs)
difficulty: hard
tags: [real-time, operational-transform, crdt, websockets, ordering, snapshots]
tracker:
  section: "### C2. Classic HLD Problems"
  bullet: "Collaborative Document Editing (Google Docs)"
notesFile: notes/c2-collaborative-editing.md
sources:
  - title: "Figma blog: How Figma's multiplayer technology works"
    url: "https://www.figma.com/blog/how-figmas-multiplayer-technology-works/"
  - title: "Real Differences between OT and CRDT in Correctness and Complexity for Consistency Maintenance in Co-Editors (arXiv 1905.01302)"
    url: "https://arxiv.org/abs/1905.01302"
  - title: "Yjs documentation"
    url: "https://docs.yjs.dev/"
confidence: "Sources disagree on the merge method. A design-tool engineering post calls operational transformation too complex and uses a central server with last-writer-wins per property, inspired by CRDTs. A paper by operational-transformation researchers argues CRDTs carry hidden complexity and that OT still runs most real co-editors, and notes that OT does not always need a server, although the well-known production versions use one. A CRDT library documents merges that need no central server. This brief therefore accepts both methods and grades the reason. A full interview breakdown of this problem was behind a paywall and was not used. The scale numbers are this problem's own assumptions."
---

## Opening prompt

Let's design a document editor where several people can edit the same document at the same time and see each other's changes as they type, like Google Docs. Where would you like to start?

## Hidden facts

Reveal a fact only when the candidate asks about it, or asks a question whose honest answer needs it. Never volunteer the list.

- **Documents:** text with simple formatting (bold, italics, headings, lists). Images, tables, comments and suggestions are out of scope. The average document is about 50 KB. The largest is about 1 million characters.
- **Core features:** create a document, open it, edit it with others at the same time, and see their changes and cursors live. Restore any earlier version from the last 30 days.
- **Users:** 50 million daily users. At the busiest time about 2 million documents are open, with about 3 million people connected and about 1 million of them typing.
- **Editors per document:** most documents have 1 to 3 people in them. Up to 100 people can edit one document at once.
- **Typing:** a client sends its changes at most every 200 ms while the user types. A typing user sends about 2 batches a second on average, about 100 bytes each.
- **Latency:** your own typing shows at once. Another person's edit shows on your screen within 500 ms at p95 when you are in the same region as the document.
- **Correctness:** everyone ends up with exactly the same text. No typed text is lost, and an insert stays where its author put it relative to the words around it.
- **Durability:** once the server confirms an edit, it survives any single server failure.
- **Offline:** a laptop or phone can keep editing offline for up to 24 hours. Its edits merge when it reconnects, and no text is lost.
- **Cursors:** other people's cursors and names show within about 1 second. They are never stored.
- **Regions:** users are global. Each document lives in one home region. Between regions a round trip is about 150 ms.
- **Numbers:** one WebSocket server holds about 100,000 connections. One database node takes about 20,000 small writes a second. A Kafka broker takes about 100 MB a second of writes.
- **Out of scope:** sharing and permissions (a check already says edit or view), search, spelling, export, printing.

For the interviewer: on the numbers, give them only when the candidate asks what one server or node can do.

## Expected requirements

Core, functional:
1. Several people edit one document at once and see each other's edits live. *Ask: What happens when two people type in the same document at the same moment?*
2. Show other people's cursors and names. *Ask: What else should people see of each other?*
3. Edit offline and merge on reconnect; restore versions from 30 days. *Ask: What happens if someone loses their connection while editing?*

Core, non-functional:
1. Everyone converges to the same text, with no text lost and inserts kept in place. *Ask: What must be true of the document after two people edit it at once?*
2. Another person's edit shows within 500 ms at p95 in the same region. *Ask: How fast must I see someone else's typing?*
3. 3 million people connected and 1 million typing at peak; up to 100 editors per document. *Ask: How many people edit at once, and how many in one document?*
4. A confirmed edit survives any single server failure. *Ask: What happens to my last edits if a server dies?*

Extras (credit when they name one, never a gap):
- Cursors are live but never stored.
- Each document has one home region.
- The largest document holds about 1 million characters.

## Capacity math

- **Connections:** 3 million / 100,000 per server is 30 WebSocket servers, about 60 with headroom, which means connections spread over many servers, so the editors of one document land on different servers unless we route them together.
- **Edit rate:** 1 million typists x 2 batches a second is about 2 million operations a second at peak, about 200 MB a second, which means every operation must be stored before it is confirmed, at a scale where one row per operation would need about 100 database nodes (2,000,000 / 20,000) before replication, while an append-only log partitioned by document takes 200 MB a second on a few brokers.
- **One document:** a document with 100 editors at 2 batches a second is 200 operations a second, which means one process can order every edit of a document easily; the hard part is getting all editors to that one place, not raw speed.
- **Fan-out:** those 200 operations a second go to 99 other editors, about 20,000 messages a second for that document, which means the owner batches outgoing changes every 50 to 100 ms.
- **Latency budget:** up to 200 ms of client batching, about 50 ms to the server, a few ms to order and store, and about 50 ms to the other clients is about 300 ms, which means the 500 ms target holds in one region, while a person in another region adds about 150 ms but still fits.
- **History:** the daily average is about a third of the peak, so about 670,000 operations a second x 100 bytes x 86,400 is about 5.8 TB a day, and about 170 TB for 30 days, which means operations are kept for 30 days for version history, and older history is kept as snapshots.
- **Opening a document:** replaying a long-lived document's full history on every open is too slow, which means a snapshot (for example every 1,000 operations or when the document goes quiet) plus the operations after it. At 2 million operations a second, one snapshot per 1,000 is 2,000 snapshots a second of about 50 KB, about 100 MB a second.

## API and entities

External API:
- `POST /documents` returns `201 { docId }`. `GET /documents/{docId}` returns `{ snapshot, revision }` for the first paint.
- `GET /documents/{docId}/versions` returns named and automatic versions. `POST /documents/{docId}/restore` with `{ revision }` returns `200 { revision }`; the restore is a new edit, not a rewrite of history.
- `WS /documents/{docId}/live` opens the live session.
- Client to server: `ops { clientId, seq, baseRevision, ops }`, `cursor { position }`.
- Server to client: `ack { seq, revision }`, `remoteOps { revision, ops, authorId }`, `presence { users and cursors }`.

Core entities:
- `Document { docId, title, homeRegion, latestRevision, createdAt }`.
- `Operation { docId, revision, clientId, seq, ops, authorId, createdAt }`, append-only and unique on `(docId, revision)` and `(docId, clientId, seq)`.
- `Snapshot { docId, revision, content, createdAt }`.
- `SessionOwner { docId, serverId, leaseExpiresAt, epoch }` in a coordination store.

## Reference design

```
 Client (local copy, pending ops, at most one batch in flight)
   │ WebSocket
   ▼
 LB ──> Gateway (holds connections) ── routes by docId ──> Document server that owns this docId
                                                           (one owner per open document, lease + epoch)
                                                           1. check epoch and (clientId, seq) for duplicates
                                                           2. transform the batch against ops after its baseRevision
                                                           3. assign the next revision
                                                           4. append to the op log (durable) ──> ack to author
                                                           5. send to the other editors, batched every 50 ms
                                                           cursors: kept in memory, sent every ~200 ms, never stored
 op log (partitioned by docId) ──> snapshot worker ──> Snapshot store (every 1,000 ops or when idle)
 coordination store (who owns which docId) <── gateways look up, document servers renew leases
```

Walk one edit: editor A types "very " before "good" at revision 41. A's client applies it at once and sends a batch with base revision 41. Meanwhile editor B's delete of an earlier word became revision 42. The document server that owns this document sees that A's base is 41, transforms the insert against revision 42 (its position moves left by the deleted length), assigns revision 43, appends it to the log and, once the append is durable, sends `ack 43` to A and the transformed insert to B and the others. B's client has its own unsent typing, so it transforms the incoming insert against its pending ops before applying it. Both screens now read the same text.

Walk one document open: A reader opens the document. The gateway asks the coordination store who owns it. Nobody does, so a document server takes a lease with a new epoch, loads the newest snapshot (revision 9,000) and the 37 operations after it from the log, and starts the session. The reader gets the text at revision 9,037 and the live stream after it. When the last editor leaves, the server writes a snapshot and lets the lease lapse.

## Accepted alternatives

- **Merge method.** Judge the reason, not the name.
  - Operational transformation with a central server that orders operations (reference). Proven for text; the server is a must in the common production form; transform functions are hard to get right.
  - A CRDT (each character has a unique id, deletes leave markers, merges work in any order). Converges without a central server and suits offline work. Costs memory for ids and delete markers, and still needs a server for storage and fan-out.
  - A central server that keeps the last value per property (fine for shapes in a design tool), plus a text method for text. Last write wins on a whole paragraph fails "no text is lost".
  - Locking a paragraph while one person edits it: fails "edit at the same time" within a paragraph.
- **Getting editors of one document together.** A lease per document in a coordination store with routing by docId (reference), consistent hashing of docId with a fencing epoch, or any server plus a per-document pub/sub channel with ordering enforced by a conditional append in the store (`revision = latest + 1`). Fine if two servers can never both assign revisions.
- **Operation storage.** A log partitioned by document (reference), or a wide-column table keyed by `(docId, revision)`, if the write rate is sized.
- **Transport.** WebSockets (reference). Server-sent events plus POST for changes is fine. Polling fails the 500 ms target at this scale.
- **Snapshots.** Every N operations, when idle, or both. All fine.

## Deep dives

### Merging concurrent edits
- **Bad:** last write wins on the whole document or paragraph, or locks. Or sending plain "insert at position 12" with no adjustment, so two people's positions drift and their screens differ.
- **Good:** operational transformation with a central order. Each change carries the revision it was based on, the server transforms it against the changes that landed since, assigns the next revision and broadcasts. Clients transform incoming changes against their own unsent ones. Or a CRDT, where each character has a stable id so inserts land next to the right neighbours in any order.
- **Great:** explains why a single order per document makes the transform rules simple (one transform path, not every pair of clients). Keeps at most one batch in flight per client, so the server only transforms against what the client has not seen. Knows the CRDT costs (ids and delete markers, cleaned up only when every replica has seen them) and the OT cost (transform functions are hard to prove correct). Picks one for a reason tied to the facts: offline for 24 hours favours a CRDT or a careful rebase; the central home region favours server-ordered OT.

### One owner per document
- **Bad:** each editor connects to a random server and servers merge among themselves with no single order.
- **Good:** route every editor of a document to one document server that orders its edits. A coordination store records the owner, and gateways route by docId.
- **Great:** a lease with an epoch number, and the log rejects writes from an old epoch, so a paused server that wakes up cannot write a second revision 43. Moves documents off a busy server by ending the lease. Keeps connections on gateways, so moving an owner does not drop every socket.

### Storing operations and snapshots
- **Bad:** saving the whole document on every keystroke. Or keeping operations only in memory and confirming them before they are stored.
- **Good:** append each operation to a durable log before the ack, and write snapshots, so an open loads a snapshot plus a short tail.
- **Great:** sizes the write rate (2 million a second) and picks a partitioned log over one row per operation. Dedupes by `(clientId, seq)` so a resent batch is applied once. Restores a version by writing a new operation that sets the old text, so history is never rewritten. Keeps operations 30 days and older history as snapshots.

### Offline edits and reconnect
- **Bad:** drop the offline edits, or overwrite the server copy with the offline copy.
- **Good:** the client keeps its pending operations and the revision they were based on. On reconnect it sends them; the server transforms them against everything that happened since (or a CRDT merges them).
- **Great:** sees that 24 hours offline can mean thousands of operations on both sides, so transforming one by one is slow; batches them, or uses a CRDT that merges in one pass. Shows the user what changed. Dedupes resent batches by `(clientId, seq)`.

## Curveballs

Use one, at the extension point, unless the candidate already handled it.
1. **All-hands document:** "A company opens one planning document for an all-hands meeting. 5,000 people open it and 300 of them edit at once. What breaks first?" Expect: 300 editors at 2 batches a second is 600 operations a second, fine for one owner. Sending each to 5,000 people one by one is about 3 million messages a second from one process. Batch outgoing changes every 100 ms (10 messages a second x 5,000 = 50,000 a second), and move the fan-out to the gateways: the owner sends each batch once to each gateway that has viewers, and gateways copy it to their sockets. Cursors for 300 people are throttled and only sent for people near your view. Strong: caps live editors (the facts allow 100) and makes the rest viewers who get a slower stream.
   Fits: One owner per document
2. **Owner crash:** "The document server that owns 20,000 open documents crashes. What do users see, and is anything lost?" Expect: nothing confirmed is lost, because an ack came only after the log append. Clients see the socket to their gateway stay up, or reconnect and resend unconfirmed batches with their `(clientId, seq)`. After the lease expires (a few seconds), new owners spread over other servers load snapshot plus log tail and continue from the last revision. Resent batches already in the log are skipped by `(clientId, seq)`. 20,000 documents loading at once is a burst of snapshot reads, so spread the restart. Strong: the epoch stops the old server from writing if it was only paused.
   Fits: One owner per document; Storing operations and snapshots
3. **End-to-end encryption:** "A customer requires end-to-end encryption: our servers must never see document text. What changes?" Expect: the server cannot transform operations it cannot read, so server-ordered OT no longer works in its usual form. Options: a CRDT on the clients, with the server storing and relaying encrypted updates in order; or the server only orders opaque batches and clients do all transforms. Snapshots must be made and encrypted by clients. Search, previews and server-side checks are lost. Strong: keys are shared between members on their devices, and a removed member needs a key change for future edits.
   Fits: Merging concurrent edits; Storing operations and snapshots

## Level bar

Hire bar must show:
- Requirements that cover live co-editing, convergence with no lost text, the 500 ms target, cursors and offline edits.
- A merge method (OT or a CRDT) explained with a concrete pair of edits, and why last write wins fails.
- WebSockets and one place that orders each document's edits, with routing by docId.
- Operations stored before the ack, and snapshots for fast loading.
- The edit rate math (about 2 million operations a second), ending in "which means a partitioned log, not one database row per keystroke".
- One edit walked from one person's keyboard to another person's screen, including the transform.

Stretch signal:
- A lease with an epoch so two servers never order the same document.
- Dedupes resent batches by `(clientId, seq)`.
- Compares OT and CRDTs on real costs (transform correctness against ids and delete markers) and ties the choice to the offline fact.
- Batches fan-out and moves it to gateways for a huge document.
- Restores versions as new operations, never rewriting history.

## Traps

- Last write wins on paragraphs, or locks, presented as collaboration.
- Every editor connected to a random server with no single order per document.
- Confirming an edit before it is stored.
- Saving the whole document on every keystroke.
- Replaying the full history on every open.
- Storing cursor positions in the database.
- "CRDTs need no server", so no thought about storage, fan-out and ordering of the log.
- "OT is solved, any library works" with no word on how the server and client transform.
