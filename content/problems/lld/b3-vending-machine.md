---
id: b3-vending-machine
track: lld
title: Vending Machine
difficulty: medium
tags: [state-machine, change-making, interfaces, strategy, concurrency]
tracker:
  section: "### B3. Applied Practice — Classic LLD Problems"
  bullet: "Vending Machine"
notesFile: notes/b3-vending-machine.md
lldFolder: vending-machine
---

## Opening prompt

Design a vending machine. Build it as a running, in-memory C++ program, with a `main()` that shows it working.

## Hidden facts

Reveal a fact only when the candidate asks about it. Never volunteer the list.

- **What happens:** a customer picks a slot, pays with coins and notes, and gets the product and any change. An operator restocks products and loads money. There is no screen and no keypad parsing: `main()` calls methods on the machine.
- **Order of steps:** select first, then pay. The customer inserts one piece at a time. A piece inserted before any selection is refused and comes straight back.
- **Money:** coins 1, 2, 5, 10 and notes 20, 50, 100. One currency, whole units, no decimals. No other value is accepted. The machine only cares about the face value. The stock of pieces starts empty and has no upper limit. The operator fills it with `loadMoney`.
- **Sale completes by itself:** the moment the inserted total reaches the price or more, the machine dispenses and returns change in the same call. There is no "confirm" or "dispense" call. Dispensing means the call returns the product; there is no hardware in the first version. Not enough money yet is waiting, not an error.
- **Cancel:** allowed any time before the product drops. The customer gets back the exact pieces they put in, not the same amount in other pieces. Cancel with nothing selected does nothing and returns nothing. Either no error or a no-slot-selected error is fine.
- **Change:** it comes from the machine's own stock of pieces. The pieces the customer just inserted count as stock for that same sale. Largest piece first is accepted for the first version. Change is always under 100: the money held before the last piece was below the price, and a piece is at most 100. A switch to a cheaper slot releases money held below the old price, which is at most 99.
- **No exact change:** the sale is cancelled. The customer gets back exactly the pieces they inserted, no product is dispensed, the product quantity and the stock stay as they were, and the machine goes back to idle.
- **Changing the selection:** while a sale is open, the customer may select another slot. The money stays. The machine checks again at once, so a switch can complete the sale. A bad choice (invalid slot or sold out) is refused, and the open sale stays as it was. Selecting the slot that is already selected changes nothing.
- **Slots:** the count is fixed when the machine is built. The demo uses 4. Ids run from 0 to count minus 1. Each slot holds one product and a quantity. All slots start empty. Two slots may hold the same product. No limit on quantity per slot. A count of 0 or less is invalid at construction.
- **Product:** a name and a price. The price is a whole number from 1 to 99. Two products are the same when name and price are equal.
- **Operator calls:** `restock(slot, product, quantity)` and `loadMoney(piece, count)`. They work only when no sale is open. During a sale they are refused with a busy error and change nothing.
- **Restock rule:** an empty slot accepts any product. A non-empty slot accepts only the same product, and the quantity adds up. A different product, or the same name with another price, on a non-empty slot is refused and nothing changes.
- **Bad input:** an invalid slot id (below 0 or at the count or above), a quantity or count of 0 or less, a price outside 1 to 99, and an empty product name are all refused without changing anything.
- **Errors:** every call returns an outcome the caller can see. Sold out, bad slot and no exact change are normal outcomes, so no exceptions for them. A constructor error may throw.
- **Customers:** one customer at a time. The operator is a different caller, not a stored "user type".
- **Threads:** two callers can run at the same moment: the keypad (customer calls) and the operator's service tablet (operator calls). `main()` may stay single-threaded for the demo.
- **Time:** the first version has none. If a rule ever needs time, the caller passes it in whole seconds. Never the system clock. A customer who walks away: nothing happens, and the sale stays open until someone cancels or pays.
- **Demo:** `main()` shows an exact-money sale, a sale with change, a cancel, a sold-out slot, a refused operator call and a restock. Read-only getters (quantity of a slot, count of a piece in stock) are fine but not required.
- **Out of scope:** cards and other payment, a screen, collecting the cash, the operator taking products or pieces out, hardware faults, price changes during a sale, receipts, several products in one sale, saving state to disk.

## Expected requirements

