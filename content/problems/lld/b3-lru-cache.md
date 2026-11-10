---
id: b3-lru-cache
track: lld
title: LRU Cache
difficulty: medium
tags: [data-structure, eviction, strategy, ttl, concurrency]
tracker:
  section: "### B3. Applied Practice — Classic LLD Problems"
  bullet: "LRU Cache (code-level)"
notesFile: notes/b3-lru-cache.md
lldFolder: lru-cache
---

## Opening prompt

Design an LRU cache. Build it as a running, in-memory C++ program, with a `main()` that shows it working.

## Hidden facts

Reveal a fact only when the candidate asks about it. Never volunteer the list.

- **Operations:** `get`, `put` and `size()`. No delete. If they add `erase(key)`, it takes O(1) and says whether the key was there. On a miss the caller loads the value itself and calls `put`. `put` returns nothing the caller needs, and it does not report the evicted key.
- **Types:** keys are `int`, any value, 0 and negatives included. Values are `std::string`, any string, the empty string included, usually under 100 characters. No templates.
- **Capacity:** an `int` number of entries, fixed at construction. The demo uses 3. Real use goes up to 1,000,000.
- **Bad capacity:** 0 or negative is invalid. The constructor rejects it with an error the caller can see, for example `std::invalid_argument`. They must not clamp it to 1 or build a cache that stores nothing.
- **Use:** a `get` hit, and a `put` of a new or existing key even with the same value, make that key the most recently used. A miss changes nothing.
- **Full cache:** a `put` of a new key first evicts exactly one entry, the least recently used. A `put` of an existing key replaces the value, refreshes the key and evicts nothing, even when the cache is full.
- **Miss:** a normal result, not an error. The caller must tell it from a stored empty string. An `std::optional`, or a `bool` plus an out parameter, both work. A marker such as `""` or `-1` does not, and neither does an exception. A pointer or reference into the node does not either: it dangles after the next eviction, and it outlives the lock.
- **Speed:** O(1) average for `get` and `put`, at up to about 50,000 calls per second.
- **Threads:** yes. One cache serves up to about 16 request threads at once. `main()` may stay single-threaded.
- **Time:** the first version has none. A later rule that needs time gets it from the caller, in whole seconds, on every `get` and `put`. Never the system clock.
- **Demo:** `main()` shows a hit, a miss, an eviction and an update.
- **Not in the first version:** expiry, other eviction policies, persistence, eviction callbacks, hit statistics, a `peek` that does not refresh. If they ask, say so and add nothing.

## Expected requirements

Core:
1. Fixed capacity of 1 or more entries. Reject 0 or negative at construction. *Ask: What capacity values are allowed?*
2. `get`: a hit returns the value and refreshes the key. A miss reports "no value". *Ask: What counts as a use, and how is a miss reported?*
3. `put` of a new key makes it most recent; a full cache evicts exactly the least recent one. *Ask: What happens when a new key arrives and the cache is full?*
4. `put` of an existing key replaces the value, refreshes the key and evicts nothing. *Ask: What does a put do when the key already exists?*
5. `get` and `put` take O(1) average time, with no scan over all entries. *Ask: How fast must each operation be?*
6. Safe when up to 16 threads call `get`, `put` and `size` at once. *Ask: Can several threads use it at once?*

Extras (credit when they name one, never a gap):
- `size()` returns the entry count, never above the capacity.
- A miss is never an empty string and changes nothing.

## Entities and relationships

- `Entry` (struct): `key` and `value`. **The hidden noun.** The node carries the key too, because eviction starts at the back node and must find its map slot by key.
- `LRUCache`: owns the capacity, the `order` list, the `index` map and the lock. Both structures always hold the same keys, so `index.size() == order.size() <= capacity`.
- `EvictionPolicy` (interface), `LruPolicy`, `LfuPolicy`: only when the policy extension arrives. The cache then keeps a plain `values` map, and the policy keeps the order or the counts.
- Not stored: the clock, expiry times, use counts, hit counters.

## Behaviour and states

