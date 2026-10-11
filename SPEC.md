# claude-toc — SPEC

A "table of contents" for long-running Claude Code work: a right-hand sidebar
that answers *where is the knowledge, where are we in the plan, and what did
each step produce* — without Claude ever editing the panel itself.

Status: **agreed** (interview 2026-10-10). Decisions are numbered `D#` so the
plan and commits can cite them.

## 1. Goals / non-goals

Goals
- **G1 Orientation at a glance** — knowledge banks, plan progress, per-step
  artifacts, in one dense panel.
- **G2 No drift** — the plan view is *parsed* from `DEV_PLAN.md`; attribution
  is *derived* from git trailers and a hook-written ledger. Nothing is
  hand-maintained twice.
- **G3 Pro-subscription friendly** — runs inside the official Claude Code
  harness; no API key, no separate billing. The only model use is the
  plan-repair subagent, and only after an explicit "yes" (§7.6).
- **G4 Vim-first** — keyboard navigation with vim letters; files open in nvim.
- **G5 Cohesive** — gruvbox-material dark/light, following
  `~/.config/theme/mode` (dotfiles THEME.md contract).

Non-goals (v1)
- Editing the plan from the panel (Claude/you edit `DEV_PLAN.md` directly).
- Attributing *manual* commits automatically (no git hooks installed).
- Non-terminal surfaces (Desktop app, VS Code) beyond "doesn't crash".
- Installation via dotfiles `bootstrap.sh` (later scope).

## 2. Platform (D1, D12)

- A **Claude Code plugin containing a mod** (TypeScript hooks module), in
  `~/claude-toc`, the repo doubling as a one-plugin marketplace.
- Requires Claude Code ≥ 2.1.287 (mods GA) and `"tui": "fullscreen"` for the
  docked sidebar; in a narrow terminal the pane falls back to Claude's inline
  placement above the prompt.
- The editor half needs **tmux + nvim**; outside tmux, "open" degrades to a
  toast plus copying the path (`$.ui.copy`).

## 3. Scope unit: a project folder (D1)

- The panel belongs to a **base folder** (where the knowledge files live), not
  to a Claude session. Several sessions may show the same folder.
- `cwd → base folder` is remembered in the mod's `$.store`; a later session in
  the same cwd re-activates silently.
- The base folder may be anywhere inside a git repo (e.g. a monorepo
  subfolder); git operations use that repo. Outside git, the Artifacts section
  shows ledger entries only.

## 4. Layout

One pane, ~40 columns, four stacked **sections**. Each section can be
collapsed to its one-line header (which then shows a summary), and any section
can be **zoomed** to take the whole pane while the others collapse (D27).

```
─┤ Context ├────────────── 3/4
 󰈙 SPEC.md               2d   ← icon + age; dimmed if missing
 󰈙 DEV_PLAN.md           3m
─┤ Plan ├──────── 7/15 ▰▰▰▱▱▱
▸ M1 Ingest           4/4 ✓   ← done milestone: folded, green, dim
▾ M2 Attribution      2/5     ← active milestone: bold yellow
  ✓ S2.1 trailer hook         green
  ◐ S2.2 ledger hook  ⇡3 +2   yellow bold · 3 commits, 2 files
  ✗ S2.3 watchman             grey italic (cancelled)
  ○ S2.4 render               default fg
─┤ Artifacts · S2.2 ├─────────
 notes: sub-bullets of the step
 ▾ e07a5c add trailer  +31-2  ← commits fold (h/l) to their files
     src/trailer.ts    +29-0
     src/register.ts    +2-2
 ▸ 9f3e1a ledger hook +86-4
 A  hooks/ledger.ts           A new (green) · M modified (yellow)
─┤ Preview · e07a5c ├── 1/4 ──  ← page n of N
 @@ src/trailer.ts @@
 +on('attribution.text', …
```

### 4.1 Context (D2)
- Defaults: `SPEC.md`, `DEV_PLAN.md`, `KNOWLEDGE.md`, `SCRATCHPAD.md`.
- `DEV_PLAN.md` front matter may add/replace entries (`toc.context: [...]`).
- Each row: icon, name, age since mtime. Missing files are shown dimmed.
- Collapsed summary: `present/total`.

### 4.2 Plan (D3)
- Parsed from `DEV_PLAN.md` (grammar in §5). Header shows done/total and a
  bar. Done milestones auto-fold; the milestone containing `[~]` auto-expands.
- Step row: status glyph, ID, title (truncate-end), and counters
  `⇡<commits> +<files>` when non-zero.
- When the plan doesn't parse, the header turns red and the repair prompt
  appears (§7.6).

### 4.3 Artifacts (D5, D25) — for the selected step
- The step's sub-bullet notes (dim).
- Commits with trailer `Plan-Step: <id>`: short sha, subject, `+add-del`.
  Each commit **folds** (`h`/`l`) to its changed files with per-file numstat;
  commits start folded except the newest.
- Ledger files attributed to the step, with status `A` / `M` / `✓`.

