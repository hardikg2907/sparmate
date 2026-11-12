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
sources:
  - title: "techinterview.org: Parking Lot low-level design"
    url: "https://www.techinterview.org/post/3233463532/low-level-design-parking-lot/"
confidence: "The fit rule (a vehicle fits a spot of its own size or bigger) and a fit check on the vehicle type, with no vehicle class tree, agree with the write-up read. That write-up gives a vehicle the smallest spot that fits; this problem uses the first free spot that fits on purpose, and its scenarios test that rule. The write-up locks each spot and the ticket table; this problem uses one lock and names finer locks as the next step. The fee rule, the layout, the rates, the scale and the night and weekend rules are this problem's own assumptions."
---

## Opening prompt

Design a parking lot. Build it as a running, in-memory C++ program, with a `main()` that shows it working.

## Hidden facts

Reveal a fact only when the candidate asks about it. Never volunteer the list.

- **What happens:** a vehicle arrives at an entrance and gets a ticket with its spot. At an exit it pays a fee based on how long it stayed. The system picks the spot; the driver does not choose.
- **Gates:** 2 entrances and 2 exits today, and more may be added. A gate is entry-only or exit-only. The spot and the fee never depend on the gate.
- **Floors:** several. Use 3 for the demo; the count must not be fixed in the code. Each floor has its own mix of spot sizes.
- **Vehicle types:** motorcycle, car, truck.
- **Fit rule:** a vehicle fits a spot of its own size or bigger. A motorcycle fits anywhere, a car fits a car or truck spot, a truck fits only a truck spot.
- **Which spot:** the first free spot that fits. Lowest floor first, then the lowest spot number on that floor. No distance to gates.
- **Lot full:** reject. No ticket, no queue.
- **Fee:** a rate per vehicle type per hour: motorcycle 20, car 50, truck 100. Every started hour counts, so 130 minutes is 3 hours and 1 minute is 1 hour. A stay of 0 minutes is charged as 1 hour. Rates must be configurable.
- **Exit time:** an exit with a minute before the ticket's entry minute is rejected, and the ticket stays open.
- **Tickets:** ids are ints handed out in order from 1, and an id is never reused. A closed ticket stays closed.
- **Vehicles:** no plate and no identity. The same car may enter twice and gets two tickets.
- **Size:** up to about 2,000 spots. A walk over all spots on each entry is fine.
- **Two gates at once:** yes, entrances and exits run at the same moment. Two vehicles must never get the same spot, and one spot must never be freed twice. `main()` may stay single-threaded for the demo.
- **Layout:** given at setup, never changes while running.
- **Out of scope:** payment failures, lost tickets, reservations, a UI.
- **Time:** the caller passes the time in (minutes since opening is fine). Do not read the system clock.

For the interviewer: on the gates, setting up the gates means creating the callers of the lot, not storing gate data in it. A thin gate class that holds a reference to the lot meets that requirement, and so does a lot that any number of callers use with no gate type at all. A candidate who passes a gate id into `enter` and `exit` and ignores it is fine. Never mark down either choice.

For the interviewer: on the fit rule, "first free fitting spot" in the requirements means the fit rule above: a vehicle fits a spot of its own size or bigger. A candidate who never asks which spots a vehicle can use has missed a rule.

For the interviewer: on threads, score the concurrency requirement only when the interviewer asked about it or the candidate took it on.

For the interviewer: on which spot, if the candidate proposes the smallest free spot that fits, say "the first free spot that fits" and add nothing. Their reason for wanting it is worth a note.

## Expected requirements

