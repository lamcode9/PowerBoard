# PowerBoard — lessons

Patterns from user corrections. Review at session start before design or product work.

## 2026-07-14 — Quiet chrome: accent is punctuation, not paint

**Correction:** After the Phases 0–7 design overhaul shipped, the user still judged the design "really not looking great": too many colors (accent tint/text on nearly every hover and active surface), old-school buttons (borders + fills), and too much visible label text. Reference: **paper.design** — near-monochrome chrome, ghost/icon buttons that only reveal a subtle filled box on hover, tooltips instead of persistent labels.

**Rule:**
- Chrome hover = neutral fill (`--control-bg-hover`) + `--text-1`. Never accent tint or accent text on hover.
- Accent is reserved for: canvas selection semantics, agent presence, ONE primary CTA per screen, and focus rings. Everything else is grayscale.
- No borders + fills on buttons. Controls are ghost (transparent at rest, subtle fill on hover/active); chips/pills are flat `--control-bg`; cards separate with hairline shadows, not border lines.
- Prefer icon-level controls with a designed hover tooltip (`data-tip`) over visible text labels wherever the icon is self-evident.

**Why:** A token system alone doesn't fix taste — the *distribution* of accent matters more than its value. Spending the accent on every interactive state makes nothing feel primary and reads as "web app", not "canvas tool".

**How to apply:** Before shipping any PowerBoard chrome, count accent occurrences on one screen; if the accent appears anywhere other than selection/agent/primary-CTA/focus, strip it back to neutral.

## 2026-07-28 — If the model can't say it, the artifact will lie

**Correction:** The user asked why an agent-built org chart came out "non-perfect, non-presentation ready" — "lines are weird, no dotted-lines option etc." Reading the live board over MCP showed the agent had written a legend saying *"Dotted line = embedded / dotted-line interface"* above nine solid lines. `BoardStyleSchema` had `stroke` and `strokeWidth` and no line-style property at all, so the agent substituted a lighter grey and shipped a diagram that contradicts its own key. Worse, `export_artboard_png` rendered **zero** connectors (only `renderPageSvg` drew them), and `validate_board` returned `valid: true` for a board with two edges running through other nodes.

**Rule:**
- **A missing expressive primitive doesn't produce a missing feature — it produces a confident lie.** When an agent-built artifact is subtly wrong, first ask what it *tried* to express and couldn't. Diff the artifact's own claims (legend, labels, title) against what it actually drew; the gap points straight at the schema hole.
- **Every render path must draw every object kind.** Artboard export, page export and the live canvas share one geometry module for exactly this reason — a per-path element filter silently deletes whole categories. If two code paths render the same model, a test must assert they agree.
- **Validation that only checks structure gives a false green.** Anything an agent is told to run before shipping must check the properties that make the output *good*, not just parseable. Geometry diagnostics (crossings, overlaps, collisions, clipping) are warnings, not errors — and they must be computed from the same routing inputs the renderer uses, or they report collisions the renderer already solved.

**Why:** Agents optimize against the tools they're given. They don't report "your schema can't express this"; they approximate, and the approximation looks deliberate. The fix is never "prompt the agent better" — it's give it the primitive, make the default output correct, and make the checker tell it the truth.

**How to apply:** When a generated artifact looks "almost right", read it for self-contradiction before touching the generator. Then check whether the shortest path to a good result is a new field in the model rather than more instruction.

## 2026-07-28 — "Did you fix the product, or the artifact?"

**Correction:** After shipping the connector/export/validation fixes, the user asked: *"did you make product fixes? or just fix the tool used in the board? the goal is that when the agent uses it, it's always perfect — embed some best practice, or an auto-feature where the components always correct themselves."* The fixes were genuinely product-level, but the question exposed something sharper: **half of what I built was automatic and half was advisory, and I had presented them as one thing.** Routing, obstacle avoidance and label placement self-corrected at render time. Node position, size, spacing and alignment were still entirely the agent's problem, and `validate_board` reported issues nobody was obliged to read.