### 4.4 Preview (D14, D26) — for the item selected in Artifacts
- The **whole** diff of the selected commit (`git show`) or file
  (`git diff` / file content for untracked), not just its head.
- Rendered with Claude Code's native `Code` element (`language: 'diff'` or the
  file's language): Claude's own syntax highlighting, theme-matched, and no
  bat/delta dependency. Paged with `J`/`K`; header shows `page n/N`.
- Capped at the mods per-tree text limit (100 000 chars); beyond that the last
  page says "truncated: `d` opens the full diff in nvim".

## 5. DEV_PLAN.md grammar (D3)

```markdown
---
toc:
  context: [SPEC.md, DEV_PLAN.md, KNOWLEDGE.md, SCRATCHPAD.md]
---
## M1 Milestone title            ← H2 = milestone ("chapter")
### Optional group               ← H3 = visual group only, no status
- [x] S1.1 Short step title      ← step: checkbox + stable ID + title
  - note lines (shown in Artifacts, not in the Plan list)
- [~] S1.2 In-progress step
- [-] S1.3 Cancelled step
- [ ] S1.4 Todo step
```

- Markers: `[ ]` todo · `[~]` in progress · `[x]` done · `[-]` cancelled.
- **IDs are stable**: `S<milestone>.<n>`, never reused or renumbered; reorder
  freely.
- **At most one `[~]`** in the file (the ledger needs a single active step).
- Max nesting: milestone → step. Prefer long flat lists over depth.
- Titles ≤ 28 characters; detail goes into the indented sub-bullets.
- Milestone status is derived from its steps (never written).
- Anything the grammar doesn't match is ignored by the parser (prose is fine).
- Parse problems (duplicate ID, two `[~]`) show as a red line in the Plan
  header — they never crash the panel.

## 6. Attribution

### 6.1 Commits (D4, D13)
- The trailer `Plan-Step: S2.2` is the contract.
- The mod's `attribution.text` hook appends it to commits Claude makes while
  a step is `[~]`. Manual commits are attributed only if you type the trailer.
- Lookup: every commit in the repo with a matching trailer (no path filter —
  D18).

### 6.2 Uncommitted / untracked files (D5)
- The mod hooks `classic.PostToolUse` for Write/Edit/NotebookEdit and appends
  `{ts, path, step, session}` to `<base>/.toc/ledger.jsonl`.
- No `[~]` step → `step: null` → shown in an "unattributed" bucket.
- `.toc/` is excluded via `.git/info/exclude` (no tracked file touched).
- Display status comes from git at render time: untracked → `A`,
  modified → `M`, clean and in an attributed commit → `✓`.

## 7. Interaction

### 7.1 Keys, while the pane is focused (D12, D24)
Mods receive single lowercase-letter/digit button hotkeys natively. Uppercase
keys go through a documented side door: a Button's `action:` names a built-in
keybinding action, and the user's **modified-key** binding for that action
presses the button. A one-time `/toc keys` merges `shift+j/k/h/l` into the
`Pane` context of `~/.claude/keybindings.json` after showing the diff (later:
dotfiles bootstrap does it). Proven or rejected by spike S1.7. Arrows, Tab,
Enter, PgUp/PgDn, Home/End and Esc stay Claude Code's.

| Key | Action |
|---|---|
| `j` / `k` | cursor down / up within the focused section (preview: one line) |
| `J` / `K` | page down / up within the focused section (long Plan, Preview) |
| `H` / `L` | focus previous / next section |
| `h` / `l` | fold / unfold: milestone, commit, or the section itself on its header |
| `z` | zoom the focused section to the full pane; again to restore |
| `g` / `e` | top / end of section |
| `o`, Enter | open: file → nvim tab; step → its Artifacts; commit → Preview |
| `d` | open the selected commit/file diff in nvim (full, untruncated) |
| `y` / `n` | answer the repair prompt, when shown (§7.6) |
| Esc | focus back to the prompt (Claude Code default) |

Fallback if the shift side door fails the spike: `J`/`K` → PgDn/PgUp (native
pane scroll), `H`/`L` → `1`–`4` section digits.

A footer row of plain buttons doubles as the key legend.

### 7.2 Commands and tool (D16, D19, D21)
- `/project [dir]` — activate for `dir` (asks if omitted): scaffold, remember,
  open the pane.
- `/toc` — immediate command: show/hide/focus the pane, works mid-turn.
- **Hotkey `Ctrl+X T`** for `/toc` (D23): a small band button with `action:`
  bound to a spare built-in keybinding action; `ctrl+x t` bound to it in
  `~/.claude/keybindings.json`. **Must be prototyped first**; fallback is a
  band digit hotkey (type `0` on an empty prompt and pause).
- Tool `mcp__claude-toc__activate({dir})` — the same activation; Claude may
  call it freely (e.g. after creating or finding a `DEV_PLAN.md`).

### 7.3 Scaffolding (D16) — idempotent, never overwrites
- Create `<base>/.toc/` and the ledger; add `.toc/` to `.git/info/exclude`.
- Create `DEV_PLAN.md` from a template **only if missing** (the template
  starts with an HTML comment describing the grammar).
