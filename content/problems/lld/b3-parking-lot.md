---
id: b3-parking-lot
track: lld
title: Parking Lot
difficulty: medium
tags: [strategy, concurrency, observer, data-shape]
tracker:
  section: "### B3. Applied Practice — Classic LLD Problems"
  bullet: "Parking Lot"
notesFile: notes/b3-parking-lot.md
lldFolder: parking-lot
---

## Opening prompt

Design a parking lot. Build it as a running, in-memory C++ program, with a `main()` that shows it working.

## Hidden facts

Reveal a fact only when the candidate asks about it. Never volunteer the list.

- **What happens:** a vehicle arrives at an entrance and gets a ticket with its spot. At an exit it pays a fee based on how long it stayed. The system picks the spot; the driver does not choose.
- **Gates:** 2 entrances and 2 exits, but the number must be configurable. A gate is entry-only or exit-only.
- **Floors:** several. Use 3 for the demo; the count must not be fixed in the code. Each floor has its own mix of spot sizes.
- **Vehicle types:** motorcycle, car, truck.
- **Fit rule:** a vehicle fits a spot of its own size or bigger. A motorcycle fits anywhere, a car fits a car or truck spot, a truck fits only a truck spot.
- **Which spot:** the first free spot that fits. Lowest floor first, then the lowest spot number on that floor. No distance to gates.
- **Lot full:** reject. No ticket, no queue.
- **Fee:** a rate per vehicle type per hour: motorcycle 20, car 50, truck 100. Every started hour counts, so 130 minutes is 3 hours and 1 minute is 1 hour. Rates must be configurable.
- **Two gates at once:** yes, entrances and exits run at the same moment. Two vehicles must never get the same spot, and one spot must never be freed twice. `main()` may stay single-threaded for the demo.
- **Layout:** given at setup, never changes while running.
- **Out of scope:** payment failures, lost tickets, reservations, a UI.
- **Time:** the caller passes the time in (minutes since opening is fine). Do not read the system clock.

## Expected requirements

Core:
1. Configure floors, spots per floor with sizes, gates and rates at setup. *Ask: What is fixed when the lot is set up?*
2. Entry: assign the first free fitting spot and return a ticket; reject if nothing fits. *Ask: What happens when a vehicle arrives, and what if the lot is full?*
3. Exit: given a ticket and a time, compute the fee, free the spot, close the ticket. *Ask: What happens when a vehicle leaves, and how is the fee worked out?*
4. Invalid or already-used tickets are rejected without changing state. *Ask: What if a ticket is wrong or used twice?*
5. Safe under concurrent entry and exit calls. *Ask: Can several threads use it at once?*

Extras (credit when they name one, never a gap):
- Entry takes a vehicle type and a time.

## Entities and relationships

- `VehicleType` (enum class, ordered by size: MOTORCYCLE, CAR, TRUCK). Also used as the spot size.
- `Spot` (class or struct): id, floor, size, and whether it is taken (or the ticket id that holds it). **The noun most candidates hide inside nested maps.**
- `Ticket` (the hidden noun): ticket id, vehicle type, spot id, entry time. Created at entry, closed at exit.
- `ParkingLot`: owns the spots and the open tickets, the lock, and the pricing rule.
- `PricingStrategy` (interface) with an hourly implementation: the fee rule is a policy, not stored data.
- Gates are callers of the lot, not data. They can be thin classes that hold a reference to the lot.
- Not stored: the fee (computed at exit), the vehicle itself (no plate needed).

## Behaviour and states

- `enter(type, time)` returns an optional ticket: walk the spots in order (floor, then number), take the first free one with `size >= type`, mark it taken, create the ticket.
- `exit(ticketId, time)` returns a fee or an error: look the ticket up, refuse unknown or closed tickets, compute `ceil(minutes / 60) * rate`, free the spot, close the ticket.
- A spot has two states, free and taken. A ticket has two states, open and closed.
- Every method that reads or writes spots or tickets takes the same lock, reads included.

## Reference design

```
 enum class VehicleType { MOTORCYCLE, CAR, TRUCK };      // order is the fit rule: size >= type

 struct Spot   { int id; int floor; VehicleType size; std::optional<int> ticketId; };
 struct Ticket { int id; VehicleType type; int spotId; int entryMinute; bool open; };

 class PricingStrategy {                                 // interface
  public:
   virtual ~PricingStrategy() = default;
   virtual int fee(VehicleType type, int minutes) const = 0;
 };
 class HourlyPricing : public PricingStrategy { ... std::map<VehicleType, int> ratePerHour; ... };

 class ParkingLot {
   std::vector<Spot> spots;                 // built once, sorted by (floor, number): the list order IS the rule
   std::map<int, Ticket> tickets;
   std::shared_ptr<PricingStrategy> pricing;
   std::mutex mtx;
   int nextTicketId = 1;
  public:
   std::optional<Ticket> enter(VehicleType type, int minute);   // lock, first free fitting spot, new ticket
   std::optional<int> exit(int ticketId, int minute);           // lock, validate, fee, free spot, close ticket
 };
```

