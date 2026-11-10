# Sparmate — UI and UX revamp

This brief explains what the revamp changes and why. It covers the user, a review of the current UI, the visual
direction, the flows, and the changes per screen. The last sections list the labels that stay frozen, the new
dependencies, and what needs a server change.

The revamp touches only `src/web/**`, with one exception: the default theme is dark, and the server's default
settings (`src/shared/types.ts`) say so. The WebSocket protocol and the rest of `src/shared/*` stay as they are, so the
two versions can run side by side and the UI can be merged back later.

---

## 1. The user and his jobs

He is one backend developer with about 1.5 years of experience. He trains for SDE-2 and senior backend rounds at
startups. He practises system design rounds (45 minutes, whiteboard) and C++ machine-coding rounds (90 to 120
minutes, editor). He often practises **after a full work day, tired**.

His own notes show where rounds go wrong. The design should help with these first:

| What trips him up | Evidence from his notes | What the UI can do |
|---|---|---|
| **Time against plan** | Parking lot: clarify, entities and behaviour took about 70 minutes against a plan of 25. Nothing ran inside the time. | Show the plan and where he is on it, all the time, in a form he reads in one glance. |
| **Driving the round** | The bar asks him to state structure and move phases himself. | Show what the current phase must produce, in his own words, next to the work. |
| **Structure of the answer** | Rate limiter: missed identity, the 429 response and the latency budget in requirements. | Keep his five-step and seven-step methods visible, with each step's goal. |
| **Closing the loop** | Gaps must be taught and written to the tracker, or they come back. | Make "teach the gaps, then save the notes" an explicit, visible sequence after the score. |

### Jobs per screen

| Screen | His job | What "done" looks like |
|---|---|---|
| Today | "Tell me what to do today and let me start it without thinking." | One obvious session from his weekly plan, and a paused round he can finish or throw away. |
| Practice | "Let me choose what to practise next." | Rounds: a list to scan, a detail panel, one Start button. Drills: the next drill and the others due. |
| Progress | "Show me my weakest skill and what to do about it." | One focus skill with one chart and one action, skills over time, the next redos. |
| History | "Let me find an old round, open its debrief or delete it." | A calm table of every round, unfinished ones marked. |
| Settings | "Let me set the plan and the tools once." | Sections with one Save button. |
| Start | "Get me ready for the round." | He reads the plan in the plan panel, picks a mode, and starts with one button. |
| Room | "Let me work, keep me honest about time, and let me talk to the interviewer." | Work area as large as possible, time plan always readable, chat always ready. |
| Pause | "Stop the clock, and make it obvious how to carry on." | Work hidden, one large Resume button, the reason for the pause stated. |
| Debrief | "Tell me straight how it went, then fix my gaps." | The call, the scores and one next step in one screen, gaps next, evidence on demand in tabs. |
| Coach | "Teach me the gap now, in plain words." | The coach chat sits beside the gaps, and each gap starts a lesson with one click. |
| Study notes | "Write the right things to my files, and only what I approve." | Every change shown as a diff with a tick box, and a clear Save. |
| History | "Find an old round, or clean up a dead one." | Status, result and the right action on each row. |
| Settings | "Change the model, the round length or the theme." | A short form, saved with one button. |

---

## 2. Review of the current UI

The current UI is **competent and calm**. It is keyboard-accessible, it has visible focus, it meets contrast AA,
and the room keeps Excalidraw and Monaco mounted so tabs switch instantly. The problems below are about
**guidance and hierarchy**, not about broken things.

I reviewed the code in the main checkout and screenshots of the fixture pages. The server on port 4747 serves an
older build than the code: its room has no Pause button in interview mode, and its user pause shows a red Retry
banner.

Ranked by how much each problem costs him in a real round. Each row names the Nielsen heuristic it breaks.

| # | Problem | Where | Heuristic | Why it matters |
|---|---|---|---|---|
| 1 | **The phase rail hides the plan.** Every phase box has the same width, whether it is 3 minutes or 15. Nothing says "you are 4 minutes behind plan". The only overrun signal is a small amber "(over)" inside one box. | Room header | Visibility of system status | Time against plan is his main failure. He needs to see it without reading. |
| 2 | **The goal of each phase is hidden in a tooltip.** "Boxes and arrows, then walk one request through every box" exists in the code, but only as a `title` attribute. | Phase rail | Recognition over recall | When tired, he forgets what a phase must produce. The goal is the best prompt the app owns. |
| 3 | **A paused round is buried.** A paused or live round shows only as a text link in the last section of the home page. | Home, history | Visibility of system status, user control | Resume or discard is often the first thing to do after a break. It should be the first thing on the page. |
| 4 | **Too many equal buttons on home.** Twelve rows with two buttons each, plus two cards with two buttons each: 28 start buttons with almost the same weight. One click starts a model call and a clock with no confirm. | Home | Aesthetic and minimalist design, error prevention | The next action is not singular. A wrong click starts a round he then has to discard. |
| 5 | **The debrief puts the gaps below a long table.** Reading order is verdict, then six dimensions with every quote, then strengths, then gaps. The coach opens on the top gap, but "Teach me this" is two screens down. | Debrief | Match with the real world, flexibility | The action he needs after the score is "work the gaps". It is far from the score. |
| 6 | **Nothing says the debrief is not finished.** The flow is score, then coach, then study notes. Study notes are the last section of a long page, and nothing shows progress through those three steps. | Debrief | Visibility of system status | Unsaved notes mean the tracker never learns about the gap. |
| 7 | **The interviewer's view of the board has no warning count.** The graph already reports unlabelled boxes and dangling arrows, but the button gives no sign until he opens it. | Room toolbar | Error prevention | Research notes list "opaque diagram reading" as a top complaint. A dangling arrow costs him a point he earned. |
| 8 | **Pause leaves the work open.** The board and editor stay usable while the clock is stopped. Only a thin banner shows the pause. | Room | Consistency with the real world | A pause that allows work breaks the timed practice. And a thin banner is easy to miss when he comes back. |
| 9 | **Pause, End interview and the timer have the same weight.** End interview is irreversible but looks like the other outlined buttons. | Room header | Error prevention | Big, final actions should look final. |
| 10 | **The new requirement looks like any other message.** The extension is the most important moment of the round, and it only gets a small chip. | Room chat | Visibility of system status | He must notice the extension at once and restate it before he codes. |
| 11 | **Flat hierarchy.** Blocks that differ in importance look alike: one bordered, rounded card style, one weight of section heading, uppercase tracked labels, meta strings joined with middle dots. | All screens | Aesthetic and minimalist design | Uniform cards flatten the hierarchy. Uppercase labels are harder to read for tired eyes. The design answers this with layered surfaces (section 3). |
| 12 | **Chrome eats the work area.** The room uses about 162 px of the 900 px height for the title row, the rail boxes and the work toolbar. | Room | Flexibility and efficiency | The whiteboard is the main tool. Every row of chrome is a row of board he loses. |

---

## 3. Design direction

### The idea: "the clock is the only loud thing"

The room is an exam desk late at night. Everything is quiet ink on paper, except one object: **the plan track**,
the round's time plan drawn to scale with a needle for "now". It is the memorable element of the product, and it
appears in three places with the same drawing: the start screen (the plan), the room (the plan and now), and the
debrief (the plan against what happened).

**The app opens in dark.** A new visitor, with no saved choice, gets the dark theme. The default is set in four
places that must agree: `DEFAULT_SETTINGS.theme` (server and its mirror in `src/web/lib/contract.ts`), the first-paint
script `public/theme-boot.js` (it adds the `dark` class unless the saved choice is `light`), `storedTheme() ?? "dark"`
in `main.tsx`, and the fallback in `App.tsx`. A saved choice always wins, and the light theme stays one setting away
in Settings. Fixture pages open dark too; `?theme=light` shows the light one. Every token below has both sets, and the
dark set is the one designed first.

