# B3 — Parking Lot (first timed machine coding round)

**Date:** 2026-10-25 · **Tracker:** B3 Parking Lot · **Status:** [~] — timed, 120 minutes, the entrance search was unwritten at the deadline.
**Code:** `lld/parking-lot/main.cpp` (C++17).

## The prompt and the facts I collected

| Asked | Answer |
|---|---|
| Spot on entry, fee at exit by duration? | Yes. The system picks the spot. |
| Vehicle types? | Motorcycle, car, truck. |
| Which spot? | First free spot that fits: lowest floor, then lowest number. |
| Lot full? | Reject. No ticket, no queue. |
| Fee? | Rate per vehicle type, every started hour counts. |

## Where the time went

| Step | Minutes |
|---|---|
| Requirements | 15 |
| Classes and enums | 30 |
| Entry and exit flow | 45 |
| Tests in `main()` | 0 |

## What to fix next time

- Write the exit flow into the must-do list in step 1.
- Write the rates down before coding.
- Keep `main()` for the end, but never leave it empty.
