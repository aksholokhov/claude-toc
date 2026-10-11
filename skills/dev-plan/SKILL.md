---
name: dev-plan
description: Write, restructure or extend a project's DEV_PLAN.md — a human-readable engineering plan (scope, architecture, milestones with deliverables, acceptance criteria and tests, decisions, definition of done) in the grammar the toc sidebar reads. Use when asked to "write a dev plan", "plan this project", "start toc", or to convert an existing plan to toc's format.
---

# Writing a DEV_PLAN.md

The plan is written **for a person first**: someone returning after two weeks,
or reading it cold, must be able to tell what is being built, why, how far it
has got and what "done" means. The toc sidebar reads only a small machine part
— milestone headings, ID'd deliverables, acceptance checkboxes — and shows
everything else as prose. Most of the work is the thinking; the syntax is a
few rules at the end.

## How to work

1. **Gather before writing.** Read the SPEC/README/KNOWLEDGE files and the code
   that exists. Measure what can be measured (sizes, counts, timings, versions)
   instead of guessing; if a number is a guess, say so.
2. **Draft the skeleton** (sections below), then fill milestones in order.
3. **Converting an existing plan:** keep every existing step ID and its marker
   (commits point at them via `Plan-Step:` trailers). Turn bare steps into
   deliverables with a description, write the milestone's *why*, and add
   acceptance criteria — check a box only if it was demonstrably met.
4. **Then activate toc** with the `mcp__toc__activate` tool (the project folder),
   unless it is already showing this plan.

## The document

```markdown
---
toc:
  context: [SPEC.md, DEV_PLAN.md, KNOWLEDGE.md, SCRATCHPAD.md]
---
# <Project> — dev plan

> **Status:** <where it stands, one line, dated if useful>.
> **Goal:** <the outcome, in a sentence or two — what changes for whom>.
> **Blocks / blocked by:** <other plans or work, if any>.

## Scope
**In:** … · **Out, deliberately:** … (and why) · **Non-goals:** …

## Architecture            (optional: a diagram in a fence, the key choices
                            and *why* each was made over the alternative)

## Milestones
<one line on how milestones are judged, e.g. "done when every acceptance
line is demonstrated, not argued">

### M1 — <What this milestone delivers>
<Why it exists: what it proves, the risk it retires, the trap it closes.
One to three short paragraphs. This is what someone reads to catch up.>

**Deliverables**
- [ ] S1.1 <Short title> — <one sentence: the concrete artifact or change>
  <optional detail: paths, commands, constraints, sub-bullets>

**Acceptance**
- [ ] <A binary, testable statement. Observable, not "works well".>

**Tests**
1. <How each acceptance line is demonstrated — including the failure case.>

## Decisions               (open questions as `- [ ] **Topic.** options, cost,
                            recommendation`; ignored by toc)

## Definition of done      (the few conditions under which the whole plan is
                            finished)
```

Other free sections are welcome where they earn their place: risks, a fault
matrix, a migration path, rollout, open questions.

## Standards for the content

- **Milestones are outcomes, not activities.** "The repo, with the empty-source
  trap closed" — not "work on backups". Order them so each one de-risks the next;
  say what blocks what.
- **Every milestone has a why.** The paragraph under the heading is the brief
  toc shows when someone selects it; make it worth reading.
- **Deliverables are concrete**: a file, a command, a setting, a behaviour —
  something you could point at. One sentence after the ` — `; detail goes in
  indented lines.
- **Acceptance is binary and observable**, demonstrated rather than argued:
  "with the mount stopped, the run exits non-zero and creates no archive", not
  "handles failures". Include the negative case — the thing that must NOT happen.
- **Tests say how** the acceptance is shown, including deliberate fault
  injection where failure is the risk.
- **Record corrections in place**, dated, instead of silently rewriting history:
  `> **CORRECTED 2026-09-23.** This milestone originally required … That was wrong
  because …`
- **Facts carry their provenance**: "MEASURED 2026-09-25", "per the vendor's docs",
  "guess". Wrong guesses are the usual root of a bad plan.
- **Decisions stay visible** until made: options, cost of each, a recommendation.
- Plain, direct sentences. No filler, no marketing tone.

## The grammar toc reads

- **Milestone:** `### M<n> — Title` under `## Milestones`. It runs until the next
  heading of the same or a higher level; deeper headings inside are visual groups.
- **Label lines** inside a milestone: a line that is only `**Deliverables**`,
  `**Acceptance**`, `**Tests**` (or any other `**Label**`).
- **Steps** are the checkboxes under `**Deliverables**`:
  `- [ ] S<n>.<k> Short title — description`.
  - Markers: `[ ]` todo · `[~]` in progress · `[x]` done · `[-]` cancelled
    (say why in the description).
  - IDs are `S<milestone>.<k>`, **stable**: never renumber or reuse one; new
    steps take the next unused number; reordering lines is fine.
  - **At most one `[~]`** in the whole file.
  - The short title (before ` — `, an em dash) is what the sidebar shows:
    **≤ 28 characters**.
- **Acceptance** checkboxes are counted (`☐2/5` beside the milestone) and never
  get IDs. A milestone shows as done only when all its steps are done and all
  its acceptance boxes are checked.
- Checkboxes anywhere else (Tests, Decisions, prose) are ignored.
- The front matter's `toc.context` lists the knowledge files shown in the
  sidebar's Context section.

## While working

- Mark a step `[~]` before starting it; flip it to `[x]` when its deliverable
  exists; then mark the next one. toc logs edits and tags commits with the `[~]`
  step.
- Tick an acceptance box only after demonstrating it; note how in the Tests
  section or a dated line if it isn't obvious.
- New work discovered mid-way becomes a new step with the next free ID — in the
  milestone it belongs to, not appended at the end of the file.