Everything else stays disciplined, and the reading pages (home, debrief, usage) separate their parts by **surface
level, not by outline**. The page canvas is sunken and lit by soft light from three corners: brand indigo at the
top left, violet at the top right and a cool teal at the bottom. In dark it is a near-black plum (`#0c0a17`). Content
sits on it in raised panels that are lit from above. The thing to do next gets a **mesh panel**: the recommended round on
home and the NEXT card on the debrief. Practice and Progress carry no mesh panel: their focus and detail panels are raised. Three tones blend as layered radial gradients, not as stripes: a
near-black corner at the top right, a bright saturated tone through the middle (brand indigo, with violet at the left)
and a pale lilac glow that rises from the bottom. White text sits only on the dark and bright tones. Whatever sits
over the glow (the score cells, the plan) sits on a dark glass tile, so white keeps its contrast. The usage page keeps
the older deep panel for its cost and chart. A hairline card is for repeated rows and for secondary blocks only. A text link inside a mesh panel (`.mesh-link`) sits on the same dark glass tile as a pill, because it usually lands on the glow.

Controls stay flat and quiet. A primary button is a plain brand fill with a 1 px lighter edge along the top and one
small shadow, and it moves 1 px when pressed. Only the
recommended round's title uses the bold rounded face.

### Type

One family, in two cuts: **Atkinson Hyperlegible Next** for the interface and **Atkinson Hyperlegible Mono** for
code, the clock and the board's text form. The Braille Institute designed the family for legibility. Its letters
are hard to confuse (`I`, `l`, `1`; `O`, `0`; `rn`, `m`). That matters for a tired reader who checks quoted
evidence, C++ code and compiler errors. Using one family for both UI and code makes the room feel like one tool.

The scale is a minor third (1.2) on a 15 px base, because chat and debrief text are read in long runs.

| Token | Size / line height | Weight | Use |
|---|---|---|---|
| `text-meta` | 12 / 16 | 500 | Times next to messages, file paths, small counts |
| `text-ui` | 13 / 18 | 500 | Buttons, tabs, labels, table cells |
| `text-body` | 15 / 24 | 400 | Chat, debrief prose, gap text |
| `text-lead` | 18 / 26 | 600 | Card titles, section headings |
| `text-title` | 22 / 28 | 650 | Page titles |
| `text-display` | 32 / 36 | 700 | The room clock, page titles on usage, the round title on a phone |
| `text-mega` | 48 / 52 | 700 | The recommended round title, the progress counts, the total cost |

`font-display` is for the big heading in the mesh panel: the recommended round's title. It is `ui-rounded` (the system's rounded face, no download, so the CSP is unchanged) and falls
back to Atkinson at weight 800.

`text-title`, `text-display` and `text-mega` carry a letter spacing of -0.02em; the smaller sizes keep the font's own spacing. A few headings on pages set a value of their own (-0.01em to -0.03em). Labels are sentence case. There are no uppercase tracked labels. Prose lines stay under about 70 characters.

### Colour tokens

The accent is **marker ink**: the blue-violet of a whiteboard pen. It marks the primary action, the current
phase and links. Beyond those it appears only as light: the brand tile, the header hairline, the start of each
section rule and the canvas glow. Status colours carry meaning only: good for "at the bar" and "passed", warn
for "behind plan" and "below the bar", bad for "out of time", "failed" and "missing".

The dark theme is a deep slate, not black, so the Excalidraw canvas and the chat panel stay distinct.

The tokens use the shadcn/ui names, so copied components read them as intended. Status colours and the soft
accent are extensions of that set.

| Token | Light | Dark | Use |
|---|---|---|---|
| `--background` | `#f3f4f6` | `#100d1c` | Page background, behind the board |
| `--card` | `#ffffff` | `#1b1e25` | Chat panel, top bar, cards, dialogs |
| `--popover` | `#ffffff` | `#20232b` | Menus, select lists, popovers |
| `--muted` / `--secondary` | `#eceef2` | `#242832` | Inputs, code blocks, track rails, quiet buttons |
| `--sunken` | `#e8ebf1` | `#0c0a17` | Canvas of the reading pages, group fills inside dialogs, the footer of a dialog |
| `--raised` | `#ffffff` | `#211e33` | Raised panels: the progress panel, the problem list, the verdict, tables |
| `--hero` | `#1f2780` | `#2a3380` | Fallback fill of the usage page's deep panel |
| `--hero-gradient` | `#1b2273` → `#2a309f` → `#4630a8` | `#20276a` → `#2e3690` → `#45339a` | The usage page's deep panel, at 125° |
| `--hero-glow` | `#3a2c9c` at 38% | `#6e64ff` at 32% | The large soft glow under the deep panel |
| `--mesh-base` | `#2b2170` | `#1d1650` | Base fill under the mesh layers |
| `--mesh-corner` | `#1a1030` | `#05030c` | The near-black corner, top right |
| `--mesh-violet` | `#7e4bb8` | `#7a5ad8` | The violet at the left middle |
| `--mesh-brand` | `#3443c0` | `#3443c0` | The bright tone through the centre |
| `--mesh-glow-edge` / `-body` | `#ece8ff` / `#a99bf0`, both at 70% | `#b9adff` / `#6f63d8`, both at 70% | The pale glow that rises from the bottom edge |
| `--mesh-ring` | `#3443c0` at 28% | `#8e9cff` at 18% | The 1 px ring around the panel |
| `--mesh-shadow` | `0 15px 38px -14px` violet at 28% | `0 15px 40px -14px` violet at 30% | The soft glow shadow under the panel |
| `--mesh-tile` / `--mesh-tile-ring` | `#1a1030` at 82% / `#ece8ff` at 20% | `#0c0828` at 80% / `#b9adff` at 22% | The dark glass tile over the glow |
| `--btn-primary` / `-hover` / `-foreground` | `#3443c0` / `#4150d2` / `#ffffff` | `#4c58d8` / `#5a66e6` / `#ffffff` | The primary button's fill |
| `--btn-secondary-bg` / `-hover` / `-fg` / `-ring` | `#f3f4f8` / `#e8ebf1` / `#181b22` / `#c5cad4` | `#221c45` / `#2c2558` / `#cfc7ff` / `#352c66` | The secondary button; the ring is its 1 px border |
| `--amber` / `-foreground` | `#f6c96a` / `#3d2900` | `#f6c96a` / `#3d2900` | The one warm accent: the recommended-round pill. Never a status colour |
| `--hero-foreground` / `--hero-muted` | `#ffffff` / `#cdd2ff` | `#f2f3ff` / `#c3c9ff` | Text and secondary text on the deep panel |
| `--hero-accent` / foreground | `#ffffff` / `#1f2780` | `#8e9cff` / `#0e1230` | The chart bars on the usage page's deep panel |
| `--bar-top` / `--bar-bottom` | `#ffffff` / `#b9b2ff` | `#b3bcff` / `#7c6cf0` | The daily cost bars and the first plan segment |
| `--glow-1` / `-2` / `-3` | `#dbe1ff` / `#ecdffe` / `#d6eff3`, each at 70% | indigo 15.4%, violet 10.5%, teal 6.3% | The canvas light, each a large radial gradient that fades out |
| `--primary-top` / `--primary-bottom` | `#4353cf` / `#2d3aae` | `#a9b3ff` / `#7f8df6` | Accent gradients such as the room's pins |
| `--brand-top` / `--brand-bottom` | `#5664dc` / `#2f3db0` | `#a9b3ff` / `#7f8df6` | The logo tile |
| `--brand-violet` / `--brand-teal` | `#7c4ddb` / `#0e8fa0` | `#c08ae6` / `#4cc3d1` | The second and third stops of the room's gradient edges, fills and rings |
| `--step-current-top` / `-bottom` | `#f3f4ff` / `#e1e5fb` | `#2f3667` / `#252b52` | The lit fill of the current step in the step bar |
| `--bubble-top` / `--bubble-bottom` | `#eff1fe` / `#dfe3fa` | `#2d3462` / `#242a50` | His chat bubbles, at 165° |
| `--edge-top` / `--edge-bottom` | ink at 5% / 13% | white at 13% / 4% | The hairline of a raised panel, lighter at the top |
| `--highlight` | white at 90% | white at 7% | The 1 px inner line at the top of panels, pills and buttons |
| `--band-good` / `-warn` / `-bad` | `#d3eedd` → `#eef8f2`, `#f8e5bb` → `#fdf6e4`, `#f8dad6` → `#fdf1ef` | `#1b3d28` → `#13241a`, `#44330f` → `#2a200c`, `#4a221f` → `#2c1614` | The verdict band, with the status fill at 10% as light from its left edge |
| `--border-strong` | `#c5cad4` | `#424857` | Rules under section headings, dividers between steps |
| `--accent` | `#e3e6ec` | `#2b303b` | Hover fill, and the fill of a quiet (secondary) button |
| `--border` | `#dcdfe5` | `#2e333e` | Hairlines between areas |
| `--input` | `#78808f` | `#6f7889` | Input borders, control outlines (3:1 or more, also on `--sunken`) |
| `--foreground` | `#181b22` | `#e8eaf0` | Main text |
| `--muted-foreground` | `#485060` | `#b1b8c6` | Secondary text |
| `--faint` | `#5d6575` | `#959eae` | Tertiary text, still AA |
| `--primary` | `#3443c0` | `#8e9cff` | Primary buttons, current phase, needle |
| `--primary-foreground` | `#ffffff` | `#0e1230` | Text on the primary colour |
| `--primary-text` | `#2f3db0` | `#a3afff` | Links, accent text on panels |
| `--primary-soft` / foreground | `#e8eafb` / `#28349a` | `#262c52` / `#c9d0ff` | Selected rows, the candidate's chat bubbles |
| `--success` / soft / fill | `#12663a` / `#e1f2e8` / `#1a7b46` | `#6fd69c` / `#16301f` / `#3fae6f` | At the bar, passed, saved |
| `--warning` / soft / fill | `#7a4a00` / `#fbefd6` / `#b06f06` | `#f2b755` / `#372a10` / `#d99a2b` | Behind plan, below the bar, paused |
| `--destructive` / soft / fill | `#a3221a` / `#fbe7e5` / `#c0392b` | `#ff9a91` / `#3b1c1a` / `#e5655a` | Out of time, failed, missing |
| `--ring` | `#3443c0` | `#a3afff` | Focus outline |
| `--chart-1` to `--chart-5` | | | Usage charts |

