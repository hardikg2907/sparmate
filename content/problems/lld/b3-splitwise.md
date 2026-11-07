---
id: b3-splitwise
track: lld
title: Splitwise
difficulty: medium
tags: [strategy, money, validation, ledger, concurrency]
tracker:
  section: "### B3. Applied Practice — Classic LLD Problems"
  bullet: "Splitwise (expense sharing)"
notesFile: notes/b3-splitwise.md
lldFolder: splitwise
---

## Opening prompt

Design Splitwise, an expense-sharing app. Build it as a running, in-memory C++ program, with a `main()` that shows it working.

## Hidden facts

Reveal a fact only when the candidate asks about it. Never volunteer the list.

- **What happens:** people in a group share costs. One person pays a bill and splits it among some people. The system tracks who owes whom. People settle up by paying each other back.
- **Money:** one currency, no conversion. Every amount is a whole number of paise (100 paise = 1 rupee), and the caller passes it in that way. No decimals in amounts and no `double`. The largest expense is 100,000,000 paise. A larger one is rejected. Output may show paise, or rupees with two digits built from integers.
- **Users:** each has an id and a name. The caller passes the user id and the group id. The system assigns expense ids, counting from 1. A repeated user id or group id is rejected. Names may repeat. Users are never deleted. Real use goes up to 10,000 users and about 100,000 expenses.
- **Groups:** a group has a name and 2 or more members, fixed at creation. A group with fewer than 2 members, a repeated member or an unknown user is rejected. Real groups hold up to 50. A user may be in many groups.
- **Expense:** it belongs to one group and has exactly one payer. An unknown group is rejected. The payer and every participant must be members of that group. The participant list has 1 or more people, with no duplicates. Its order matters only for leftover paise. The payer may be outside the list. The payer's own share creates no debt, and a payer who is the only participant is accepted and changes no balance.
- **Split types:** equal, exact amounts, percentages. Do not mention share-based splits.
- **Leftover paise (one rule for every split that divides):** floor each share, then hand out the leftover paise one each, in the listed order, to participants with a non-zero weight, until none are left. The shares always add up to the total exactly. For an equal split, the first `total % n` listed participants pay one paisa extra: 1000 among 3 gives 334, 333, 333. If they propose another rule that is fixed, written down and always adds up (the last participant with a non-zero weight absorbs the difference, or largest remainder with ties to the earlier listed participant), accept it and adjust scenarios 2, 4, 10b and 11. A zero weight must still owe nothing.
- **Exact:** one amount per participant, in paise, adding up to the total. A zero entry means that person owes nothing. A negative entry is rejected.
- **Percent:** one percentage per participant, up to 2 decimals (33.33 is allowed), none negative, totalling exactly 100.00. 33.33 three times is 99.99 and is rejected. A zero entry is allowed. Integer hundredths of a percent (3333) is best. A `double` is accepted only if the total check uses a tolerance and the shares still add up in paise.
- **Rejection:** an invalid call is rejected with an error the caller can see, in one style (a result with a reason, or an exception). A rejected call changes nothing: no expense, no balance.
- **Balances:** tracked per pair of users, across all groups together, not per group. Each pair has one netted balance: if Bob owes Alice 300 and then Alice owes Bob 250, the system shows only "Bob owes Alice 50". A pair at 0 shows nothing. The caller can list every balance and ask for one user's balances. A user's list shows every line where the user owes or is owed. Line order does not matter. A user's net position is what others owe the user minus what the user owes, and all net positions add up to 0.
- **Settle-up:** `from` pays `to` an amount, and that reduces what `from` owes `to`. Partial payments are fine. The amount must be above 0 and at most what `from` currently owes `to`. Paying someone you owe nothing is rejected, and so is overpaying. An unknown user is rejected. It is not tied to a group. Paying the full debt removes the pair.
- **Time:** the caller passes a whole number (minutes is fine) on each expense and each settle-up. The system stores it for history. Nothing in the first version depends on it. Do not read the system clock.
- **Threads:** yes, up to 8 threads and about 100 calls per second. `main()` may stay single-threaded for the demo.
- **Out of scope:** several payers, other currencies, recurring expenses, notifications, login, persistence, a UI, per-group balance views, adding or removing group members. Editing or deleting an expense and simplifying debts are not in the first version either. If they ask, say "not now" and add nothing.
- **Demo:** `main()` shows an equal split, an exact split, a percent split, the balance list, a settle-up and one rejected expense.

