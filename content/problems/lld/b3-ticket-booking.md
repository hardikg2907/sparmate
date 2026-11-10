---
id: b3-ticket-booking
track: lld
title: Movie Ticket Booking System
difficulty: hard
tags: [show-seat, hold-expiry, state-machine, strategy, concurrency]
tracker:
  section: "### B3. Applied Practice — Classic LLD Problems"
  bullet: "Hotel/Movie Ticket Booking System"
notesFile: notes/b3-ticket-booking.md
lldFolder: ticket-booking
---

## Opening prompt

Design a movie ticket booking system. Build it as a running, in-memory C++ program, with a `main()` that shows it working.

## Hidden facts

Reveal a fact only when the candidate asks about it. Never volunteer the list.

- **What happens:** a user browses shows of a movie in a city, sees which seats are free, picks seats, and holds them while they pay. Payment success confirms the booking. Payment failure or a timeout gives the seats back. A confirmed booking can be cancelled.
- **Catalogue:** cities have theatres, theatres have screens, screens run shows, a show is one movie on one screen at one start time. All of it is given at setup and never changes while running. Movies have a title and a duration in minutes. No rule uses the duration.
- **Seat layout:** every screen in the demo has rows A, B and C with 5 seats each, labelled A1 to C5. Row A is REGULAR, row B is PREMIUM, row C is RECLINER. Real screens differ in size, so the layout is data given at setup.
- **Price:** set per show and per category, in whole rupees. Demo shows use 200 REGULAR, 300 PREMIUM, 500 RECLINER, except show 2, which uses 150, 250 and 400. Every show prices every category. Prices never change after setup.
- **Who picks seats:** the user names the exact seats. The system does not assign them.
- **Seat state:** a seat is free, held or booked **for one show**. Seat A1 in the 6 pm show and in the 9 pm show are two separate things.
- **Hold:** 1 to 6 seats of one show, all or nothing. If any seat is not free, the whole request is rejected and nothing changes. Duplicate seats in one request and seats that are not on the screen are invalid. A held seat is not free for anyone, including the user who holds it. One user may have many holds and bookings at once, on the same show too. A hold cannot be extended or renewed. After it ends, the user makes a new hold.
- **Hold time:** 5 minutes, configurable. A hold made at minute 10 is valid at minutes 10 to 14 and is over at minute 15. The caller passes `now` on every call.
- **Expiry:** no timer thread. A seat counts as free the moment `now` reaches its expiry, even if nothing cleaned it up. An explicit `releaseExpired(now)` is allowed as an extra, never as the only mechanism.
- **Payment:** outside the system. The caller reports the result. Success calls confirm with the hold id. Failure calls release with the hold id. The hold id is the booking id that `hold` returns. Confirm and release have no user check, because they are payment callbacks.
- **Amount:** the sum of the seat prices for that show, fixed when the hold is made. Hold returns it with the hold id. Confirm returns the same number.
- **Confirm:** works only on a hold that is still held and not expired. It is rejected for an unknown id, an expired hold, a released hold or an already confirmed one.
- **Cancel:** only the owner, only a confirmed booking, only while `now` is before the show start. The seats become free at once. The refund is the full amount paid. Money movement is out of scope. A hold that is not confirmed is ended by release or expiry, not by cancel.
- **Browse:** shows of a movie in a city, ordered by start time (show id breaks ties). A show with `start <= now` is not listed, the same rule as hold. Browse also has to give the free seats of one show at time `now`, in layout order (A1 to C5). Free seats of a started show are still readable. Browse takes only a movie and a city: no filter by date, language, genre or theatre. An unknown show, movie or city gives an empty list.
- **Booking closes at show start:** a hold at `now >= start` is rejected. A hold made before the start may still be confirmed inside its 5 minutes.
- **Threads:** yes. Many users tap seats at the same moment, up to about 16 request threads in one process. `main()` may stay single-threaded.
- **Time:** whole minutes from a fixed origin, passed in by the caller. Never the system clock.
- **Rejections:** any style works (optional, bool, error code or exception). The reasons need not be told apart. A rejected call must change nothing.
- **Scale:** the demo has 5 shows. Real bounds are about 300 seats per screen and a few thousand shows, all in memory. A scan over shows is fine for browse.
- **Out of scope:** user accounts, real payments, coupons, food, notifications, overlapping-show checks, editing or deleting shows, partial cancel, waitlists, extending a hold, listing a user's bookings (a booking is found by its id).