Inside a mesh panel (`.on-mesh`) every text and status token takes its dark-theme value in either theme, because the
panel is dark in both: white text, lilac secondary text, and the bright status colours (the warning text is a lighter amber, `#fad38e`, so it keeps AA on the glow). A `Badge` or a score on a tile
therefore reads the same in light and in dark.

The plain status token is the text and icon colour; `-soft` is the tinted fill it sits on; `-fill` is a solid bar,
dot or button. Excalidraw's toolbar and menus and the Monaco editor take their colours from these tokens, so both
sit in the room in either theme.

Measured contrast (WCAG 2.2): main text 15.7:1 (light) and 15.1:1 (dark). The faintest text is 5.3:1 and 6.2:1.
Every status text on its soft fill is above 6:1. Control outlines are 3.4:1 and 3.8:1. On `--sunken`, main text is
14.4:1 and 15.7:1, secondary text 6.8:1 and 9.5:1, the faintest text 4.9:1 and 7.0:1, and control outlines
3.3:1 and 4.3:1. Everything meets AA, and most text meets AAA.

Text on a gradient is measured against its darkest and its lightest point:

Text over the mesh panels was measured on rendered pixels: the text was hidden, the background under each word was
read, and the worst point was compared with the text colour. On the home hero the lowest value is 4.8:1 in dark and
5.1:1 in light, at 1440 and at 375 px, for every word and every enabled button. On the DSA hero it is 5.0:1 and
5.6:1. Disabled buttons are exempt.

| Where | Light | Dark |
|---|---|---|
| Home hero, lowest text over the mesh and its tiles (measured) | 5.1 | 4.8 |
| DSA hero, lowest text over the mesh and its tiles (measured) | 5.6 | 5.0 |
| Home hero title, body text, warning line (measured, lowest of 1440 and 375 px) | 6.5, 5.5, 5.1 | 5.7, 4.8, 7.1 |
| Home hero link "Pick another problem" on its dark tile (measured, lowest) | 12.3 | 14.3 |
| White on the bright violet, at its brightest | 5.9 | 4.9 |
| White on the primary button, rest and hover | 7.7, 6.4 | 5.7, 4.7 |
| Secondary button label, rest and hover | 15.7, 14.4 | 10.0, 8.8 |
| Amber badge label | 8.9 | 8.9 |
| Canvas at the brightest glow: main, secondary, faintest text | 13.3, 6.3, 4.5 | 11.8, 7.1, 5.2 |
| Usage deep panel, darkest stop: text, secondary text | 13.8, 9.4 | 12.2, 8.4 |
| Usage deep panel, lightest stop: text, secondary text | 9.3, 6.3 | 8.7, 6.0 |
| Pills at the shaded top edge | 5.2 to 7.3 | 6.1 to 7.0 |
| Large counts, both ends of their gradient | 17.2, 8.7 | 11.8, 6.8 |
| Room glass header over the canvas light: main, secondary text | 16.4, 7.7 | 13.5, 8.1 |
| Room work toolbar over the canvas light: secondary, faintest text | 7.3, 5.3 | 7.9, 5.8 |
| Current step label and time, top and bottom of its fill | 9.4, 8.2 | 7.6, 9.0 |
| Faintest text on a step chip | 5.7 | 5.2 |
| His chat bubble text, top and bottom of its gradient | 9.1, 8.1 | 7.8, 9.2 |
| Room clock digits in their well, both ends of their gradient | 15.2, 7.7 | 15.2, 8.8 |
| Guide's pin number, top and bottom of its gradient | 6.2, 9.0 | 9.2, 6.1 |
| Held pin number on its fill, card to soft end | 7.0, 6.1 | 9.4, 8.0 |
| Gap pin number on its fill, card to soft end | 7.5, 6.3 | 8.2, 7.5 |

### Verdict words

The scorecard stores four verdicts (`strong_hire`, `hire`, `lean_no_hire`, `no_hire`), and the judge keeps those terms.
The screen never shows them. Every place that shows a verdict reads its words from `src/web/lib/verdict.ts`: the
debrief header and its step status, the home page's last-attempt badges and the history list.

| Stored value | Label | One-line meaning, shown on the debrief header |
|---|---|---|
| `strong_hire` | Strong pass | An interviewer would pass this round with confidence, and you showed more than the bar asks. |
| `hire` | Pass | An interviewer would likely pass this round. You met the bar. |
| `lean_no_hire` | Close, not yet | An interviewer would likely not pass this round, but one or two fixes would change that. |
| `no_hire` | Not yet | An interviewer would not pass this round. Several parts fell below the bar. |

