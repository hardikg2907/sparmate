---
id: b3-library-management
track: lld
title: Library Management System
difficulty: medium
tags: [data-shape, reservations, observer, strategy, time-as-input]
tracker:
  section: "### B3. Applied Practice — Classic LLD Problems"
  bullet: "Library Management System"
notesFile: notes/b3-library-management.md
lldFolder: library-management
---

## Opening prompt

Design a library management system. Build it as a running, in-memory C++ program, with a `main()` that shows it working.

## Hidden facts

Reveal a fact only when the candidate asks about it. Never volunteer the list.

- **What happens:** a library lends books to registered members. A member borrows a book, keeps it for a while, and brings it back. The system picks the physical copy; the member does not choose.
- **Books and copies:** a book is a title by an author. The library owns 1 or more physical copies of each book. Two editions of a title are two books. Copies are added after the book exists. Nothing is ever removed in the first version.
- **Who calls:** a librarian desk calls the system. No logins, no roles, no UI.
- **Size:** up to about 10,000 books and 50,000 copies in memory. The demo has 4 books. A linear scan for search is fine.
- **Ids:** the system hands out ints, in the order things are added. Books, copies, members, loans and reservations each count from 1 on their own. Copy ids run across the whole library, not per book.
- **Time:** whole days as an `int`. Day 0 is the first day of the demo. Every call that can see or change availability takes the day: borrow, return, renew, reserve, cancel, add copy and search. Calls never go back in time. Never read the system clock.
- **Loan period:** 14 days. Due day = borrow day + 14. A copy returned on its due day is on time. It is late from the day after.
- **Fine:** 2 per whole day after the due day. Due day 14: returned on day 14 costs 0, on day 15 costs 2, on day 20 costs 12. No cap. The return call reports the fine. Paying fines and keeping a debt balance are out of scope. The rate must be configurable.
- **Borrow limit:** 3 open loans per member at once. Configurable.
- **Config:** the limit, loan days, fine rate, renewal count and hold days must all live in one place, not as literals in the code. The demo uses 3, 14, 2, 2 and 3.
- **Borrow rules:** the member and the book must exist. The member must have no overdue open loan (an open loan is overdue when today is after its due day). The member must have fewer than 3 open loans. The member must not already hold a copy of the same book. A copy must be free for this member. A rejected call changes nothing. Any error style works, but use one style for every rejected call.
- **Which copy:** the lowest copy id among the book's copies that sit on the shelf. A member with a ready hold on the book gets the held copy instead.
- **Return:** by copy id, because the copy is the thing in the hand. An unknown copy, or a copy that is not on loan, is rejected.
- **Renew:** at most 2 renewals per loan. Allowed only on or before the due day. Rejected while any member is waiting in the book's queue. New due day = renewal day + 14, not old due day + 14. Other loans of the member do not matter. A member whose hold is ready is not waiting, so a held copy does not block renewals.
- **Search:** case-insensitive substring match on title or author, as one call or two. It returns books, not copies. Each hit shows how many copies sit on the shelf. Hits come in book-id order. An empty query returns nothing. A copy on loan or on hold is not on the shelf.
- **Reservations:** per book, first in first out in the order of the calls, not the day value. A member may reserve only when no copy of that book is on the shelf. A member may not reserve a book they hold, and may not have 2 active reservations for the same book. "Active" means waiting or ready. Reserving has no overdue check and no limit check, and there is no cap on reservations per member. A book with no copies yet cannot be borrowed, and a member may reserve it. Cancelling an active reservation is allowed, whether waiting or ready. Cancelling an unknown or finished one is rejected.
- **Hold:** when a copy comes free (a return, a cancelled hold, a lapsed hold, a new copy) and a member is waiting, the copy is held for the first waiting member. They may borrow it up to and including `day + 3`. Nobody else may take it. Borrowing it ends their reservation. A held copy is not on the shelf. A member at the borrow limit still gets the hold and loses it at the lapse.
- **Lapse:** no timer runs. A call that touches a book checks that book's holds first. A hold lapses when the day is after its last day. The member leaves the queue. The copy then goes to the next waiting member with a fresh 3 days counted from the day of the call that noticed it. With nobody waiting, it goes back to the shelf.
- **Threads:** several desks may call at once. `main()` may stay single-threaded.
- **Out of scope:** fine payment, deleting books, copies or members, branches, e-books, barcodes, reserving a specific copy, persistence.