**Rule:**
- **Grade every fix as automatic, default, or advisory — and say which.** Automatic = happens at render/apply time with no caller involvement. Default = applied at creation unless overridden. Advisory = reported, requires someone to act. Advisory fixes only work on agents that already behave well, which is the opposite of what "always perfect" needs. Aim for automatic; settle for default; treat advisory as a last resort.
- **Put the failure where the caller believes it succeeded.** A diagnostic in a tool nobody calls is a diagnostic that does not exist. Every export now returns the board's layout warnings beside the file path, so an agent that never validates still finds out at the exact moment it thinks it is done.
- **An auto-corrector must be idempotent, and idempotence has to be designed for, not hoped for.** The first version drifted 8px every run because it snapped centre lines while sizes were odd multiples of 4. Fixing it meant choosing a size rhythm (2×grid) that makes every half-size a whole grid step. Only an idempotent corrector is safe to run before every export, which is what makes "always perfect" reachable rather than "perfect if you remember to run it once".
- **Auto-correction needs a theory of intent, or it destroys deliberate work.** Every pass is gated: sizes unify only within 15%, spacing evens out only when gap variation is small *relative to node size* (a max/min ratio wrongly protects 16-vs-53px gaps between 432px cards), and rows/columns resolve to one non-overlapping assignment so the second pass cannot undo the first.

**Why:** "Always perfect" is a property of defaults and invariants, not of guidance. Anything that depends on the agent choosing correctly will hold most of the time and fail exactly when it matters.

**How to apply:** When asked to make output reliably good, list every fix and mark it automatic / default / advisory. If the list is mostly advisory, the work is not done — find where the value can be computed instead of chosen, and where the check can be attached to the action the caller actually takes.

## 2026-08-07 — "Why has the build been running for 21 hours?"

**Correction:** The user asked why the TestFlight build was still going after 21 hours. It wasn't going at all.
`fastlane mac beta` had run at 14:24 the previous day, failed after ~56 seconds, and nothing had been running
since. I had ended the previous turn with "want me to run it?" and never established what state the release
was actually in — so the user was watching a dead terminal and I had no idea.

**Rule:**
- **A release step is not done until you have looked at its artifact.** `fastlane`'s `report.xml` lists the
  steps that ran; the *absent* step is the diagnosis. Here steps 2–4 were logged and step 5 (`upload_pkg`)
  was missing, with no `.pkg` on disk — the lane died on `upload_pkg(pkg: nil)` because `latest_pkg` globbed
  an empty directory. Check for the built file, not for the absence of an error.
- **"Is it still running?" is answerable in one command — answer it before theorising.** `ps -Ao pid,etime,command`
  settles it. A stray `log stream --predicate process contains "altool"` from an earlier session had been up for
  3 days and reads exactly like a hung build in a terminal tab.
- **Tool defaults change under `^` version ranges, and the failure can be silent.** `electron-builder` 26.15.3
  signs the `.app` and exits 0 without building the `.pkg` unless `mas.target: pkg` is set explicitly. Exit code
  0 plus a missing artifact is the worst failure shape there is: every check passes and nothing shipped.

**Why:** The build pipeline is the one part of the work with no user in the loop to notice it silently did
nothing. An export that fails is visible in a second; a release that fails is invisible until someone asks.

**How to apply:** After any release lane, assert the artifact exists and is the right size/signature before
reporting status. When a lane fails, read `fastlane/report.xml` for the first missing step rather than
re-running blind — and if a build tool exits 0, verify it produced something.

## 2026-08-07 — A green assertion that measures the wrong pixels

**Context:** Fixing the canvas/SVG text-wrap divergence. Two verification steps passed while proving nothing,
and a third only worked because the code under test was stale.

**Rule:**
- **`sharp`'s `stats()` reads the INPUT image, not the queued pipeline.** `sharp(png).extract({…}).stats()`
  returns the *whole picture's* numbers. Two different crops reported an identical stddev to 14 decimal
  places — that identity was the tell. Materialise the crop with `.toBuffer()` and re-open it. Any
  measurement API that can silently ignore your transform needs a control case: if two regions that should
  differ report the same number, the measurement is broken, not the subject.
- **Verify against a real artefact before trusting a diagnostic.** The new `text-overflows-box` check passed
  every synthetic test and then fired 11 false positives on the real 506-element board — including a 15px
  letter in an 18px box — because it charged a full line-height to the first line. Seed fixtures are sized by
  whoever wrote the fixture; real boards are sized by a human with taste, and only they expose an
  off-by-one-line-height.
- **Workspace `dist` is a silent staleness trap.** `apps/server` imports `@powerboard/renderers` and
  `@powerboard/schema` from their built output, so a source change is invisible to server tests until
  `npm run build`. A typecheck error (`no exported member`) is the lucky version of this; the unlucky version
  is a test that renders the old code and passes.

**Why:** All three failure modes look like success. The pipeline reports green, the diagnostic reports
findings, the raster reports ink — and none of it is measuring what you think.

**How to apply:** For any measurement-based assertion, first make it fail on purpose. If you cannot state what
the number would be if the fix were absent, the assertion is decorative. (Here the raster test *did* fail
against the stale unwrapped renderer, which is the only reason it can be trusted.)