The senior bar uses the same labels. Tones are unchanged: good for both passes, warn for "Close, not yet", bad for "Not yet".

### Space, shape and density

- A 4 px grid. Gaps of 4, 8, 12, 16, 24, 32 and 48 px.
- Radius follows hierarchy: 8 px for controls, 10 px for hairline cards, 14 px for raised panels, the usage page's
  deep panel and dialogs, 24 px for the mesh panels, full round only for status pills.
- **Two densities.** The room is dense, like an IDE: 13 px controls, 40 to 48 px bars. Home and the debrief are
  for reading: 15 px text, 24 px line height, wide margins, a 720 px reading column.
- Four surfaces, set by the `variant` of the card. `flat` is a hairline card with a faint shadow and an inner top
  highlight. `raised` has a hairline that is lighter at the top than at the bottom, an inner top highlight and a
  fill that darkens a little toward the bottom. It has no
  heavy edge and a medium shadow (`--elev-md`). `sunken` is a fill with no edge, for a group inside another
  surface. `mesh` is the three-tone panel described above, with the 1 px ring and the violet glow shadow. `hero` is the usage page's deep panel: its gradient, a 1 px inner highlight at the top, `--elev-lg` and a large soft
  glow in `--hero-glow` under it. Interactive cards rise 2 px on hover, their shadow grows and their edge takes a
  little of the brand ink; rows inside a divided list rise 1 px. Menus, popovers and dialogs float on the deepest
  shadow with an inner top highlight, and a dialog's fill is lit a little from the top.
- Pills are tinted glass: their own text colour shades the top edge at 10% and draws a 14% rim.
- Buttons. Primary is flat: `--btn-primary` with a 1 px lighter line along the top and one small shadow, no gradient and
  no glow. Hover moves the fill to `--btn-primary-hover`. Secondary is a quiet fill (`--btn-secondary-*`) with a 1 px
  border. Outline keeps its hairline; on hover its edge takes the brand ink. Every button moves down 1 px while it is
  pressed, except under reduced motion. A focused button shows the focus outline with a soft glow around it. The
  recommended-round panel uses the same primary and secondary buttons as the rest of the app.
- Section headings are 22 px bold on a 2 px rule that starts in the brand ink and fades through `--border-strong`
  to nothing on the right, so the page reads as chapters. The large counts use the 48 px `text-mega` size; on a phone the round title falls
  back to the 32 px display size.
- The shell header is sticky and flat while the page is at the top. Once content scrolls under it, the card colour at 80%
  over a 24 px blur and a 1 px bottom border fade in (150 ms, opacity only). The brand mark sits on a tile filled with a
  gradient from `--brand-top` to `--brand-bottom`. In test mode a full-width amber strip under the bar says "Test mode:
  the model is faked". On a phone a bottom tab bar (Today, Practice, Progress, Jump) takes the tabs, with the same glass.

### Motion

- **The page arrives in one sequence.** On home, debrief and usage the sections fade in and rise 10 px, 400 ms
  each, in 50 ms steps from the top. Rows in a list follow the same rule inside their section, capped at ten
  steps so a long list never makes the last row wait. Then meters fill: progress pips, score meters and the cache
  meter grow from their left edge in 500 ms, in 45 ms steps; the daily cost bars grow from the bottom in 550 ms,
  in 18 ms steps. The large numbers count up once from zero in 700 to 1100 ms with an ease-out: the progress
  counts and the total cost; the debrief has no count-up. A later change to a number shows the new value at once.
- **A drill result** answers the submit: the outcome title settles in on "Interview-ready" (scale 1.06 to 1, 200 ms),
  and on "Getting there" or "Needs work" the "What to improve" card slides in 8 px (200 ms). Both wait for the page's own
  sequence to arrive.
- **The week strip's tick** fills from the bottom in 300 ms when today's round finishes. Earlier days show their tick at once.
- **The plan needle** moves with the clock. When the phase changes, the current segment's fill slides to the next
  segment in 200 ms.
- **The pace chip** glows once, with one soft ring that grows and fades over 1.1 s, when the round first turns behind
  plan. It does not repeat. **Hold to end** fills the End interview button over 1.2 s while the pointer is down,
  and eases back in 280 ms on an early release.
- **Motion that answers an action**: buttons ease colour and shadow in 150 ms and move down 1 px while pressed; cards rise on
  hover in 180 ms; dialogs fade and scale in from 95% with a 260 ms ease-out over a blurred, dimmed page, and fade
  out in 150 ms; menus, select lists, popovers and tooltips grow from their trigger; toasts slide in at the bottom
  left.
- **The jump palette** (⌘K, or Ctrl+K) opens with a fade and a scale from 98% in 140 ms and closes in 100 ms. Under
  reduced motion it only fades. On a phone it rises from the bottom as a sheet.
- **Route changes cross-fade** with the View Transitions API: the old page fades out in 160 ms, the new one fades
  in over 260 ms. Browsers without the API swap pages at once. The room only fades in when it opens, because the
  board measures its position when it mounts.
- Loading states are skeletons in the shape of the content, so nothing jumps when the data arrives.
- **The room is a work surface, so nothing in it moves on its own** except the needle, the typing dots and the
  spinner. Movement there only answers his own actions or the round's progress: a plan segment lights on hover; a palette row lights and its swatch grows a little on hover; a step's progress fill grows by scale
  in 300 ms; a coverage ring redraws in 240 ms after a check; a new message rises in over 200 ms; a pin pops in from
  half size in 180 ms when it appears, and its note fades and scales in over 150 ms.
- **The debrief's step rings** start empty and fill once, in 900 ms, when each scrolls into view.
- Only `transform`, `opacity` and `filter` animate, except the ring and the needle. Enter animations fill backwards
  only, so they leave no transform behind and fixed and sticky elements keep working. The glass blur sits only on
  the header bars, the dialog backdrop and the pause cover, never on a scrolling list. The pause cover blurs the
  board only while the round is paused and the board is inert.
- Nothing moves on its own except the needle, the typing dots, the spinner and the skeleton shimmer. The mesh
  gradient is still.
- With `prefers-reduced-motion`, nothing moves: no entrance, no fill, no count-up, no hover lift, no button
  movement, no pace-chip ring and no view transition. The hold-to-end fill steps in four jumps instead of gliding. Every number shows its final value at once and the needle jumps once a second. The gradients stay. Scripted test runs (`?testhooks=1`) also show final numbers at once.

### Components

The primitives live in `src/web/components/ui/` and follow shadcn/ui: Radix-based dialog, alert dialog, dropdown
menu, select, tabs, tooltip, popover, scroll area, switch, checkbox and collapsible, plus button, badge, card,
alert, banner, empty state, skeleton, separator, input, textarea, keycap and a segmented control. Cards take a `variant` (`flat`, `raised`, `sunken`, `hero`, `mesh`). The `useCountUp` hook runs the count-up of large numbers. Toasts come from
Sonner. The Escape that closes a layer never reaches the room's "stop speaking" shortcut. Pressing `?` outside a
text field, the board or the editor lists every keyboard shortcut. ⌘K (Ctrl+K elsewhere) opens the jump palette on every
page that has the main bar.

---

## 4. Information architecture and flows