For the interviewer: on the time, do not spend time defending against calls that go back in time.

For the interviewer: on the borrow rules, the rejection reason is not graded.

For the interviewer: on returns, return by loan id is equally fine.

For the interviewer: on the lapse, scenarios 1 to 11 only check that the next member can borrow on the day of the lapse, which holds under either rule. Accept a next hold counted from the old hold's last day if the candidate states it.

For the interviewer: on what is out of scope, if asked about lost books, member types or notifications, say "not in the first version" and add nothing.

## Expected requirements

Core:
1. Add books, add copies of a book, and register members. *Ask: What is lent: a book or a copy, and who can borrow?*
2. Borrow: apply the borrow rules, pick the lowest free copy, create a loan with a due day. *Ask: What stops a member from borrowing, and how long is a loan?*
3. Return: close the loan, report the fine, free the copy. *Ask: What happens when a book comes back late?*
4. Renew: extend the due day under the renew rules. *Ask: Can a loan be extended, and how often?*
5. Reserve and cancel, first-in-first-out per book; a freed copy is held for the queue head. *Ask: What happens when a member wants a book that is out?*
6. Time is a parameter on every call; limits, loan days and fine rate are configurable. *Ask: Where does the current time come from, and what may change?*
7. Safe under concurrent calls. *Ask: Can several threads use it at once?*

Extras (credit when they name one, never a gap):
- Search by title or author, with the shelf count per book.
- Rejected calls change nothing. Unknown ids never create phantom entries.
- A hold lapses after 3 days. Renewal limits and hold days are configurable too.

## Entities and relationships

- `Book` (struct): id, title, author, and the ids of its copies. A title, not a thing you can hold.
- `BookCopy` (the first hidden noun): id, book id, status. **Most candidates hide it inside an `int copies` counter on `Book`.**
- `Loan` (the second hidden noun): id, member id, copy id, borrow day, due day, renewals, open. The due day lives here, not on the member or the copy.
- `Member`: id, name. Open loans are found through `Loan`, so there is one source of truth.
- `Reservation`: id, member id, book id, state, held copy id, last hold day. Created by `reserve`.
- `Library`: owns all of the above, the per-book waiting queues, the rules and the lock.
- `Rules` (struct) holds limit, loan days, fine rate, renewals and hold days. It becomes a strategy interface when member types arrive.
- Not stored: the fine (computed at return), the shelf count (derived), "is overdue" (derived from the due day and today).
- Accepted alternative: a `deque<int>` of member ids per book plus `heldFor` and `holdUntilDay` fields on the copy, with no `Reservation` struct. A map from copy id to its one open loan is also fine.
- Accepted alternative for time: the reference passes the day on each call. An injected clock that the demo advances, or an `advanceTo(day)` call that lapses holds eagerly, is also fine if the system clock is never read and the results stay the same.

## Behaviour and states

```
 BookCopy:   AVAILABLE --borrow--> ON_LOAN --return--> release() --> AVAILABLE   (nobody waiting)
                                                               \--> ON_HOLD      (a member waits)
             ON_HOLD --holder borrows--> ON_LOAN
             ON_HOLD --lapse or cancel--> release() --> ON_HOLD (next waiter) or AVAILABLE

 Reservation: WAITING --copy freed--> READY --holder borrows--> FULFILLED
              WAITING --cancel--> CANCELLED       READY --cancel--> CANCELLED       READY --lapse--> EXPIRED
```

- Every public method that touches a book first calls `settle(book, day)`. It lapses any hold whose last day has passed. This is the only place time moves a hold.
- `release(copy, day)` is the only place that decides "hold for the head of the queue, or back on the shelf". Return, cancel, lapse and add-copy all call it.
- Invariant: a book never has a waiting member and a shelf copy at the same time. `release` keeps it true.
- `borrow(member, book, day)`: settle, check the borrow rules, take the holder's copy or the lowest shelf copy, mark it on loan, create the loan.
- `giveBack(copy, day)`: find the open loan, settle its book, fine = `max(0, day - dueDay) * rate`, close the loan, `release`.
- `renew(copy, day)`: find the open loan, settle its book, check count, day and queue, set the new due day.
- `reserve(member, book, day)`: settle, refuse if a copy is on the shelf, refuse duplicates, append to the queue.
- A loan is open or closed. Every method that reads or writes any of these maps takes the same lock, reads included.