Core:
1. Configure floors, spots per floor with sizes, gates and rates at setup. *Ask: What is fixed when the lot is set up, and does the lot need to know the gates?*
2. Entry: assign the first free fitting spot and return a ticket; reject if nothing fits. *Ask: What happens when a vehicle arrives, which spots can each vehicle use, and what if the lot is full?*
3. Exit: given a ticket and a time, compute the fee (every started hour at the rate of the vehicle's type, at least 1 hour), free the spot, close the ticket. *Ask: What happens when a vehicle leaves, and is a part hour charged?*
4. An unknown ticket, a ticket used twice, or an exit time before the entry is rejected without changing state. *Ask: What if a ticket is wrong or used twice?*
5. Safe under concurrent entry and exit calls. *Ask: Can several threads use it at once?*

Extras (credit when they name one, never a gap):
- A way to read the free spots per floor and size, for a display or a test.
- Names the cost of first-fit (a car can take the last truck spot on a floor) and best-fit as the other rule.

## Entities and relationships

- `VehicleType` (enum class, ordered by size: MOTORCYCLE, CAR, TRUCK). Also used as the spot size.
- `Spot` (class or struct): id, floor, number on the floor, size, and whether it is taken (or the ticket id that holds it). **The noun most candidates hide inside nested maps.**
- `Ticket` (the hidden noun): ticket id, vehicle type, spot id, entry time, open or closed. Created at entry, closed at exit.
- `ParkingLot`: owns the spots and the open tickets, the lock, and the pricing rule.
- `PricingStrategy` (interface) with an hourly implementation: the fee rule is a policy, not stored data. It takes the whole ticket and the exit time, so a rule that needs the entry time fits behind the same call.
- Gates are callers of the lot, not data. They can be thin classes that hold a reference to the lot.
- Not stored: the fee (computed at exit), the vehicle itself (no plate needed), the gate.

## Behaviour and states

- `enter(type, time)` returns an optional ticket: walk the spots in order (floor, then number), take the first free one with `size >= type`, mark it taken, create the ticket.
- `exit(ticketId, time)` returns a fee or an error: look the ticket up, refuse an unknown or closed ticket and an exit time before the entry, then ask the pricing rule for the fee (`max(1, ceil(minutes / 60)) * rate` in the hourly rule), free the spot, close the ticket. Every check runs before the first change, so a rejected exit changes nothing.
- A spot has two states, free and taken. A ticket has two states, open and closed.
- Every method that reads or writes spots or tickets takes the same lock, reads included.

## Reference design

```
 enum class VehicleType { MOTORCYCLE, CAR, TRUCK };      // order is the fit rule: size >= type

 struct Spot   { int id; int floor; int number; VehicleType size; std::optional<int> ticketId; };
 struct Ticket { int id; VehicleType type; int spotId; int entryMinute; bool open; };

 class PricingStrategy {                                 // interface
  public:
   virtual ~PricingStrategy() = default;
   virtual int fee(const Ticket& ticket, int exitMinute) const = 0;   // the whole ticket, so a rule can see when the stay began
 };
 class HourlyPricing : public PricingStrategy {
   std::map<VehicleType, int> ratePerHour;
  public:
   explicit HourlyPricing(std::map<VehicleType, int> rates);
   int fee(const Ticket& ticket, int exitMinute) const override;      // max(1, started hours) * rate of the ticket's type
 };

 class ParkingLot {
   std::vector<Spot> spots;                 // sorted by (floor, number), id == index: the list order IS the rule
   std::map<int, Ticket> tickets;
   std::shared_ptr<PricingStrategy> pricing;
   std::mutex mtx;
   int nextTicketId = 1;
  public:
   ParkingLot(std::vector<Spot> layout, std::shared_ptr<PricingStrategy> pricing);   // sorts by (floor, number), sets each id to its index
   std::optional<Ticket> enter(VehicleType type, int minute);   // lock, first free fitting spot, new ticket
   std::optional<int> exit(int ticketId, int minute);           // lock, validate, fee, free spot, close ticket
 };
```

A flat `vector<Spot>` sorted by floor and number turns "lowest floor, then lowest number" into one loop. The spot id equals its index in that vector, so a ticket that stores the spot id frees its spot with one lookup. The fee call passes the whole ticket and the exit minute, so a new pricing rule never changes the call in `exit`.

## Patterns that fit

- **Strategy** for pricing (and optionally for spot assignment): a new pricing rule is a new class, not an edit to `ParkingLot`. A function object such as `std::function<int(const Ticket&, int)>` is the same seam with less code.
- **Observer** only if the display-board extension comes up.
- **Accepted alternatives:** a `Floor` class that holds its spots, if the walk still goes floor by floor and number by number. A free set per size (`std::set<int>` of spot ids for each size), where first fit is the lowest id across the sets of sizes that fit; it pays off only well beyond 2,000 spots, and a plain walk is fine here. A pricing call that takes only the vehicle type and the minutes, as a first version: the night-rate extension then widens it, which is a fair, small change if they say so. Smallest-spot-first assignment is a valid rule in general, but here the interviewer's answer is first fit, and the code must follow the answer they got.
- Not needed: Singleton, Factory, State pattern (two states per object do not justify it), a class per vehicle type (the fit rule is one comparison on an ordered enum).

## Demo scenarios

Every scenario starts from a fresh lot with this layout unless it says otherwise: floor 1 = M, M, C, C, T (spot ids 0 to 4); floor 2 = M, C, C, C (ids 5 to 8); floor 3 = C, C, T (ids 9 to 11). Rates 20, 50, 100 per hour. Every entry is at minute 0 unless a minute is given. Adapt the calls to the candidate's own API; the expected behaviour is what matters.

1. **A car takes the first car spot.** A car enters: it gets spot 2 (floor 1, first car spot). A second car enters: it gets spot 3.
2. **A motorcycle takes the first spot.** A motorcycle enters: it gets spot 0. A car then enters: it gets spot 2.
3. **A truck takes a truck spot.** A truck enters: it gets spot 4. A car then enters: it gets spot 2.
4. **Trucks go up a floor.** Two trucks enter: they get spots 4 and 11 (floor 3).
5. **Lot full for trucks.** Two trucks enter (spots 4 and 11). A third truck enters: rejected, no ticket. Nothing changed: a car that enters next gets spot 2, and a motorcycle after it gets spot 0.
6. **Exit and fee.** A car enters at minute 0 (spot 2) and exits at minute 130: fee 150 (3 hours times 50). Spot 2 is free again: a car that enters at minute 140 gets spot 2.
7. **A freed spot is reused first.** Car A enters (spot 2), then car B (spot 3). Car A exits at minute 30: fee 50. Car C enters at minute 40: it gets spot 2 again, the lowest free fitting spot.
8. **An unknown ticket changes nothing.** A car enters at minute 100 (spot 2). An exit with ticket id 999, never issued, is rejected. A second car enters at minute 110 and gets spot 3, so spot 2 is still taken. The first car then exits at minute 160: fee 50.
9. **A ticket used twice.** Car A enters at minute 0 (spot 2) and exits at minute 60: fee 50. Car B enters at minute 60 and gets spot 2. Car A's ticket exits again at minute 70: rejected, no fee. Car C enters at minute 70 and gets spot 3, because spot 2 still holds car B. Car B exits at minute 120: fee 50.
10. **Motorcycles spill into bigger spots.** Six motorcycles enter one after another. They get spots 0, 1, 2, 3, 4 and 5: the third takes car spot 2, because spots 0 and 1 are taken and spot 2 is the next spot that fits, and the fifth takes truck spot 4. The motorcycle in spot 0 exits at minute 60: fee 20. A seventh motorcycle enters at minute 60 and gets spot 0. If they never asked which spot to pick and chose the smallest free spot that fits, with that rule stated in their code or notes, judge this scenario against their own rule: the six get spots 0, 1, 5, 2, 3 and 6.
11. **Fees at the edges.** Five cars each enter at minute 0 and exit at minutes 0, 1, 60, 61 and 130: fees 50, 50, 50, 100 and 150. A motorcycle that stays 61 minutes pays 40. A truck that stays 120 minutes pays 200. After all of them have left, a car enters at minute 200 (spot 2) and tries to exit at minute 150, before its entry: rejected, and its ticket stays open. A second car then gets spot 3, and the first car exits at minute 260 and pays 50. If they never asked about a stay of 0 minutes and their code states a fee of 0 for it, accept 0 for that one stay.
12. **Another layout and other rates.** Floor 1 = M, C (ids 0 and 1); floor 2 = C, T (ids 2 and 3). Rates 10, 30, 60. A motorcycle, a car, a second car and a truck enter at minute 0: spots 0, 1, 2 and 3. A second truck is rejected, and so is a third car. The motorcycle exits at minute 30: fee 10. The car in spot 1 exits at minute 61: fee 60. The truck exits at minute 181: fee 240 (4 started hours times 60).
13. **Two gates at once. Only if the candidate made it thread-safe.** One floor of 500 car spots. Two threads each try to admit 1,000 cars at minute 0. Exactly 500 tickets succeed and no spot id appears twice. Then two threads each try to exit all 500 tickets at minute 60: exactly 500 exits succeed, each with fee 50, and a new car then gets the first spot.

## Extensions

Pick one. Say the requirement, ask "What changes?", and give the facts only when they ask.

1. **Electric-vehicle charging:** some car spots have chargers. An electric car prefers a charger spot but may take any spot that fits; charging costs extra per hour. What changes?
   - Expect: a `charger` flag on `Spot`, an electric flag on the entry call, and a preference step in `enter`: look for the lowest free charger spot first, then fall back to the normal walk. The ticket records at entry whether the car is charging, so the fee rule reads it from the ticket. A new pricing rule (or a wrapper around the hourly one) adds the surcharge, and `exit` is untouched, because the fee call already gets the whole ticket. A candidate whose fee takes only the type and the minutes has to widen it; a fair, small change if they say why. Weak answers: an `if (electric)` inside `HourlyPricing`, or a second spot list that the walk must merge. Stretch: says a plain car may block a charger spot, and names a rule for it (charger spots last for plain cars) as a product question, not a code change.
   - Facts: a charger spot is a car spot with a charger. An electric car takes the lowest free charger spot; with none free, it takes the first free spot that fits, like any car. A plain car may use a charger spot and pays no surcharge. Charging runs for the whole stay, and the surcharge is 20 per started hour, only for an electric car on a charger spot.
   - Check: spot 3 has a charger. An electric car enters at minute 0 and gets spot 3, though spot 2 is free. A plain car then gets spot 2. A second electric car gets spot 4, the next free spot that fits, because the only charger is taken. At minute 130 the first electric car pays 3 times (50 + 20) = 210, the second pays 150, and the plain car pays 150.
   - Same: scenarios 1 to 12 with no charger spots, and the fee of every plain car.
2. **Weekend and night rates:** the rate now depends on when each hour of the stay started. Night hours and weekend hours cost more. What changes?
   - Expect: a new `PricingStrategy` that walks the stay hour by hour from the entry minute, prices each started hour by the moment it starts, and adds them up. `ParkingLot` is untouched, because the fee call already passes the ticket (with its entry minute) and the exit minute. A candidate whose first version passes only the type and the minutes changes that one call in `exit`; a fair, small change if they say so. Weak answers: a branch on the time of day inside `ParkingLot`, or pricing the whole stay by its start time or its end time. Stretch: keeps the 1-hour minimum and the started-hour rule in one shared place, so both pricing rules agree, and names the cost of a walk per hour for very long stays (fine here).
   - Facts: minute 0 is Monday 00:00. A started hour is a night hour when it starts at 22:00 to 05:59 (minute of the day 1320 to 1439, or 0 to 359). It is a weekend hour when it starts on a Saturday or a Sunday. A night or weekend hour costs 1.5 times the rate: motorcycle 30, car 75, truck 150. Every other hour costs the normal rate. A stay of 0 minutes is still 1 hour, priced by its start.
   - Check: a car enters at minute 1290 (Monday 21:30) and exits at 1410: two started hours, at 1290 (day, 50) and 1350 (night, 75): 125. A car enters at minute 0 and exits at 420: six night hours and one day hour, 6 times 75 plus 50 = 500. A car enters at minute 7800 (Saturday 10:00) and exits at 7920: 150. A motorcycle enters at minute 7170 (Friday 23:30) and exits at 7290: 60.
   - Same: entry, exit checks, the fit rule and every spot result. A stay from 10:00 to 12:10 on a weekday still costs 150 for a car.
3. **Display boards:** each floor has a board that shows its free spots by size, and it must update on every entry and exit. What changes?
   - Expect: a listener interface (for example `onFloorChanged(floor, size, freeCount)`) that boards implement and register on the lot. `enter` and `exit` collect the change while they hold the lock and notify after they release it, so a slow board never blocks a gate. Each board keeps its own lock for its own counts. The walk in `enter` and the pricing rule are untouched. A rejected entry or exit sends no update. Weak answers: the lot holding a `Board` type and calling it directly, or notifying while it still holds the lot's lock. Stretch: keeps a free count per floor and size inside the lot, so an update needs no walk over the spots, and says that a board may briefly show an older count than the lot, which is fine for a display.
   - Facts: a board counts spots by the spot's own size, not by which vehicles could use them. A free car spot counts once, under cars. There is one board per floor. A board only reads; it never changes the lot.
   - Check: on a fresh lot, floor 1's board shows motorcycle 2, car 2, truck 1. A motorcycle enters (spot 0): floor 1 shows motorcycle 1. Three more motorcycles enter (spots 1, 2 and 3): floor 1 shows motorcycle 0, car 0, truck 1. A truck enters and gets spot 4: floor 1 shows truck 0, and floors 2 and 3 got no update. A second truck gets spot 11: floor 3 shows truck 0. A third truck is rejected and no board changes.
   - Same: scenarios 1 to 12, with or without boards registered.

## Concurrency follow-up

"Two entrances call `enter` at the same moment with one spot left. Walk me through what happens in your code." Expect: names the check-then-act race; one `std::mutex` with `std::lock_guard` in every method that touches spots or tickets, reads included; explains why the exit path needs the lock too. Stretch signal: discusses lock scope (do not call out to boards or loggers while holding it) and per-floor locks as the next step, with the cost.

## Level bar

Hire bar must show:
- Step 1 questions that cover gates, fit rule, lot full, fee rule and concurrency.
- `Spot` and `Ticket` as real types; a flat data shape that makes the assignment rule a simple walk.
- A program that compiles and runs scenarios 1 to 9 inside the time, with the core running by about minute 40.
- Pricing kept out of `ParkingLot` (Strategy or at least one function object), so the extension lands in one place.
- Correct locking when asked.

Stretch signal:
- Finds `Ticket` and the data shape fast (inside 15 minutes), skeleton compiling by minute 30.
- Treats time as a parameter without being told.
- Passes the whole ticket to the pricing rule before any extension, and can say why.
- Handles the extension with a small, local change and says which existing behaviour stays the same.

Below the bar:
- The fee worked out inside `ParkingLot` with a literal rate and no time input, or the spots held in nested maps with no `Spot` type.
- Nothing runs at the end, whatever the quality of the design.

## Traps

- Nested maps (`floor -> type -> number -> ticket`) instead of a `Spot` type: every lookup can fail three ways, and `operator[]` silently inserts.
- A `Vehicle` class tree (`Car`, `Motorcycle`, `Truck`) with no behaviour of its own: the fit rule is one comparison on an ordered enum, and the tree adds code that nothing calls.
- Integer division that rounds down (`minutes / 60 * rate`): 1 minute costs 0 and 130 minutes costs 2 hours. Scenario 11 catches it.
- Freeing the spot before every check has passed, so a rejected exit (a closed ticket, or an exit before the entry) still frees a spot. Scenarios 9 and 11 catch it.
- Copying a spot or ticket (`auto x = ...`) and then changing the copy, so the real one never changes.
- `->` on an empty `std::optional`.
- Locking only the entrance path and forgetting exits and reads.
- Reading the system clock inside the lot, which makes the fee untestable.
- Spending more than about a third of the round on steps 1 to 3 so nothing runs at the end.