Core:
1. A machine with a fixed number of slots. The operator stocks each slot with a product and a quantity. *Ask: What does the machine hold, and who fills it?*
2. The customer selects a slot, inserts pieces one at a time, and may cancel. *Ask: What are the customer's steps, and in what order?*
3. The sale completes when the total reaches the price. The machine dispenses, lowers the quantity and returns change. *Ask: When does a sale complete, and what does the customer get?*
4. Change comes from stock, including the customer's pieces; no exact change cancels the sale. *Ask: Where does change come from, and what if it cannot be made?*
5. Cancel returns exactly the pieces inserted. *Ask: What does a customer get back on cancel?*
6. The operator can restock and load money; both are refused during a sale. *Ask: What can the operator do, and when?*
7. Safe when the keypad thread and the operator thread call at the same time. *Ask: Can several threads use it at once?*

Extras (credit when they name one, never a gap):
- Invalid or out-of-order calls are refused without changing state. A bad call never crashes the machine.
- When a sale is cancelled for lack of exact change, the exact pieces come back. The restock rule holds.

## Entities and relationships

- `Denomination` (enum class with face values: ONE = 1 up to HUNDRED = 100). Map keys sort by value, so the largest piece is at the end.
- `Cash` (an alias for `std::map<Denomination, int>`): a count per denomination. Used for the stock, for the pieces inserted, and for change. **Money is never one number.**
- `Product` (struct): name and price. A value, not a class hierarchy.
- `Slot` (struct): a product and a quantity. The id is the position in a `vector`.
- `Order` (the hidden noun): the slot id and the exact pieces inserted so far. It exists only while a sale is open. **Most candidates keep `balance` and `selectedSlot` as loose fields on the machine, and then cannot refund exact pieces.**
- `State` (enum class): IDLE and SLOT_SELECTED. Only states a caller can see between two calls.
- `CustomerPanel` and `OperatorPanel` (interfaces): two sets of methods, both implemented by `VendingMachine`. Callers are not entities.
- `VendingMachine`: owns the slots, the stock, the state, the open order, the lock and the change rule.
- Not stored: the balance as one number, the change (computed at sale time), the user type, a DISPENSING step.

## Behaviour and states

A sale finishes inside one `insertMoney` call. So "dispensing" and "returning change" never exist between two calls, and they are not states. The machine has exactly two states. The open order exists exactly when the state is SLOT_SELECTED.

```
 method          | IDLE                                      | SLOT_SELECTED
 ----------------|-------------------------------------------|-----------------------------------------
 selectSlot(id)  | bad id -> INVALID_SLOT; empty -> SOLD_OUT;| same two checks, order untouched on error;
                 | both stay IDLE. Else new Order, then      | else switch the slot, KEEP the pieces,
                 | SLOT_SELECTED                             | run the completion check
 insertMoney(d)  | NO_SLOT_SELECTED, piece comes back        | add the piece, run the completion check
 cancel()        | nothing to cancel, nothing returned       | return the exact pieces, drop the order, IDLE
 restock(...)    | validate, apply the restock rule          | MACHINE_BUSY
 loadMoney(...)  | validate, add to the stock                | MACHINE_BUSY
```

Each cell is one branch in the code. An empty cell is an unhandled situation.

The completion check, in this order:

```
 paid < price ?   -> wait (return an empty result, state unchanged)
 1. move the order's pieces INTO the stock          <- before change: the customer's own piece can be the change
 2. makeChange(paid - price) from the stock
 3a. success -> quantity--, dispense, return the change
 3b. failure -> take the pieces back OUT of the stock, return them, NO_EXACT_CHANGE
 drop the order, state = IDLE
```

- `makeChange` walks the stock from the largest piece down and takes `min(amount / value, inStock)`. It writes the stock only after the amount reaches 0. A leftover amount above 0 means failure.
- Greedy fails on some stock mixes. Change 6 from {5:1, 2:3} is possible (2+2+2), but greedy takes the 5 and then has nothing for the last 1. Accept greedy for the first version. They should say what it misses.
- `cancel` and `insertMoney` must check the state before touching the order. `order->` on an empty `std::optional` is undefined behaviour.

## Reference design