## Expected requirements

Core:
1. Register users. Create groups with a member list. *Ask: Who can share expenses, and how are they grouped?*
2. Add an expense: group, payer, total in paise, split type, participants and a time. *Ask: What goes into an expense, and how can it be split?*
3. Validate every input: amounts, participants, membership, exact sums and percentages. *Ask: What makes an expense invalid?*
4. Shares add up to the total to the paisa; the leftover rule is stated and repeatable. *Ask: How is money stored, and who gets the leftover paisa?*
5. One netted balance per pair of users; show who owes whom, for all or for one user. *Ask: Are balances kept per pair or per group, and what can be shown?*
6. Settle up with the rules above. *Ask: How does one user pay another back?*
7. Safe under concurrent calls. *Ask: Can several threads use it at once?*

Extras (credit when they name one, never a gap):
- A rejected call changes nothing.
- Equal, exact and percent splits sit behind one interface, and each participant has a split input.
- Total above 0 and within the cap; no empty or duplicate participants; everyone is a group member; exact amounts add up; percentages total 100; no negative entries.

## Entities and relationships

- `Money`: an alias for `std::int64_t`, in paise. Not a class with operators.
- `User` (id, name) and `Group` (id, name, member ids): small structs. The service checks membership.
- `Part`: the caller's input for one participant. A user id and one number: exact paise, or percent in hundredths. Equal ignores the number.
- `Share`: a user id and the paise that user owes for one expense. The strategy computes it.
- `Settlement`: from, to, amount, time. Kept for history. The ledger does not read it.
- `Expense` (the hidden noun): id, group, payer, total, **the stored shares**, time. Most candidates apply the split straight into a balance map and keep no record. Then edit and delete are impossible, and nothing proves the total.
- `SplitStrategy` (interface) with `EqualSplit`, `ExactSplit` and `PercentSplit`: each validates its input and returns shares. They use no ledger, no clock and no lock.
- `Ledger`: the pair balances and the rule for adding to them.
- `SplitService`: owns users, groups, expenses, the ledger, the strategies and the lock.
- Not stored: a user's net position (derive it from the pairs), a balance per group, any floating-point value.

## Behaviour and states

- `addExpense(...)`: check the group, the payer, the participants and the total. Pick the strategy. It validates and returns the shares. Check that the shares add up to the total. Only then mutate: for each share whose user is not the payer and whose amount is above 0, call `ledger.add(user, payer, amount)`. Store the expense and return its id. All validation comes before the first change.
- `settle(from, to, amount, time)`: check the users and the amount, then check `amount <= owes(from, to)` and apply `ledger.add(to, from, amount)`, then record the `Settlement`. A settle-up is a debt in the opposite direction. The check and the change happen in one critical section.
- `balances()` and `balancesOf(user)` only read. They must never insert into a map.
- An expense has no states in the first version, and a pair is either at 0 (absent) or not. State has nothing to do.
- Every public method takes the same lock, reads included.

## Reference design

