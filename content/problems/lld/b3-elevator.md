---
id: b3-elevator
track: lld
title: Elevator System
difficulty: hard
tags: [state-machine, strategy, scheduling, simulation, concurrency]
tracker:
  section: "### B3. Applied Practice — Classic LLD Problems"
  bullet: "Elevator System"
notesFile: notes/b3-elevator.md
lldFolder: elevator
sources:
  - title: "Hello Interview, Elevator"
    url: "https://www.hellointerview.com/learn/low-level-design/problem-breakdowns/elevator"
confidence: "Medium. The car states, the sweep order, the hall call versus the car call, and a replaceable dispatch rule are the problem's standard form. The one outside write-up of the problem dispatches at once with no waiting queue. This version holds a call that no car can serve and retries it at the start of every tick, and it states that rule in full. The three extensions are the usual follow-ups. The scenario ticks were replayed against a model of the stated rules, and the waiting-call and heading cases were checked against that model on random loads."
---

## Opening prompt

Design an elevator system. Build it as a running, in-memory C++ program, with a `main()` that shows it working.

## Hidden facts

Reveal a fact only when the candidate asks about it. Never volunteer the list.

- **What happens:** people press a button on a floor (a hall call) and the system picks a car. Inside the car they press a floor (a car call). The car goes there and opens its doors.
- **Building:** 10 floors, numbered 0 to 9, with 0 as the ground floor. The count must be configurable. Real use goes up to about 50 floors and 8 cars.
- **Cars:** 3 in the demo, with ids 0, 1, 2. The count must be configurable. Every car serves every floor. In the demo all cars start idle at floor 0 with doors closed, unless a scenario says otherwise. Start floors are a setup value.
- **Hall call:** a floor plus a direction, UP or DOWN. The ground floor has no DOWN button and the top floor has no UP button. Such a press is invalid.
- **Car call:** a car id plus a floor. The caller names the car, so nothing is dispatched.
- **Passengers:** not modelled. There are no people, no boarding and no destination tied to a hall call. `main()` presses the car call itself when it wants a passenger to get in. No weight exists in the first version. A served hall call does not set the car's next heading.
- **Who picks the car:** the system, for hall calls only, through a replaceable rule. The first rule is "nearest suitable car".
- **Nearest suitable car:** distance is the number of floors between the car and the call floor. A car with no stops and doors closed is free, and a free car is suitable for any call. A busy car is suitable only when it is heading the same way as the call and the call floor is still ahead of it. A car with its doors open is never suitable. A car that holds a stop at its own floor and has not opened its doors yet counts the same way. The call floor must lie strictly ahead, so a moving car that is already at the call floor is not suitable. The nearest suitable car wins. Ties go to the lowest car id. So a press at the floor where a car stands with its doors open goes to another car, or waits.
- **Heading of a busy car:** a free car takes its heading the moment it gets its first stop. The car counts as moving toward that stop at once, even before the first tick. After that, the heading changes only when the car reverses. A car that has never moved has heading UP. A free car whose first stop is its own floor keeps the heading of its last trip.
- **No suitable car:** the call waits. A new call is tried at once. Waiting calls are retried at the start of every tick, before any car moves, oldest first. A press that has to wait is still a valid press: it is accepted, not rejected. The return value tells valid from invalid, not assigned from waiting.
- **Order of stops:** a car keeps its heading while any stop lies ahead. When none lies ahead and one lies behind, it reverses. When none remain, it goes idle. Stops are served in sweep order, never in the order pressed. A car never reverses between stops. The car turns at its last stop, not at the end of the shaft.
- **Idle cars:** an idle car stays where it is. There is no parking at the ground floor.
- **Time:** simulated. `main()` calls `tick()`. The system never reads the clock, sleeps or starts a timer thread. One call is one step, and a car moves one floor per step.
- **Doors:** a car that arrives at a stop opens its doors in that same tick. In the next tick the doors close and the car does not move. The tick after that, it moves on if it has stops. The door time is 1 tick in the demo.
- **Same floor:** a hall call for the floor where a free car stands goes to that car (distance 0), and its doors open on the next tick. A car call for the floor the car is on is invalid. For a moving car, that means the floor it just reached. A car call for a floor behind the car is valid, and the car serves it after it reverses.
- **Pressing a lit button:** pressing the same hall call or the same car call twice is not an error. It adds no second stop and moves no second car.
- **Invalid input:** floor out of range, unknown car id, a missing button, the car's own floor. The call is rejected and nothing changes. Any error style works, but use one style for every rejected call.
- **Threads:** in a real building many floors press at once while a timer calls `tick()`. `main()` may stay single-threaded.
- **Out of scope:** passengers, destination dispatch (choosing a car at the lobby), fire and emergency modes, door sensors, acceleration, energy, a UI, more than one building, load balancing, a guarantee that a waiting call is served within a set time.