## 2026-08-07 — Index 0 is falsy, and the model tests will never tell you

**Correction:** Auto-layout drag-to-reorder did nothing on the canvas. The schema was right, the
operation was right, 110 tests passed. The canvas called `stackReorderTarget(...)` and then wrote
`if (reorder) { … }` — so an index of **0**, which is "drop it at the top of the stack" and the single
most likely reorder a user performs, was treated as "no reorder" and fell through to an ordinary move
that the reflow immediately undid.

**Rule:**
- **Any function returning `number | undefined` must be tested with `!== undefined`, never truthiness.**
  The bug is invisible in review because `if (reorder)` reads correctly in English. Zero, empty string
  and `false` are the three values that make "did I get an answer?" and "is the answer truthy?" differ.
- **A derived-state feature needs an integration test at the boundary, not just model tests.** Every
  assertion about the resolver passed while the UI that calls it was broken. When the model is
  materialised (reflow-on-write) the UI failure mode is *silent*: the wrong write is immediately
  overwritten by a correct reflow, so the screen just looks frozen rather than wrong.
- **Prove the harness before trusting a negative.** Two synthetic drags did nothing, and the natural
  conclusion was "the automation cannot drag." Running the same synthetic drag against an ordinary
  absolute element moved it — which converted "the tool is broken" into "my code is broken" in one step.

**Why:** Reflow-on-write is a good design (one resolver, every consumer reads plain x/y) but it hides UI
bugs: any incorrect write is quietly corrected, so a broken interaction produces no visible error.

**How to apply:** When a feature makes state derived, list the interactions that write to it and drive
each one for real. And when an interaction "does nothing," first drive a known-good interaction the same
way — a control case turns an ambiguous silence into a located fault.

## 2026-08-07 — "Absent from App Store Connect" is not "failed"

**Correction:** I reported that `fastlane mac beta` had built the `.pkg` but never uploaded it. It had
uploaded fine. I checked ASC roughly two minutes after the upload, saw no new build, and called it a
failure — then re-ran `upload_only`, which Apple rejected with *Redundant Binary Upload*. That rejection
was the only reason I found out the original upload had succeeded.

**Rule:**
- **ASC indexing lag is ~3–4 minutes, and I had already measured it twice in the same session** (both
  earlier builds were "not indexed yet" on the first check and VALID a few minutes later). Absence inside
  that window carries no information. Poll it; don't diagnose it.
- **Never pipe a release lane through `tail`.** `fastlane mac beta 2>&1 | tail -5` reports *`tail`'s* exit
  code — always 0 — and truncates the one line that says whether the upload happened. This is the second
  time in one session; the first was `bundle exec fastlane … | tail -80` silently swallowing a "no
  Gemfile" failure. Run release lanes unpiped and grep the saved log afterwards.
- **A redundant-upload error is good news.** `90189 Redundant Binary Upload` means the binary is already
  on Apple's side. Treat it as confirmation, not as a failure to fix.

**Why:** Both halves of the mistake were self-inflicted: I hid the evidence with a pipe, then filled the
gap with the pessimistic guess instead of the one my own earlier measurements supported.

**How to apply:** Before concluding a release step failed, name the observation window and check it
against known latency. If the answer is "I looked too early," wait — don't act.

## 2026-08-11 — The App Store submission blockers the API cannot see

**Context:** First Mac App Store submission. Every field the App Store Connect API exposes was
filled and `submit` still failed, three times, with the same message: `STATE_ERROR.ENTITY_STATE_INVALID
— appStoreVersions ... is not in valid state. This resource cannot be reviewed, please check
associated errors to see why.` There is no endpoint that lists those associated errors.

**Rule:**
- **Three required things are not in the ASC API at all, and their absence is invisible to it.**
  *App Privacy* (the data-collection questionnaire + its Publish step) has no relationship on the
  app and no top-level collection — `appDataUsages`, `appPrivacyDetails` and every variant 404.
  *Content Rights* is likewise UI-only. Both silently block review. Budget a browser trip for a
  first submission; the API gets you ~90% and then stops without saying so.
- **`copyright` starts null on a new appStoreVersion and blocks submission.** It is a plain PATCH
  attribute, so it is easy to fix and easy to never think of — nothing in the API surface flags it.
- **The version page in the ASC web UI is the only place that names what is missing.** When the
  submit error is opaque, stop probing endpoints and open the page; it showed Content Rights
  unset and an age-rating banner in one glance, after I had burned several calls guessing.
