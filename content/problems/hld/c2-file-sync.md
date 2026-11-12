---
id: c2-file-sync
track: hld
title: File Sync Service (Dropbox)
difficulty: medium
tags: [blob-storage, chunking, deduplication, sync-protocol, conflicts, sharding]
tracker:
  section: "### C2. Classic HLD Problems"
  bullet: "File Sync Service (Dropbox)"
notesFile: notes/c2-file-sync.md
sources:
  - title: "Hello Interview: Design Dropbox"
    url: "https://www.hellointerview.com/learn/system-design/problem-breakdowns/dropbox"
  - title: "Dropbox Tech: Streaming file synchronization"
    url: "https://dropbox.tech/infrastructure/streaming-file-synchronization"
confidence: "The block design (4 MB blocks named by SHA-256, a commit that answers with the blocks it still needs, a journal read by cursor, a notification channel that only says something changed) comes from a first-party engineering post. Direct upload to object storage with signed URLs, multipart upload and server checks of uploaded parts come from an interview breakdown. The two sources differ on conflicts: the breakdown uses last write wins, while this brief keeps both versions, because the hidden facts forbid losing an edit. The scale numbers are this problem's own assumptions."
---

## Opening prompt

Let's design a file sync service like Dropbox: a folder on each of your devices that stays the same everywhere. Where would you like to start?

## Hidden facts

Reveal a fact only when the candidate asks about it, or asks a question whose honest answer needs it. Never volunteer the list.

- **Clients:** a desktop app that watches one local folder, mobile apps and a website. The desktop app can run for weeks without restarting.
- **Core features:** upload and download files of any type, keep a user's devices in sync automatically, and share a folder with other users (edit or view only). Deleted files can be restored for 30 days.
- **Users:** 100 million users store data. 50 million are active each day, with about 2 devices each. About 40 million devices are online at the busiest time.
- **Files:** a user has about 1,000 files on average. The average file is about 500 KB. Most files are under 1 MB. The largest allowed file is 50 GB.
- **Changes:** an active user changes about 10 files a day. An average change brings about 200 KB of new data. The busiest hour carries about 3 times the average.
- **Networks:** home upload speed is often 20 Mbit/s. Laptops sleep and phones lose signal in the middle of transfers.
- **Sync speed:** a small file saved on one device shows on the user's other online devices within 10 seconds at p95. Large files take as long as the transfer needs.
- **Offline:** a device may be offline for weeks, then catch up.
- **Edits on two devices:** the service must never lose an edit. If two devices change the same file from the same version, both results must survive.
- **Durability:** once the app shows a file as synced, it must never be lost.
- **Consistency:** a user may see another device's change a few seconds late. A file must never appear half written.
- **Sharing:** most shared folders have under 10 members. A shared folder appears inside each member's own folder tree.
- **Available tech:** object storage, Postgres or MySQL, Redis, Kafka.
- **Numbers:** one server holds about 200,000 idle long-lived connections. One database node holds about 2 TB of data comfortably.
- **Out of scope:** editing a file together in real time, previews, search inside files, virus scanning, billing and storage quotas.

For the interviewer: on the numbers, give them only when the candidate asks what one server or shard can hold.

## Expected requirements

Core, functional:
1. Upload and download files up to 50 GB from any device. *Ask: What can users store, and how big can a file be?*
2. Changes on one device appear on the user's other devices without any action. *Ask: What happens on my laptop when I save a file on my desktop?*
3. Share a folder with other users, who then sync it too. *Ask: Can people work on the same files?*

Core, non-functional:
1. 50 million daily users, 500 million file changes a day, about 100 TB of new data a day. *Ask: How many users and changes, and how much data?*
2. A synced file is never lost, and no edit is lost when two devices change one file. *Ask: What must never happen to a user's files?*
3. A small change reaches the user's other online devices within 10 seconds. *Ask: How quickly must my other devices see a change?*
4. Uploads survive bad networks and resume where they stopped. *Ask: What happens when the connection drops halfway through a big file?*

Extras (credit when they name one, never a gap):
- Restore deleted files for 30 days.
- Devices that were offline for weeks catch up.
- A file never shows half written on another device.
- View-only members of a shared folder.

## Capacity math

The metadata bytes per file and per journal entry, the 4 MB block size and the headroom factors below are assumptions. Accept other reasonable values when the candidate gives a reason.

