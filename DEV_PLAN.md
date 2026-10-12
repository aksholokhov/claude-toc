---
toc:
  context: [SPEC.md, DEV_PLAN.md, KNOWLEDGE.md, SCRATCHPAD.md]
---
<!-- toc reads milestones, steps and acceptance (grammar in the toc:dev-plan
skill); all other text is for people. Step IDs are stable, one [~] at a time. -->

# claude-toc — dev plan

> **Status:** v0.1 feature-complete and user-tested; review cleanups (M11) before the first push.
> Plan format v2 landed 2026-10-11. Not yet pushed or tagged.
> **Goal:** a table of contents for long Claude Code sessions — a sidebar showing
> where the project's knowledge lives, how far the plan has got, and which commits
> and files each step produced — that runs on a Claude Pro login, with no API key.
> **Blocks:** S8.2 (install from the dotfiles `bootstrap.sh`) waits for S7.4.

## Scope

**In:** a Claude Code *mod* (plugin + TypeScript hooks module) with a docked
sidebar of Context / Plan / Artifacts / Preview / Keys; DEV_PLAN.md parsing;
commit attribution by trailer; a ledger of edited files; nvim, delta and
lazygit opened in tmux beside Claude; a Haiku repair agent for a broken plan.

**Out, deliberately:** a left-hand sidebar (the mods dock is right-only, D36);
anything needing an API key; editing the plan from the sidebar (Claude and the
person edit the file; toc only reads it).

**Non-goals:** replacing `/diff`, git clients or an editor — toc points at
them; tracking work across several projects at once (the scope is one folder).

## Architecture

```
  DEV_PLAN.md ─┐                      ┌─► docked pane (ui.render Pane)
  git log      ├─► hooks/lib (pure) ──┤
  ledger.jsonl ┘   parse · model      └─► tmux: nvim | delta | lazygit
                         ▲
   hooks/register.ts ────┘  every $ call: events, polling, process.run, store
```

All logic that can be pure lives in `hooks/lib/` and is unit-tested; everything
touching the mods API is in `register.ts` (a validator rule: `$` may only be
passed to its top-level functions). Design and decisions: SPEC.md (D1–D42).
Platform facts learned the hard way: KNOWLEDGE.md.

## Milestones

Every step ends with `claude plugin validate --strict` and `claude plugin test`
green. A milestone is done when its acceptance lines are demonstrated, not argued.

### M0 — Requirements agreed, option chosen
Before building anything: a spec the user signed off, and an honest comparison
of building a mod against combining existing plugins or doing nothing.

**Deliverables**
- [x] S0.1 Grill the requirements — four interview rounds, decisions D1–D23.
  Mods were discovered mid-interview and changed the platform (D12).
- [x] S0.2 Write SPEC.md — the design, with a decision log.
- [x] S0.3 Compare build/combine/no-op — Build chosen.
  The only option covering per-step untracked files.
- [x] S0.4 Write DEV_PLAN.md — this plan, first in the v1 grammar.
- [x] S0.5 Design walkthrough artifact — https://claude.ai/artifact/QmMT28HLWoquxhVkfdNAk9

**Acceptance**
- [x] The user approved the spec and the plan ("The plan is fully approved").
- [x] The option comparison names what each alternative cannot do.

### M1 — Skeleton, and the platform questions answered by spikes
Mods were days old and thinly documented. Each risky assumption (docking, key
input, model spawning) got a live spike before anything depended on it.

**Deliverables**
- [x] S1.1 Plugin + marketplace json — `.claude-plugin/{plugin,marketplace}.json`, `hooks/hooks.json`.
- [x] S1.2 Pull types for this build — use the d.ts Claude Code writes, not GitHub's.
- [x] S1.3 /toc opens an empty pane — immediate command; ~42 columns; dock vs inline checked.
- [x] S1.4 Spike: Ctrl+X T hotkey — a band Button's `action` pressed by a bound chord.
  > **CORRECTED 2026-10-11.** The first action used, `app:toggleReplTab`, is
  > Claude's own tab switch once `/diff` is open; now `strip:jump1` (D38).
- [x] S1.5 Test harness green — `claude plugin test`, one render snapshot test.
- [x] S1.6 Read cc-plugin-diff source — scrolling, key legend, keyboard actions.
- [x] S1.7 Spike: shift J/K/H/L keys — Shift never presses a Button; Alt (Global) does.
  Shipped as ⌥j/⌥k page, ⌥h/⌥l section, each with a plain-letter twin (D32).
- [x] S1.8 Spike: haiku agent.spawn — a mod can spawn a Haiku subagent with a prompt (D29).

**Acceptance**
- [x] A pane docks beside the transcript in fullscreen and inline when narrow.
- [x] A chord from the prompt presses a toc button; Alt+letter does too.
- [x] A Haiku agent spawned by the mod edits a file and reports back.