```
 enum class Denomination { ONE = 1, TWO = 2, FIVE = 5, TEN = 10, TWENTY = 20, FIFTY = 50, HUNDRED = 100 };
 enum class State { IDLE, SLOT_SELECTED };               // only what a caller can see between two calls
 enum class Error { NONE, INVALID_SLOT, SOLD_OUT, NO_SLOT_SELECTED, NO_EXACT_CHANGE,
                    MACHINE_BUSY, SLOT_NOT_EMPTY, INVALID_INPUT };

 using Cash = std::map<Denomination, int>;               // a count per denomination
 struct Product { std::string name; int price; };
 struct Slot    { Product product; int quantity = 0; };  // the vector index is the slot id
 struct Order   { int slotId; Cash inserted; int total() const; };   // the pieces, not a running total
 struct Result  { Error error = Error::NONE; std::optional<Product> dispensed; Cash returned; };

 class CustomerPanel {                                   // interface
  public:
   virtual ~CustomerPanel() = default;
   virtual Result selectSlot(int slotId) = 0;
   virtual Result insertMoney(Denomination d) = 0;
   virtual Result cancel() = 0;
 };
 class OperatorPanel {                                   // interface
  public:
   virtual ~OperatorPanel() = default;
   virtual Error restock(int slotId, Product product, int quantity) = 0;
   virtual Error loadMoney(Denomination d, int count) = 0;
 };

 class VendingMachine : public CustomerPanel, public OperatorPanel {
   std::vector<Slot> slots;                 // built once from the slot count
   Cash cashStock;
   State state = State::IDLE;
   std::optional<Order> order;              // has a value exactly when state == SLOT_SELECTED
   std::mutex mtx;                          // one lock for both panels
   Result tryCompleteSale();                // wait, or: pieces into stock, make change, roll back on failure
   bool makeChange(int amount, Cash& change);   // largest first; writes cashStock only on success
  public:
   explicit VendingMachine(int slotCount);  // throws std::invalid_argument when slotCount < 1
   // the five overrides, each starts with std::lock_guard<std::mutex> lock(mtx);
 };
```

`Order` holds the slot id and the exact pieces as a `Cash` map, not a total. That one choice makes cancel and the no-exact-change refund trivial, and it lets the sale decrement the right slot. A map keyed by an `enum class` whose values are the face values gives largest-first walking with `rbegin()` and a count per piece.

## Patterns that fit

- **Enum plus a transition table** is the reference for two states and five methods. Each cell of the table is one branch.
- **State pattern** is accepted if they name the cost: a class per state, one pass-through per method, and the circular dependency between machine and states. It pays when a third state arrives, so it is a senior signal only when they argue it from that axis: new states favour the pattern, new methods favour the enum. Building five state classes for two states in the first 40 minutes is over-engineering.
- **Interface segregation** for the two panels: the customer code cannot call `restock`, and no `if (user == OPERATOR)` appears anywhere.
- **Strategy** for the change rule or for a dispenser, when an extension arrives. An interface plus a fake in `main()` is also a testing seam.
- Also accepted, if they can defend it: the slot id and a `Cash` kept as two fields instead of an `Order` type (a bare `balance` number is not accepted); making change on a copy of the stock and committing only on success, instead of moving the pieces in and rolling back; an `int` piece checked against the seven values instead of an enum; a count array indexed by piece instead of a map; a search for change instead of greedy.
- Not needed: Singleton, Factory, Observer, Builder, Command, a `Product` class hierarchy, separate `Coin` and `Note` classes (one face value covers both).

## Demo scenarios

Each scenario starts from a fresh machine unless it says otherwise. Adapt the calls to the candidate's own API; the expected behaviour is what matters. "Waiting" means the call succeeds and nothing is dispensed. Where a scenario names a quantity or a stock count, read it through a getter if they have one, or infer it from the next sale. If they asked about a rule and the interviewer answered, their code must follow the answer. If they decided a rule on their own and said so, grade their code against their own rule, not the brief. A crash or wrong money is always a failure. For a rule they never asked about and never stated, grade against the brief and name the missed question at the debrief.

**Machine A:** 4 slots. Slot 0 holds Cola, price 35, quantity 3. Slot 1 holds Chips, price 20, quantity 2. Slot 2 holds Gum, price 5, quantity 1. Slot 3 is empty. The stock holds 10 pieces of each of the seven denominations.

**Machine B:** the same 4 slots and products, but the stock is empty.