For the interviewer: on the order of stops, accept either name, SCAN or LOOK.

For the interviewer: on a hall call at the floor where a car stands with its doors open, if the candidate argues for serving it with that car, accept that as their stated assumption. Scenarios 1 to 11 never press a hall call at such a floor.

For the interviewer: on the doors, a good design makes the door time a setup value.

For the interviewer: do not mention the extensions until the extension step.

## Expected requirements

Core:
1. Configure floors, car count and car start floors at setup. *Ask: What is fixed when the building is set up?*
2. Hall call (floor, direction): validate it, drop a lit duplicate, pick a car by a replaceable rule. *Ask: What happens when someone presses a button in the hall?*
3. Car call (car id, floor): validate it and add a stop to that car. *Ask: What happens when a rider presses a floor button inside a car?*
4. Each car has four states (idle, up, down, doors open) and serves stops in SCAN order. *Ask: What does a car do between stops, and in what order does it serve them?*
5. `tick()` advances the whole building by one step. No system clock. *Ask: How does time pass in the simulation?*
6. Invalid input is rejected without changing state. *Ask: What should happen on bad input?*
7. Safe under concurrent button presses and ticks (only when asked). *Ask: Can several threads use it at once?*
8. The caller can read each car's floor and state, so `main()` can print positions. *Ask: How does the caller see where the cars are?*

Extras (credit when they name one, never a gap):
- A hall call that no car can serve yet is held until a car is suitable.

## Entities and relationships

- `Direction` (enum class: UP, DOWN): the hall button and the car's heading.
- `CarState` (enum class: IDLE, MOVING_UP, MOVING_DOWN, DOORS_OPEN). One enum replaces the loose flags `isMoving` and `doorsOpen`. The flags allow "moving with doors open", which must not exist.
- `HallCall` (struct, the hidden noun): floor, direction, and the assigned car id, or -1 while it waits. **Most candidates keep a hall call as two loose ints, so they cannot detect a duplicate or hold a waiting call.** It lives from the press until the assigned car opens its doors there.
- `Elevator` (the car): id, floor, state, heading (UP until the car first moves) and `stops`. It owns the SCAN rule and the one-tick `step()`, because both need only its own data.
- `DispatchStrategy` (interface) with `NearestSuitable`: it reads the cars and returns a car id, or -1. It never changes a car.
- `Building`: owns the cars, the hall calls, the strategy and the lock. Its entry points are `hallCall`, `carCall` and `tick`.
- Not stored: passengers, weight (until the extension), a clock, the caller's destination.

## Behaviour and states

- `hallCall(floor, dir)`: reject out-of-range floors and missing buttons. If the same call is already in `calls`, succeed and change nothing. Otherwise add it with car -1 and ask the strategy. On a car id, call `addStop(floor)` on that car and record the id.
- `carCall(carId, floor)`: reject an unknown car, a floor out of range and the car's own floor. Then `addStop(floor)`.
- `addStop(f)`: insert `f` into `stops`. A free car also sets its heading toward `f` and its state to MOVING_UP or MOVING_DOWN at once. If `f` is its own floor, it stays IDLE and the next tick opens the doors. Any other car only inserts.
- `Elevator::step()` checks in this order: doors open, a stop at its own floor, no stops, then a move of one floor along the heading. If the new floor is a stop, the stop is removed and the doors open.
- `Building::tick()`: retry the waiting calls in order, step every car in id order, and erase the hall calls assigned to a car that opened its doors at that floor.

```
 IDLE (no stops)        --stop added, other floor-->  MOVING_UP / MOVING_DOWN   (state flips now, car has not moved)
 IDLE (stop at floor)   --tick-->                     DOORS_OPEN
 MOVING_x               --tick, new floor is a stop-> DOORS_OPEN                 (stop removed)
 MOVING_x               --tick, not a stop-->         MOVING_x                   (floor +1 or -1)
 DOORS_OPEN             --tick, stops left-->         MOVING_UP / MOVING_DOWN    (SCAN rule, no move this tick)
 DOORS_OPEN             --tick, no stops-->           IDLE
```