### M2 — The plan model
A pure parser, so the sidebar can never drift from the file and broken input
is reported, not crashed on.

**Deliverables**
- [x] S2.1 Parse DEV_PLAN grammar — pure function: text → milestones, steps, issues.
- [x] S2.2 Front matter context list — `toc.context` names the Context files.
- [x] S2.3 Parse diagnostics — duplicate ID, two `[~]`, bad marker → red header.
- [x] S2.4 DEV_PLAN.md template — scaffolded by `/project` when missing.
- [x] S2.5 Parser tests from fixtures — including this repo's own plan.
- [x] S2.6 Typed issue codes — dup-id, multi-doing, bad-marker, orphan-trailer, …

**Acceptance**
- [x] This repository's DEV_PLAN.md parses without errors (a test asserts it).
- [x] Every issue code has a fixture that produces it.

### M3 — Activation: a project folder, by the person or by Claude
toc is passive until pointed at a folder; Claude may point it itself (D19).

**Deliverables**
- [x] S3.1 /project [dir] command — opens the pane unfocused (D31).
- [x] S3.2 activate tool for Claude — `mcp__toc__activate({dir})`.
- [x] S3.3 Scaffold .toc + exclude — idempotent; `.git/info/exclude`; never overwrites.
- [x] S3.4 Remember cwd → base dir — `$.store`; re-activated on session start.
- [x] S3.5 Inject format context — the rules block, only while active (D17).

**Acceptance**
- [x] Running `/project` twice changes nothing the second time.
- [x] Claude, asked to set up a plan, calls `activate` without being told the tool name.

### M4 — The sidebar
Dense, keyboard-first, readable at 42 columns, themed like the rest of the shell.

**Deliverables**
- [x] S4.1 Palette from theme mode — gruvbox-material, from `~/.config/theme/mode`.
- [x] S4.2 Context section — files, age, missing ones dim.
- [x] S4.3 Plan section + folding — done milestones auto-fold; the `[~]` one opens.
- [x] S4.4 Cursor + vim hotkeys — j k h l g e o d f b, digits, q.
- [x] S4.5 Refresh: events + poll — turn.complete, PostToolUse, 2 s mtime poll.
- [x] S4.6 Width / truncation pass — 30–60 columns; dock and inline.
- [x] S4.7 Collapse + zoom sections — h/l on a header; z zooms (D27).
- [x] S4.8 Paging + section jumps — f/b page, 1–5 jump, j/k flow across sections.

**Acceptance**
- [x] Every row fits on one line at 42 columns; headers never wrap.
- [ ] Light mode looks right (user check: `theme light`, restart, look).
- [x] Edits to DEV_PLAN.md show in the sidebar within 2 s without a keypress.

### M5 — Attribution: which commits and files belong to which step
The point of the Artifacts section. Commits are linked by a trailer, files by a
ledger, both keyed on the single `[~]` step.

**Deliverables**
- [x] S5.1 Ledger PostToolUse hook — Write/Edit/NotebookEdit → `.toc/ledger.jsonl`.
  Plus files changed from Bash, via a git-status snapshot around each call.
- [x] S5.2 Plan-Step commit trailer — Bash `git commit` gets `--trailer 'Plan-Step: <id>'`.
  > **CORRECTED 2026-10-10.** First done through `attribution.text`, which the
  > model simply dropped; a deterministic command rewrite replaced it (D13).
- [x] S5.3 Git queries — log by trailer, numstat, status porcelain.
- [x] S5.4 Artifacts section — notes, commits, files A/M/✓, unattributed.
- [x] S5.5 Paged full-diff preview — native Code element, wrapped, paged by screen rows (D26, D35).
- [x] S5.6 Fold commits to files — h/l; newest open; per-file numstat (D25).

**Acceptance**
- [x] A commit Claude makes while a step is `[~]` carries that step's trailer.
- [x] A file Claude creates from Bash shows under the step.
- [x] Knowledge files and `.toc/` never appear as artifacts.

### M6 — Editor and viewer beside Claude
Reading a file or a change happens in real tools, in a tmux split that keeps
Claude's width.

**Deliverables**
- [x] S6.1 tmux split by width — now always the left half of Claude's pane (D20, revised).
- [x] S6.2 nvim per tmux window — socket keyed by window id; later files open as tabs.
- [x] S6.3 Diff tab for commit/file — replaced by the delta/lazygit viewer (D37).
- [x] S6.4 Fallback outside tmux — toast and copy the path.

**Acceptance**
- [x] A second file opens as a tab in the same nvim.
- [x] Quitting the viewer or nvim gives the keys back to toc (user check).
- [x] A closed pane is never used as a split target ("can't find pane").

### M9 — Plan repair
A broken plan should cost one keypress and a Haiku run, not the main model's
attention (D28, D29).