- `get(key)`: find the key in `index`. A miss returns no value and changes nothing. A hit `splice`s the node to the front of `order` and returns a copy of the value.
- `put(key, value)`: look for the key first. Found: replace the value, `splice` to the front and stop, because an update never evicts. Not found and `order.size() == capacity`: read `order.back().key`, erase it from `index`, then `pop_back`. Then `push_front` a new `Entry` and store `order.begin()` in `index`.
- `size()` returns `index.size()`. An entry is present or absent, and the cache has no modes, so State has nothing to do.
- Every public method takes the same lock, `get` and `size` included.

## Reference design

```
 struct Entry { int key; std::string value; };               // the node carries the key so eviction can find the map slot

 class LRUCache {
   int capacity;
   std::list<Entry> order;                                    // front = most recently used, back = next victim
   std::unordered_map<int, std::list<Entry>::iterator> index; // key -> node; splice keeps these iterators valid
   std::mutex mtx;                                            // every method, get included
  public:
   explicit LRUCache(int capacity);                           // throws std::invalid_argument when capacity < 1
   std::optional<std::string> get(int key);                   // lock, find, splice to front, return a copy
   void put(int key, const std::string& value);               // lock, update and splice, or evict back() then push_front
   int size();                                                // lock, index.size()
 };

 // After the policy extension: the cache owns the values, the policy owns the order or the counts.
 class EvictionPolicy {                                       // interface
  public:
   virtual ~EvictionPolicy() = default;
   virtual void onInsert(int key) = 0;
   virtual void onAccess(int key) = 0;
   virtual void onRemove(int key) = 0;                        // a key left without eviction
   virtual int  evict() = 0;                                  // pick the victim, forget it, return its key
 };
 // LruPolicy: std::list<int> plus a map of iterators. LfuPolicy: a count per key, a std::unordered_map<int, std::list<int>> of keys per count, a map from key to its bucket iterator, and a minCount.
 // LRUCache then holds std::unordered_map<int, std::string> values and a std::shared_ptr<EvictionPolicy>.
```

A list in recency order plus a map from key to list iterator makes every step O(1). The map finds the node, `splice` moves it to the front without invalidating any iterator, and `back()` is always the next victim.

## Patterns that fit

- **Strategy** for the eviction policy, once the policy extension arrives: a new policy is a new class, and the cache does not change. Cost: `LruPolicy` keeps a second key index, and they should say so.
- **Data structures:** list plus hash map is the reference. A `std::list<int>` of keys, with the value stored in the map beside the iterator, is accepted: the back node is still a key, so eviction finds its slot. A hand-written doubly linked list with sentinels is accepted, at the cost of more code and more pointer bugs. An ordered map keyed by a use counter is O(log n): it misses the stated O(1) goal, so accept it only if they say so and can name the O(1) structure. A `vector` or `deque` with a linear search is not accepted, because each call is O(n).
- **LFU data structures:** a `std::set` ordered by (use count, last-use tick) is O(log n). Accept it as a first version if they say so. The O(1) answer is count buckets with a `minCount`.
- Not needed: Singleton, Factory, Observer, State, templates over the key and value types.

## Demo scenarios

Each scenario starts with a fresh cache of capacity 3 unless stated. Keys are `int`, and values are the strings a, b, c and so on. `put 1:a` stores key 1 with value a, and `get 1` gives its value or a miss. Adapt the calls to the candidate's own API; the expected behaviour is what matters. If they have no `size`, skip the size checks.