- Invariants: a moving car always has a stop ahead in its heading. A car moves at most one floor per tick and never with doors open. Its floor stays in `0..floors-1`. A hall call is in `calls` exactly once, from the press until it is served.
- Every public method of `Building` takes the same lock, reads included.

## Reference design

```
 enum class Direction { UP, DOWN };
 enum class CarState  { IDLE, MOVING_UP, MOVING_DOWN, DOORS_OPEN };

 struct HallCall { int floor; Direction dir; int car; };      // car == -1 while the call waits

 class Elevator {
  public:
   int id; int floor; CarState state; Direction heading = Direction::UP;   // heading survives DOORS_OPEN
   std::set<int> stops;                                       // sorted: "ahead" is the last or the first element
   void addStop(int f);
   bool step();                                               // one tick; true when the doors opened this tick
 };

 class DispatchStrategy {                                     // interface
  public:
   virtual ~DispatchStrategy() = default;
   virtual int pick(const std::vector<std::shared_ptr<Elevator>>& cars, const HallCall& call) const = 0;  // car id or -1
 };
 class NearestSuitable : public DispatchStrategy { ... };     // suitable() filter, then min distance, lowest id on ties

 class Building {
   int floors;
   std::vector<std::shared_ptr<Elevator>> cars;
   std::vector<HallCall> calls;                               // press order; waiting and assigned calls in one list
   std::shared_ptr<DispatchStrategy> strategy;
   mutable std::mutex mtx;
  public:
   Building(int floors, std::vector<int> carStartFloors, std::shared_ptr<DispatchStrategy> strategy);   // throws std::invalid_argument on a bad setup
   bool hallCall(int floor, Direction dir);
   bool carCall(int carId, int floor);
   void tick();
   int carFloor(int carId) const;                             // lock, then read; for the demo and the checks
   CarState carState(int carId) const;
 };
```

Each car holds its stops in a sorted `std::set<int>` plus a heading. Sorting turns the SCAN rule into two checks: is the largest stop above the car, or the smallest below it. One `calls` list holds both waiting and assigned hall calls, so the duplicate check and the clean-up after service are one scan each.

## Patterns that fit

- **Strategy** for the dispatcher: a new rule (fewest stops, estimated arrival) is a new class, not an edit to `Building`. The strategy takes cars and a call and returns an id. It does not change a car.
- **An enum plus one `step()`** is enough for the four states. A small State class per state is also fine if the transitions stay in one place. Do not mark either choice down.
- **Command or an event queue** only in the concurrency follow-up.
- **Accepted alternatives:** two sorted containers per car instead of one set plus a heading: stops above and stops below, as two `std::set`s or two `std::priority_queue`s. With heaps, the candidate must drop duplicate stops by hand, and cannot erase a middle stop. A `(floor, direction)` key in a set or map can stand in for the `HallCall` struct, if it detects duplicates and keeps the waiting calls and their car. The scenarios give the same results for all of these.
- Not needed: Singleton for `Building`, Factory for cars, Observer (no display board), Visitor, a `Passenger` class.

## Demo scenarios

Every scenario starts on a fresh building: 10 floors (0 to 9), 3 cars with ids 0, 1, 2, all idle at floor 0 with doors closed, nearest-suitable dispatch. A press happens between ticks. "After tick N" means after N calls to `tick()` since the scenario began. State names are IDLE, UP (MOVING_UP), DOWN (MOVING_DOWN) and DOORS (DOORS_OPEN). Do not check a car's enum state before the first tick. Adapt the calls to the candidate's own API. The numbers follow the rules in Hidden facts. If you answered a rule differently in the round, recompute. If the candidate never asked about a rule, state it once at demo time and count it as a missed question, not as a bug.

