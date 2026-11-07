# Machine coding rubric

The bar is a {{target_level}} or {{stretch_level}} backend engineer at a {{target_company}}, in a 90 to 120 minute machine coding round: a running, in-memory C++ program, then one new requirement near the end. Score each dimension from 1 to 4. There are eight dimensions, in this order: `requirements`, `working_code`, `design`, `extensibility`, `edge_cases`, `concurrency`, `code_quality` and `communication_time`. Each one has its own section below, headed by its id, with its display name on the line under the heading. Concurrency is scored only in the cases its section names.

| Score | Label | When to give it |
|---|---|---|
| 1 | Missing | The work this dimension measures never happened, or a red flag dominates it. |
| 2 | Below bar | Some of the work happened, but at least one 3-level signal is missing. Every dimension starts here. |
| 3 | At bar | Every 3-level signal shows in the evidence, or all but one shows and the rest is clear and strong. This is a hire at the {{target_level}} level on this dimension. |
| 4 | Stretch signal | Every 3-level signal shows, plus at least two 4-level signals, and they got no hint on this dimension. |

A real hiring panel weighs the evidence as a whole, not item by item. So one missing 3-level signal does not hold a dimension at 2 when every other 3-level signal shows clearly. Two missing signals do. When you give a 3 with one signal missing, name that signal as a low gap so they still see it. Red flags and hint caps apply on top of this rule.

A signal that starts with "When" applies only if that situation came up in the round. If it never came up, it does not hold the score back.

A red flag caps its dimension at 2, unless they noticed and fixed it themselves during the round.

Working, demoable code is the gate in this format. A clean design that does not run is not a hire. After that, the round grades how well the design takes the new requirement. Over-engineering is a more common failure than a missing pattern.

The order of their seven steps is not graded. Judge what they produced.

## Outside the bar

Never require these, and never reward them: templates, move semantics, the rule of five, raw-pointer ownership, header files, getters and setters that do nothing, lock-free structures, thread pools, persistence, a user interface, and naming a design pattern out loud.

They write C++17 in the subset the profile names. When the profile names none, the plain subset is `class` and `struct`, pure virtual interfaces with `override` and a virtual destructor, `std::shared_ptr` with `std::make_shared`, `enum class`, `std::optional`, and `std::mutex` with `std::lock_guard`. Staying inside the candidate's subset is correct.

Never grade UML notation. A clear class diagram on the board is evidence for design, and an empty or rough one costs nothing.

Any design that meets the requirements with a reason is valid. A function object in place of a Strategy class, or an enum with if-checks for two states in place of the State pattern, scores the same as the brief's reference.

## requirements
Name: Requirements

Measures whether they pin down what to build before they build it.

- **1:** They start coding with no questions, or build something other than what was asked.
- **2:** They ask only happy-path questions, miss a rule that shapes the code (a failure case, an ordering rule, a limit), or keep their assumptions in their head.
- **3, every one of these:**
  - They ask about the operations, the rules, the failure cases and the scope.
  - When the problem has callers that act in some order or at the same time, they ask about it.
  - They write down the must-do list, the facts they collected and what is out of scope, in the file or the chat.
- **4, all of 3 plus at least two of these:**
  - They ask which requirements are likely to change, and plan a seam for them.
  - They pick a minimal first slice and say so.
  - They list the failure cases before writing any code.
- **Red flags:** coding before the scope is stable; a rule the interviewer gave that never reaches the code.

## working_code
Name: Working code

Measures whether the program compiles and does what was asked. The tester's scenario results are the main evidence.

- **1:** The file does not compile, there is no `main()`, or nothing runs.
- **2:** It compiles, but a core flow is missing or wrong (it fails one or more core scenarios), or only the happy path works.
- **3, every one of these:**
  - It compiles with the round's flags.
  - It passes the core scenarios that the brief's Level bar names.
  - Their `main()` shows the core flows with visible results.
  - When something is unfinished, they say so plainly.
- **4, all of 3 plus at least two of these:**
  - It passes every scenario, including the edge cases.
  - It handles inputs nobody listed (unknown ids, repeats) without crashing.
  - Their demo proves state changes, not just that calls return.
  - A thin slice was running by about the middle of the round.
- **Red flags:** it does not compile; they claim something works that the tests show does not; a crash or undefined behaviour under the sanitizer builds.

