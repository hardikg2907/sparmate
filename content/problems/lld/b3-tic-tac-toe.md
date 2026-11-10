---
id: b3-tic-tac-toe
track: lld
title: Tic-Tac-Toe
difficulty: easy
tags: [grid, validation, win-detection, command, strategy]
tracker:
  section: "### B3. Applied Practice — Classic LLD Problems"
  bullet: "Tic-Tac-Toe / Chess"
notesFile: notes/b3-tic-tac-toe.md
lldFolder: tic-tac-toe
---

## Opening prompt

Design a tic-tac-toe game. Build it as a running, in-memory C++ program, with a `main()` that shows it working.

## Hidden facts

Reveal a fact only when the candidate asks about it. Never volunteer the list.

- **What happens:** two or more players take turns to mark an empty cell of a square board. The first with K marks in an unbroken line wins. A full board with no winner is a draw.
- **Board and K:** N by N, and a win length K, both set at setup. The defaults are 3 and 3. Real use goes up to N of about 20, but the design must still work at 1,000. N must be at least 3, and K must be at least 3 and at most N. Anything else is invalid.
- **Win rule:** K or more marks of the same player in a row, in a column, or on a diagonal. Every diagonal counts, not only the two main ones. A gap, another player's mark, or the board edge ends a line. A line never wraps from one row to the next. A line longer than K also wins.
- **Players:** 2 or more. Each has a unique id, a name, and a unique one-character symbol. Any character is a legal symbol. Names are only for display: they may repeat and are never checked. Setup with fewer than 2 players, a repeated id, or a repeated symbol is invalid.
- **Turn order:** the setup order, then around again. The first player listed moves first. Only an accepted move passes the turn.
- **A move:** a player id, a row and a column. Both are 0-based, and `(0, 0)` is the top-left cell.
- **Bad moves:** 5 reasons to reject: game over, unknown player, not that player's turn, row or column out of range (negatives included), cell already taken. The caller must be able to tell the reasons apart. An enum, a result struct or distinct errors all work. A bare `bool` does not. A rejected move changes nothing: no mark, no turn change, no state change. If a move breaks two rules at once, any one correct reason is fine, except that a finished game always answers "game over".
- **Game over:** WON or DRAW. Every later move is rejected, whatever the player or the cell. A finished game has no next player: the caller gets an empty answer, such as an empty `std::optional` or a sentinel.
- **Draw:** all N times N cells are filled and nobody has won. A move that fills the last cell and completes a line is a win, not a draw. No early draw detection.
- **Speed:** a move costs O(1) or O(K). It never scans the whole board. On a 1,000 by 1,000 board with K = 5, each move should still read only a few dozen cells.
- **Results:** a good move reports "accepted", and the caller can read the new state. Bad setup is rejected when the game is built, with an error the caller can see, for example `std::invalid_argument`. No half-built game and no silent clamping.
- **Threads:** the players may call from different threads, one game shared by all of them. `main()` may stay single-threaded.
- **Time:** none. The game has no clock and no move timer. A later rule that needs time gets it from the caller on every call. Never the system clock.
- **Demo:** `main()` plays one full game from a scripted list of moves, printing the board after each move. It reads no keyboard input. The print layout is free.
- **Not in the first version:** undo, computer players, other games, a UI, a reset (a rematch is a new game), scores across games, a network layer, a pass or resign, saving and loading a game, a lobby of many games. If they ask, say so and add nothing.

## Expected requirements

Core:
1. Configure N, K and the players at setup. Reject a bad setup. *Ask: What can be configured, and what setups are invalid?*
2. `move(player, row, col)` is accepted, or rejected for one of 5 reasons with no change. *Ask: What makes a move invalid, and what happens then?*
3. Players take turns in setup order. Only accepted moves pass the turn. *Ask: Who moves first, and when does the turn pass?*
4. A win is K or more in a row, column or diagonal, checked only around the last move. *Ask: What counts as a win, and how fast must the check be?*
5. A draw is a full board with no winner. A win on the last cell is a win. *Ask: When is the game a draw?*
6. Safe when moves arrive from several threads. *Ask: Can several threads use it at once?*