For the interviewer: on the hold time, if the candidate wants the caller to pass the expiry as well as `now`, that is fine: `expiresAt = now + 5`.

For the interviewer: on booking closing at show start, do not test that a hold made before the start can still be confirmed inside its 5 minutes.

For the interviewer: on the rejections, the candidate picks the style.

For the interviewer: on scale, an index by movie and city is a fine extra.

## Expected requirements

Core:
1. Set up cities, theatres, screens with seat layouts, movies and shows with prices per category. *Ask: What must be set up before anyone can book?*
2. Hold 1 to 6 seats of one show for 5 minutes, all or nothing; return the hold id and total. *Ask: Who picks the seats, and what happens while a customer pays?*
3. Confirm after payment success. Reject unknown, expired, released and already confirmed holds. *Ask: What does payment tell the system, and what if the hold is too old?*
4. Release on payment failure. An expired hold frees its seats without any cleanup call. *Ask: What happens to the seats if payment fails or time runs out?*
5. Cancel a confirmed booking before the show starts, as its owner. Seats become free. *Ask: Can a booking be cancelled, and by whom?*
6. Safe under concurrent calls. *Ask: Can several threads use it at once?*

Extras (credit when they name one, never a gap):
- Browse: shows of a movie in a city, in start order, started shows hidden. Free seats of a show at `now`.
- Seat state is per show.
- Every invalid call is rejected with no state change.

## Entities and relationships

- `SeatCategory` (enum class): REGULAR, PREMIUM, RECLINER. Category is data. Subclasses per category are a trap.
- `City`, `Theatre`, `Screen`, `Movie`: plain data linked by ids. Nested objects or flat id maps both work. A `Screen` owns its list of physical `Seat` records (id, row, number, category).
- `Show`: movie id, screen id, start minute, price per category, and its list of `ShowSeat` records.
- `ShowSeat` (the hidden noun): the state of one seat in one show. State (free, held, booked), the booking that owns it, and the minute the hold ends. **Most candidates put a booked flag on the physical `Seat`.** Then booking the 6 pm show blocks the 9 pm show.
- `Booking`: id, user, show, seat ids, amount, hold expiry, status. One record covers the hold and the booking. Two records (`Hold` and `Booking`) are fine too.
- `PricingStrategy` (interface): maps a seat in a show to a price. The first version is a lookup by category. The pricing extension needs the seam.
- `BookingSystem`: owns the catalogue, the shows, the bookings and the lock.
- Not stored: free-seat lists (derived from `ShowSeat`), the user (an `int` id), the payment.

## Behaviour and states

- `hold(user, show, seats, now)`: lock. Validate show, `now < start`, 1 to 6 seats, no duplicates, every seat on the screen. Check every seat is free at `now`. If any is not, reject and write nothing. Then mark all seats held with `heldUntil = now + 5`, add the booking, return it (id and amount).
- `confirm(booking, now)`: the booking must be held. If `now >= expiresAt`, mark it expired, free only the seats it still owns, and reject. Otherwise mark the seats booked and the booking confirmed. Return the amount.
- `release(booking, now)`: only a held booking. Free only the seats this booking still owns. A late release must never free seats now held by someone else. A release of a confirmed booking is rejected.
- `cancel(booking, user, now)`: confirmed, owner, `now < start`. Free the seats, mark cancelled, return the amount.
- A seat is free when its state is free, or held with `now >= heldUntil`.
- Every method that reads or writes seats or bookings takes the same lock, reads included.

```
 ShowSeat:  FREE --hold--> HELD --confirm--> BOOKED --cancel--> FREE
                             |
                             +-- release, or now >= heldUntil --> FREE   (a new hold can take it at that moment)

 Booking:   HELD --confirm--> CONFIRMED --cancel--> CANCELLED
              |
              +-- release ----> RELEASED
              +-- expiry -----> EXPIRED
```