1. **Exact money, several pieces (A).** Select slot 0. Insert 20: waiting. Insert 10: waiting. Insert 5: the total is 35, so Cola is dispensed and nothing comes back. Cola quantity is 2. The stock now holds 11 each of 20, 10 and 5. Insert 5 again: refused, no slot selected, and the piece comes back.
2. **Change from stock (A).** Select slot 1, insert 50. Chips is dispensed and the change is one 20 and one 10. Chips quantity is 1. The stock holds 11 of 50, 9 of 20 and 9 of 10.
3. **A big note for a small item (A).** Select slot 2, insert 100. Gum is dispensed and the change is 95: one 50, two 20 and one 5. Gum quantity is 0. Select slot 2 again: sold out.
4. **Cancel returns the exact pieces (A).** Select slot 0. Insert 10 three times: waiting each time. Cancel: three 10 pieces come back (not a 20 and a 10), no product. Cola quantity is still 3 and the stock is unchanged. Insert 5: refused, no slot selected.
5. **Bad customer input (A).**
   - Insert 10 with nothing selected: refused, the 10 comes back, the stock is unchanged.
   - Cancel with nothing selected: nothing returned, nothing changes.
   - Select -1 and select 4: invalid slot. Select 3 (empty): sold out. After each, insert 5 is still refused as no slot selected.
   - Select 2, insert 5: Gum is dispensed with no change. Select 2 again: sold out.
   - Only if their API takes a plain `int` for the piece: inserting 7 comes straight back with an error, and the state does not change.
6. **Switching the selection keeps the money.**
   - Machine A: select 0, insert 20 (waiting). Select 3 (empty): sold out, and the order stays on slot 0 with 20 inserted. Select 1: the sale completes at once. Chips is dispensed, nothing comes back, Cola is still 3 and Chips is 1.
   - Fresh machine A: select 1, insert 10 (waiting). Select 0: still waiting, because 10 is below 35. Insert 20 (waiting), insert 5: Cola is dispensed and nothing comes back. Chips is still 2 and Cola is 2.
7. **The customer's own piece is the change (B).** Select slot 1. Insert 10: waiting. Insert 20: the total is 30, Chips is dispensed and one 10 comes back. Chips quantity is 1. The stock now holds exactly one 20. A design that makes change only from the old stock refuses this sale, and that is wrong.
8. **No exact change, then recovery (B).** Select slot 0, insert 20 (waiting), insert 20: the total is 40 and the change would be 5, but the stock has no 5. The sale is cancelled: two 20 pieces come back, no product, Cola is still 3, the stock is empty, and the state is idle. The operator loads one 5 (allowed, nothing is open). Repeat the same three calls: Cola is dispensed and one 5 comes back. Cola is 2 and the stock holds two 20 pieces.
9. **The operator is refused during a sale (A).** Select 0, insert 10. Restock slot 1 with Chips 20, quantity 5: refused as busy. Load three 5 pieces: refused as busy. Chips is still 2 and the 5 stock is still 10. Insert 20 (waiting), insert 5: Cola is dispensed. Now restock slot 1 with Chips 20, quantity 5: accepted, Chips is 7. Load three 5 pieces: accepted, the 5 stock is 14.
10. **Restock rules (A).**
    - Restock slot 3 with Water 15, quantity 4: accepted. Select 3, insert 10, insert 5: Water is dispensed with no change. Water quantity is 3.
    - Restock slot 0 with Cola 35, quantity 4: accepted, Cola is 7.
    - Restock slot 0 with Fanta 35, quantity 2: refused as slot not empty. Restock slot 0 with Cola 40, quantity 1: refused too, and Cola is still 7 at price 35. (Only if they never asked and compare products by name only and say so, accepting Cola 40 is also fine: then Cola is 8, and the price is graded against their own rule.)
    - Sell Gum out (select 2, insert 5). Restock slot 2 with Mints 8, quantity 3: accepted, because the slot is empty. Select 2, insert 10: Mints is dispensed and one 2 comes back. Mints is 2.
11. **Bad operator input and construction (A).** Restock slot 9 and slot -1: invalid slot. Restock slot 3 with quantity 0 and with quantity -2, with price 0, price -5 and price 100, and with an empty name: all refused. Load 0 pieces and -1 pieces: refused. Afterwards slot 3 is still empty (select 3 gives sold out) and the stock is unchanged. Load two 5 pieces: accepted, the 5 stock is 12. A machine with 0 slots and a machine with -1 slots are rejected at construction with an error the caller can see. A machine with 1 slot works.
12. **Concurrency. Only if the candidate made it thread-safe.** A machine with 1 slot that holds Gum, price 5, quantity 1,000. The stock is empty. Thread 1 (keypad) makes 1,500 attempts: select slot 0, and if that is accepted, insert one 5. It counts the attempts that dispensed Gum as D. Thread 2 (operator) restocks slot 0 with Gum 5, quantity 1, exactly 500 times, and retries each time it gets busy. After both threads finish: no crash, D plus the final quantity is exactly 1,500, the stock holds exactly D pieces of 5, and the machine is idle.