Extras (credit when they name one, never a gap):
- The caller can read the game state (in progress, won, draw), the winner, whose turn it is, and any cell.
- The win check costs O(K) or better and never scans the whole board.

## Entities and relationships

- `Player` (struct): id, name, symbol.
- `Board`: the N by N grid. **A noun most candidates leave inside `Game` as a raw `vector<vector<char>>`.** Each cell holds the player index, or -1 for empty, never the symbol. The symbol is only for display.
- `MoveResult` (enum class): OK plus the 5 reject reasons. A real type, not a `bool`.
- `GameState` (enum class): IN_PROGRESS, WON, DRAW.
- `Move` (struct): player, row, column. Optional in the first version. Undo needs it.
- `Game`: owns the board, the players, K, the turn, the move count, the state, the winner and the lock. It holds the rules. The board is only geometry.
- Not stored: per-line counters (valid only when K equals N), the clock, a score.

## Behaviour and states

- `move(playerId, row, col)`, checks in this order: game over, unknown player, wrong turn, out of range, cell taken. Then place the mark, count the move, and check for a win around that cell. A win sets WON and the winner. Otherwise a full board sets DRAW. Otherwise pass the turn.
- Win check: from the new cell, walk both ways along each of the 4 axes (row, column, diagonal, anti-diagonal). Count the unbroken cells owned by the mover. The line wins when `1 + forward + backward >= K`. Stop each walk at the edge, at a gap, or after K - 1 cells. Cost: at most 8 times (K - 1) reads.
- Only the player who just moved can have just won. Draw check: `moves == N * N`, after the win check came back false. O(1).
- States: after an accepted move, IN_PROGRESS stays or goes to WON or DRAW. WON and DRAW are final, and every move there is rejected as "game over". The state follows from the move count and a winner field, so State pattern classes have nothing to do.

Questions to ask once the code runs, one per turn, only if the candidate has not already covered them:
- "What does your win check cost on a 1,000 by 1,000 board with K = 5?"
- "What happens if K is 4 on a 5 by 5 board?"
- "What happens to the turn when a move is rejected?"

## Reference design

```
 enum class GameState { IN_PROGRESS, WON, DRAW };
 enum class MoveResult { OK, GAME_OVER, UNKNOWN_PLAYER, NOT_YOUR_TURN, OUT_OF_RANGE, CELL_TAKEN };

 struct Player { int id; std::string name; char symbol; };

 class Board {
   int n;
   std::vector<std::vector<int>> cells;                 // -1 empty, else player index
  public:
   explicit Board(int size) : n(size), cells(size, std::vector<int>(size, -1)) {}
   bool inRange(int r, int c) const { return r >= 0 && r < n && c >= 0 && c < n; }
   int  size() const { return n; }
   int  at(int r, int c) const { return cells[r][c]; }
   void set(int r, int c, int who) { cells[r][c] = who; }
   int  run(int r, int c, int dr, int dc, int who, int limit) const {   // same-owner cells in one direction
     int count = 0;
     for (r += dr, c += dc; count < limit && inRange(r, c) && cells[r][c] == who; r += dr, c += dc) ++count;
     return count;
   }
 };

 class Game {
   int k;
   Board board;
   std::vector<Player> players;
   int current = 0, moves = 0, winner = -1;
   GameState state = GameState::IN_PROGRESS;
   mutable std::mutex mtx;
   bool completesLine(int r, int c, int who) const {
     static const int axes[4][2] = {{0, 1}, {1, 0}, {1, 1}, {1, -1}};
     for (const auto& a : axes)
       if (1 + board.run(r, c, a[0], a[1], who, k - 1) + board.run(r, c, -a[0], -a[1], who, k - 1) >= k) return true;
     return false;
   }
  public:
   Game(int size, int winLength, std::vector<Player> players);      // throws std::invalid_argument on a bad setup
   MoveResult move(int playerId, int row, int col);                 // lock, validate in order, place, win, draw, turn
   GameState getState() const;  int winnerId() const;  int currentPlayerId() const;  int cell(int r, int c) const;
 };
```

A grid of player indexes plus a walk from the last cell turns "did this move win?" into 4 short loops. The walk needs no counters, works for K below N and for 3 or more players, and has nothing to undo later.