```
 using Money = std::int64_t;                                 // paise. 64-bit on purpose: 100,000,000 * 10,000 overflows int

 enum class SplitType { EQUAL, EXACT, PERCENT };

 struct Part    { int userId; std::int64_t value; };         // exact paise, or percent in hundredths (33.33 -> 3333); equal ignores it
 struct Share   { int userId; Money amount; };               // what one participant owes for one expense
 struct Group   { int id; std::string name; std::set<int> members; };
 struct Expense { int id; int groupId; int payerId; Money total; std::vector<Share> shares; int time; };
 struct Settlement { int from; int to; Money amount; int time; };
 struct Debt    { int debtor; int creditor; Money amount; };  // amount > 0
 struct Result  { bool ok; int id; std::string error; };     // one error style for every call

 // floor(total * w / sum(w)) per part, then leftover paise one each, in listed order, to parts with w > 0
 std::vector<Share> allocate(Money total, const std::vector<Part>& weights);

 class SplitStrategy {                                       // interface
  public:
   virtual ~SplitStrategy() = default;
   virtual bool split(Money total, const std::vector<Part>& parts,
                      std::vector<Share>& out, std::string& err) const = 0;   // false and a reason when the input is invalid
 };
 class EqualSplit   : public SplitStrategy { ... };          // every weight is 1, then allocate
 class ExactSplit   : public SplitStrategy { ... };          // each value >= 0 and sum == total; the values are the shares
 class PercentSplit : public SplitStrategy { ... };          // each value >= 0 and sum == 10000, then allocate

 class Ledger {
   std::map<std::pair<int,int>, Money> owed;                 // key (lo, hi), lo < hi. > 0: hi owes lo. < 0: lo owes hi. Erase at 0
  public:
   void add(int debtor, int creditor, Money amt);            // skip debtor == creditor; normalise the key; add or subtract; erase at 0
   Money owes(int debtor, int creditor) const;               // what debtor owes creditor; 0 when none or the debt runs the other way; never inserts
   std::vector<Debt> lines() const;                          // every non-zero pair once
 };

 class SplitService {
   std::map<int, std::string> users;
   std::map<int, Group> groups;
   std::map<int, Expense> expenses;
   std::vector<Settlement> settlements;
   std::map<SplitType, std::shared_ptr<SplitStrategy>> strategies;   // a new split type is a new class plus one line here
   Ledger ledger;
   mutable std::mutex mtx;
   int nextExpenseId = 1;
  public:
   Result addUser(int id, const std::string& name);                   // lock, reject a repeated id
   Result addGroup(int id, const std::string& name, const std::vector<int>& members);   // lock, check members exist and are distinct
   Result addExpense(int groupId, int payerId, Money total, SplitType type,
                     const std::vector<Part>& parts, int time);       // lock, validate, shares, apply, store
   Result settle(int from, int to, Money amount, int time);           // lock, check amount <= owes, apply, record
   std::vector<Debt> balances() const;                                // lock, ledger.lines()
   std::vector<Debt> balancesOf(int userId) const;
   Money netOf(int userId) const;                                     // owed to the user minus owed by the user
 };
```

One signed number per pair of users, under a key with the smaller id first, makes netting automatic: add on one side, subtract on the other, and a zero erases the pair. Each expense keeps its computed shares, so a later reversal subtracts exactly what was added.

Accepted variations:
- A nested `map<int, map<int, Money>>` that keeps `owes[a][b]` and `owes[b][a]` as opposite values. They must update both in one step.
- Un-netted directed edges, only if `balances()` nets each pair on read.
- Replaying every stored expense and settle-up on each read. It is correct, and they must say it costs O(E) per read.
- A `std::shared_ptr<SplitStrategy>` passed by the caller instead of an enum. A strategy that returns `std::optional` or throws instead of using an output parameter.
- Their own helper in place of `allocate`, if equal and percent share one leftover rule.
- A thin `Money` struct around the `int64`, with no floating point inside. System-assigned user and group ids.
- A `std::shared_mutex`, with a shared lock for reads and an exclusive lock for writes.

## Patterns that fit

- **Strategy** for the split type. This is the textbook case. The validation lives inside each strategy, so a new split type is one new class and one registration line, and `addExpense` does not change. They should notice that equal and percent are the same proportional split with different weights.
- A small shared function for the leftover paise. It is not a pattern, but it keeps one rule in one place.
- Not needed: Observer (no notifications in scope), Factory beyond a plain map, Singleton, State, Command or Memento for undo (stored shares do that job), Builder for `Expense`.

## Demo scenarios