## Extensions

Pick one the candidate has not seen. Prefer 1 or 2. Number 3 has the same shape as the maintenance mode they already built. Say the requirement, ask "What changes?", and hold the facts back until they ask.

1. **Change whenever the stock allows it:** product says the machine must find change whenever its stock can make it, not only when greedy can.
   - Facts: prefer the fewest pieces, and any answer wins a tie. Keeping greedy's pieces whenever greedy succeeds, and searching only when greedy fails, is also accepted. The change is always under 100. The stock still includes the customer's own pieces. A failure still cancels the sale and returns the exact pieces. Example: slot 0 holds Juice at price 14, the stock holds one 5 and three 2 pieces, and the customer inserts one 20. The change is 6. The new rule returns three 2 pieces, and the stock then holds the 20 and the 5. Greedy fails here. With only one 5 in stock, change 6 is truly impossible, so the 20 comes back.
   - Expect: only `makeChange` changes. A bounded search or a small table over amounts up to 99 and the seven denominations is enough. Putting it behind a small interface with a greedy and an exact version also works. The rollback and the "pieces into stock first" rule do not move.
   - Same: scenarios 1 to 11 give the same results, because greedy already returns the fewest pieces in every one of them. (In general greedy can use more pieces than the fewest on a rare stock mix, so a fewest-pieces search may hand back different pieces than greedy there.)
2. **Idle timeout:** a sale that sits unpaid for too long is cancelled and refunded.
   - Facts: the limit is 60 seconds since the last activity. Activity is a successful select (new, switch, or the same slot again) and every inserted piece. A refused call is not activity. A sale is expired when `now` minus the last activity is 60 or more. Expiry returns the exact pieces, drops the order and goes to idle. Time comes from the caller in whole seconds: either `now` on every customer call, or one `tick(now)`. Both are accepted. The machine starts no thread and never reads a clock. Operator calls carry no time. The demo ticks or makes a customer call first, so this never decides a result. If a customer call arrives after expiry, the old pieces are refunded in that call's result and the call is then handled as in idle: a piece comes straight back, and a select starts a new sale. An operator call during an expired sale that nobody has noticed yet is refused as busy, because operator calls carry no time.
   - Example (machine A): at 0 select slot 0. At 30 insert 10, so the deadline is now 90. A tick at 89 does nothing. A tick at 90 returns one 10 and the state is idle.
   - Expect: a last-activity field on `Order`, set by select and insert. One `expireIfStale(now)` step that reuses the cancel code. The refund reaches the caller and is not lost when a lazy check fires inside another call. No new state, because expiry lands in idle.
   - Same: with every call inside the window, scenarios 1 to 11 give the same results. Cancel still returns the exact pieces. No system clock and no sweeper thread.
3. **Dispense failure (close to the maintenance mode they saw):** the dispenser can jam. The machine calls a `Dispenser` and may get a failure back.
   - Facts: the dispenser returns success or failure, and the demo uses a fake that fails on demand. On failure the sale is cancelled. The customer gets back the exact pieces. The quantity and the stock stay as they were. The machine then goes to OUT_OF_ORDER. In that state every customer call is refused as out of order, and a piece inserted comes straight back. The operator's restock and load calls still work. A new operator call `repair()` goes back to idle. `repair()` in any other state is refused. A jam stops the whole machine, not one slot.
   - Expect: a third state and a cell for every method. A dispenser interface injected at construction. In the completion check, change is worked out in a local, then the dispenser runs, and only then do the stock and quantity change. A good answer says why that order matters.
   - Same: with a dispenser that never fails, scenarios 1 to 11 give the same results. Cancel, change and the busy rule do not change.
4. **Maintenance mode (already seen):** the operator enters a maintenance state. Customers are out of service during it, and restock and load money work only there. Do not use it.

## Concurrency follow-up

"The operator's tablet restocks slot 2 at the same moment the keypad's last `insertMoney` completes a sale from slot 2. Walk me through what happens in your code." Expect:
- It names the shared state: `slots`, `cashStock`, `state` and `order`.
- It names the races. A lost update: `quantity--` and `quantity += n` interleave. A check-then-act race: `restock` sees IDLE, then the keypad thread selects a slot before `restock` writes. Undefined behaviour: `makeChange` walks `cashStock` while `loadMoney` inserts into the same map.
- The fix is one `std::mutex` member of the machine, taken with `std::lock_guard` at the top of every public method of both panels, reads and getters included. One lock, because both panels are views of the same object. The state check happens inside the lock.
- Private helpers do not lock. `std::mutex` is not recursive, so a public method that calls another public method locks twice. That is undefined behaviour, and in practice a deadlock.
- If they used the State pattern: copying the `shared_ptr` to the current state while another thread assigns it is itself a data race. The lock must cover the copy and the call.