## design
Name: Class design

Measures whether responsibilities sit in the right classes, and whether the data shape keeps the rules simple.

- **1:** Everything lives in `main()`, or in one class with free-floating data.
- **2:** There are classes, but a key noun is hidden (inside nested maps, for example), a class does two unrelated jobs, or the data and the rules that change it live apart, as plain data bags driven by a procedural manager.
- **3, every one of these:**
  - Each noun that has state or identity is its own type, including the hidden noun the problem needs.
  - Entities own their state and the rules that change it, and one class coordinates them.
  - The data shape makes the main rule simple, for example a flat list kept in the order the rule walks.
- **4, all of 3 plus at least two of these:**
  - Dependencies point one way, with no cycles.
  - They add small interfaces only where change is likely, and say why.
  - They state what their data shape makes easy and what it makes hard.
  - Callers such as gates, users or panels are interfaces the core implements, not stored data.
- **Red flags:** an interface for every class; a pattern used for its own sake; a god class.

## extensibility
Name: Extensibility

Measures whether the design takes the new requirement with a small, local change.

- **1:** They cannot take the extension without a rewrite, or never engages with it.
- **2:** The extension forces edits in many places, they hard-code it as a new branch inside the core logic, or they cannot say where it would go.
- **3, every one of these:**
  - They restate the new requirement and ask which existing behaviour changes.
  - The change lands in one or two places (a new class, a new strategy, a new field), and the core stays untouched or nearly so.
  - They use a pattern only where it fits, and can say why it fits.
- **4, all of 3 plus at least two of these:**
  - The seam existed before the extension arrived, because the varying rule was already behind an interface or a function.
  - They name which existing behaviour stays the same, and check that it still runs.
  - A second change would also stay local, and they name the boundary that makes it so.
- **Red flags:** counting patterns as the goal; an extension that silently breaks an existing scenario.

When time ran out before they could code the extension, score their spoken plan against the code they have. A spoken plan alone can reach 3, never 4.

## edge_cases
Name: Edge cases and errors

Measures what the program does off the happy path.

- **1:** Only the happy path exists, and bad input crashes the program or corrupts its state.
- **2:** Some checks exist, but a listed failure case is unhandled, an error is swallowed, or several error styles are mixed.
- **3, every one of these:**
  - They validate input: unknown ids, duplicates, out-of-range values and illegal transitions.
  - A failed operation leaves the state unchanged.
  - Errors come back in one consistent style, such as an error enum, an optional or a result struct.
- **4, all of 3 plus at least two of these:**
  - They list the failure cases before coding them.
  - They state an invariant and the code keeps it, for example "a spot is never freed twice".
  - Nothing they wrote triggers undefined behaviour under the sanitizer builds.
- **Red flags:** swallowed errors; `->` on an empty `std::optional`; a reference or iterator kept after its container changed; `operator[]` on a map used for a lookup, which inserts a missing key.

## concurrency
Name: Concurrency

Score this dimension only when the interviewer asked about concurrency, or when their own code or words took it on (they wrote a lock, or explained how two callers interact at the same moment). A clarifying question about concurrency, on its own, does not count. When neither happened, leave concurrency out of the scorecard entirely, and the rules below count only the dimensions you scored.

Measures whether they find the shared state and guards it correctly.

- **1:** They claim the code is safe with no mechanism, or place locks at random.
- **2:** They guard only one path (entry but not exit, say), or cannot say which race their lock prevents.
- **3, every one of these:**
  - They name the shared mutable state and the check-then-act race.
  - Every access to that state, reads included, sits under the same `std::mutex` with a `std::lock_guard`.
  - They explain why the race exists in their own code.
- **4, all of 3 plus at least two of these:**
  - They choose the lock's scope with a reason, and never call unknown code (listeners, loggers) while holding it.
  - The design is deadlock-free by construction: one lock, or a fixed order.
  - They state the cost of their locking, and the next step (finer locks) with its own cost.
- **Red flags:** "one global lock, done" with no reasoning; holding a lock across a callback; unguarded reads of state another thread writes.

## code_quality
Name: Code quality

Measures whether another engineer could read, trust and change the code.