1. **Ride, with a tie.** Press hall call (5, UP). All three cars are 5 floors away, so car 0 wins. After tick 1: car 0 at floor 1, UP. After tick 4: floor 4, UP. After tick 5: floor 5, DOORS. Now press car call (car 0, floor 8) while the doors are open. After tick 6: floor 5, UP (the doors closed and the car did not move). After tick 7: floor 6. After tick 9: floor 8, DOORS. After tick 10: floor 8, IDLE. Cars 1 and 2 stay at floor 0, IDLE, all the time.
2. **Nearest car wins.** Start floors 0, 4, 9. Press hall call (6, DOWN). Distances are 6, 2, 3, so car 1 wins. After tick 1: car 1 at floor 5, UP. After tick 2: floor 6, DOORS. After tick 3: floor 6, IDLE. Cars 0 and 2 never move.
3. **Wrong direction skips a busy car.** Press hall call (5, UP), then hall call (3, DOWN), before any tick. The first goes to car 0. Car 0 is heading up, so it is not suitable for DOWN. Cars 1 and 2 are free at distance 3, and car 1 wins the tie. After tick 3: car 0 at floor 3, UP (it passes without stopping); car 1 at floor 3, DOORS; car 2 at floor 0, IDLE. After tick 5: car 0 at floor 5, DOORS; car 1 at floor 3, IDLE. This needs the heading-at-press rule. A design that sets the heading only at tick 1 treats car 0 as free for both calls. Car 0 then takes both and car 1 never moves, so state the rule before you judge that result.
4. **Same direction joins a busy car.** Press car call (car 0, floor 8) and run 2 ticks: car 0 is at floor 2, UP. Press hall call (5, UP). Car 0 is suitable at distance 3. Cars 1 and 2 are free at distance 5. Car 0 wins. After tick 5: car 0 at floor 5, DOORS. After tick 6: floor 5, UP. After tick 9: floor 8, DOORS. After tick 10: floor 8, IDLE. Cars 1 and 2 never move.
5. **Sweep order, not press order.** Press car calls for car 0 in the order 7, 3, 5, before any tick. After tick 3: floor 3, DOORS. After tick 6: floor 5, DOORS. After tick 9: floor 7, DOORS. After tick 10: floor 7, IDLE. The doors opened three times, in the order 3, 5, 7.
6. **Turnaround.** Start floors 6, 0, 0. Press car calls for car 0: floor 8, then floor 2. After tick 2: floor 8, DOORS. After tick 3: floor 8, DOWN (it reversed and did not move). After tick 6: floor 5, DOWN. After tick 9: floor 2, DOORS. After tick 10: floor 2, IDLE. Variant on a new building with the same start floors 6, 0, 0: floor 2 first, then floor 8. The first stop sets the heading, so after tick 4 car 0 is at floor 2, DOORS. After tick 11 it is at floor 8, DOORS. After tick 12 it is IDLE.
7. **No suitable car, so the call waits.** A building with 1 car at floor 0. Press car call (car 0, floor 8), then hall call (3, DOWN). The car is heading up, so the call waits. After tick 8: floor 8, DOORS, and the call still waits. After tick 9: floor 8, IDLE, and the call still waits. After tick 10: floor 7, DOWN. The retry ran at the start of the tick, so the car moved in the same tick. After tick 14: floor 3, DOORS. After tick 15: floor 3, IDLE, with no waiting calls.
8. **Invalid input.** Each of these is rejected: hall call (0, DOWN), hall call (9, UP), hall call (10, DOWN), hall call (-1, UP), car call (car 0, floor 10), car call (car 0, floor -1), car call (car 3, floor 4), car call (car -1, floor 4), car call (car 0, floor 0). After 3 ticks every car is at floor 0, IDLE. On a fresh building of 5 floors (0 to 4) and 1 car: hall call (4, UP), hall call (5, DOWN) and car call (car 0, floor 5) are rejected, and hall call (4, DOWN) is accepted. After tick 4: car 0 at floor 4, DOORS.
9. **Duplicate presses.** Press hall call (5, UP) twice, then car call (car 0, floor 5) twice, before any tick. After tick 5: car 0 at floor 5, DOORS. After tick 6: IDLE. After tick 7: IDLE. The doors opened once in total. Cars 1 and 2 never move.
10. **Zero distance.** Start floors 4, 9, 9. Press hall call (4, UP). Car 0 is at distance 0 and wins. After tick 1: car 0 at floor 4, DOORS. After tick 2: floor 4, IDLE. Cars 1 and 2 never move. Variant A, on a fresh building with the same start floors: press hall call (4, UP), then car calls (car 0, floor 2) and (car 0, floor 6), before any tick. A car that has never moved has heading UP, and a first stop at its own floor does not change it. After tick 1: car 0 at floor 4, DOORS. After tick 2: floor 4, UP. After tick 4: floor 6, DOORS. After tick 5: floor 6, DOWN (it reversed and did not move). After tick 9: floor 2, DOORS. After tick 10: floor 2, IDLE. A design that starts with heading DOWN reaches floor 2 first, so state the rule before you judge that result. Variant B, on a fresh building with start floors 4, 0, 0: press hall call (4, UP), then hall call (6, UP), before any tick. Car 0 holds a stop at its own floor, so it is not suitable for the second call. Cars 1 and 2 are free at distance 6, and car 1 wins the tie. After tick 1: car 0 at floor 4, DOORS and car 1 at floor 1, UP. After tick 6: car 1 at floor 6, DOORS.
11. **Three calls at once.** Press hall calls (2, UP), (4, UP), (6, UP) before any tick. Car 0 takes all three. Each time it is suitable and ties with the free cars, so the lowest id wins. The doors open at floor 2 after tick 2, at floor 4 after tick 5, and at floor 6 after tick 8. After tick 9: floor 6, IDLE. Cars 1 and 2 never move. This is the plain rule at work, not a bug. If the candidate asks whether it is fair, the answer is that a distance-only rule does not balance load.
12. **Only if the candidate made it thread-safe.** Four threads each press 500 valid hall calls (random floors 1 to 8, random directions) while a fifth thread calls `tick()` 5,000 times. The tick thread also checks that no car moves more than one floor between ticks. After the threads join, call `tick()` until every car is IDLE and three further ticks change no car's floor or state, at most 2,000 more ticks in all. Stopping at the first moment all cars are idle is wrong: a waiting call is retried only at the start of the next tick. A press counts as accepted when it is valid, even if it is a lit duplicate or has to wait. Expected: no crash, no deadlock, all 2,000 presses accepted, no car out of range, no move of more than one floor, and at the end every car IDLE and still.