Senior signal:
- Lock scope with a reason. Outside code that can call back into the machine must not run under the lock, because the mutex is not recursive. They see that a slow dispenser held under the lock stalls every other call, and that letting go of the lock mid-sale needs a visible DISPENSING state: a slow outside call is what earns a new state. Holding the lock across a fast fake dispenser is fine.
- Uses the numbers. One customer presses a key every few hundred milliseconds, and each critical section takes microseconds, so one lock is busy far below 1% of the time. Per-slot locks add deadlock risk and buy nothing, because a sale touches a slot, the stock and the order together.
- Names the other shape: one thread owns the machine and both panels post commands to a queue, which is the actor model (an actor with a mailbox, such as an Elixir process or an Akka actor, is also accepted). States the cost, which is latency and a reply channel.

## Level bar

SDE-2 (hire) must show:
- Step 1 questions that cover the order of steps, cancel and refund, the failure list (sold out, bad slot, no exact change), where change comes from, what the operator can do and when, and threads. A rule they do not ask about must appear as a stated assumption.
- The exact pieces held per denomination and kept together with the slot id (an `Order` type is the reference; two fields are fine), and `Slot` and `Product` as plain data. Customer and operator as two interfaces or two clear groups of methods.
- A state enum with only the states a caller can see, and a transition table written or spoken. Wrong-order calls are refused, not crashes.
- A program that compiles and runs scenarios 1 to 9 inside the time, with something running by about minute 40.
- The inserted pieces counted as stock before change is made, with a rollback on failure (or change worked out on a copy and committed only on success), and a refund of the exact pieces.
- The extension handled in the last 15 minutes: they restate it, name which existing behaviour changes, and write the change or the exact fields and methods that change.
- Correct locking when asked: one mutex shared by both panels.

Senior signal:
- Finds `Order` and the cash shape fast (inside 15 minutes), with the skeleton compiling by minute 30.
- Explains why dispensing is not a state, and what would earn a new state (a jam, maintenance, a slow outside call).
- Picks the enum or the State pattern with the axis argument, unprompted, and states the cost.
- Names the greedy flaw with a real stock mix (for example 6 from {5:1, 2:3}) before the interviewer does, and chooses to keep it or fix it with a reason.
- Takes time as a parameter without being told. Re-runs the scenarios after the extension.
- Asks about extension-shaped things in step 1 (cards, hardware faults) and then keeps them out of the first version.

## Traps

- A running `balance` number (with `selectedSlot` as a loose field) instead of the exact pieces: cancel and the failed-change refund cannot return the exact pieces, and a refund by amount hands back different pieces.
- A state per step of the happy path (SELECTING, ACCEPTING_MONEY, DISPENSING, RETURNING_CHANGE): the sale runs inside one call, so no caller ever sees these. Each extra state adds cells and bugs.
- A separate `dispense()` or `confirm()` call: it allows wrong sequences. Auto-dispense makes them impossible.
- Making change from the old stock only: a sale the customer's own piece could finish is refused.
- Changing the real stock before the change succeeds and not undoing it on failure, or forgetting to take the pieces back out: the stock goes wrong after a refused sale.
- A greedy loop that does not check that the leftover is 0: the machine gives short change without telling anyone.
- Switching the selection with `order = {slotId, {}}`: the inserted money is dropped.
- Reusing the sold-out check inside `restock`: restocking an empty slot fails.
- A `UserType` enum or an `isOperator` flag with `if` checks in every method, instead of two interfaces.
- `map<string, int>` from product to quantity: it loses the slot, and two slots with the same product clash.
- Copying a slot (`Slot s = slots[i]`) and changing the copy, so the real quantity never changes. Or `->` on an empty `std::optional` in idle.
- Floating point for prices (rounding errors), or an `int` piece that is not checked against the seven values (an invalid piece gets in).
- Locking each panel with its own mutex, or calling a public method from inside a locked one, or running code that can call back into the machine while holding the lock.
- Reading the system clock for a timeout: the behaviour cannot be tested.
- Five State classes and a factory before anything runs, or more than 25 minutes on steps 1 to 3 so nothing runs at the end.