Invariant to listen for: a seat has at most one owner at a time, and only its owner can change it.

## Reference design

```
 enum class SeatCategory { REGULAR, PREMIUM, RECLINER };
 enum class SeatState    { FREE, HELD, BOOKED };
 enum class BookingState { HELD, CONFIRMED, RELEASED, EXPIRED, CANCELLED };

 struct Seat     { int id; char row; int number; SeatCategory category; };   // physical, belongs to a screen
 struct ShowSeat { SeatState state = SeatState::FREE; int bookingId = 0; int heldUntil = 0; };   // one seat in ONE show
 struct Show     { int id; int movieId; int screenId; int startMinute;
                   std::map<SeatCategory, int> price;
                   std::vector<ShowSeat> seats; };                          // seats[i] pairs with the screen's seat i
 struct Booking  { int id; int userId; int showId; std::vector<int> seatIds;
                   int amount; int expiresAt; BookingState state; };

 class PricingStrategy {                                                    // interface
  public:
   virtual ~PricingStrategy() = default;
   virtual int price(const Show& show, const Seat& seat, int occupiedSeats) const = 0;
 };
 class CategoryPricing : public PricingStrategy { ... return show.price.at(seat.category); ... };

 class BookingSystem {
   std::map<int, std::shared_ptr<Show>> shows;      // plus maps for cities, theatres, screens, movies
   std::map<int, Booking> bookings;
   std::shared_ptr<PricingStrategy> pricing;
   int holdMinutes = 5;
   std::mutex mtx;
   int nextBookingId = 1;
  public:
   std::optional<Booking> hold(int userId, int showId, const std::vector<int>& seatIds, int now);   // id and amount
   std::optional<int> confirm(int bookingId, int now);                       // amount
   bool release(int bookingId, int now);
   std::optional<int> cancel(int bookingId, int userId, int now);            // refund amount
   std::vector<int> freeSeats(int showId, int now);
   std::vector<int> showsFor(int movieId, int cityId, int now);
 };
```

`Show` owns a `vector<ShowSeat>` indexed like the screen's seats. That makes "state per show" one array lookup, and a hold is one loop to check and one loop to write. `ShowSeat` stores `heldUntil`, so the free check needs no booking lookup. Expiry is lazy: every check compares `now` with `heldUntil`.

Accepted alternatives: separate `Hold` and `Booking` records. A `ShowSeat` that stores only the booking id, with expiry read from the booking. A per-show set of unavailable seats, if it keeps the owner and the expiry. The caller passing `expiresAt` as well as `now`. A `hold` that returns only the id, with the amount read from the booking. A global mutex or a mutex per show. Nested city-theatre-screen objects or flat id maps. A seat label such as "A1" instead of an int id.

## Patterns that fit

- **Strategy** for pricing: the first version is a category lookup, and dynamic pricing becomes a new class, not an edit to `hold`. Seat selection for group bookings can be a Strategy too, but a plain function is enough.
- Not needed: Singleton, Factory, Observer (no notifications), the State pattern. A `BookingState` enum with guard checks is enough for five states. One class per state is over-engineering.

## Demo scenarios

Every scenario starts from a fresh system built from this setup. Steps inside a scenario run in order. Adapt the calls to the candidate's own API; the expected behaviour is what matters. A seat label is a row letter and a number. Time is in minutes. Hold time is 5.

Setup: cities 1 Pune and 2 Delhi. Theatres: 1 Central and 2 Riverside in Pune, 3 Plaza in Delhi. Screens: 1 in Central, 2 in Riverside, 3 in Plaza. Every screen has rows A, B and C of 5 seats (15 seats). Movies: 1 "Orbit" (120 minutes), 2 "Harbor" (150 minutes). Shows (prices REGULAR, PREMIUM, RECLINER):