## Reference design

```
 enum class CopyStatus { AVAILABLE, ON_LOAN, ON_HOLD };          // LOST joins with the lost-book extension
 enum class ReservationState { WAITING, READY, FULFILLED, CANCELLED, EXPIRED };

 struct Book        { int id; std::string title; std::string author; std::vector<int> copyIds; };
 struct BookCopy    { int id; int bookId; CopyStatus status; };
 struct Member      { int id; std::string name; };
 struct Loan        { int id; int memberId; int copyId; int borrowDay; int dueDay; int renewals; bool open; };
 struct Reservation { int id; int memberId; int bookId; ReservationState state; int copyId; int holdUntilDay; };
 struct SearchHit   { int bookId; std::string title; int onShelf; };
 struct Rules       { int maxLoans = 3; int loanDays = 14; int finePerDay = 2; int maxRenewals = 2; int holdDays = 3; };

 class Library {
   std::map<int, Book> books;  std::map<int, BookCopy> copies;  std::map<int, Member> members;
   std::map<int, Loan> loans;  std::map<int, Reservation> reservations;
   std::map<int, std::deque<int>> waiting;        // book id -> WAITING reservation ids, in call order
   Rules rules;  std::mutex mtx;
   int nextBookId = 1, nextCopyId = 1, nextMemberId = 1, nextLoanId = 1, nextReservationId = 1;   // one counter per kind
  public:
   int addBook(const std::string& title, const std::string& author);       // book id
   std::optional<int> addCopy(int bookId, int day);                       // copy id; calls release
   int addMember(const std::string& name);                                // member id
   std::optional<int> borrow(int memberId, int bookId, int day);          // loan id
   std::optional<int> giveBack(int copyId, int day);                      // the fine
   std::optional<int> renew(int copyId, int day);                         // the new due day
   std::optional<int> reserve(int memberId, int bookId, int day);         // reservation id
   bool cancelReservation(int reservationId, int day);
   std::vector<SearchHit> search(const std::string& text, int day);       // book id, title, shelf count
  private:
   void settle(int bookId, int day);     // lapse holds whose last day is before `day`
   void release(int copyId, int day);    // hold for the head of the queue, or back on the shelf
 };
```

Every record links to the others by id, so each lookup is one `find` and nothing holds a pointer that can dangle. One private `release` is the only door a freed copy walks through.

## Patterns that fit

- **Strategy** for the rules: a `Rules` struct is enough at first. When member types arrive, it becomes a `MembershipPolicy` interface with one class per type, and `Library` asks the member's policy instead of reading fixed numbers.
- **Observer** only when the notification extension comes up: a listener interface that `release` and `settle` call.
- Not needed: Singleton, Factory, State pattern (3 copy states and one transition function do not justify it), Decorator, an inheritance tree of item types, a search index.

## Demo scenarios

Rules in force: loan 14 days, limit 3, fine 2 per day, 2 renewals, hold 3 days. Run scenarios 1 to 10 in order on one library. Scenarios 11 and 12 use fresh libraries. Adapt the calls to the candidate's own API; the expected behaviour is what matters.

Setup for 1 to 10: books added in this order: Dune by Frank Herbert (copies 1 and 2), The Pragmatic Programmer by Andrew Hunt (copy 3), Clean Code by Robert Martin (copy 4), Clean Architecture by Robert Martin (copy 5). Members: Alice, Bob, Carol, Dan.