## Patterns that fit

- **Strategy** for a computer player (how it picks a cell) and, later, for pluggable board-game rules. It is not needed in the first version.
- **Command** for undo. A stack of `Move` records is just as good here. Accept either.
- Not needed: Singleton, Factory, State pattern (3 states), Observer, a class per direction (`RowChecker` and so on), a `WinStrategy` hierarchy before a second win rule exists.
- **Accepted alternatives:**
  - Per-line counters per player (rows, columns, 2 diagonals) give O(1) checks, but only when K equals N. K is configurable, so a candidate who starts here must handle K below N. Switching to the walk after one question is fine. A single signed counter (+1 for one player, -1 for the other) works for 2 players only.
  - A full-board scan is correct but costs O(N times N) per move. It is below the bar if the candidate defends it as "fine for 3 by 3". It is at the bar if the candidate names the cost and fixes it after one question.
  - A scan of the whole row, column and both diagonals through the last cell costs O(N) per move. It is at the bar if the candidate names the cost and bounds the walk by K after one question.
  - A `char` grid of symbols works when setup also refuses the empty marker as a symbol, because every symbol is unique. The player index is simpler: identity never depends on display.
  - Flat storage (one `vector<int>` of N times N) works if the walk steps by row and column and checks the range on both, never by flat-index steps.
  - The line-walk living in `Board` or in `Game`, a result enum, a result struct or distinct exceptions for bad moves, `Move` as a struct or three ints. Accept all, with one error style.

## Demo scenarios

Unless stated, each scenario starts from a fresh 3 by 3 game with K = 3, and two players: X (id 1) moves first, then O (id 2). A cell is `(row, col)`, 0-based. A move is written `X(0,1)`. In the boards, `.` is an empty cell. Adapt the calls to the candidate's own API. The expected behaviour is what matters.

1. **Fresh game and a row win.** A new game is in progress, with no winner, X to move, and 9 empty cells. `X(0,0)` `O(1,0)` `X(0,1)` `O(1,1)` are accepted, and the game stays in progress with the turn passing each time. `X(0,2)` is accepted: WON, winner X.
   ```
    X X X
    O O .
    . . .
   ```
2. **Column, diagonal and anti-diagonal.** Three fresh games. Every move before the last one leaves the game in progress.
   - a. `X(0,0)` `O(0,1)` `X(1,0)` `O(1,1)` `X(2,0)`: X wins on move 5 (column 0).
   - b. `X(0,0)` `O(0,1)` `X(1,1)` `O(0,2)` `X(2,2)`: X wins on move 5 (main diagonal).
   - c. `X(0,0)` `O(0,2)` `X(0,1)` `O(1,1)` `X(2,2)` `O(2,0)`: O, the second player, wins on move 6 (anti-diagonal).
   ```
     a         b         c
    X O .     X O O     X X O
    X O .     . X .     . O .
    X . .     . . X     O . X
   ```
3. **Draw.** `X(0,0)` `O(0,1)` `X(0,2)` `O(1,1)` `X(1,0)` `O(1,2)` `X(2,1)` `O(2,0)` `X(2,2)`. All 9 are accepted. After move 8 the game is in progress. After move 9: DRAW, no winner. Then `O(0,0)` is rejected: game over.
   ```
    X O X
    X O O
    O X X
   ```
4. **A win on the last cell is a win.** `X(0,0)` `O(0,1)` `X(0,2)` `O(1,0)` `X(2,0)` `O(1,2)` `X(2,2)` `O(2,1)` `X(1,1)`. After move 8 the game is in progress. Move 9 fills the last cell and completes both diagonals: WON, winner X. It is not a draw.
   ```
    X O X
    O X O
    X O X
   ```
