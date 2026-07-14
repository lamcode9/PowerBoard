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