- **Change rate:** 50 million users x 10 changes is 500 million a day, about 6,000 metadata commits a second and about 18,000 at peak, which means the metadata service is a busy database tier that needs sharding.
- **Upload volume:** 500 million changes x 200 KB is 100 TB a day, about 1.2 GB a second (about 9 Gbit/s) on average and about 28 Gbit/s at peak, which means file bytes go straight from the client to object storage with signed URLs, never through our API servers.
- **Stored bytes:** 100 TB a day is about 36 PB a year of new data, and live data is about 100 million users x 1,000 files x 500 KB = 50 PB, which means object storage for the bytes and a separate database for the metadata.
- **Metadata:** 100 billion files x about 500 bytes of metadata is about 50 TB. At 2 TB a shard that is 25 shards, and about 50 with room to grow, which means a shard key is needed, and the natural one is the folder tree a change belongs to (a user's root or a shared folder), so one tree's journal lives on one shard.
- **Journal growth:** 500 million changes a day at about 500 bytes an entry is about 250 GB a day, about 7.5 TB for the 30 days that restores need, which means old entries that a newer entry for the same path replaces are compacted away after 30 days, and a device that is further behind reads the current file entries instead.
- **Large files:** 50 GB at 20 Mbit/s is 20,000 seconds, about 5.6 hours, which means an upload must be split into blocks and resume after a drop. At 4 MB a block that is 12,500 blocks, and the list of their 32-byte SHA-256 hashes is about 400 KB.
- **Connections:** 40 million online devices / 200,000 per server is 200 notification servers, which means the push channel is its own fleet and carries only "something changed", never file data.
- **Sync time:** the 10-second rule for small files leaves room for a commit (tens of ms), a push (under a second) and a list call plus a download of a few blocks, which means push, not polling every few minutes; polling every 10 seconds from 40 million devices would be 4 million requests a second.

## API and entities

External API:
- `POST /files/commit` with `{ namespaceId, path, blockHashes[], baseRevision }` returns `200 { revision }` when every block is stored, or `409 { needBlocks: [hash, ...], uploadUrls }` when some are missing. A stale `baseRevision` creates a conflicted copy instead of overwriting.
- `PUT <signed upload URL>` sends one block straight to object storage. The server checks the stored parts before the commit succeeds.
- `GET /changes` with `namespaceId` and `cursor` returns `200 { entries: [{ path, revision, blockHashes, deleted }], cursor, hasMore }`.
- `GET /blocks/{hash}` returns a short-lived signed download URL.
- `POST /shares` with `{ folderPath, members, access }` returns `201 { namespaceId }`.
- Notification channel: a long-lived connection that sends `{ namespaceId, latestCursor }` and nothing else.

Core entities:
- `Namespace { namespaceId, ownerId, kind (user root or shared folder) }`, the shard key.
- `JournalEntry { namespaceId, journalId (increasing), path, revision, blockHashes[], size, deleted, deviceId, createdAt }`, append-only.
- `FileEntry { namespaceId, path, latestJournalId }`, the current view of each path.
- `Block { hash (SHA-256), size, storageKey, refCount }`, stored once per account.
- `Membership { namespaceId, userId, access, mountPath }`.
- `DeviceCursor { deviceId, namespaceId, cursor }`, kept on the device.

## Reference design

```
 Desktop app: watcher ──> split changed files into 4 MB blocks, hash each (SHA-256)
     │ 1. POST /files/commit (hashes, baseRevision) ──> Metadata service ──> metadata DB shard (by namespace)
     │ 2. 409 needBlocks + signed URLs  <──┘
     │ 3. PUT missing blocks straight to object storage (parallel, resumable)
     │ 4. POST /files/commit again ──> server checks the blocks exist ──> append JournalEntry, update FileEntry
     │                                                                        └──> Kafka "namespace changed"
     │                                                                                └──> notification servers
 Other devices <── "namespace N changed, latest cursor C" (long-lived connection) ──┘
     └──> GET /changes?cursor=.. ──> new entries ──> GET /blocks/{hash} (signed URLs, via CDN) for blocks
          not already on disk ──> write to a temp file, rename into place when complete
```

Walk one upload: the user saves a 30 MB report on the desktop. The watcher sees the change, splits the file into 8 blocks, hashes each and calls commit with the 8 hashes and the revision it started from. The metadata service finds 6 hashes already stored for this account (only one section of the file changed) and answers `409` with the 2 missing hashes and signed upload URLs. The app uploads those 2 blocks straight to object storage, then calls commit again. The service checks both blocks exist, appends a journal entry with the next journal id for that namespace, updates the file entry and publishes "namespace changed". The app shows the file as synced.

Walk one sync to another device: the laptop holds a connection to a notification server, which sends "namespace N changed, latest cursor 1042". The laptop's cursor is 1040, so it calls `/changes?cursor=1040` and receives two entries. For the report it already has 6 of the 8 blocks on disk, downloads the other 2 through signed URLs, writes the file to a temp path and renames it into place, so no program sees half a file. It saves cursor 1042. If the notification had been lost, the laptop's periodic check (every few minutes) would have found the same entries.

## Accepted alternatives

- **How bytes reach storage.** Signed URLs straight to object storage (reference), or the provider's multipart upload with one URL per part. A block service of our own in front of storage is fine if the candidate prices 28 Gbit/s through it.
- **Block size.** Fixed 4 MB blocks (reference). Smaller blocks find more repeats but cost more metadata. Content-defined blocks (cut points chosen by a rolling hash) keep an insert near the start of a file from changing every later block. Fine with that reason.
- **Deduplication scope.** Within one account (reference). Across all accounts saves more storage, but whether an upload was skipped tells a user that someone else holds that exact file, so it leaks information. Fine if the leak is named and handled.
- **Push channel.** Long polling (reference), WebSockets or server-sent events. Polling alone is fine only with the request-rate math and a sync target it still meets. A message queue per device that carries the change records, as some guides teach, is partial credit: it works, but it keeps a second copy of the journal for each of 40 million devices, and a device that is offline for weeks needs a fallback anyway. The journal read by cursor gives the same result from one copy.
- **Metadata store.** Sharded Postgres or MySQL by namespace (reference), or a distributed SQL or wide-column store, as long as appends to one namespace's journal stay ordered.
- **Conflicts.** Keep both versions as a conflicted copy (reference). Last write wins fails the "never lose an edit" fact. Merging file contents is out of scope for arbitrary files.

## Deep dives

### Uploading in blocks and skipping known ones
- **Bad:** one HTTP request per file through the API servers. A 50 GB upload takes hours and starts over after a drop, and every byte crosses our servers.
- **Good:** split into 4 MB blocks named by their hash, ask which blocks the server lacks, upload only those straight to object storage with signed URLs, then commit the list of hashes. A dropped upload resumes from the missing blocks.
- **Great:** the server checks that each block really exists in storage before the commit succeeds, so a client cannot commit blocks it never sent. Hashes are computed on the client, and the server can recompute them for safety. Names the trade between fixed and content-defined blocks. Deduplicates within an account and states the leak of doing it across accounts. Downloads use the same hashes, so a device skips blocks it already holds.

### The change journal and cursors
- **Bad:** each client lists its whole folder every few minutes and compares. Or the server pushes file contents to every device.
- **Good:** an append-only journal per namespace with an increasing id. A device keeps a cursor and asks for entries after it. A push channel only says "namespace N has news", and the device then reads the journal.
- **Great:** the journal is the truth and notifications are hints, so a lost or duplicate notification is harmless, and a slow periodic check catches anything missed. Cursors are per namespace, so shared folders work like any other tree. Large catch-ups page through the journal. A device offline for weeks reads the current file entries instead of replaying every entry.

### Conflicts and never losing an edit
- **Bad:** last write wins, so one device's edit silently disappears. Or a lock on the file across devices.
- **Good:** every commit carries the revision it started from. The server applies it only if that is still the latest revision (a compare-and-set). Otherwise it stores the change as "report (conflicted copy from laptop)" next to the original.
- **Great:** covers rename and delete races too (an edit to a file another device deleted brings the file back rather than losing the edit). The client writes downloads to a temp file and renames, so no half files. The client never deletes a local file until the server has its newer version. Explains why merging contents is left to the user for arbitrary files.

### Sharding the metadata
- **Bad:** one database for 100 billion file entries. Or sharding by file id, which scatters one folder's journal across every shard.
- **Good:** shard by namespace, so each journal append and each cursor read touches one shard. A shared folder is its own namespace, mounted into each member's tree.
- **Great:** sizes it (about 50 TB, 25 to 50 shards). Plans for a very large namespace that outgrows one shard (a company-wide folder) by limiting its rate or splitting by subfolder. Moves a namespace between shards by copying, then switching with the journal id as the cut point.

## Curveballs

Use one, at the extension point, unless the candidate already handled it.
1. **Company-wide folder:** "A company of 50,000 employees shares one folder, and every employee syncs it. A script adds 1 million files to it in one hour. What breaks first?" Expect: the namespace's journal takes about 280 commits a second (1,000,000 / 3,600) on one shard, which is fine. The fan-out is the problem: one notification per change to 50,000 devices is about 14 million messages a second. Coalesce: send at most one "namespace changed" per device every few seconds with the latest cursor, so about 10,000 list calls a second at one every 5 seconds per device, and page the list results. The downloads are 50,000 copies of the same blocks, so serve them through the CDN. Strong: limits the rate of a single namespace and sees that one shard holds this whole folder.
   Fits: The change journal and cursors; Sharding the metadata
2. **Reconnect storm:** "A bad deploy restarts every notification server at once. 40 million devices lose their connection. What happens, and what do you change?" Expect: if every device reconnects and lists at once, that is about 670,000 connections a second over one minute. Clients reconnect with random backoff spread over about 10 minutes (about 67,000 a second). No change is lost, because the journal and cursors hold the truth, and devices that wait just sync a little later. Roll deploys out a slice of servers at a time. Strong: the list call after a reconnect is cheap when nothing changed, and the server can tell clients to wait longer under load.
   Fits: The change journal and cursors
3. **Version history:** "Product wants users to restore any version of any file from the last 12 months, not just deleted files for 30 days. What changes, and what does it cost?" Expect: the journal already records every version as a list of block hashes, so a restore is a new commit of an old list. Storage stops shrinking when files are overwritten: up to about 36 PB more over a year on top of about 50 PB of live data. The journal must also be kept for 12 months instead of being compacted after 30 days: about 250 GB a day, about 90 TB a year of metadata, about 45 more shards' worth. Blocks must be kept while any version points at them, so count references or run a mark-and-sweep job. A block that is about to be deleted can be reused by an upload that was just told "already stored", so the sweep must skip recent blocks and recheck before deleting. Strong: old versions can move to cheaper storage.
   Fits: Uploading in blocks and skipping known ones
4. **Long flight:** "A user edits 40 files in a shared folder on a laptop during a 12-hour flight. Meanwhile a colleague edits 5 of those files, deletes a subfolder that holds 3 others, and renames 1 more. The laptop reconnects. What does each person see?" Expect: the laptop first reads the journal from its cursor, then commits each change with the revision it started from. The 31 files nobody else touched commit normally. The 5 edited on both sides fail the compare-and-set and become conflicted copies next to the colleague's versions, so both edits survive. The 3 deleted files come back with the laptop's edits, because an edit beats a delete, and the colleague sees them reappear. For the renamed file, with the path as the key, the laptop's edit lands under the old name next to the renamed file: nothing is lost, but it is untidy; a stable file id that survives renames lets the edit follow the file. Strong: the laptop never applies the colleague's delete to a local file that still has unsent edits, and the app shows the user a list of what conflicted.
   Fits: Conflicts and never losing an edit; The change journal and cursors

## Level bar

Hire bar must show:
- Requirements with numbers for the change volume, the 50 GB limit and the 10-second sync target, and the rule that no edit is lost.
- The upload math (about 100 TB a day, about 28 Gbit/s at peak) and the decision it forces: bytes go straight to object storage, and metadata lives apart.
- Files split into hashed blocks: only missing blocks are uploaded, and an upload resumes after a drop.
- A sync path that loses nothing: devices catch up from an ordered change log read from a saved position, any push only says that something changed, and two devices editing one file never overwrite each other.

Stretch signal:
- Keeps other devices from seeing a half-written file (a temp file, then a rename) without a prompt.
- Checks on the server that uploaded blocks really exist before the commit.
- Treats notifications as hints and the journal as the truth, with a periodic check as a safety net.
- Shards by namespace with the size math, and plans for a giant shared folder.
- Names the information leak of deduplication across accounts.
- Content-defined blocks for inserts in large files, with the reason.

## Traps

- File bytes sent through the API servers, or stored in the database.
- Last write wins presented as fine, when the facts say no edit may be lost. Some interview guides teach it for this problem, so it is partial credit when the candidate never heard the fact and switches to a conflicted copy once told; it is a red flag when they keep it after hearing the fact.
- Polling the whole folder tree, or polling every few seconds from 40 million devices with no math.
- Pushing file contents through the notification channel.
- Trusting the client's word that a block was uploaded.
- Sharding by user id while shared folders span many users, with no plan for them.
- Writing a download straight over the old file, so other programs see half a file.