| Show | Movie | Screen | Start | Prices |
|---|---|---|---|---|
| 1 | 1 | 1 | 1000 | 200, 300, 500 |
| 2 | 1 | 1 | 1300 | 150, 250, 400 |
| 3 | 2 | 2 | 1000 | 200, 300, 500 |
| 4 | 1 | 2 | 1200 | 200, 300, 500 |
| 5 | 1 | 3 | 1000 | 200, 300, 500 |

1. **Browse.** Movie 1 in Pune at minute 0: shows 1, 4, 2 in that order. Movie 1 in Delhi: show 5. Movie 2 in Pune: show 3. Movie 2 in Delhi: none. Movie 1 in Pune at minute 1000: shows 4 and 2 (show 1 has started).
2. **Hold and price.** User 1 holds A1, B1, C1 on show 1 at minute 10: accepted, total 1,000 (200 + 300 + 500), 12 free seats on show 1. User 2 holds A1, B1, C1 on show 2 at minute 10: accepted, total 800 (150 + 250 + 400), 12 free seats on show 2. Show 1 still has 12 free seats.
3. **State is per show.** User 1 holds A1 on show 1 at minute 10 and confirms at minute 12. User 2 holds A1 on show 2 at minute 20: accepted, total 150. User 2 holds A1 on show 1 at minute 21: rejected. At minute 21, show 1 has 14 free seats and show 2 has 14.
4. **Conflict, all or nothing.** User 1 holds A1, A2 on show 1 at minute 10. User 1 holds A1 again at minute 11: rejected (even the owner). User 2 holds A2, A3 at minute 11: rejected as a whole. A3 is still free and 13 seats are free. User 2 holds A3, A4 at minute 11: accepted, total 400, 11 free seats.
5. **Confirm.** User 1 holds A1, A2 on show 1 at minute 10. Confirm at minute 12: accepted, amount 400, A1 and A2 booked, 13 free seats. Confirm the same hold again at minute 13: rejected, still one booking. User 2 holds A1 at minute 100: rejected (booked seats never expire), 13 free seats.
6. **Payment failure and bad transitions.** User 2 holds B1, B2 on show 1 at minute 20. Release at minute 21: both seats free, 15 free seats. User 3 holds B1 at minute 21: accepted. Confirm the released hold at minute 22: rejected, and B1 stays held by user 3. User 1 holds A1 at minute 30 and confirms at minute 31. Release that hold at minute 32: rejected, A1 stays booked. At minute 32, 14 seats are free.
7. **Expiry at the boundary.** User 3 holds B1 on show 1 at minute 21 (over at 26) and holds C1 at minute 21 as a second hold. User 2 holds B1 at minute 25: rejected. User 3 confirms the C1 hold at minute 25: accepted (last valid minute), amount 500. User 2 holds B1 at minute 26: accepted, with no cleanup call made. User 3 confirms the old B1 hold at minute 26: rejected, and B1 stays held by user 2. User 3 reports a payment failure for the old B1 hold at minute 27: rejected or harmless, and B1 stays held by user 2. At minute 27, 13 seats are free. At minute 31, user 2's hold is over and 14 seats are free.
8. **Invalid input and limits.** At minute 10, each of these is rejected and changes nothing: a hold of 0 seats; a hold of 7 seats (A1 to A5, B1, B2); a hold of A1 and Z9 (A1 stays free); A1 twice in one request; show 99; confirm, release and cancel with id 999. Show 1 still has 15 free seats. A hold of exactly 6 seats (A1 to A5, B1) is accepted: total 1,300 (5 x 200 + 300), 9 free seats. At minute 999, user 2 holds C5: accepted, total 500. At minute 1000, user 2 holds C4: rejected (show started).
9. **Cancel and resale.** User 1 holds A1, A2 on show 1 at minute 10, confirms at minute 12. User 1 cancels at minute 800: refund 400, 15 free seats. User 2 holds A1 at minute 801: accepted.
10. **Cancel rules.** At minute 10, user 1 holds and confirms (at minute 12) A1 and A2 (booking P, 400), then C1 (booking R, 500). User 2 does the same for C2 (booking S, 500). Then in order: user 3 cancels S at minute 100: rejected, C2 still booked. User 2 cancels S at minute 100: refund 500, C2 free. User 2 cancels S at minute 101: rejected, no second refund. User 3 holds C3 at minute 102, then cancels that unconfirmed hold at minute 103: rejected, C3 stays held at minutes 102 to 106 and is free at 107 (skip this step if the candidate's API merges cancel and release). User 1 cancels P at minute 999: refund 400, and 14 seats are free at minute 999 (only C1 is booked; A1, A2, C2 and C3 are free). User 1 cancels R at minute 1000: rejected, C1 stays booked.
11. **Mixed lifecycle.** User 1 holds A1, A2 at minute 10. User 2 holds B1 at minute 11. User 3 holds C1 at minute 12. Confirm the first hold at minute 13. Release the second at minute 14. At minute 16, 12 seats are free (C1 still held until 17). At minute 17, 13 seats are free, and the confirm of the third hold at minute 17 is rejected. The final seat map: A1 and A2 booked, everything else free.
12. **Only if the candidate made it thread-safe:** 8 threads each loop over the 15 seats of show 1 and try to hold one seat per call, at minute 10, thread number as user id. In total exactly 15 holds succeed, no seat is held twice, and show 1 has 0 free seats at minute 10. At minute 15 (nobody confirmed) all 15 seats are free again. The count per thread is not fixed.

## Extensions

Pick one for the last 15 minutes. Prefer 1 or 2. Use 3 as a design talk if little time is left.

1. **Group booking with adjacent seats.** "Hold N seats together": the system picks N consecutive seat numbers in one row, all free at `now`. Rule: scan rows A, B, C in order, take the lowest starting number in the first row that has a run. Adjacency never wraps to the next row. Example on a fresh show 1 at minute 10: 4 together gives A1 to A4 (800). 3 together gives B1 to B3 (900), because row A has only A5 left. 2 together gives B4 and B5 (600). 6 together is rejected: no row has 6 seats. 7 together is rejected by the 6-seat limit. After the first hold is released, 5 together gives A1 to A5 (1,000). What changes? Expect: one new function that picks seat ids from the show's seat list, then calls the existing hold path. **What stays the same:** explicit-seat `hold`, the limit of 6, all or nothing, confirm, release, expiry, cancel.
2. **Dynamic pricing by occupancy.** The price is the category price times a multiplier. Occupied means booked, or held and not expired at `now`, counted before the new hold. Under 50% occupied (0 to 7 of 15) is 1.0x. From 50% to under 80% (8 to 11 of 15) is 1.2x. 80% or more (12 to 15) is 1.5x. All seats in one hold use one multiplier. No rounding rule is needed. Example on a fresh show 1 at minute 10: user 1 holds A1 to A5: 1,000 at 1.0x (0 occupied). User 1 holds B1 to B3: 900 at 1.0x (5 occupied). User 2 holds B4, B5: 720 (2 x 360, 8 occupied). User 3 holds C1, C2: 1,200 (2 x 600, 10 occupied). User 4 holds C3: 750 (1.5x, 12 occupied). At minute 15 everything has expired, and user 5 holds A1: 200. What changes? Expect: a new `PricingStrategy` that reads occupancy, injected into `BookingSystem`. The first-version interface may need the occupied count added, which is a fair, small change. Every demo price is a multiple of 50, so both multipliers give whole rupees and no rounding rule is needed. **What stays the same:** every earlier scenario that asserts a total has fewer than 8 seats occupied before each hold, so its totals do not change; the amount is fixed at hold and confirm returns that same amount, the cancel refund is the amount paid, and states and expiry do not change.
3. **Hotel rooms over date ranges.** The same engine sells rooms by night. A room is booked for check-in day to check-out day, and the nights are check-in up to but not including check-out. Room 101 costs 3,000 a night. User 1 holds days 10 to 13 (nights 10, 11, 12): 9,000. User 2 holds days 12 to 14: rejected (night 12 taken). User 2 holds days 13 to 15: accepted, 6,000. User 3 holds days 9 to 10: accepted, 3,000. Check-in equal to check-out is rejected. A hold covers 1 to 6 nights. Cancel works while `now` is before the start of the check-in day (day x 1,440 minutes). What changes? Expect: the unit of state moves from (show, seat) to (room, night). A good design lets `Booking` carry a list of slot keys, and the hold, confirm, release and cancel code never learns whether the keys are seats or nights. **What stays the same:** all or nothing, the 5-minute hold, lazy expiry, the booking states, and the movie scenarios.

## Concurrency follow-up

"Two users hold the same seat of the same show at the same moment. Walk me through what happens in your code." Expect: names the check-then-act race, where both read free and both write held. One `std::mutex` with `std::lock_guard` covers the check of every seat and the marking of every seat, so a multi-seat hold is atomic. `confirm`, `release`, `cancel` and the free-seat query take the same lock. Confirm checks expiry and flips to booked under that lock, so a confirm and a new hold after expiry cannot interleave. The payment itself never runs under the lock: that is why holds exist. Stretch signal: a mutex per show, with the reason (a hold touches one show, so there is no lock-ordering problem and unrelated shows do not wait). A per-show mutex alone is not enough, because the shared `bookings` map and the booking id counter are touched by every show. They need a small second lock (or an atomic counter), held only for the lookup or insert and never while waiting for a show lock. If they lock per seat, they must lock in ascending seat id, or two holds of A1,A2 and A2,A1 deadlock. They state the cost of one global mutex and why it is fine at 16 threads. In a real deployment, the same rule is one conditional `UPDATE` in Postgres that sets a seat held only if it is free or expired, in one transaction for all seats. A Redis `SET NX` with a TTL per seat also works, with a rollback when part of the group fails.

## Level bar

Hire bar must show:
- Step 1 questions that cover who picks seats, hold time and expiry, what payment tells the system, the cancel rule, seats per hold, and concurrency.
- `ShowSeat` (state per show) as a real type, found within about 20 minutes and with at most one hint. A flat per-show seat array that makes hold a check loop plus a write loop.
- A program that compiles and runs scenarios 1 to 10 inside the time.
- All-or-nothing hold. Confirm that re-checks expiry. Release and expiry that free only the seats the booking still owns.
- Time passed in on every call, never the clock.
- Correct locking when asked.

Stretch signal:
- Names the per-show seat state in the first 10 to 15 minutes, before any hint, and says why a flag on `Seat` fails.
- Chooses lazy expiry unprompted and says why: no timer thread, testable, one writer.
- States the invariant "one owner per seat" and uses it in the late confirm and late release cases.
- Keeps the amount fixed at hold time and says why.
- Lands the extension in one new function or one new class, and says which behaviour stays the same.
- Explains lock scope, the per-show lock and the deadlock rule.
- Skips needless pieces: no payment gateway mock, no State classes.

## Traps

- A booked flag on the physical `Seat`: one show's booking blocks every other show on that screen.
- Holding seats one at a time and returning at the first failure without undoing: a failed request leaves partial holds behind. Check all, then write all.
- Expiry by a timer thread, `sleep` or the system clock: untestable, and it adds a second writer.
- Confirm that skips the expiry check, or a release that frees by seat id instead of "seats this booking still owns": it frees another user's hold.
- Price read again at confirm or at cancel instead of the amount fixed at hold time.
- `price[category]` through `operator[]` inserts 0 for a missing key, so a missing price sells free seats. Same for `shows[id]`. Use `find` or `at`.
- `auto show = shows[id];` or `auto b = bookings[id];` on a map of values copies the record, so changes to `ShowSeat` or to the booking state are lost.
- A subclass per seat category. Category is data.
- Locking only `hold`, or holding the lock while "payment runs".
- Smart-sounding answers: "an `std::atomic<int>` per seat" (fails for multi-seat all-or-nothing). "A global lock, done" (correct, but they must say what it costs). "A background thread is more realistic". "A distributed lock" for an in-memory single-process program.
- Over-modelling: State classes, User and Payment classes, a Singleton, more than 25 minutes on cities, theatres and screens before anything runs.
