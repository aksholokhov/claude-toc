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
- [x] S1.1 Plugin + marketplace json
  - .claude-plugin/{plugin,marketplace}.json, hooks/hooks.json
- [x] S1.2 Pull types for this build
  - use the d.ts Claude Code writes, not GitHub's
- [x] S1.3 /toc opens an empty pane
  - immediate: true; columns ≈ 40; check dock vs inline
- [x] S1.4 Spike: Ctrl+X T hotkey
  - works: Chat ctrl+x t → app:toggleReplTab
  - D23: band Button action= spare built-in action
  - verify no side effect; else fallback band digit `0`
- [x] S1.5 Test harness green
  - claude plugin test; one render snapshot test
- [x] S1.6 Read cc-plugin-diff source
  - steal: scrolling, key legend, keyboard actions
- [x] S1.7 Spike: shift J/K/H/L keys
  - D24: Pane-context shift+x → Button action
  - result: Shift never presses; Alt (Global) does
  - shipped as ⌥j/⌥k page, ⌥h/⌥l section
- [x] S1.8 Spike: haiku agent.spawn
  - D29: can a mod spawn a haiku subagent w/ prompt

## M2 Plan model
- [x] S2.1 Parse DEV_PLAN grammar
  - pure fn text → {milestones, steps, errors}
- [x] S2.2 Front matter context list
- [x] S2.3 Parse diagnostics
  - dup ID, two [~], bad marker → red header line
- [x] S2.4 DEV_PLAN.md template
- [x] S2.5 Parser tests from fixtures
- [x] S2.6 Typed issue codes
  - dup-id, multi-doing, bad-marker, orphan-trailer

## M3 Activation
- [x] S3.1 /project [dir] command
  - asks via Input when dir omitted
- [x] S3.2 activate tool for Claude
  - mcp__claude-toc__activate({dir}); D19
- [x] S3.3 Scaffold .toc + exclude
  - idempotent; .git/info/exclude; never overwrite
- [x] S3.4 Remember cwd → base dir
  - $.store; re-activate on session.start + classic.SessionStart
- [x] S3.5 Inject format context
  - ≈150 tokens, only while active (D17)

## M4 Sidebar render
- [x] S4.1 Palette from theme mode
  - mirror palette.lua; fallback to theme keys
  - light mode not yet seen live
- [x] S4.2 Context section
- [x] S4.3 Plan section + folding
  - auto-fold done milestones; expand the [~] one
- [x] S4.4 Cursor + vim hotkeys
  - j k h l g e 1 2 3 o d f; footer legend
- [x] S4.5 Refresh: events + poll
  - turn.complete, PostToolUse, 2s mtime poll
- [x] S4.6 Width / truncation pass
  - 30–60 cols; dock and inline placements
- [x] S4.7 Collapse + zoom sections
  - D27: h/l on header; z zoom; 1-line summaries
- [x] S4.8 Paging + section jumps
  - J/K page, H/L prev/next section

## M5 Attribution
- [x] S5.1 Ledger PostToolUse hook
  - Write/Edit/NotebookEdit → ledger.jsonl
  - + Bash edits via git-status snapshot
- [x] S5.2 Plan-Step commit trailer
  - attribution.text failed live (model drops it)
  - now: Bash git commit → --trailer rewrite
- [x] S5.3 Git queries
  - log by trailer, numstat, status porcelain
- [x] S5.4 Artifacts section
  - notes, commits, files A/M/✓, unattributed
- [x] S5.5 Paged full-diff preview
  - D26: own section; native Code; 100k cap
- [x] S5.6 Fold commits to files
  - D25: h/l; newest open; per-file numstat

## M6 Editor pane
- [x] S6.1 tmux split by width
  - ≥220 cols left, else below (D20)
- [x] S6.2 nvim per tmux window
  - socket keyed by window id; --remote-tab
- [x] S6.3 Diff tab for commit/file
- [x] S6.4 Fallback outside tmux
  - toast + $.ui.copy(path)

## M9 Plan repair
- [x] S9.1 Repair prompt in pane
  - D28: [y]/[n], issues listed, n until change
- [x] S9.2 Haiku repair subagent
  - contract + issues + file + session excerpt
- [x] S9.3 Backup + trailer-safe IDs
  - .toc/DEV_PLAN.md.bak; never touch trailer IDs
- [x] S9.4 Broken-plan fixtures
  - one per issue code; repair is idempotent

## M7 Dogfood & ship
- [~] S7.1 Dogfood on this repo
  - waiting on the user's test batch
- [x] S7.2 README + screenshots
- [x] S7.3 Record KNOWLEDGE findings
- [ ] S7.4 GitHub remote + tag v0.1

## M8 Later
- [ ] S8.1 Hybrid nvim full view (v)
  - D12c: same tree as nvim buffer, real gg/G//
- [ ] S8.2 Install via dotfiles bootstrap