## Extensions

Pick one near the end. Start with 1. Use 2 only if time remains. Ask for a restatement before any code changes. For each, scenarios 1 to 11 must give the same results when the new feature is unused. Each check starts on a fresh building with 10 floors and 3 cars at floor 0, unless it names other start floors.

1. **Maintenance mode for one car.** The caller can put a car in maintenance and take it out again. A car in maintenance finishes the stops it already holds, then stays where it is, idle. It takes no new hall calls and no new car calls. What changes? Expect: an in-service flag on the car, read by the suitability check and `carCall`. `step()`, the SCAN rule and the tick order stay untouched. Stretch signal: the candidate sees that a better rule hands the car's hall stops back to the dispatcher, which needs a way to tell a hall stop from a car stop. Check: press hall call (5, UP), which goes to car 0. After tick 2 put car 0 in maintenance. Car call (car 0, floor 7) is rejected. Press hall call (3, UP). Car 0 is nearer, but car 1 gets it. After tick 5: car 0 at floor 5, DOORS (it still serves its stop) and car 1 at floor 3, DOORS. After tick 6: car 0 is IDLE at floor 5 and stays there. Now take car 0 out of maintenance and press hall call (7, UP). Car 0 wins at distance 2. After tick 8: car 0 at floor 7, DOORS.
2. **Express car.** Car 2 serves only floors 0, 5 and 9. What changes? Expect: each car knows which floors it serves, for example a set where empty means all, read by the suitability check and `carCall`. Movement and the SCAN rule stay the same, because the car simply passes floors it has no stop for. Subclassing `Elevator` and copying `step()` is the weaker answer. Check: start floors 0, 0, 5. Press hall call (4, UP). Car 2 is nearer (distance 1) but does not serve floor 4, so car 0 wins. Car call (car 2, floor 3) is rejected. Car call (car 2, floor 9) is accepted. After tick 4: car 2 at floor 9, DOORS (it passed floors 6, 7, 8) and car 0 at floor 4, DOORS.
3. **Weight limit.** A car holds at most 600 kg. `board(carId, kg)` and `alight(carId, kg)` work only while the doors are open. A board that would pass 600 kg is rejected and nothing changes. A car at or above 480 kg (80 percent) gets no new hall calls. What changes? Expect: a load field on the car, a load check in the suitability rule, and two new methods that check the doors state. Movement does not change. Stretch signal: a car at or above 480 kg should skip hall stops it already holds and hand them back, using the same seam as maintenance. Check: hall call (2, UP) goes to car 0. After tick 2 car 0 is at floor 2, DOORS. `board(0, 300)` and `board(0, 250)` are accepted. `board(0, 100)` is rejected and the load stays 550. Press car call (car 0, floor 6). After tick 3: car 0 is at floor 2, UP. Press hall call (4, UP). Car 0 carries 550 kg, over the 480 kg line, so it is not suitable. Car 1 wins the tie with car 2. After tick 7: car 0 at floor 6, DOORS and car 1 at floor 4, DOORS. Car 0 passed floor 4 without stopping.