- Never create `SPEC.md`, `KNOWLEDGE.md`, `SCRATCHPAD.md` or `CLAUDE.md`.

### 7.4 Context injection (D17)
- While active, the mod adds a ≈150-token block for Claude: the grammar,
  width rule, one-`[~]` rule, and "flip markers as you work". No CLAUDE.md
  edits (optional one-line pointer only on request).

### 7.5 Editor pane (D8, D20, D22)
- One nvim per **tmux window**, socket keyed by window id; started on first
  open, reused afterwards (`--server … --remote-tab`). Never hijack a nvim the
  user started.
- Split placement by width: window ≥ ~220 cols → split left of Claude's pane;
  otherwise split below (~45% height), so Claude keeps width for the docked
  sidebar.

### 7.6 Plan repair (D28, D29)
- When `DEV_PLAN.md` fails the grammar (duplicate ID, two `[~]`, malformed
  marker, renumbered ID that orphans trailers…), the Plan header turns red and
  a prompt replaces the list's first row:
  `DEV_PLAN.md is broken (2 issues). Repair? [y] yes [n] no`, issues listed
  below it.
- `y` dispatches a **Haiku subagent** (`$.agent.spawn`, model forced to
  `haiku` via the spawn options or our own `agent.spawn` hook). Its prompt
  carries: the grammar contract (SPEC §5), the parser's issue list, the current
  file, and a recent excerpt of this session (`$.session.messages()`, last
  ~40 entries, trimmed) so it can tell which step is really in progress.
- It edits the file with the normal **Edit** tool — so it goes through
  permissions, shows in `/diff`, and lands in the ledger. The mod keeps a copy
  at `.toc/DEV_PLAN.md.bak` first.
- Rule given to the subagent: never change a step ID that appears in a
  commit trailer; minimal edits; report what it changed in one line.
- `n` dismisses the prompt until the file changes again. The red header
  stays.
- Cost: one Haiku run on your plan's usage, only on `y`.

## 8. Refresh

No file watcher in the mods API, so:
- redraw on `turn.complete`, `classic.PostToolUse`, and after our own commands;
- a cheap `$.clock.every` poll (~2 s) of `DEV_PLAN.md` mtime and
  `.git/HEAD`/`index` mtimes, redrawing only on change.

## 9. Theming (D15)
- Truecolor hues mirrored from `nvim/lua/config/palette.lua` (dotfiles),
  chosen by `~/.config/theme/mode` read on each poll; if the file is absent
  (other hosts), fall back to Claude Code theme keys.
- Encoding channels: position (sections, indent), color (status), weight /
  italic / dim (activity), glyphs (`✓ ◐ ✗ ○ ▸ ▾`, Nerd Font file icons),
  counters.
- Section headers use embedded-title borders (`─┤ Plan ├────`), the
  framed terminal-RPG look used across the dotfiles TUIs.

## 10. Later scope
- **Hybrid view (D12c)**: `v` opens the same tree as a full nvim buffer for
  real vim motions (`gg`, `G`, `/`).
- Install via dotfiles `bootstrap.sh`; a GitHub remote for `~/claude-toc`.

## 11. Decision log

| # | Decision |
|---|---|
| D1 | Scope = project folder; tmux window remembers it |
| D2 | Four default knowledge files; front matter may extend; missing = dim |
| D3 | H2 milestones → checkbox steps, stable IDs, `[ ] [~] [x] [-]`, ≤2 levels |
| D4 | Commit↔step via `Plan-Step:` git trailer |
| D5 | Uncommitted files via PostToolUse ledger; one `[~]` at a time |
| D8 | One dedicated nvim per tmux window; tabs per file |
| D12 | Host = native Claude Code mod sidebar; nvim full view later |
| D13 | Trailer auto-added to Claude's commits only (`attribution.text`) |
| D14 | Preview both in-pane and in nvim |
| D15 | Encoding as in §4 mockup |
| D16 | `/project` scaffolds `.toc/` + missing DEV_PLAN.md only; no CLAUDE.md |
| D17 | Injected context block teaches Claude the format |
| D18 | Commits matched by trailer, no path filter |
| D19 | Claude may activate freely |
| D20 | Editor split: left if wide, else below |
| D21 | `/project [dir]`, `/toc`, `mcp__claude-toc__activate` |
| D22 | nvim keyed per tmux window |
| D23 | `/toc` hotkey `Ctrl+X T` via borrowed action (prototype; fallback `0`) |
| D24 | `J`/`K` page, `H`/`L` switch section, via shift bindings → Button `action` (spike) |
| D25 | Commits fold to their files with `h`/`l`; replaces the `f` key |
| D26 | Preview = whole diff, native `Code` element, paged; `d` for full nvim diff |
| D27 | Sections collapse to one-line summaries; `z` zooms one section |
| D28 | Broken plan → `[y]/[n]` repair prompt in the pane |
| D29 | Repair = Haiku subagent via `$.agent.spawn`, Edit tool, backup first |