Setup for every scenario: users 1 Alice, 2 Bob, 3 Carol, 4 Dave, 5 Erin. Group 1 "Trip" = Alice, Bob, Carol, Dave. Group 2 "Flat" = Alice, Bob. Group 3 "Big" = Alice, Bob, Carol, Dave, Erin. Each scenario starts from a fresh service unless it says otherwise. All amounts are paise. "Alice pays 1200 equal [Alice, Bob, Carol, Dave]" means a Trip expense with that payer, total, split type and participant order. "Bob owes Alice 300" is one balance line, and line order does not matter. Times are any whole numbers. Adapt the calls to the candidate's own API; the expected behaviour is what matters. Net positions are for your check. Work them out from the balance lines. The candidate need not offer an API for them. Scenarios 2, 4, 10b and 11, and the extension checks that use them, depend on the leftover rule. If they chose another rule that adds up, check only that the shares add up to the total, that none is negative, and that each share is within 1 paisa of its exact value (within n − 1 paise for a last-participant rule). Recompute the rest from the candidate's shares.

1. **Equal, exact division.** Alice pays 1200 equal [Alice, Bob, Carol, Dave]. Each share is 300. The balances are exactly: Bob owes Alice 300, Carol owes Alice 300, Dave owes Alice 300. Alice has no line for her own share. Net positions: Alice +900, and Bob, Carol and Dave −300 each. Variant on a fresh service: Alice pays 500 equal [Alice] is accepted, and the balances stay empty.
2. **Equal, leftover paise.**
   - a. Alice pays 1000 equal [Alice, Bob, Carol]. Shares 334, 333, 333. Balances: Bob owes Alice 333, Carol owes Alice 333.
   - b. Alice pays 1000 equal [Bob, Carol, Alice]. Shares 334, 333, 333 in that order. Balances: Bob owes Alice 334, Carol owes Alice 333.
   - c. Alice pays 1001 equal [Bob, Carol, Dave]. Shares 334, 334, 333. Balances: Bob owes Alice 334, Carol owes Alice 334, Dave owes Alice 333. The payer is outside the list, so Alice is owed all 1001.
   - d. Alice pays 1 equal [Bob, Carol]. Bob owes Alice 1. Carol has no line.
3. **Exact split.** Bob pays 2500 exact [Alice 1000, Bob 500, Carol 1000]. Balances: Alice owes Bob 1000, Carol owes Bob 1000. Variant: Bob pays 2500 exact [Alice 2500, Carol 0] is accepted. Balance: Alice owes Bob 2500, and Carol has no line.
4. **Percent split.**
   - a. Carol pays 10000 percent [Alice 50, Bob 30, Dave 20]. Balances: Alice owes Carol 5000, Bob owes Carol 3000, Dave owes Carol 2000.
   - b. Alice pays 101 percent [Bob 50, Carol 50]. Bob owes Alice 51, Carol owes Alice 50.
   - c. Alice pays 100 percent [Bob 33.33, Carol 33.33, Dave 33.34]. The three amounts add up to 100 and each is 33 or 34. With the brief's rule: Bob owes Alice 34, Carol 33, Dave 33. Skip this one if their API cannot take two decimals, and note that as a gap.
5. **Netting across groups, and a flip.** Start with scenario 1. Then Flat: Bob pays 500 equal [Alice, Bob]. The Alice and Bob pair becomes "Bob owes Alice 50", one line, with no "Alice owes Bob 250" line. Carol and Dave still owe Alice 300 each. Then Trip: Bob pays 500 equal [Alice, Bob]. The pair flips to "Alice owes Bob 200". Final lines: Alice owes Bob 200, Carol owes Alice 300, Dave owes Alice 300. Net positions: Alice +400, Bob +200, Carol −300, Dave −300.
6. **Settle-up, partial then full.** Start with scenario 1. Bob pays Alice 100: Bob owes Alice 200. Bob pays Alice 200: the Bob line is gone. Carol and Dave still owe Alice 300 each. Net positions: Alice +600, Bob 0, Carol −300, Dave −300.
7. **Settle-up rejected.** Start with scenario 1. Each call below is rejected, and the three 300 lines stay as they were:
   - Carol pays Alice 400 (she owes 300).
   - Carol pays Alice 0, and Carol pays Alice −50.
   - Alice pays Bob 100 (wrong direction, Alice owes nothing).
   - Dave pays Bob 100 (no debt between them).
   - Bob pays Bob 100.
   - Bob pays user 99 100.