- **Age-rating fields are a mix of string enums and booleans, and the API validates one at a time.**
  `gunsOrOtherWeapons` is a STRING (`NONE`), `gambling` is a boolean, `ageAssurance` is required and
  boolean. Expect an iteration loop; each 409 names exactly one field.
- **Match the build's marketing version to the App Store version string before building.** A build
  can only attach to the version whose string equals its `CFBundleShortVersionString`. Shipping
  `0.1.0` against a `1.0` record cost a full rebuild-and-reupload cycle. Check
  `asc.js state` *first*, and rename the ASC record (`asc.js rename`) rather than creating a second
  version — ASC allows only one editable version per platform.

**Why:** The API's silence reads as completeness. Every call returned 200, every field I could see
was populated, and the thing actually blocking review was a questionnaire the API does not model.

**How to apply:** For a first submission on any platform, drive the API for everything it supports,
then open the console page and read it before declaring a blocker. For subsequent releases these
one-time records persist, so the API path alone is enough.

## 2026-08-11 — A CSS rule that ties on specificity wins by position, and hides a whole panel

**Correction:** The user reported the right panel had no way to reopen. It had one — `.pane-edge-tab.right`,
rendered, visible, `opacity: 1` — parked at `x = 1280` on a 1280px viewport. `[data-tip] { position: relative }`
sits ~700 lines below `.pane-edge-tab { position: absolute }` in the same sheet, ties it at one-class
specificity, and wins on order. The tab lost absolute positioning, flowed into the grid, and left the screen.

**Rule:**
- **A generic attribute-selector utility (`[data-tip]`, `[data-state]`, `[hidden]`) has exactly class
  specificity and will silently override component rules declared earlier.** When a utility sets a
  positioning or layout property, qualify the component rule by its parent (`.app-shell > .pane-edge-tab`)
  so rule order stops mattering.
- **"Element exists and is visible" is not "element is reachable."** The diagnostic that found this in one
  step was `document.elementFromPoint(centreX, centreY)` returning `null` — present in the DOM, absent from
  the viewport. Check hit-testing, not `getComputedStyle`.
- **A hidden panel with no working reopen is a trap, not a bug.** Any collapse control needs a second,
  independent path back: the edge tab AND a command-palette entry. One affordance is one point of failure.

**Why:** Every individual signal said the feature worked. The tab was in the DOM, styled, event-bound, and
its own `data-tip` tooltip rule was written specifically for it — by the same hand that broke it.

**How to apply:** When a control "does nothing," get its rect and hit-test its centre before reading its
CSS. And grep for later `[attr]` rules whenever a component's `position`, `display` or `overflow` is
mysteriously not what the source says.

## 2026-08-11 — A native `abort()` in a codec is not an exception, and the sandbox is a different machine

**Correction:** An agent session reported PNG export "crashes the app" and worked around it with SVG.
Two crash reports said `EXC_BREAKPOINT` on a `libvips worker` thread inside
`rsvg_handle_render_document`. The cause: under the MAS App Sandbox, pango can resolve no emoji font,
and pango answers that with `g_error()` — which always calls `abort()`. Because the server runs inside
the Electron main process, that abort killed PowerBoard. Any emoji anywhere in a board's text made PNG,
JPG and PDF export lethal; boards without emoji were fine, and dev never reproduced it.

**Rule:**
- **Native library failures are not catchable.** libvips, librsvg, pango and glib respond to a bad input
  by aborting the process. Anything that hands user content to them must run in a child process, or one
  malformed glyph takes the whole app with it. `try/catch` around a native call is theatre.
- **The App Sandbox is a different environment, not a stricter one.** Fonts, caches and config paths that
  exist for `npm run dev` are simply absent inside the container. A feature that touches fonts, temp
  files, or anything under `~` must be exercised in a sandboxed build before it ships, not in dev.
- **`asarUnpack` must cover the dependency closure, not the package.** A spawned Node child cannot read
  anything inside `app.asar`. Unpacking `sharp` alone left it unable to load `detect-libc`; the
  in-process path never noticed, because Electron's patched `fs` reads the archive for it.

**Why:** Every layer hid the one below. The crash log named a font, the font problem only existed in the
sandbox, and the sandbox only mattered because the rasterizer shared a process with the UI. Diagnosing
from the reported symptom ("PNG export is broken") would have found none of it — the crash report and a
reproduction inside the real sandboxed binary found all three.

**How to apply:** For any "the app just disappeared" report, read
`~/Library/Logs/DiagnosticReports/<App>-*.ips` first — the faulting thread's stack names the library and
the abort path in one step. Then reproduce against the *installed* build by driving its own HTTP
endpoint, with stderr captured, rather than trying to reproduce in dev.