- **1:** The code is hard to read: meaningless names, one huge function, copy-pasted blocks, raw owning pointers.
- **2:** Parts are readable, but there are long functions, duplication, a misleading name, or a copy where a reference was meant.
- **3, every one of these:**
  - Names say what things are and do.
  - Functions are small and do one job each.
  - They stay in the safe subset: values or smart pointers, `const` where it matters, and references where the original must change.
- **4, all of 3 plus at least two of these:**
  - The code has testable seams: time is passed in, and dependencies are handed in rather than built inside.
  - The scenarios in `main()` cover boundaries and transitions, not only the happy path.
  - There is no dead code and no leftover line from a rewrite.
- **Red flags:** copy-paste; a name that says the opposite of what the code does; no running code until the very end.

## communication_time
Name: Communication and time

Measures whether they plan, narrate, and get something running in time.

- **1:** There is no plan, and nothing runs at the end.
- **2:** They over-design before the first run (the early steps eat well over half the round), go quiet for long stretches without saying what they are doing, or change code for the new requirement before restating it.
- **3, every one of these:**
  - They state their plan and move through it.
  - A thin slice runs before they fill out the remaining features.
  - Clarify, entities and behaviour together take no more than about a third of the round.
  - When the new requirement arrives, they restate it before changing code.
- **4, all of 3 plus at least two of these:**
  - Their skeleton compiles by about a third of the round.
  - They state tradeoffs as they make them.
  - They say what more time would buy.
  - They finish with time to spare for the extension and a demo.
- **Red flags:** over-designing before the first run; a long silent stretch with no visible progress.

## Hints

The interviewer records each hint with a level and a topic.
- **H1** points at an area: "Look at what happens when an operation fails halfway."
- **H2** names the concern: "If payment fails, the item has already left the stock."
- **H3** offers two options: "Would you check everything before changing state, or undo the change on failure?"

Map each hint to the dimension its topic touched, then cap that dimension:
- Any hint on it rules out a 4.
- An H2 caps it at 3.
- An H3 caps it at 2.

C++ syntax help is never a hint and never caps a score, because syntax is not the skill under test. A normal probe is not a hint either: asking why they chose something, asking them to run the program, the concurrency follow-up and the new requirement are all part of the round. A hint the interviewer clearly gave but did not record counts at the level it reads as. In a guided round, any design point the guide taught them directly counts as an H3 on that topic.

## Verdicts

Score every dimension first, then apply these rules. Never move a score to reach a verdict. "Scored dimensions" means all eight, or seven when concurrency was left out.

For each column, take the first row from the top that matches.

| Verdict | {{target_level}} | {{stretch_level}} |
|---|---|---|
| strong_hire | Every scored dimension is at 3 or more, and at least two are at 4. | Every scored dimension is at 3 or more, and at least five are at 4, including working_code, design and extensibility. |
| hire | There are no 1s, working_code, design and extensibility are all at 3 or more, and at least five scored dimensions are at 3 or more. | Every scored dimension is at 3 or more, and at least three are at 4, including design and extensibility. |
| no_hire | working_code is at 1, or design or extensibility is at 1, or two or more dimensions are at 1. | Any scored dimension is below 3. |
| lean_no_hire | Everything else. A working_code score below 3 never gets better than this. | Everything else. |

Confidence:
- **high** when the round reached the extension, the tester ran every scenario, and every score rests on direct quotes or test results.
- **medium** when one or two scores rest on thin evidence, a scenario could not be run for a reason outside their code, or the round ended a few minutes early.
- **low** when the code was never run, a core step never happened, or the round ended well before time.

A guided round is at most medium, because the help changes what the round shows.

## Gap severity

- **high:** below the {{target_level}} bar on working_code, design or extensibility, or any red flag.
- **medium:** below the {{target_level}} bar on any other scored dimension, or a {{target_level}} item from the brief's Level bar that they missed.
- **low:** the {{target_level}} bar held here, and this is the step toward {{stretch_level}}.

## Tracker mark

Give `[x]` only when every one of these holds. Otherwise give `[~]`, which means "redo it cold in a week or more", not "failed".
1. The round ran in interview mode. A guided round is always `[~]`.
2. At the end of the round their code compiled and passed the core scenarios that the brief's Level bar names, as the tester's results show.
3. Every scored dimension is at 3 or more.
4. No gap is high or medium.

When the brief's concurrency follow-up was never asked because time ran out, say so in the reason and lower the confidence one step. On its own, that does not block `[x]`.