1. Day 0: Alice borrows Dune. She gets copy 1, due day 14. Alice borrows Dune again: rejected, she already holds a copy, and copy 2 stays on the shelf. A borrow with an unknown member id, and one with an unknown book id: both rejected, nothing changes.
2. Day 0, search: "dune" gives Dune with 1 on the shelf. "CLEAN" gives Clean Code, then Clean Architecture, 1 each. Author "martin" gives the same two. "pragmatic prog" gives 1 hit. "zzz" and "" give nothing.
3. Day 0: Alice borrows The Pragmatic Programmer and Clean Code. Both succeed, both due day 14, and she now has 3 open loans. Alice borrows Clean Architecture: rejected (limit), the copy stays on the shelf. Day 1: Bob borrows Dune and gets copy 2, due day 15. A search for "dune" now shows 0 on the shelf.
4. Day 2: Carol reserves Dune. Day 3: Dan reserves Dune. The queue is Carol, then Dan. Rejected: Alice reserves Dune (she holds a copy), Carol reserves Dune again, Carol reserves Clean Architecture (a copy is on the shelf), a reserve on an unknown book. Day 4: Bob renews copy 2: rejected because members wait. The due day stays 15.
5. Day 10: Alice renews The Pragmatic Programmer: due day 24, not 28. Day 12: she renews again: due day 26. Day 13: a third renew is rejected, due day stays 26.
6. Day 14: Alice returns copy 1: fine 0, because day 14 is the due day. Copy 1 goes on hold for Carol through day 17. A search for "dune" shows 0 on the shelf.
7. Day 15: Dan borrows Dune: rejected, the only free copy is held for Carol. Alice borrows Clean Architecture: rejected. Her Clean Code copy is 1 day overdue, and she has 2 loans, so the overdue rule is the only cause. The copy stays on the shelf.
8. Day 16: Carol borrows Dune. She gets copy 1, due day 30. Her reservation is done. Dan is now first in the queue.
9. Day 19: Bob returns copy 2, due day 15: fine 8 (4 days at 2). The copy goes on hold for Dan through day 22. Day 20: Alice returns copy 4, due day 14: fine 12. Alice borrows Clean Architecture: succeeds, due day 34, because she no longer has an overdue loan. Day 22: Dan borrows Dune and gets copy 2, on the last day of the hold, due day 36.
10. Day 23: Alice returns copy 4 again: rejected, no fine, the copy stays on the shelf. A return of copy 99: rejected. A renew of copy 4 (not on loan): rejected.
11. Fresh library, stretch: one book, Emma by Jane Austen, with copy 1. Members Alice, Bob, Carol. Day 0: Alice borrows. Day 1: Bob reserves. Day 2: Carol reserves. Day 5: Alice returns, fine 0, and the copy is held for Bob through day 8. Then, replaying the setup each time:
   - a. Day 6: Carol borrows: rejected, the copy is held for Bob.
   - b. Day 8: a search for "emma" shows 0 on the shelf. Day 9: Carol borrows: succeeds, due day 23, because Bob's hold has lapsed. Bob then borrows on day 9: rejected, and the reservation has ended.
   - c. Boundary: day 8, Bob borrows: succeeds, due day 22.
   - d. Day 6: Bob cancels the reservation. The copy is held for Carol through day 9. Day 9: Carol borrows: succeeds.
   - e. Replay without Carol's reservation, so Bob is the only one waiting. A lapse puts the copy back on the shelf: a search at day 8 shows 0, and at day 9 shows 1.
   - f. Replay up to day 2 only, with no return. Day 3: a second copy of Emma (copy 2) is added. It is held for Bob through day 6. Day 4: Carol borrows: rejected. Bob borrows: gets copy 2.
12. Only if the candidate made it thread-safe: one book with 50 copies, 200 members. 4 threads each try 50 different members at day 0. Exactly 50 borrows succeed and no copy id appears twice. Then 8 threads return the same copy at once: exactly 1 succeeds.

## Extensions

Pick one for the last 15 minutes. Offer a second only if the candidate finishes early.