1. **Put, get, miss.** On the empty cache, `get 42` misses and the size is 0. `put 1:a, 2:b, 3:c`. The size is 3, and `get 1`, `get 2`, `get 3` give a, b, c. `get 4` misses.
2. **Eviction order.** `put 1:a, 2:b, 3:c`. `get 99` misses and changes nothing. `put 4:d` evicts key 1, then `put 5:e` evicts key 2. `get 1` and `get 2` miss. `get 3`, `get 4`, `get 5` give c, d, e. The size is 3.
3. **A get saves a key (the classic trace), capacity 2.** `put 1:a, 2:b`. `get 1` gives a. `put 3:c` evicts key 2, so `get 2` misses. `put 4:d` evicts key 1, so `get 1` misses. `get 3` gives c and `get 4` gives d.
4. **Updating an existing key.** Two fresh caches, each with `put 1:a, 2:b, 3:c`. A: `put 2:B` evicts nothing, so the size is 3 and `get 1`, `get 2`, `get 3` give a, B, c. B: `put 1:A`, then `put 4:d`. The update counted as a use, so key 2 goes: `get 2` misses, and `get 1`, `get 3`, `get 4` give A, c, d.
5. **Invalid capacity.** Capacity 0 and capacity -5 are rejected (skip -5 if their capacity type is unsigned), and capacity 1 works. "Rejected" means the caller sees an error, for example an exception. The program does not crash, and no usable cache is left behind.
6. **Capacity 1.** `put 1:a`, then `get 1` gives a. `put 1:A` evicts nothing, so `get 1` gives A. `put 2:b` evicts key 1, so `get 1` misses and `get 2` gives b. The size is 1.
7. **Odd keys and values, capacity 4.** `put 0:""` (the empty string), `-1:neg`, `2147483647:max`, and key 5 with 10,000 "x" characters. `get 0` hits and gives the empty string. `get -1` and `get 2147483647` give neg and max. `get 5` gives all 10,000 characters. `get 1` misses. The size is 4.
8. **Scale, capacity 100,000.** For k from 0 to 199,999, `put k` with the value "v" followed by k as text. The size is 100,000. Keys 100,000 to 199,999 all hit with their own value, and `get 99999` misses. The run takes well under 10 seconds, even in a debug build. A linear scan per call takes about 20 seconds in an optimised build and minutes in a debug build.
9. **Expiry. Only if the candidate built it.** Time is in whole seconds. At time 0: `put 1:a` with TTL 10, and `put 2:b` with no TTL. At time 9: `get 1` gives a, and does not extend the life. At time 10: `get 1` misses, because an entry put at time t with TTL d expires at time t + d. At time 20: `put 3:c` with TTL 5. At time 24: `put 3:C` with TTL 5, which restarts the clock, so it expires at time 29. At time 28: `get 3` gives C. At time 29: `get 3` misses. At time 1,000,000: `get 2` gives b.
10. **LFU policy. Only if the candidate built it.** The fewest uses goes first, and a tie goes to the least recently used. `put 1:a, 2:b, 3:c`. `get 1` twice, then `get 2` once, so keys 1, 2 and 3 have 3, 2 and 1 uses. `put 4:d` evicts key 3. `put 5:e` evicts key 4, because a new entry starts at 1. `get 5` gives e, so key 5 has 2. `put 6:f` evicts key 2: keys 2 and 5 tie at 2, and key 2 was used longer ago. Then `get 3`, `get 4`, `get 2` miss, and `get 1`, `get 5`, `get 6` give a, e, f.
11. **Concurrency. Only if the candidate made it thread-safe.** Capacity 100. Four threads (t = 0 to 3) each run 5,000 rounds (r = 0 to 4,999). Each round puts key `(r + 250 * t) % 1000` with that key as text for the value, then gets key `(r * 3 + 250 * t) % 1000` and checks any hit against that key as text. After all threads finish: no crash and no wrong value, the size is exactly 100, and getting each key from 0 to 999 once gives exactly 100 hits, each with its own text.

## Extensions

Pick one. If they built room for one already, pick another. Say the requirement, ask "What changes?", and hold the facts back until they ask.

1. **Expiry:** each entry may carry a time to live in whole seconds, given at `put`. An expired entry must never be returned. What changes?
   - Facts: the caller passes the current time into every `get` and `put`, and the cache never reads the clock. A TTL is at least 1 second, and an entry without one never expires. An entry put at `t` with TTL `d` expires at `t + d`: a `get` at exactly `t + d` already misses. A `get` does not extend it, and a `put` of an existing key restarts it and replaces the TTL, so a `put` without a TTL makes the entry permanent. The caller's time never goes backward. `size()` takes no time argument.
   - Expect: an `expiresAt` in `Entry`, `now` as a parameter of `get` and `put`, and an expired `get` that removes the entry and misses. Lazy removal is fine: a dead entry may linger until a `get` finds it or it is evicted, and `size()` may still count it; no scenario checks that. Purging dead entries before evicting a live one is better. A good answer names the lazy gap: a full cache can evict a live entry while a dead one sits untouched. Stretch fix: an index ordered by expiry time.
   - Same: without a TTL, scenarios 1 to 8 give the same results. A hit still refreshes, an update still evicts nothing, and nothing reads the system clock.