## Concurrency follow-up

"In a real building, many floors press buttons at once while a timer calls `tick()` once a second. Walk me through what can go wrong in your code."

Expect: the candidate names the shared mutable state: each car's floor, state and `stops`, plus the `calls` list. The key race is check-then-act. The strategy sees a free car, then a `carCall` or a `tick` changes that car before `addStop` runs. The result is a stop in the wrong direction, a lost call or a doubled call. A concurrent `tick` can also erase from a `std::set` that another call is reading, which is undefined behaviour. A good answer uses one `std::mutex` in `Building`, with `std::lock_guard` in `hallCall`, `carCall`, `tick` and every state read. The pick and the `addStop` sit under one lock hold, and `tick` is one critical section, so nobody sees a half-stepped building. One lock beats one lock per car, because dispatch reads every car and per-car locks still leave a gap between pick and assign. A `std::shared_mutex` that takes shared locks for reads is also fine. The strategy stays a pure read inside the lock.

Stretch signal: the candidate says `std::atomic` fields cannot protect an invariant that spans several fields. They also propose an event queue. Buttons push events, and `tick` drains the queue at its start. The lock is then short, events apply in a fixed order, and the cost is a delay of up to one tick, which does not matter because cars only move on ticks.

## Level bar

Hire bar must show:
- Step 1 questions that cover floors and cars, hall calls versus car calls, the dispatch rule, the time model, invalid input and concurrency.
- Real types: a car with a state enum, a `HallCall` value (a struct, or a `(floor, direction)` key that detects duplicates and holds waiting calls), a building that owns them, and a dispatch rule behind a strategy interface or a function object. The four states are one enum, not flags.
- A program that compiles and runs scenarios 1 to 6 and 8 inside the time, with time driven only by `tick()`. Scenario 7 is required when the candidate asked what happens if no car is suitable. If they did not ask, it is a missed question, not a failed run.
- The dispatch rule behind a Strategy interface or a function object, so the first extension lands in one or two places.
- A sweep order that is not first-in-first-out.
- Correct locking when asked.

Stretch signal:
- Asks whether time is simulated before any code.
- Asks what happens when no car is suitable, and what a second press of a lit button does, before any code.
- Finds a sorted stop structure plus a heading (or two sorted stop lists) fast, and states the invariant that a moving car always has a stop ahead.
- Skeleton compiling by minute 30. The first `main()` prints floors and states each tick and proves the movement before the dispatcher gets clever.
- Handles the extension with a small local change and says which existing behaviour stays the same.
- Names the weakness of the distance-only rule (scenario 11) and offers alternatives with their costs.

## Traps

- Moving cars with `sleep`, a timer thread or `std::chrono`. A thread per car feels like how real elevators work, but the demo can no longer show exact positions. Time must come from `tick()`.
- Serving stops in press order with a `queue` or `vector`: calls 7, 3, 5 make the car zigzag. A sorted set and a heading fix it.
- Dropping the hall call's direction from the suitability check, so a car heading up takes a call for DOWN (scenario 3). The direction is used for dispatch only: serving a hall call does not set the car's next heading, because passengers are not modelled.
- One loose `bool isMoving` and `bool doorsOpen` instead of one state enum. It allows a car that moves with its doors open.
- Putting the dispatch `if/else` inside `Building`, or a strategy that changes the cars. The rule must be replaceable and read-only.
- No duplicate check, so a waiting call is added twice and two cars drive to the same floor.
- Copying a car (`auto car = *cars[i]`) and changing the copy, so the real car never moves.
- `std::map::operator[]` on an unknown car id, which silently adds an entry.
- Accepting a hall call UP on the top floor or a car call for the car's own floor, because nothing validated it.
- Spending 40 minutes on an optimal dispatcher (estimated arrival time, destination dispatch) before one car moves.
- Many patterns before the first run: Singleton building, car factory, Observer, Command and a `Passenger` class.