```
 Today ──(Start)──► Room ──(End interview / time up)──► Debrief
  │  ▲                    │ ▲                                │
  │  └── Back to home ◄───┘ │                                ├─ Gaps ──► Coach chat
  │                         │                                └─ Study notes ──► Save
  ├─ Unfinished card ──(Finish)──────────┘
  ├─ Unfinished card ──(End and debrief)──► Debrief
  ├─ Unfinished card ──(Discard)──► confirm ──► Today
  ├─ See the plan ──► plan panel ──(Start)──► Room
  ├─ Practice, Rounds row ──(Start)──► Room
  ├─ Practice, Drills ──(Start drill)──► Drill
  ├─ Progress, History row ──(Open)──► Room or Debrief
  ├─ Jump palette ──► any round, problem, page or settings section
  └─ Settings page
```

The main bar (Today, Practice, Progress, the Jump box and one Menu) shows on the reading pages. Practice holds Rounds and
Drills; Progress holds This week, Skills, DSA and History as sections. Rooms and debriefs are full screen without it.
The old addresses `/library`, `/gym`, `/dsa` and `/history` are replaced in place by `/practice`, `/practice/drills`,
`/progress#dsa` and `/progress#history`.

### Start a round

1. Today shows **one session**, chosen from the weekly plan, with the other unfinished rounds, redos, due drills and the DSA goal beside it.
2. He presses the one filled button ("Start guided round" or "Start interview round"). "See the plan" opens a side
   panel with the mode switch, the step plan with its minutes and last time's minutes, and the last try. On Practice, in
   Rounds, he selects a row and starts from the detail panel.
3. The button shows a spinner while the server creates the session, then the room opens.

The plan panel is the moment to read the plan before the clock runs. The room shows the same plan.

### During the round

```
 ┌───────────────────────────────────────────────────────────────────────────────────────────────┐
 │ ← URL Shortener [HLD guided]  Req│Ent│API│▌High-level design 6:13 / 13│ Deep dives            │
 │                               27:26 left · 2:10 behind plan   Pause   End interview   ⋯       │  52 px
 ├───────────────────────────────────────────────────────────┬───────────────────────────────────┤
 │ High-level design. Boxes and arrows … [This step|Whole|…] │  Checklist                0 of 2 ▾│  36 px
 │ ┌──────┐ ┌ Requirements ┐ ┌ Entities ┐ ┌ API ─────┐       │  Interviewer 08:25                │
 │ │ pal  │ │              │ │          │ │          │       │  Why a 302 and not a 301?         │
 │ │      │ └──────────────┘ └──────────┘ └──────────┘       │                    You 09:00 ┌───┐│
 │ │      │ ┌ High-level design ──────────┐ ┌ Deep dives ┐   │                              │...││
 │ └──────┘ └─────────────────────────────┘ └────────────┘   │  (Check this step) (Hint)         │
 │                                                           │  [ Reply to the interviewer…  ]  ⏎│
 └───────────────────────────────────────────────────────────┴───────────────────────────────────┘
```

The chrome above the work area is two rows, 88 px in all: the top bar and the work bar.

- **Plan track.** One row inside the top bar, between the mode chip and the pace chip. Segments are drawn to scale by
  planned minutes (a short step keeps a floor width so it still shows a name). Finished segments are solid; the
  current segment is lit and fills with the time spent in it, with its name and "6:13 / 13" above it; later segments
  show a short, truncated name. Time past the plan shows as a striped warn fill. A small accent tick under the track marks "now"
  on the plan's scale, clear of every label. Each segment is a button: a click (or Enter) moves to that phase and brings the step's frame
  into view (the Code tab for an LLD step that is answered in code). The frame also comes into view when the
  interviewer or guide moves the rail. A guided round marks each passed step with a tick. On a phone only the
  current segment shows.
- **The board is the answer sheet.** One board holds a labelled frame per step, so each step's drawing and notes are
  its answer. "This step" and "Whole board" in the work bar move the view. In a guided round, the guide's pins sit on
  the elements they are about; hover or focus shows the note.
- **Step checklist.** When the round sends the checklist for the current step, the chat column opens with one row,
  "Checklist  0 of 2". It opens in place to list each item and what is covered, with a missing requirement shown as
  the question to ask rather than its answer. It is not a scroller. The server holds the checklist back for the whole
  of a live round, in every mode, so the row appears only once the round is over; the debrief shows the full list.
- **Pace chip.** Next to the clock: "2:10 behind plan" in the warn colour once the clock passes the planned end of
  the current phase (the sum of the minutes of every phase up to and including it), else a quiet "On plan". Only an
  interview round is held to its plan: a guided round and a gap-practice round show no chip, and neither does a
  round with no time plan. When it first turns to behind it lights once with a single ring.
- **Goal line.** The work bar says what the current phase must produce, from his own method, on one line.
- **Timer.** Mono digits. Neutral when on plan, warn under 5 minutes, bad at 0. Guided mode counts up.
- **End interview** is a quiet text button in the bad tone. A click, Enter or Space opens the confirm dialog. Holding
  the pointer down for 1.2 s ends the round at once: a fill grows across the button, and letting go early eases it
  back. Under reduced motion the fill steps. Its tooltip says "Click to confirm, or hold to end now". **Pause** is
  outlined. Discard stays in the menu, and in an LLD round so does "Copy path" for the attempt file.

### Pause, auto-pause and resume

- Any pause covers the work area and the chat with a dimmed, blurred layer: one large **Resume** button that takes
  focus, and "You paused 17:37 into the round. The clock is stopped." with the round time at the pause. The top bar stays clear,
  with Resume there as well. A model error shows **Retry** and its reason on a small card instead. The chat box is
  disabled.
- The board and the editor stay mounted under the cover, so nothing reloads on resume.
- The reason texts stay the same as today, so the meaning does not change: "Paused because the room was closed.
  Resume when you're ready." and the others.

### End and debrief

1. **End interview** asks for confirmation with today's text. Time up does the same without a click.
2. While the debrief runs, the page shows the four stages with plain words for each, and the round's plan
   against actual time, so the wait already teaches something.
3. When the score is ready, the top of the debrief shows the call, the scores and one **NEXT** card that names the
   single action to take: the current gap, then the study notes, then the step after the round. A line under it
   shows progress ("Gaps: 2 of 4 done · 1 with the coach").

### Coach and study notes

- The coach chat stays on the right. Each gap has one main button: **Teach me this**, **Continue in chat**,
  **Practise this gap** or **Finish the lesson**, by the gap's state (not started, with the coach, done, for later).
  A ⋯ menu holds **Restart lesson** and **Practise this gap**. The chat shows a divider line, "Now on: <gap>",
  where each gap begins, and **Continue in chat** scrolls the chat to it.
- **Draft study notes** sits in its own section after the gaps, with the hint "Draft once the gaps are done. You can
  draft any time." The proposal view keeps every behaviour: grouped by file, a tick box per change, blocked changes
  disabled with the reason, a diff per file, **Save selected**, the result list, and **Draft again** on a stale draft.

### Finish or discard from Today

- A round paused in the last 24 hours is the Today hero, with **Finish** as its primary action. Older unfinished rounds
  sit in the Unfinished card with **Finish** and **End and debrief**. A round with under 5 minutes of clock offers
  **Discard** in place of End and debrief. Discard asks first, with the same text as the room.

---

## 5. Changes per screen

### Main bar and page frame

- **Bar.** "Sparmate" on a filled brand tile, three tabs (Today, Practice, Progress) with a 2 px underline on the
  current page, a "Jump to…" box with its shortcut, and a Menu button. Practice carries the due-drill count as a small
  amber badge. The Menu lists Settings, Usage and Keyboard shortcuts; when the server runs with the fake agent it also
  shows "Test mode is on" (the mode is set when the server starts, so the Menu has no switch). On a phone the bar keeps
  the logo and the Menu, and a bottom tab bar holds Today, Practice, Progress and Jump.