8. **Split validation.** Each call is rejected. Afterwards the balance list is empty and no expense exists.
   - Bob pays 2500 exact [Alice 1000, Bob 500, Carol 900] (adds to 2400).
   - Bob pays 2500 exact [Alice 1000, Bob 1000, Carol 1000] (adds to 3000).
   - Bob pays 2500 exact [Alice 3000, Bob −500] (adds up, but one entry is negative).
   - Alice pays 1000 percent [Alice 50, Bob 30, Carol 10] (90).
   - Alice pays 1000 percent [Alice 50, Bob 30, Carol 30] (110).
   - Alice pays 1000 percent [Alice 33.33, Bob 33.33, Carol 33.33] (99.99).
   - Alice pays 1000 percent [Alice 120, Bob −20] (adds to 100, but one entry is negative).
9. **Input validation.** Each call is rejected, and nothing changes. Unless stated, each is a Trip expense: Alice pays 1000 equal [Alice, Bob].
   - Total 0, and total −500.
   - Empty participant list.
   - Duplicate participant: [Bob, Bob].
   - Erin as a participant (not a Trip member), and Erin as the payer.
   - User 99 as a participant, user 99 as the payer, and group 99.
   - Only if they asked about the cap: a total of 100,000,001.
10. **Large amounts and totals.**
    - a. Alice pays 100,000,000 percent [Bob 50, Carol 50]. Bob owes Alice 50,000,000, and Carol owes Alice 50,000,000. A 32-bit `total * percent` overflows here.
    - b. Alice pays 100,000,000 equal [Alice, Bob, Carol]. Shares 33,333,334, 33,333,333, 33,333,333. Bob owes Alice 33,333,333, and Carol owes Alice 33,333,333.
    - c. Alice pays 100,000,000 equal [Bob], 30 times. The balance is "Bob owes Alice 3,000,000,000", which is above the 32-bit limit.
11. **A mixed ledger.** Trip: Alice pays 3000 equal [Alice, Bob, Carol]. Bob pays 2000 equal [Bob, Carol, Dave] (shares 667, 667, 666). Carol pays 900 exact [Alice 100, Dave 800]. Balances, five lines: Bob owes Alice 1000, Carol owes Alice 900, Carol owes Bob 667, Dave owes Bob 666, Dave owes Carol 800. Net positions: Alice +1900, Bob +333, Carol −767, Dave −1466. They add up to 0. One user's view for Carol: owes Alice 900, owes Bob 667, is owed 800 by Dave.
12. **Concurrency. Only if the candidate made it thread-safe.**
    - a. Alice pays 20000 equal [Alice, Bob], so Bob owes Alice 10000. Two threads each call "Bob pays Alice 100" 100 times. Exactly 100 calls succeed and 100 are rejected. At the end the pair is at 0, and it was never below 0.
    - b. On a fresh service, two threads each add 1,000 expenses of "Alice pays 100 equal [Alice, Bob]". At the end: 2,000 distinct expense ids, Bob owes Alice 100,000, and the net positions add up to 0.

## Extensions

Pick the one that probes their biggest gap. A candidate who used a `switch` on the split type gets the share-based split. A candidate who kept no expense record gets edit and delete. A strong candidate gets simplify. Say the requirement, ask "What changes?", and hold the facts back until they ask. Offer a second one only if the first lands in about 5 minutes.

