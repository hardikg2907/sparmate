# System design rubric

The bar is an SDE-2 or senior backend engineer at a Series A to C startup, in a 45 to 60 minute system design round. Score every dimension from 1 to 4. There are six dimensions, in this order: `navigation`, `design`, `depth`, `scale_reliability`, `communication` and `drive_time`. Each one has its own section below, headed by its id, with its display name on the line under the heading.

| Score | Label | When to give it |
|---|---|---|
| 1 | Missing | The work this dimension measures never happened, or a red flag dominates it. |
| 2 | Below bar | Some of the work happened, but at least one 3-level signal is missing. Every dimension starts here. |
| 3 | At bar | Every 3-level signal shows in the evidence, or all but one shows and the rest is clear and strong. This is an SDE-2 hire on this dimension. |
| 4 | Senior signal | Every 3-level signal shows, plus at least two 4-level signals, and they got no hint on this dimension. |

A real hiring panel weighs the evidence as a whole, not item by item. So one missing 3-level signal does not hold a dimension at 2 when every other 3-level signal shows clearly. Two missing signals do. When you give a 3 with one signal missing, name that signal as a low gap so they still see it. Red flags and hint caps apply on top of this rule.

A signal that starts with "When" applies only if that situation came up in the round. If it never came up, it does not hold the score back.

A red flag caps its dimension at 2, unless they noticed and fixed it themselves during the round.

The order of their steps is not graded. They follow their own six-step plan, but judge what they produced, not whether they produced it in that order.

## Outside the bar

Never require these, and never reward them:
- Deriving Paxos or Raft. Knowing what problem consensus solves, and that etcd or ZooKeeper solve it for you, is enough.
- Novel algorithms or research-grade distributed systems.
- Organisation-level strategy, such as migration roadmaps or team topologies.
- Memorised internals of one vendor's product.
- An exhaustive requirements list. About three core features and three to five quality targets meet the bar. Extra requirements earn credit only when they change the design.
- Precise arithmetic. Rounded, order-of-magnitude numbers are the norm in a real round.

A product name earns nothing without the reason behind it. "I know that area less well", followed by reasoning from what they do know, is a plus and never a gap.

## navigation
Name: Problem navigation

Measures whether they find the real problem before solving it: the requirements, the scope and the numbers that shape the design.

- **1:** They start designing with no questions, or never state what the system must do.
- **2:** They ask some questions but miss a requirement that shapes the design (a traffic ratio, a latency target, a freshness or consistency rule), assume features nobody asked for, or do math that never changes a decision.
- **3, every one of these:**
  - They ask targeted functional and non-functional questions, and confirm the scope before designing.
  - They write down the core features and the quality targets, each non-functional one with a number or a rule.
  - They state their assumptions out loud.
  - When the scale shapes the design, they do rough capacity math without being asked, and the numbers that drive a decision end in that decision. Order of magnitude is enough, and a number that drives nothing needs no consequence.
- **4, all of 3 plus at least two of these:**
  - They name early what makes this particular system hard.
  - They state non-goals explicitly.
  - They turn a vague goal into a numeric target the interviewer did not give them.
  - They use the math to rule a design option in or out.
- **Red flags:** the scope is never confirmed; math with no effect on the design; a requirement that contradicts a fact the interviewer gave.

## design
Name: Solution design

Measures whether they produce a working design that meets the requirements, with an API and a data model.

- **1:** There is no coherent design: boxes with no flow, or one box called "backend".
- **2:** A design exists but has a hole: no API or no data model, a request that cannot be traced end to end, a component with no reason to exist, or a functional requirement the design does not meet.
- **3, every one of these:**
  - An API that covers the core operations, with inputs, outputs and the main errors.
  - The core entities with their keys, and where each one is stored.
  - One request walked through every box, including the miss or failure path.
  - Every component has a stated reason, and the design meets the functional requirements.
- **4, all of 3 plus at least two of these:**
  - They choose storage from the access pattern and say why.
  - They handle ordering, duplicates or idempotency wherever the problem has them.
  - They keep the design as simple as the targets allow, and remove a component they do not need.
  - They spot a consistency edge in their own design, such as reading your own write through a lagging replica, without a prompt.
- **Red flags:** one giant backend box; durability waved away; many services before the core path works; a design copied from a known system that does not fit these requirements.

## depth
Name: Technical depth

Measures whether they know how the pieces they chose actually work, and decide between options with a reason.

- **1:** They name tools and cannot say anything about how they work when asked.
- **2:** They list options without deciding, decide with a slogan such as "NoSQL scales", or go vague one level down.
- **3, every one of these:**
  - They go deep in one or two areas when asked, explaining the mechanism (the data structure, the protocol, the order of steps), not just the name.
  - They decide between options with a reason tied to this problem's numbers or access pattern.
  - When they say "it depends", they attach the decision rule.
  - When they do not know something, they say so plainly and reason from what they do know.
- **4, all of 3 plus at least two of these:**
  - They pick a deep dive themselves, and it is the one that matters most.
  - They credit the option they rejected, and name what it would have bought.
  - They bring operational specifics: what happens on a deploy, a dying node, a page at three in the morning.
  - They name the debt they are accepting and when they would pay it down.
- **Red flags:** brand-dropping; refusing to change a decision when the interviewer changes a fact; a confident but wrong mechanism, which is bluffing.