- **Jump palette.** A dialog with a search field and groups in this order: Continue (open rounds, with "Paused, 43 of 120
  min"), Start (today's recommended round), Problems (with track and difficulty), Pages, Settings. Arrow keys move, Enter
  opens, Esc closes. A row matches when the query is a substring of it, or when each query word starts a word of it.
- **Frame.** A centred column about 1160 px wide. Heroes are mesh panels with one filled button. Side cards are raised
  panels. Detail goes behind a side panel, a popover or an info tip, never in an accordion. A fact never shares a line
  with dots: each has its own label and value.

### Today

Today is one page for the whole day, and with data it fills the first screen at 1440 by 900.

- **Day header.** The date as a kicker, the day's title, and on the right "2 of 3 planned days done this week". Only
  days whose outcome is known are counted.
- **Week strip.** Seven cells under the header, Monday first. Each shows the day name, the plan type (HLD, LLD, DSA,
  Redo or Rest) and a state mark. *Done* is filled with a tick. *Missed* is hollow, muted and dashed, with the type
  struck through. *Today* has the brand fill and a ring. *Planned* is a plain outlined cell, and *Rest* is quiet. An
  HLD, LLD or Redo day is done when a round of that kind ended that day. A DSA day is done only when the DSA numbers
  show a medium solved that day, and otherwise stays planned, because missing data is never a missed day. A past
  day of a round kind with no finished round is missed. On a phone the strip scrolls sideways inside its own row,
  with today centred.
- **Hero.** The only mesh panel, about 300 px tall. One row of chips: an amber chip ("Redo due", "New problem" or
  "Unfinished"), the track pill, then Mode, Round and Debrief as label-and-value pills. Under it the title at 40 px with
  tight tracking in the rounded face, one sentence why, at most one amber warning line, then the filled primary
  button, "See the plan" and a quiet link to the Library. On a phone the primary button sticks to the bottom of the
  screen.
- **Plan preview.** A raised card under the hero: the round's steps drawn to scale, each with its minutes, and its
  name under the bar when the step is wide enough. Short steps are named in a wrapping legend row below the bar, each
  with a swatch in its colour, its name and its minutes.
- **Also today.** A right column of raised cards. *Unfinished round* has the name, the pause date, a clock bar,
  **Finish**, **End and debrief** (or **Discard**) and "N more unfinished rounds". *Drills due* shows the count and
  total minutes, up to three rows (the gap, and the drill with its minutes and the problem of its next attempt, with a
  "Changed constraint" tag when it asks one) each with **Start**, and "Open Practice". It
  is hidden when nothing is due. *DSA this week* shows a ring ("2 of 3 mediums"), "1 more by Sunday" and "Open
  LeetCode". Without a username it asks for one and links to Settings. A link card lists the other redos.
- **Focus band.** In the left column under the plan preview. "This week's focus: <skill>", the skill's average over
  the newest scored rounds, a sparkline of its last five scores and "See progress". The skill is the same one the
  Progress page shows.
- **First run.** With no round played, the hero is a four-step checklist: set the weekly plan, add the LeetCode
  username, play the first round, read its debrief. A finished step is ticked, the first open step is lit and has
  one action. The right column shows quiet dashed outlines of the cards that fill in later, and the week strip shows
  no missed days.
- **Rest day.** A calm hero, "Rest day.", with "No round is planned today." and then either "Nothing is due." or "N drills
  are due if you want a short one.". It offers "Pick a problem anyway" and, when drills are due, "Do one drill
  anyway". Below it a "Next up" card names the next planned day and how far away it is. The strip still shows the week.
- **Plan panel.** A panel from the right: mode switch, the plan bar drawn to scale, a table of step, plan and last time,
  and a last-try tile.

### Practice

- **Switch.** A segmented control, Rounds and Drills. Drills carries "N due" in an amber pill. `/practice` opens Rounds and
  `/practice/drills` opens Drills. "Practise any question" sits in the page header and opens its own page with the same
  fields and limits as before.
- **Rounds.** Track (HLD, LLD, My questions, each with a count) and filter (Fresh first, Redo due, All). One raised list
  with groups; a row has a mark, title, difficulty and a two-line result, and no button. The detail is a sticky raised
  panel: chips, title, the interviewer's opening line, a facts tile, the mode switch with an info tip, one filled Start
  button and a caption. `/practice#<problem id>` opens the list on that problem.
- **Drills.** A raised panel holds the next drill: an amber "Next drill" pill, the drill name, the problem of its next
  attempt (with a small accent "Changed constraint" tag when the drill asks the problem after one changed constraint, and
  the problem of the round that showed the gap in the gap line when it differs), a tile of three
  facts (length, due, Interview-ready results with three pips and an info tip that says three results on at least two
  different problems close a gap) and one line for the task, then the one primary
  button. A raised "Also due" card lists three more with a drill glyph, the problem of the next attempt, the same tag and
  the due day in amber. "All drills"
  opens the side panel. A first run with no drills shows "Drills start after your first round". The hero carries a quiet
  outline "History" button beside "Start drill", and each "Also due" row ends in a small "History" link. Below the
  hero and the card, a "Closed drills" raised card lists the closed drills (a glyph, the drill, the gap, the round it came
  from and the day it closed; five rows, then "Show all N"). A "Recent attempts" raised card follows, with one row per
  attempt: the date and the drill, the problem, the outcome badge, a strip of criterion bars, the time and the cost. A row
  is a full-width button with a chevron that turns; it opens in place and shows the attempt (see Drill history).

### Progress

- **Sub-nav.** A sticky row under the bar: This week, Skills, DSA, History. It marks the section nearest the top as the
  page scrolls, and a click scrolls to the section and sets `#week`, `#skills`, `#dsa` or `#history`.
- **This week.** The focus card is a raised panel with the amber "Focus this week" pill as its only accent: the lowest
  skill, its score, one supporting number, a planned-against-used chart with one bar per step, and one action. Beside it
  are four counters (rounds, redos, drills, DSA mediums) and the next two redos, with a side panel for the full queue.
- **Skills.** A Guided and Interview switch, a 1 to 4 track per skill with a dashed line at the target bar, a dot per
  round and the skill's level as a bold number to one decimal. The tone of the dots follows the level. Under the dots a
  thinner row of small diamonds marks the last eight drills on the same track, each coloured by its own score and
  labelled for a screen reader ("Drill, Capacity math, 3.2, Interview-ready"). The info tip beside the title says "Your
  last 3 rounds, plus drills from the last 30 days at a lower weight." and explains the scale. The footer reads "Dots:
  rounds. Diamonds: drills. Dashed line: target bar".
- **Drills by kind.** A raised card under Skills with one row per kind that has an attempt: a glyph, the kind, eight
  small pips for the last results (green Interview-ready, amber Getting there, red Needs work; each pip has its words
  for a screen reader), then "N attempts in 30 days" and the first-try share. A row links to Practice, Drills.
- **DSA.** A raised panel with the amber "Weekly goal" chip, "Mediums this week", a large count with "of N", the one
  primary "Open LeetCode" button and a tile with the Monday-first day strip, beside a 400 px raised card "This pass". The
  strip's cells are 28 px: a solve fills the cell and shows its count, a DSA day in the plan has an outline, today has a
  ring. The card holds "Not touched yet" as quiet chips, or three bars when every common topic has a solve. Lifetime
  totals never appear; the page never makes a readiness call. Notices (no username, not found, error) are one raised card
  with one primary action.
- **History.** One raised panel with a header row and an actions column. The table scrolls sideways on a phone. An
  unfinished round carries a warn chip and a Finish button.
- **Empty states.** Each section has its own: the focus card says the focus appears after a scored round, Skills says no
  scored round yet, DSA shows its notice, History says finished rounds appear there.

### Drill history

- Reached from Practice, Drills (the hero, "Also due", "Closed drills" and "Recent attempts"), at `/practice/drills/<id>`.
  It uses the normal frame with Practice marked in the bar. A ghost back link reads "Practice › Drills". The header is
  a kicker (the drill glyph, the kind and an "Open" accent or "Closed" green badge), the gap as the title and, while the
  drill is open, "Start drill" on the right.
- A raised facts card in four columns on desktop and one on a phone: Interview-ready results with the pips and the info
  tip, when it comes back, the next problem with the "Changed constraint" tag, and the problems it has used. A hairline
  and one quiet line name the ready proofs.
- A raised "Attempts" card: each row is a full-width button with a turning chevron, the date, the outcome badge ("after a
  revision" beside it in muted text), the problem, a strip of one bar for each criterion (green at 3 or 4, amber at 2, red at 1;
  one label for a screen reader), the time and the cost. An open row shows, in this order: "Your task", "What changed", the
  answers or "The conversation" (the same sunken thread as the result screen), then for each grade "How each part scored",
  "What went well" beside "What to improve", "Your line" and, when sent, "What a strong answer says". A revised attempt
  shows "First try" and "After the revision" blocks. An attempt with no saved body says so in one muted line.
- Loading is two skeleton blocks; an error is an alert with "Try again"; a drill with no attempt says so in one line.

### Settings

- A left nav on desktop and a scrolling row of buttons on a phone. Raised sections hold label and control pairs, with a
  hairline between pairs. One filled "Save changes" button sits at the top right.

### Drill screen

- The drill screen is full screen with a slim bar: Back to Practice, the drill name and a soft countdown that turns amber
  and counts up in overtime. Two columns hold the prompt cards and one raised answer card. A changed-constraint drill
  shows the accent "Changed constraint" tag beside the problem name, and a "What changed" card with the other material.
  The result shows the same tag beside the problem. A dialogue drill (the deep dive and the trade-off) says in a quiet
  line under the answer box that one or two follow-up questions come before the result. After the opening answer the
  answer card becomes "Your conversation": a short thread of sunken cards, one for each turn (a small "You" or
  "Interviewer" label over plain text), then a "Your reply" box, the line "Question 1 of up to 2", "Send reply" as the
  primary button and a quiet "Start over" below that asks first. The timer keeps running. The result of a dialogue has
  no revise button and shows a "The conversation" card with the same thread below "Your line". The result is a mesh hero (the
  outcome as the title, the schedule tile, then "Revise your answer" as the primary button when a
  revision is allowed) with cards below: the criteria list, "What went well" beside "What to improve", and "Your line".
  Each criterion is a row with its label, a four-step meter (green at 3 or 4, amber at 2, red at 1, the tones of the Progress skill rows) and "n of 4"; a core
  criterion carries a small "Core" tag that screen readers read too. The quote sits in a quiet sunken block with a 1 px
  hairline all round. Revising shows two columns: the feedback on the left, the answer box with the first answer in it on
  the right, and "Submit revision" as its button; the timer is hidden. "Interview-ready" takes the success tone and the
  mark settles in (scale 1.06 to 1, 200 ms); "Getting there" and "Needs work" take the amber tone and the "What to improve"
  card slides in (8 px, 200 ms). After a revision one line reads "After a revision. First try: <outcome>.". Reduced motion and
  `?testhooks=1` show the final state at once. In the console, a warning or an error shows a small status icon and a
  coloured label, never a coloured edge.

### Room

- **Surfaces.** The room uses the reading pages' finish without their ambient motion. Behind the chrome lies the
  sunken canvas with two soft lights from the top corners (indigo left, violet right). On it sit the glass top bar
  and the work bar; raised, lit cards float on them (the checklist, the "What this step needs" card, pins and their
  notes). The board, the editor and the chat column stay plain card surfaces, so the work stays quiet.
- **Top bar** in one 52 px row of glass (the card colour at 80% over a 24 px blur) with the gradient hairline on its
  bottom edge: back, the title in lead type, a tinted-glass mode chip (accent when guided), the plan track filling
  the middle, the pace chip, the timer, Pause, End interview and the menu. The timer sits in a shallow sunken well;
  on plan its mono digits shade from the text colour into the brand ink. Under five minutes and at zero it takes
  the tinted warn and bad fills instead. The behind-plan chip is tinted warn glass with a glowing dot. On a phone
  the bar wraps into rows and the mode chip goes; the chat column gets most of the height, and the checklist row and the speech note stay hidden.
- **Plan track** in one 20 px row of segments, with a 16 px label line above it for the current step. Finished
  segments are solid soft brand; the current one has a brand hairline and a fill that grows with the time spent
  (indigo to violet, with a soft glow); later ones are flat grey with a short label. Time past the plan stays
  striped warn. The needle is a short indigo-to-violet tick under the track with a soft glow.
- **Work bar** is a 36 px translucent strip with an inner top highlight and a hairline under it. On the left is the
  goal line. On the right is a segmented switch: in an HLD round "This step", "Whole board" and "Interviewer's
  view" (which turns soft accent while the panel is open and carries a warn count); in an LLD round "Code" and
  "Class diagram", with the Run button beside them on the Code tab and the board switch beside them on the diagram
  tab. The console below the editor shows no Run of its own.
- **Board.** A fresh board starts with one empty frame per step (HLD: Requirements, Core entities, API, High-level design,
  Deep dives; LLD: Entities and States), and opens on the current step's frame. Pins are numbered circles over the
  canvas: a brand gradient for a guide's note, outlined green or red for what the judge marked held or a gap, each
  with a soft glow in its own colour. A pin whose element sits under one of the board's controls (the top toolbar,
  the menu button, the shape properties panel, zoom, undo and redo, help) is hidden and out of the tab order until the element is scrolled into
  the open canvas; a note that would open into the controls along the top opens below its pin.