1. **Share-based splits:** "Split by shares: Bob 2, Carol 1, Dave 1."
   - Facts: each value is a whole number of shares, none negative, at most 1,000,000. Zero means that person owes nothing. All zero is rejected, because it divides by zero. The leftover rule is the same one.
   - Expect: one new class, `ShareSplit`, that calls the same `allocate`, plus one registration line. No edit to `addExpense`, `Ledger` or the other strategies. A candidate who sees equal as "1 share each" has seen the real shape.
   - Check: Alice pays 1000 shares [Bob 2, Carol 1, Dave 1]. Bob owes Alice 500, Carol 250, Dave 250. Alice pays 1000 shares [Bob 3, Carol 2]. Bob owes Alice 600, Carol 400. Alice pays 1001 shares [Bob 2, Carol 1]. With the brief's rule, Bob owes Alice 668 and Carol 333. Largest remainder gives 667 and 334. Both add up to 1001.
   - Same: scenarios 1 to 11 give the same results. A rejected expense still changes nothing.
2. **Simplify debts:** "Show the fewest payments that settle everyone."
   - Facts: it is a read-only suggestion. It does not change the stored pair balances or any net position, and it may pair people who never owed each other directly. Real use has at most about 12 people with a non-zero net position.
   - Expect: a function over the per-user net positions, and nothing else changes. Drop zeros. Then repeatedly match the largest debtor with the largest creditor and move the smaller of the two amounts. That gives at most k − 1 transfers for k non-zero users. It is **not always the minimum**. The true minimum is k minus the largest number of groups the people can be split into, where each group's nets add up to 0. That is a partition problem and NP-hard in general. For about 12 users, a bitmask search over zero-sum subsets finds it. A candidate at the hire bar who says "greedy, and it is not always minimal" holds the bar. Claiming greedy is optimal does not.
   - Check, scenario 11's ledger: 3 transfers, for example Dave pays Alice 1466, Carol pays Alice 434, Carol pays Bob 333. This is the minimum, because no proper subset of the four nets adds up to 0. Applying the transfers brings every net to 0. With another leftover rule, recompute the nets from the candidate's shares. It is still 3 transfers.
   - Check, where greedy loses: on Big, Alice pays 1100 exact [Carol 500, Dave 300, Erin 300], and Bob pays 500 exact [Alice 500]. Net positions: Alice +600, Bob +500, Carol −500, Dave −300, Erin −300. Greedy with ties to the lower id gives 4 transfers: Carol pays Alice 500, Dave pays Bob 300, Erin pays Bob 200, Erin pays Alice 100. The minimum is 3: Carol pays Bob 500, Dave pays Alice 300, Erin pays Alice 300. For any answer, check that every amount is above 0, that every net ends at 0, and the count.
   - Same: `balances()`, `balancesOf` and `settle` give the same results as before.
3. **Edit and delete an expense:** "Let a user delete an expense, or change it."
   - Facts: balances afterwards must equal the balances as if the expense had never existed (delete), or as if the new version had always been the real one (edit). Settle-ups stay. An unknown id, an already-deleted id, and editing a deleted expense are rejected. An edit may change the amount, the split, the participants or the payer, but not the group. An invalid edit is rejected and leaves the old expense in place.
   - Expect: delete walks the stored shares and applies each in reverse: `ledger.add(payer, user, amount)`. Edit validates the new version first, then reverses the old and applies the new in one critical section. Subtracting "total / n" is wrong with leftover paise and with exact and percent splits. Replaying everything is accepted if it replays the settle-ups too.
   - Check: Alice pays 1200 equal [Alice, Bob, Carol, Dave], then Bob pays Alice 100, so Bob owes Alice 200 and Carol and Dave owe 300 each. Delete the expense: the only line is "Alice owes Bob 100". Bob's 100 payment stays, and Bob's 300 share is gone. Edit instead to 1600 equal, same people: Bob owes Alice 300, Carol 400, Dave 400. Edit instead to payer Bob, 1200 equal, same people: Alice owes Bob 400, Carol owes Bob 300, Dave owes Bob 300. Edit instead to exact amounts that do not add up: rejected, and the lines are still Bob 200, Carol 300, Dave 300.
   - Same: scenarios 1 to 11 give the same results, settle-up rules do not change, and the shares of an untouched expense are not recomputed.