## scale_reliability
Name: Scale and reliability

Measures whether they find where the design breaks under load or failure, and fix it with numbers.

- **1:** They ignore load and failure entirely, or answer every scale question with "add more servers".
- **2:** They find the bottleneck only after a heavy nudge, fix it without numbers, or leave an obvious single point of failure in place.
- **3, every one of these:**
  - When asked where the design breaks first, they name the first bottleneck and the number behind it.
  - They fix it with a concrete mechanism and rough numbers, such as how many nodes or what hit ratio.
  - They handle a node dying, including what happens to work in flight: retries, duplicates, timeouts.
  - When the curveball is about load or failure, they answer it with a change that fits their existing design.
- **4, all of 3 plus at least two of these:**
  - They raise failure paths and the first bottleneck before being asked.
  - They spot a hot key or hot partition, and explain why more shards do not help it.
  - They plan graceful degradation: what still works while a dependency is down.
  - They size the blast radius before choosing a fix.
- **Red flags:** "highly available" with no mechanism; failover with no thought for the data it loses; a slow dependency treated as if it were simply down.

## communication
Name: Communication

Measures whether the interviewer can follow their thinking and work with them.

- **1:** The interviewer cannot follow the design from what they wrote, or they bluff repeatedly.
- **2:** They write long passages with no structure, argue without weighing the interviewer's point, skip questions, or make poor use of hints.
- **3, every one of these:**
  - They walk through the design in an order a listener can follow.
  - They think out loud at decision points, saying what they are weighing.
  - They answer the question that was asked, both halves of a two-part question.
  - When they get a hint, they use it and move forward.
- **4, all of 3 plus at least two of these:**
  - They signpost, for example "I'll do the data model, then the write path".
  - They check in with the interviewer at real decision points.
  - When a constraint changes, they say quickly what changes and what stays.
- **Red flags:** bluffing; ignoring a direct question; talking past the question that was asked.

## drive_time
Name: Driving and time

Measures whether they lead the round and finish a complete design inside the time.

- **1:** They wait to be led throughout, or have no complete design when time runs out.
- **2:** The interviewer has to move them between phases, or one phase eats the round (for example twenty minutes on requirements), so the design ends incomplete or rushed.
- **3, every one of these:**
  - They lead the early phases themselves (requirements, math, API, first design) without being told to move on.
  - They have a complete first design by about the middle of the round.
  - They keep each phase near its plan, or notice an overrun and recover.
  - They leave time for the deep dives and the curveball.
- **4, all of 3 plus at least two of these:**
  - They set the agenda for the deep dives, offering two or three and saying why each matters.
  - They find the limits of their own design before the interviewer does.
  - They manage time out loud, for example "I'll give this five minutes, then move on".
- **Red flags:** thirty minutes on one component; nothing on the board at the halfway point.

## Hints

The interviewer records each hint with a level and a topic.
- **H1** points at an area: "What happens if this node fails?"
- **H2** names the concern: "Many requests could miss the cache for the same key at once."
- **H3** offers two options: "Would you coalesce those misses, or warm the key ahead of time?"

Map each hint to the dimension its topic touched, then cap that dimension:
- Any hint on it rules out a 4.
- An H2 caps it at 3.
- An H3 caps it at 2.

A normal probe is not a hint. Asking them to go deeper on something they raised, asking where the design breaks first, and delivering the curveball are all part of the round. A hint the interviewer clearly gave but did not record counts at the level it reads as. In a guided round, anything the guide taught them directly counts as an H3 on that topic.

## Verdicts

Score every dimension first, then apply these rules. Never move a score to reach a verdict.

For each column, take the first row from the top that matches.

| Verdict | SDE-2 | Senior |
|---|---|---|
| strong_hire | Every dimension is at 3 or more, and at least two are at 4. | Every dimension is at 3 or more, and at least five are at 4. |
| hire | There are no 1s, navigation and design are both at 3 or more, and at least four of the six dimensions are at 3 or more. | Every dimension is at 3 or more, and at least three are at 4, including depth and scale_reliability. |
| no_hire | Navigation or design is at 1, or two or more dimensions are at 1, or fewer than three dimensions are at 3 or more. | Any dimension is below 3. |
| lean_no_hire | Everything else. | Everything else. |

Confidence:
- **high** when the round reached the curveball and every score rests on direct quotes.
- **medium** when one or two scores rest on thin evidence, or the round ended a few minutes early.
- **low** when a core phase never happened, or the round ended well before time.

A guided round is at most medium, because the help changes what the round shows.

## Gap severity

- **high:** below the SDE-2 bar on navigation or design, or any red flag.
- **medium:** below the SDE-2 bar on any other dimension, or an SDE-2 item from the brief's Level bar that they missed.
- **low:** the SDE-2 bar held here, and this is the step toward senior.

## Tracker mark

Give `[x]` only when every one of these holds. Otherwise give `[~]`, which means "redo it cold in a week or more", not "failed".
1. The round ran in interview mode. A guided round is always `[~]`.
2. They finished inside the time. Before the round ended they had the requirements, an API, a design that meets the functional requirements and at least one deep dive, and they answered the curveball. Ending early counts when all of that was done.
3. Every dimension is at 3 or more.
4. No gap is high or medium.

A Level bar item that the round never reached because the interviewer chose another path, such as a curveball that was never given, is not a gap. Name it in the reason, and lower the confidence one step.