- **Board palette.** A raised side panel, lit from above. Its rows light up with an inner highlight on hover, the
  swatch grows a little, and a press scales the row to 98%. The swatches use the app tokens; keyboard order is
  unchanged.
- **Editor and console.** Monaco uses the mono cut of the family, after the font loads, so the cursor stays
  aligned. The console is lit from above like a raised panel. It keeps the error list, jump-to-line and every note;
  Run lives in the work bar. The attempt file path is not on screen: the menu holds "Copy path".
- **Step checklist** is one 32 px row at the top of the chat column, "Checklist  0 of 2 ▾", a muted well with a
  hairline all round. It opens in place, with no scroll area of its own. Each item's mark is tinted by its state:
  green when covered, amber when partly covered, muted when missing.
- **Chat.** The header is lit from above and ends in the gradient hairline; its status dot says "thinking" or
  "listening" and carries a soft halo in its colour. The interviewer's messages are plain text under a name line
  with a small indigo-to-violet dot, like a transcript. His own messages are bubbles in a light brand gradient with
  an inner highlight and a faint brand shadow. System events are small centred lines between two rules that fade
  out to the sides. The extension is a distinct raised card with a "New requirement" badge.
  Under the opening message of an LLD round a quiet card, "What this step needs", repeats the phase goal and lists
  that phase's checklist items when the round sends them. "Check this step", "Hint" and "I'm stuck" are small pills
  just above the composer. A one-time note above them, "Voice input needs the speech pack." with Install and Not
  now, shows while the speech pack is missing; "Not now" is remembered for that browser. The mic button stays, off,
  with its reason. The composer is a lit field that glows in the brand ink when it has focus; Send is the primary
  gradient button.