1. **Member types:** a premium member has a limit of 5, a loan of 21 days and a fine of 1 per day. Standard members stay as they are. What changes? Expect: a policy per member type that the library asks for limit, loan days and fine rate; a member holds its policy; no `if (type == PREMIUM)` in the borrow path. Check: a premium member borrows 5 books on day 0 (the library has at least 6 books with free copies), each due day 21, and a sixth borrow is rejected. Returning one on day 30 costs 9. A standard member returning a day-0 loan on day 30 pays 32. A premium renew on day 10 gives due day 31. The due day is stored on the loan at borrow time. Must stay the same: scenarios 1 to 11 for standard members, 2 renewals, 3 hold days, the queue rules.
2. **Notify the next member:** when a hold starts, tell that member; when a hold lapses, tell the member who lost it. What changes? Expect: a listener interface with `onHoldReady(member, book, lastDay)` and `onHoldLapsed(member, book)`, registered on the library and called from `release` and `settle`. Check, replaying scenario 11: day 5, Bob is told the hold is ready through day 8. Day 9, on the call that notices the lapse, Bob is told the hold lapsed, then Carol is told her hold is ready through day 12 (day 11 if the candidate counts from the old hold's last day). Events are collected while the lock is held and delivered after it is released. Must stay the same: queue order, hold rules, every result in scenarios 1 to 11. With no listener registered, nothing changes.
3. **Lost book:** `reportLost(copy, day)` closes the loan and marks the copy lost for good. The member is charged the book's price, plus 50 handling, plus any overdue fine up to the report day. What changes? Expect: a new copy status `LOST` and one method; a `price` on `Book`; `release` and the queue code untouched. Check on a fresh library: Dune has price 400 and one copy. Alice borrows it on day 0 (due day 14) and Bob reserves it on day 1. Reported lost on day 20: charge 462 (400 + 50 + 12). Replayed and reported on day 10: 450. The copy never shows on the shelf, a return of it is rejected, and Bob is not promoted. Alice's loan count drops by 1. A new copy added on day 21 goes on hold for Bob through day 24. Must stay the same: all earlier scenarios, the invariant that a waiting member and a shelf copy never coexist.

## Concurrency follow-up

"Two desks call `borrow` for the last copy of a book at the same moment. Walk me through what happens in your code." Expect: names the check-then-act race (find a shelf copy, then mark it on loan) and the compound state (copy, loan and queue change together); one `std::mutex` with `std::lock_guard` in every public method, `search` and other reads included, because a scan over a map that another thread is changing is undefined behaviour; explains why a `return` racing a `renew` on the same loan also needs it. A `std::shared_mutex` with a shared lock for `search` is fine only if `search` does not lapse holds. In the reference it does, so it needs the exclusive lock. Stretch signal: says per-object locks do not help here, because one borrow touches the copy, the member's loans and the queue; keeps lock scope tight and delivers notifications after releasing the lock; names per-book locks as the next step and the cost: the limit and overdue checks read the member's other loans, which sit under other books' locks, so a second lock or a fixed lock order is needed.

## Level bar

Hire bar must show:
- Step 1 questions that cover what is lent (book or copy), the borrow limit, loan length and renewal, the fine rule and time, what a reservation does when a copy returns, and concurrency. Assumptions written down.
- `BookCopy` and `Loan` as real types, with the due day on the loan. A `Reservation` record, or a per-book queue plus hold fields, so a held copy is visible.
- A program that compiles and runs scenarios 1 to 10 inside the time. Scenario 11 (hold lapse) is a stretch. A candidate who leaves it out and says so plainly still meets the bar.
- Fines exact at the boundary (the due day is on time), with time passed in on every call.
- Limits, loan days and fine rate in one config struct or policy, so the member-types extension lands in one place.
- Rejected calls change nothing. One error style. No phantom members from `operator[]`.
- Correct locking when asked.

Stretch signal:
- Names `Book`, `BookCopy` and `Loan` within 15 minutes, with a skeleton compiling by minute 30.
- One `release` path for every freed copy, and states the invariant out loud.
- Asks "what if the member at the head never comes?" before being told.
- Treats time as a parameter without being told, and explains why the hold lapse is checked lazily.
- Handles the extension with a small, local change and says which existing behaviour stays the same.
- States the cost of search (a scan) and when an index would pay for itself.

## Traps

- An `int copies` counter on `Book`. It sounds simpler, and it holds until a hold needs "which copy", a double return skews the count, or a copy is lost.
- A `Member::borrow(Book&)` that changes both sides. Two sources of truth drift apart.
- Letting any member grab a freed copy, so the queue is advice and not a rule.
- A hold that never lapses, so one absent member blocks a book forever.
- Counting the due day as late, so a return on the due day pays a fine, or any other off-by-one in the days late. Computing the fine from a timer or the system clock.
- Renewal that adds 14 to the old due day, or that works on an overdue loan.
- Holding `BookCopy` objects in a `vector` and keeping references or pointers. A `push_back` makes them dangle. Erasing a lost copy from the `vector` also shifts every id.
- `auto loan = loans[id];` then changing the copy. `operator[]` on an unknown member id quietly inserts one.
- `if (member.type == PREMIUM)` spread across the borrow and return paths, or a class per rule.
- Calling observers while holding the lock, or storing raw listener pointers that can dangle.
- Building a trie or an inverted index for search before the core flows run.
- Spending more than 25 minutes on steps 1 to 3 so nothing runs at the end.