2. **A second eviction policy:** product also wants least-frequently-used eviction. The caller picks the policy when it builds the cache, and the entry with the fewest uses goes first. What changes?
   - Facts: a new entry starts at 1 use, and each later hit or update adds 1. A tie goes to the least recently used. An evicted key forgets its count. The speed target stays O(1), and a slower first version must say so.
   - Expect: the order logic leaves the cache. The cache keeps `values` and an `EvictionPolicy`, and `get` and `put` only call its hooks. An `enum` plus `switch` works for two policies if they name the cost: each new policy edits the cache. Stretch: O(1) LFU with count buckets, and why `std::priority_queue` fails: it cannot change a priority in place.
   - Same: with `LruPolicy`, scenarios 1 to 8 give the same results. A new key in a full cache evicts exactly one entry, and an update none. The lock stays in the cache and covers the policy calls.

## Concurrency follow-up

"Two threads call `get` on the same key at the same moment. What happens in your code?" Expect:
- The shared state is `order` and `index`, which must always agree.
- `get` is a write, because it moves the node. So "reads need no lock" is wrong, and so is a `std::shared_mutex` with a shared lock in `get`: two readers would splice the same list.
- The fix is one `std::mutex` with a `std::lock_guard` in every public method, `get` and `size` included, and the value copied out under the lock.
- A second race: a `get` holds a node while another thread's `put` evicts it, or two `put`s of new keys both pass the capacity check.

Stretch signal: states the cost with the problem's numbers. At 50,000 calls per second and about 1 microsecond per call, one mutex is busy about 5% of the time, so one lock is enough. For much higher rates they shard: N caches with one mutex each, picked by the key's hash. The cost is that eviction is per shard, so the cache is only approximately LRU.

## Level bar

Hire bar must show:
- Step 1 questions that cover the capacity rule, what counts as a use, what `put` does to an existing key, how a miss is reported, and threads.
- A list node that carries the key (an `Entry` with key and value, or a list of keys with the value in the map), in a list plus a map that give O(1) `get` and `put`. They can say why the iterators stay valid after `splice`. If they erase and re-insert instead, they must store the new iterator.
- Scenarios 1 to 8 pass inside the time, with the core running by about minute 40.
- The existing-key check before the capacity check, and a miss that cannot be mistaken for an empty string.
- The extension in code inside the last 15 minutes, naming the behaviour that stays the same. If time ran out, the exact fields and methods that change.
- Correct locking when asked: one mutex, `get` included, value copied out.

Stretch signal:
- Asks about expiry, other policies and threads in step 1, then builds the core without them. The core runs by about minute 25.
- Says unprompted that `get` is a write, so a shared lock fails.
- Takes time as a parameter without being told, and weighs lazy against eager expiry.
- Tests capacity 1, a full-cache update and a miss in `main()`, and re-runs scenarios 1 to 8 after the extension.
- Names O(1) LFU with count buckets, or the sharding trade-off, with numbers.

## Traps

- A `vector` or `deque` for the order, or a scan for the oldest timestamp: every call is O(n), which fails at 1,000,000 entries.
- Moving a node with `erase` and `push_front` and forgetting to store the new iterator: the map points at a dead node. `splice` avoids it.
- `operator[]` on `index` inside `get`: a miss inserts an empty slot.
- Checking the capacity before the existing key: an update of a full cache evicts an innocent entry, or the entry itself.
- Returning `""` or `-1` for a miss, or a reference into the node, which dangles after the next eviction.
- "`get` only reads, so no lock", or a shared lock in `get`.
- A sweeper thread or the system clock for expiry: the cache cannot be tested, and time must come from the caller.
- `std::priority_queue` for LFU: it cannot change a priority in place, so stale entries pile up.
- `std::shared_ptr` for both `next` and `prev` in a hand-written list: the cycles leak every node.
- Over-building (templates, a `Cache` interface with a factory) before anything runs, or more than 20 minutes on steps 1 to 3.