- **Pause cover**, described in section 4. It covers the work with the dialogs' backdrop (dimmed toward the brand ink
  and blurred) and scales in from 95% over 260 ms. It holds a large Resume button and one line of text, with no
  card, except for an error pause, which keeps a card with a tinted-glass icon disc.

### Debrief

- **Header.** Back, title, track and mode, date and round time. The date line hides on a phone. A status chip shows
  only while the debrief runs or when it failed.
- **Verdict.** Compact, with no panel and no edge strip: a small eyebrow and the call in 22 px bold type, in the
  status colour of the call (green for a pass or "Ready", amber for "Close, not yet", red for "Not yet"). The band
  behind the debrief header carries the same tone. The confidence, and for an interview round the stretch-level call, sit beside the call as small
  muted text. One or two muted lines under it give the reasons or the meaning. The call is the second loudest thing
  on the page.
- **Score strip.** One row of equal cells with a hairline between them (three per row on a phone): the dimension name
  in small muted text, the score at 20 px with tabular figures and a muted "/4", and a thin four-segment meter. A
  score below 3 is in the warning colour, a score of 3 or more in the success colour. The strip is one target that
  opens the Evidence tab.
- **NEXT.** One soft brand card with the label "NEXT", the action in one line and the only filled primary button on
  the page. A muted progress line under it has a thin segmented bar, one segment per gap.
- **Gaps.** The current gap is a raised card with a state badge, the only coloured badge in the list, and an outline
  button. Every other gap is a quiet row between hairlines, with no card, a regular-weight title, muted minutes and
  a small state dot or a tick for done. Section headings (Gaps to work on, Study notes, Summary) share one style.
- **Details.** Underline tabs: Evidence (with a By step or By score toggle), Time, What the judge saw, and
  Reference. In **By step**, each step is its own raised card: the step's frame sits in a sunken well like paper
  laid on the card, with the pins at their places; the title carries a tinted-glass pill with the coverage ring and
  "5 of 6 on the checklist"; "What held" and "What's missing" are headings in the status colour with a tinted mark
  (a tick, a minus); his notes from the round sit in a sunken fill.
- **Coach.** On a wide screen the coach sits beside the scorecard. Below the md breakpoint it sits under it, so
  the score stays reachable on a phone.

### Usage

- **Cost panel.** The deep panel holds the total cost at 48 px, the call and round counts, and the daily cost
  chart for 30 days with bars in a light-to-violet gradient.
- **Token strip.** One raised panel with input tokens, output tokens and the cache hit rate, with a meter,
  separated by hairlines.
- **Drills.** Between the token strip and the tables: a raised panel of three figures (drill cost, attempts, grader
  calls) separated by hairlines, then a "By drill kind" table and a "By attempt" table in raised panels. The attempt
  table shows 20 rows and a button that shows the rest. With no drill call the section is one muted line.
- **Tables.** Usage by problem (rounds cost, drills cost and total cost as three columns), round, role and model sit in raised panels with a muted header row, under
  sentence-case section headings.

### Settings

- Same fields. Each group (round length, models and effort, theme, voice, study folder) is a sunken fill with a
  bold heading and a short help line. The dialog footer is sunken too. The theme still previews live. On a phone
  the model table shows each role's name on its own line above its two lists.

---

## 6. Labels and hooks that stay frozen

Scripts and tests depend on these, so the revamp keeps them exactly.

- Text "Sparmate" on Today (`scripts/smoke-ui.mjs`).
- A button whose text contains "End interview" in the room, and a confirm button whose text is "End interview"
  (`scripts/e2e/ui-tour.mjs`).
- Text "What the judge saw", "Strengths" or "Teach me" on the debrief (`ui-tour.mjs`).
- The room's back link `a[aria-label="Back to home"]`, its leave confirm button "Leave", and Ctrl+M for the
  microphone (`scripts/e2e/voice-lifecycle.mjs`).
- The room root keeps `flex h-full`, the room never scrolls as a whole, and no scroller sits inside another
  (`scripts/e2e/layout-check.mjs`).
- The frame (`html`, `body`, `#root` and the room and debrief roots) uses `overflow: clip`, so it cannot scroll even from code. A page
  jumps to a section with `scrollToInScroller` (`src/web/lib/scrollInScroller.ts`), never `scrollIntoView`, so only its own
  scroller moves (`scripts/e2e/layout-check.mjs`).
- `window.__irBoard` and `window.__irShell` with `?testhooks=1`, and the `__fixtureLog` in fixture mode.
- Fixture names: `home` (Today), `library` (Practice, Rounds), `library-new`, `progress`, `history` and `dsa` (Progress,
  opened at that section), `settings`, `gym` (Practice, Drills), `drill-detail` (the history of one drill), `drill-dialogue` (a dialogue drill after its first question), the room and debrief fixtures, and `usage`. URL
  parameters: `fixture`, `theme`, `mode`, `status`, `error`, `reason`, `offline`, `timeup`, `stale`, `preparing`, `now`
  (a date, for Today and Progress), `unfinished=0`, `username`, `plan`, `testmode=0`, and for Today `today=first` (no
  rounds yet, no drills) and `today=rest` (today's slot of the plan becomes rest). On Today a `username` or a `state`
  (the DSA states) shows the DSA numbers.

---

## 7. New dependencies

| Package | Version | Licence | Why it is needed |
|---|---|---|---|
| `@fontsource-variable/atkinson-hyperlegible-next` | `5.3.0` | SIL Open Font License 1.1 | The interface typeface. Self-hosted woff2, bundled by Vite, no network request. |
| `@fontsource-variable/atkinson-hyperlegible-mono` | `5.3.0` | SIL Open Font License 1.1 | The code, clock and graph-text typeface. Same reasons. |
| `radix-ui` | `1.8.1` | MIT | Accessible dialog, menu, select, tabs, tooltip, popover and form primitives. |
| `class-variance-authority` | `0.7.1` | Apache 2.0 | Button variants. |
| `clsx` | `2.1.1` | MIT | Joins class names. |
| `tailwind-merge` | `3.7.0` | MIT | Merges Tailwind classes; taught the app's type scale. |
| `sonner` | `2.0.8` | MIT | Toasts. |
| `tw-animate-css` (dev) | `1.4.0` | MIT | CSS-only enter and exit animations for the Radix layers. |

Every version is pinned exactly. The OFL is not MIT. It is a permissive font licence: free use, bundling and
redistribution, with the one rule that the font is not sold on its own. The CSP already allows the fonts
(`font-src 'self' data:`), and only the Latin subset loads, through `unicode-range`. Radix and Sonner set inline
`style` attributes and Sonner adds one `<style>` element; the CSP allows both (`style-src 'self' 'unsafe-inline'`).
None of the packages uses `eval` or loads anything from the network.

---

## 8. Needs a server change

One line: the default theme in `DEFAULT_SETTINGS` (`src/shared/types.ts`) is `dark`, so a new install opens dark. A
`settings.json` that already holds a theme keeps it. The gap badges and the step count read `Session.gapProgress`.

The DSA response carries `week.mediumsPerDay` (Monday first), the mediums counted on the day each problem was first
solved this week. The week strip reads it, so a DSA day agrees with the weekly ring.

---

## 9. How the revamp is checked

- `npm run typecheck`, `npm test` and `npx vite build` pass, and so do `scripts/e2e/ws-fake-round.mjs`,
  `layout-check.mjs`, `voice-lifecycle.mjs` and `ui-tour.mjs`, each with its own `PORT`.
- Screenshots of the main pages in `docs/screens/`, plus a live run of this version.
- An accessibility pass: contrast AA in both themes, focus order on every screen, labels on every control, the
  timer and chat announcements unchanged, and reduced motion respected.