**Deliverables**
- [x] S9.1 Repair prompt in pane — `Repair? y/n` with the issues listed.
- [x] S9.2 Haiku repair subagent — contract + issues + file + session excerpt.
- [x] S9.3 Backup + trailer-safe IDs — `.toc/DEV_PLAN.md.bak`; trailer IDs never change.
- [x] S9.4 Broken-plan fixtures — one per issue code; repair is idempotent.

**Acceptance**
- [x] `y` repairs a plan with two `[~]` steps and the header turns green.
- [x] The repair's hand-back spends no main-model turn.

### M10 — Plan format v2: a human-grade plan toc can read
The v1 grammar made plans terse lists: easy to parse, useless for catching up.
v2 inverts it: the plan is a proper engineering document — why, scope,
deliverables, acceptance, tests — and toc reads only a small, fixed part of it
(D41). Selecting a milestone or step shows its own lines as a brief (D42).

**Deliverables**
- [x] S10.1 Grammar in SPEC §5 — milestones by heading, label lines, `—` titles.
- [x] S10.2 Parser for v2 — labels, acceptance counts, block line ranges; v1 still parses.
- [x] S10.3 Brief in Preview — Plan row → its lines of DEV_PLAN.md, real line numbers.
- [x] S10.4 toc:dev-plan skill — how to write the plan well; the grammar last.
- [x] S10.5 Convert this DEV_PLAN — every ID and marker kept; why and acceptance added.

**Acceptance**
- [x] This file parses without issues, and every step ID in git history still exists.
- [x] The user catches up on a step from the sidebar alone (brief + Artifacts).
- [ ] Claude, asked to "write a dev plan and start toc" in a fresh folder, produces a
      v2 plan that parses cleanly and activates toc.

**Tests**
1. `claude plugin test` — v2 fixtures: labels, ignored checkboxes, line ranges.
2. In this window: select M10, then S10.3, in Plan; Preview shows their lines.

### M11 — Review cleanups
An eight-block review (Haiku reviewers, findings checked by hand) found one
real bug, a layer of dead code, prompt text that pushes Claude the wrong way,
and logic written twice that had already drifted. This pays that down before
v0.1; the larger restructures stay as later steps.

**Deliverables**
- [x] S11.1 Fix zoom drill + click — `o` on a step reveals Artifacts under zoom; a click reloads Preview.
- [~] S11.2 Delete dead code — unused fields, exports, params and the keybinding migration.
- [ ] S11.3 Fix Claude-facing text — at most one [~], no grammar per turn, step size, "demonstrated".
- [ ] S11.4 One reveal helper — the zoom/unfold rule written once, not five times.
- [ ] S11.5 One left-column module — nvim and viewer as one record per window, one open routine.
- [ ] S11.6 Tests at the interface — tmux fake by operation, no argv indices; the missing cases.
- [ ] S11.7 Row width measured once — one row helper that measures its own prefix.
- [ ] S11.8 Keys dispatched by section — global keys, then one handler per section; per-section records.
- [ ] S11.9 Read the plan once — plan text kept with the parsed plan; one repair record.

**Acceptance**
- [ ] Every confirmed finding in A, B, D and E is fixed or consciously dropped.
- [ ] No behaviour change the user can see, except the two bug fixes.

### M7 — Dogfood and ship
Used on itself until the user's test batches pass, then tagged and installable
from the dotfiles.

**Deliverables**
- [x] S7.1 Dogfood on this repo — four test rounds; the user: "All works!" (2026-10-11).
- [x] S7.2 README + screenshots — install, keys, the grammar.
- [x] S7.3 Record KNOWLEDGE findings — every platform surprise, dated.
- [ ] S7.4 GitHub remote + tag v0.1 — once the user provides the remote.

**Acceptance**
- [x] The user's test batch passes with no open bug.
- [ ] `claude plugin install toc@claude-toc` works from the GitHub marketplace.

### M8 — Later
**Deliverables**
- [ ] S8.1 Hybrid nvim full view — the same tree as an nvim buffer, real gg/G and search (D12c).
- [ ] S8.2 Install via bootstrap — dotfiles: marketplace add, install, `/toc keys`.

## Decisions

- [ ] **Left-hand sidebar.** Impossible inside Claude Code (the dock is right-only).
      The only route is toc as its own tmux pane, which S8.1 would build towards.
- [x] **Acceptance tracking.** Counted, not ID'd (agreed 2026-10-11); revisit if
      per-criterion attribution is ever wanted.

## Definition of done

1. The user's test batch passes and v0.1 is tagged on GitHub.
2. A fresh machine gets toc from the dotfiles bootstrap with its key bindings.
3. A plan written with the toc:dev-plan skill is one the user would accept from
   a senior engineer — and the sidebar reads it without a parse issue.