## Concurrency follow-up

"Two people add expenses and a third settles up at the same moment. Walk me through what can go wrong in your code." Expect:
- The shared state is the pair map, the expense table, the settlement list, the user and group tables, and the id counter.
- An expense touches several pairs. Without one lock around the whole change, a reader can see half an expense, with net positions that do not add up to 0, and two writers can lose an update to the same pair.
- `settle` is a check-then-act: both threads read "owes 100", both pass `amount <= owes`, and both subtract. The check and the change must sit in the same critical section.
- `std::map::operator[]` inserts, so even a read can write. Reads need the lock too.
- The fix is one `std::mutex` with a `std::lock_guard` in every public method. The strategy's `split` is a pure function, so it may run before the lock. The group and membership reads belong inside the lock, because `addGroup` can insert into the same map. An edit is one critical section.

Stretch signal: states the cost with the brief's numbers. At about 100 calls per second and a few microseconds each, one lock is busy well under 1% of the time. One lock per pair needs the locks taken in sorted key order for a multi-pair expense, or two expenses can deadlock, and it buys nothing at this load. Sharding by group does not work here, because balances are global: two groups share the same Alice and Bob pair. They also say not to call anything unknown while holding the lock.

## Level bar

Hire bar must show:
- Step 1 questions that cover the money unit and rounding, the leftover rule, the split types and their validation, whether balances are per pair or per group, the settle-up rules, and threads.
- Money as an integer type, 64-bit, with no floating point in amounts. Shares that add up to the total exactly, with a stated and implemented leftover rule.
- The split types behind a Strategy, with validation inside it, so a new type lands in one new class.
- `Expense` and `Share` as real types, and a pair balance that nets, so "who owes whom" has no duplicate pair and no zero line.
- Validation that finishes before the first mutation, so a rejected call leaves no trace.
- A program that compiles and runs scenarios 1 to 9 inside the time.
- Correct locking when asked, with the settle-up race named.

Stretch signal:
- Finds `Expense` with stored shares and the pair ledger fast (inside 15 minutes), with the skeleton compiling by minute 30.
- Treats time as a parameter without being told. Asks about rounding and overflow before coding.
- Sees equal and percent as one proportional split. States the invariant "shares add up to the total" and asserts it in `main()`.
- Handles the extension with a small, local change and says which existing behaviour stays the same. For simplify, they say plainly that greedy is not always minimal.
- Lists failure cases up front: overpaying a settle-up, a zero entry, a payer outside the list, a delete after a settle-up.

## Traps

- `double` for money, or rounding every share to 2 decimals. 33.33 three times gives 99.99, so the shares do not add up and the ledger drifts. Comparing percentages with `== 100.0` fails the same way.
- Dividing with `total / n` and dropping `total % n`. Paise disappear, and the net positions no longer add up to 0.
- A 32-bit `int` for `total * percent`, which overflows at 100,000,000.
- A `switch` on the split type inside `addExpense`, so every new split type edits the service. The opposite fault is an interface, a factory and a builder for three tiny rules.
- Applying the shares while validating. A bad sum found after the second share leaves a half-applied expense.
- A directed matrix that is never netted, so the output shows "Alice owes Bob 250" and "Bob owes Alice 300" together. Or only per-user net positions, which cannot say who owes whom.
- No `Expense` record, so delete is impossible. Or delete by subtracting `total / n`, which is wrong with leftover paise and exact splits.
- `operator[]` in a read path. It inserts zero pairs and prints "owes 0" lines.
- Letting a settle-up overpay, or checking the amount outside the lock. Reading the system clock for the expense time.
- "Greedy simplify gives the minimum." "Use max-flow" is the same kind of confident wrong answer, because max-flow does not minimise the number of edges. Another one: simplify that rewrites the stored pair balances, which destroys the record of who paid whom.
- Copying an `Expense` or a map entry (`auto x = ...`) and changing the copy, or erasing from the map while iterating over it.
- Spending more than 25 minutes on steps 1 to 3, so nothing runs at the end.
