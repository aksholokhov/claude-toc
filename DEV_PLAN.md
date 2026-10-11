---
toc:
  context: [SPEC.md, DEV_PLAN.md, KNOWLEDGE.md, SCRATCHPAD.md]
---
<!-- claude-toc grammar (SPEC §5):
  ## M<n> Title           milestone
  - [ ] S<n>.<k> Title    step; markers [ ] todo [~] doing [x] done [-] cancelled
    - notes               sub-bullets, shown in the Artifacts pane
  IDs are stable, never reused. One [~] at a time. Titles <= 28 chars. -->

# claude-toc — DEV_PLAN

Option chosen: **Build** (vs. combine / no-op; see design walkthrough).
Every step ends with `claude plugin validate --strict` + `claude plugin test`
green. Decision refs (`D#`) point into SPEC.md §11.

## M0 Discovery
- [x] S0.1 Grill the requirements
  - 4 rounds, D1–D23; mods discovered mid-interview (D12)
- [x] S0.2 Write SPEC.md
- [x] S0.3 Compare build/combine/no-op
  - Build chosen: only option covering per-step untracked files
- [x] S0.4 Write DEV_PLAN.md
- [x] S0.5 Design walkthrough artifact
  - https://claude.ai/artifact/QmMT28HLWoquxhVkfdNAk9

## M1 Skeleton & spikes
- [ ] S1.1 Plugin + marketplace json
  - .claude-plugin/{plugin,marketplace}.json, hooks/hooks.json
- [ ] S1.2 Pull types for this build
  - use the d.ts Claude Code writes, not GitHub's
- [ ] S1.3 /toc opens an empty pane
  - immediate: true; columns ≈ 40; check dock vs inline
- [ ] S1.4 Spike: Ctrl+X T hotkey
  - D23: band Button action= spare built-in action
  - verify no side effect; else fallback band digit `0`
- [ ] S1.5 Test harness green
  - claude plugin test; one render snapshot test
- [ ] S1.6 Read cc-plugin-diff source
  - steal: scrolling, key legend, keyboard actions
- [ ] S1.7 Spike: shift J/K/H/L keys
  - D24: Pane-context shift+x → Button action
  - fallback: PgDn/PgUp + section digits
- [ ] S1.8 Spike: haiku agent.spawn
  - D29: can a mod spawn a haiku subagent w/ prompt

## M2 Plan model
- [ ] S2.1 Parse DEV_PLAN grammar
  - pure fn text → {milestones, steps, errors}
- [ ] S2.2 Front matter context list
- [ ] S2.3 Parse diagnostics
  - dup ID, two [~], bad marker → red header line
- [ ] S2.4 DEV_PLAN.md template
- [ ] S2.5 Parser tests from fixtures
- [ ] S2.6 Typed issue codes
  - dup-id, multi-doing, bad-marker, orphan-trailer

## M3 Activation
- [ ] S3.1 /project [dir] command
  - asks via Input when dir omitted
- [ ] S3.2 activate tool for Claude
  - mcp__claude-toc__activate({dir}); D19
- [ ] S3.3 Scaffold .toc + exclude
  - idempotent; .git/info/exclude; never overwrite
- [ ] S3.4 Remember cwd → base dir
  - $.store; re-activate on session.start + classic.SessionStart
- [ ] S3.5 Inject format context
  - ≈150 tokens, only while active (D17)

## M4 Sidebar render
- [ ] S4.1 Palette from theme mode
  - mirror palette.lua; fallback to theme keys
- [ ] S4.2 Context section
- [ ] S4.3 Plan section + folding
  - auto-fold done milestones; expand the [~] one
- [ ] S4.4 Cursor + vim hotkeys
  - j k h l g e 1 2 3 o d f; footer legend
- [ ] S4.5 Refresh: events + poll
  - turn.complete, PostToolUse, 2s mtime poll
- [ ] S4.6 Width / truncation pass
  - 30–60 cols; dock and inline placements
- [ ] S4.7 Collapse + zoom sections
  - D27: h/l on header; z zoom; 1-line summaries
- [ ] S4.8 Paging + section jumps
  - J/K page, H/L prev/next section

## M5 Attribution
- [ ] S5.1 Ledger PostToolUse hook
  - Write/Edit/NotebookEdit → ledger.jsonl
- [ ] S5.2 Plan-Step commit trailer
  - attribution.text, only while a step is [~]
- [ ] S5.3 Git queries
  - log by trailer, numstat, status porcelain
- [ ] S5.4 Artifacts section
  - notes, commits, files A/M/✓, unattributed
- [ ] S5.5 Paged full-diff preview
  - D26: own section; native Code; 100k cap
- [ ] S5.6 Fold commits to files
  - D25: h/l; newest open; per-file numstat

## M6 Editor pane
- [ ] S6.1 tmux split by width
  - ≥220 cols left, else below (D20)
- [ ] S6.2 nvim per tmux window
  - socket keyed by window id; --remote-tab
- [ ] S6.3 Diff tab for commit/file
- [ ] S6.4 Fallback outside tmux
  - toast + $.ui.copy(path)

## M9 Plan repair
- [ ] S9.1 Repair prompt in pane
  - D28: [y]/[n], issues listed, n until change
- [ ] S9.2 Haiku repair subagent
  - contract + issues + file + session excerpt
- [ ] S9.3 Backup + trailer-safe IDs
  - .toc/DEV_PLAN.md.bak; never touch trailer IDs
- [ ] S9.4 Broken-plan fixtures
  - one per issue code; repair is idempotent

## M7 Dogfood & ship
- [ ] S7.1 Dogfood on this repo
- [ ] S7.2 README + screenshots
- [ ] S7.3 Record KNOWLEDGE findings
- [ ] S7.4 GitHub remote + tag v0.1

## M8 Later
- [ ] S8.1 Hybrid nvim full view (v)
  - D12c: same tree as nvim buffer, real gg/G//
- [ ] S8.2 Install via dotfiles bootstrap