A flat `vector<Spot>` sorted by floor and number turns "lowest floor, then lowest number" into one loop. A ticket stores the spot id, so exit is one lookup.

## Patterns that fit

- **Strategy** for pricing (and optionally for spot assignment): a new pricing rule is a new class, not an edit to `ParkingLot`.
- **Observer** only if the display-board extension comes up.
- Not needed: Singleton, Factory, State pattern (two states per object do not justify it).

## Demo scenarios

Layout for every scenario unless stated: floor 1 = M, M, C, C, T (spot ids 0 to 4); floor 2 = M, C, C, C (ids 5 to 8); floor 3 = C, C, T (ids 9 to 11). Rates 20, 50, 100 per hour. Adapt the calls to the candidate's own API; the expected behaviour is what matters.

1. A car enters at minute 0: it gets spot 2 (floor 1, first car spot).
2. A motorcycle enters: it gets spot 0.
3. A truck enters: it gets spot 4.
4. A second truck enters: it gets spot 11 (floor 3).
5. A third truck enters: rejected, no ticket, nothing changes.
6. The car from scenario 1 exits at minute 130: fee 150 (3 hours times 50); spot 2 is free again.
7. A new car enters: it gets spot 2 again (lowest free fitting spot).
8. Exit with a ticket id that was never issued: rejected; no spot changes.
9. Exit the same ticket twice: the second exit is rejected and nothing is freed twice.
10. Fill both motorcycle spots on floor 1 and spot 5, then a fourth motorcycle enters: it takes the lowest free spot of any size (spot 3 if free).
11. Fees at the edges: 1 minute is 1 hour, 60 minutes is 1 hour, 61 minutes is 2 hours.
12. Only if the candidate made it thread-safe: two threads each admit 1,000 cars into a lot with 500 car-or-bigger spots; exactly 500 tickets succeed and no spot id appears twice.

## Extensions

Pick one.
1. **Electric-vehicle charging:** some car spots have chargers. An electric car prefers a charger spot but may take any car spot; a charger spot costs 20 more per hour while charging. What changes? Expect: a spot attribute plus a pricing rule, ideally no edit to the assignment loop beyond a preference order; Strategy pays off here.
2. **Weekend and night rates:** the rate depends on when the hour started. What changes? Expect: a new `PricingStrategy` that walks the stay hour by hour; `ParkingLot` untouched.
3. **Display boards:** each floor shows free spots by size and updates on every entry and exit. Expect: Observer, notify after releasing the lot's lock, each board with its own lock.

## Concurrency follow-up

"Two entrances call `enter` at the same moment with one spot left. Walk me through what happens in your code." Expect: names the check-then-act race; one `std::mutex` with `std::lock_guard` in every method that touches spots or tickets, reads included; explains why the exit path needs the lock too. Stretch signal: discusses lock scope (do not call out to boards or loggers while holding it) and per-floor locks as the next step, with the cost.

## Level bar

Hire bar must show:
- Step 1 questions that cover gates, fit rule, lot full, fee rule and concurrency.
- `Spot` and `Ticket` as real types; a flat data shape that makes the assignment rule a simple walk.
- A program that compiles and runs scenarios 1 to 9 inside the time.
- Pricing kept out of `ParkingLot` (Strategy or at least one function object), so the extension lands in one place.
- Correct locking when asked.

Stretch signal:
- Finds `Ticket` and the data shape fast (inside 15 minutes), skeleton compiling by minute 30.
- Treats time as a parameter without being told.
- Handles the extension with a small, local change and says which existing behaviour stays the same.

## Traps

- Nested maps (`floor -> type -> number -> ticket`) instead of a `Spot` type: every lookup can fail three ways, and `operator[]` silently inserts.
- Copying a spot or ticket (`auto x = ...`) and then changing the copy, so the real one never changes.
- `->` on an empty `std::optional`.
- Locking only the entrance path and forgetting exits and reads.
- Reading the system clock inside the lot, which makes the fee untestable.
- Spending more than 25 minutes on steps 1 to 3 so nothing runs at the end.