5. **Bad moves, one fault each.** Each of these is rejected, and the board stays empty with X to move: `X(3,0)`, `X(0,3)`, `X(-1,1)` and `X(1,-1)` (out of range); `O(0,0)` (not O's turn); player id 99 at `(0,0)` (unknown player). Then, in order:
   - `X(1,1)` is accepted, so the rejections did not use up X's turn.
   - `O(1,1)` is rejected: cell taken. It is still O's turn.
   - `X(0,0)` is rejected: not X's turn.
   - `O(0,0)` is accepted.
   - `X(1,1)` and `X(0,0)` are both rejected: cell taken.
   - End state: 2 moves played, X at `(1,1)`, O at `(0,0)`, X to move.
6. **After the game ends.** Take the finished game from scenario 1. `O(2,2)`, `X(2,2)` and `X(0,0)` are each rejected as game over, even though `(0,0)` is taken. The board, the winner and the move count do not change. The finished draw from scenario 3 also rejects every move as game over.
7. **Setup checks.** Each of these is rejected with a visible error, and no game exists:
   - N = 2, K = 2.
   - N = 3, K = 4.
   - N = 5, K = 2.
   - N = 3, K = 3 with two players that both use the symbol `X`.
   - N = 3, K = 3 with one player.
   - N = 3, K = 3 with two players that both have id 1.

   Each of these is accepted: N = 3 with K = 3 and two players; N = 5 with K = 4; N = 5 with K = 5; N = 4 with K = 3 and three players.
8. **K below N: gaps and joined runs (N = 5, K = 4).** `X(3,0)` `O(0,0)` `X(3,1)` `O(0,1)` `X(3,3)` `O(0,3)` `X(3,4)` `O(0,4)` are accepted, and the game stays in progress after every move. X holds 4 cells of row 3 and O holds 4 cells of row 0, but a gap breaks both lines. Then `X(3,2)` fills the gap: X wins with a line of 5. A counter design that tests for K marks in a row declares a win at move 7. A check that walks only one way from the last cell sees 3 and misses the win.
   ```
    O O . O O
    . . . . .
    . . . . .
    X X . X X      (before X(3,2))
    . . . . .
   ```
9. **K below N: other diagonals and edges (N = 5, K = 4).**
   - a. `X(0,1)` `O(4,0)` `X(1,2)` `O(4,1)` `X(2,3)` `O(4,2)` `X(3,4)`: X wins on move 7, on a diagonal that is not a main diagonal. The game is in progress before that.
   - b. `X(0,3)` `O(2,0)` `X(0,4)` `O(2,1)` `X(1,0)` `O(2,2)` `X(1,1)`: all 7 are accepted and the game stays in progress, with O to move. The end of row 0 and the start of row 1 are not neighbours.
   - c. `X(0,3)` `O(4,0)` `X(1,2)` `O(4,1)` `X(2,1)` `O(4,2)` `X(3,0)`: X wins on move 7, on an anti-diagonal that is not the main one. The game is in progress before that.
   ```
     a             b             c
    . X . . .     . . . X X     . . . X .
    . . X . .     X X . . .     . . X . .
    . . . X .     O O O . .     . X . . .
    . . . . X     . . . . .     X . . . .
    O O O . .     . . . . .     O O O . .
   ```
10. **Three players (N = 4, K = 3).** Players A (id 1), B (id 2), C (id 3), in that order. `A(0,0)` and `B(0,1)` are accepted. Now it is C's turn, so `A(3,3)` and `B(3,3)` are rejected (not their turn). Then `C(1,1)` `A(0,3)` `B(1,0)` `C(2,2)` `A(3,0)` `B(2,0)` are accepted, with the turn going A, B, C around. `C(3,3)` wins on move 9, on the diagonal `(1,1)`, `(2,2)`, `(3,3)`. Then `A(1,2)` is rejected: game over.
    ```
     A B . A
     B C . .
     B . C .
     A . . C
    ```
11. **Large board (N = 10, K = 5).** `X(5,9)` `O(0,0)` `X(6,9)` `O(0,1)` `X(7,9)` `O(0,2)` `X(8,9)` `O(0,3)` are accepted, and the game is in progress: 4 in a row is not enough. `X(9,9)` wins at the bottom-right corner. The walk must stop at the board edge without reading outside it.
12. **Only if the candidate made it thread-safe.**
    - a. 8 threads each call `X(0,0)` at the same moment. Exactly 1 call is accepted and the other 7 are rejected. Cell `(0,0)` holds X, it is O's turn, and the move count is 1.
    - b. 1,000 rounds, each on a fresh game. Two threads, one per player, each loop over the 9 cells in row-major order and try a move for their own player, until the game is over. After every round: the game is WON or DRAW; the accepted moves number between 5 and 9; the marks on the board equal the accepted moves; X has as many marks as O, or one more; and a DRAW means exactly 9 marks.

## Extensions

Give one with 15 minutes left. Undo is the default. Use 2 or 3 for a candidate who finishes early.

1. **Undo the last move.** "Players may take back their last move, as many times as they like, back to an empty board." What changes? Expect: a history of accepted moves, as a stack of `Move` records or as `Command` objects with `execute` and `undo`. `undo()` removes the last record, empties its cell, lowers the move count, gives the turn back to that mover, and sets the state to IN_PROGRESS with no winner. Undoing a winning or drawing move reopens the game. `undo()` on an empty history reports "nothing to undo" and changes nothing. The line-walk needs no rollback. A counter design must roll its counters back, and that is where it breaks. `undo()` takes the same lock as `move`. What must stay the same: all 5 reject reasons, turn order, win and draw rules. A rejected move leaves no history entry. No redo.
   - Check: after scenario 1, `undo()` empties `(0,2)`, the game is in progress, X is to move, and there is no winner. `X(0,2)` wins again. Then 5 undos reach an empty board with X to move, and a 6th is rejected.
   - Check: after scenario 3, `undo()` empties `(2,2)`, the game is in progress, and X is to move. `X(2,2)` gives DRAW again.
2. **A computer player.** "A seat can be played by the computer." What changes? Expect: a `MoveStrategy` interface that reads the board and returns a cell, and a way to mark which players are computers. The computer's cell goes through the same `move` call, so the same validation applies. The strategy sees a read-only board and never writes to it. `Game` asks the strategy in one place and has no other `isComputer` branches. Two strategies, so Strategy has a reason to exist. `FirstFree` takes the lowest row, then the lowest column, among empty cells. `WinOrBlock` takes a cell that wins now, else a cell that blocks the opponent's immediate win, else the first free cell. Ties go to the lowest row, then the lowest column. No minimax. This extension is for two players. What must stay the same: human moves, reject reasons, turn order, win and draw rules.
   - Check: O is `FirstFree`. After `X(1,1)` it takes `(0,0)`. After `X(0,1)` it takes `(0,2)`. `X(2,1)` wins for X.
   - Check: X is `FirstFree` and O is `WinOrBlock`, both computers. The moves are `X(0,0)` `O(0,1)` `X(0,2)` `O(1,0)` `X(1,1)` `O(2,0)` `X(1,2)` `O(2,2)` `X(2,1)`, and the result is DRAW.
   - Check: with explicit moves, build X at `(0,0)` and `(0,1)`, O at `(1,0)` and `(1,1)`, then X at `(2,2)`. O is to move, and `WinOrBlock` picks `(1,2)`, its own win, not the block at `(0,2)`.
3. **Another board game with pluggable rules.** "Reuse the engine for Connect Four: 6 rows, 7 columns, 4 in a row, players R then Y. A move names only a column, and the piece falls to the lowest empty row, and row 5 is the bottom." What changes? Expect: the board gets separate row and column counts, and a rules interface (Strategy) answers where a move lands and whether the game is over. Tic-tac-toe and Connect Four become two implementations. Turn order, history, the state enum and the line-walk stay shared. A full column and an out-of-range column are rejected. What must stay the same: with the tic-tac-toe rules plugged in, scenarios 1 to 11 behave as before.
   - Check: `R(0)` `Y(1)` `R(0)` `Y(1)` `R(0)` `Y(1)` `R(0)`: R wins on move 7, a vertical line in column 0. `R(0)` `Y(0)` `R(1)` `Y(1)` `R(2)` `Y(2)` `R(3)`: R wins on move 7, along row 5.
   - Check: 6 alternating drops fill column 0. A 7th drop by R into column 0 is rejected, R is still to move, and `R(1)` lands on row 5. Columns 7 and -1 are rejected as out of range.
   - Chess is a stretch for talk only, never code. If it comes up, ask what the rules interface would need: piece types, from-and-to moves, per-piece legality, check and checkmate. Then ask which parts survive. The board, turn order, history and game states do. The placement rule and the win rule do not.

## Concurrency follow-up

"Two clients submit a move for the same player at the same moment. Walk me through what happens in your code." Expect: the turn check, the cell check, the mark, the state update and the turn change form one check-then-act sequence. Without a lock, both calls pass the turn check and both place a mark, so one player moves twice, or both pick the same empty cell and the second overwrites the first. One `std::mutex` with `std::lock_guard` in `move`, and in every reader (state, winner, current player, cell, print), makes the whole sequence one step. A reader can otherwise see a placed mark with an old state. Stretch signal: says the game is sequential by turns, so the lock exists only because the API can be called from several threads. Notes that an `atomic<int>` for the turn is not enough, because the operation spans several fields. Gives one lock per game, so many games run in parallel, and a registry of games needs its own lock only for its map. Does not hold a lock while calling a computer player's strategy unless that code is small and pure.

## Level bar

Hire bar must show:
- Step 1 questions that cover N and K, the number of players and their symbols, who moves first, what happens on a bad move, the draw rule, and threads.
- `Board`, `Player`, a typed result for the 5 reject reasons, and `Game` as real types. A player's identity is separate from how it is displayed: cells hold the player index (best), or a symbol with an empty marker that no player can use.
- A bounded win check: it looks only around the last move and costs O(K) or better. Per-line counters are fine as a start, but the final program must handle K below N (scenarios 8 to 11). A full-board scan or a scan of whole lines is allowed only if the candidate names the cost and fixes it after one question.
- All 5 reject reasons. A rejected move changes nothing and the turn stays. Win is checked before draw.
- A program that compiles and runs scenarios 1 to 11 inside the time: skeleton compiling by minute 25, a full game running by minute 45. The problem is easy, so speed and cleanliness are the bar.
- Correct locking when asked.
- One extension landed in the last 15 minutes as a small, local change, with the candidate saying which existing behaviour stays the same.

Stretch signal:
- Sees without help that counters fail when K is below N, and says why: they count marks, not unbroken runs, and they cover only 2 diagonals.
- Bounds the walk by K, or explains why it is already bounded: no run of K or more can exist before a move, because the game would have ended. So a move costs the same on a 1,000 by 1,000 board. Mentions sparse storage for a huge board.
- States the invariants out loud: a cell is empty or holds a valid player index; the move count equals the number of marks; the state follows from the count and the winner.
- Keeps `Board` as plain geometry and the rules in `Game`, so pluggable rules fit with no rewrite.
- Makes a computer player testable: a deterministic strategy, or a seeded random one passed in. Has a `main()` that checks results.
- Names the lock's real reason and its scope.

## Traps

- Scanning the whole board after every move. It works at 3 by 3 and fails the speed requirement.
- Per-line counters used with K below N. They count marks, not unbroken runs, so `X O X X` on a 4-wide row counts as 3 and wins with K = 3, though the longest run is 2. They also track only the two main diagonals. A single signed counter (+1 and -1) also fails with 3 or more players.
- Counting one way only from the last cell, so a move that joins two runs is missed.
- Walking a flat index (`r * n + c`), so a line wraps from the end of one row to the start of the next.
- `cells[r][c]` before the range check. On a `vector` that is undefined behaviour, not an error.
- Hard-coding 3 (`char board[3][3]`), or a `char` grid whose empty marker (`' '`) is also a legal symbol.
- Placing the mark before validating, or passing the turn on a rejected move.
- Checking for a draw before a win, so a win on the last cell reads DRAW.
- Returning `bool` from `move`, which loses the reason.
- A State pattern for 3 states, a class per direction, a `PlayerFactory`: pattern count as a goal.
- Undo by copying the whole board for every move, then forgetting the turn, the winner or the state.
- A computer player with a writable `Game&` that places its own mark and skips validation.
- A global lock "and done", locking `move` but not the readers, or holding the lock while calling strategy code that can block or that locks the same game again (a plain `std::mutex` deadlocks).
- Spending more than 25 minutes on steps 1 to 3 so nothing runs at the end.
