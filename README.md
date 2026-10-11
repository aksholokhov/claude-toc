# claude-toc

A table of contents for long Claude Code sessions: a sidebar inside Claude
Code that shows where the project's knowledge lives, how far `DEV_PLAN.md`
has got, and which commits and files each step produced — parsed from the
files themselves, so it can't drift.

```
─┤ Context ├────────────────── 3/4      knowledge files, age, missing ones dim
─┤ Plan ├──────────── 19/52 ▰▰▱▱▱▱      milestones → steps, ✓ ◐ ✗ ○, ⇡commits +files
─┤ Artifacts · S2.1 ├─────── ⇡1 +0      the step's notes, commits (fold to files), files A/M/✓
─┤ Preview · 7f7953d ├────── 1/36       the whole diff, paged
j:↓ k:↑ h:◂ l:▸ g:⤒ e:⤓ z:zoom  o:open d:diff ⌥j⇟ ⌥k⇞ ⌥h ⌥l
```

It's a Claude Code **mod** (a plugin with a TypeScript hooks module), so it
runs on a Claude Pro/Max login with no API key. The only model use is the
optional plan repair (one Haiku run, only when you press `y`).

Requires Claude Code ≥ 2.1.287 with fullscreen rendering (`"tui":
"fullscreen"`) for the docked sidebar; narrower terminals get it above the
prompt. Opening files needs tmux + nvim. Tested with v2.1.296.

## Install

```sh
claude plugin marketplace add ~/claude-toc     # or the GitHub repo once it has a remote
claude plugin install toc@claude-toc
```

Then, once, in a session: `/toc keys` — adds `Ctrl+X T` and `Alt+j/k/h/l`
to `~/.claude/keybindings.json` (it never overrides a key you bound).

For development, load the working tree instead: `claude --plugin-dir ~/claude-toc`
(edits hot-reload).

## Use

- `/project [dir]` — point the sidebar at a project folder. Creates
  `DEV_PLAN.md` from a template if missing, `.toc/` for its own state (kept
  out of git via `.git/info/exclude`), and remembers the folder for this
  working directory. Claude can do the same with the `mcp__toc__activate` tool.
- `Ctrl+X T` (or `/toc`) — focus the sidebar; again to close it.
- In the sidebar: `j`/`k` move, `⌥j`/`⌥k` page, `⌥h`/`⌥l` switch section,
  `h`/`l` fold (milestone, commit, or the whole section on its header),
  `z` zoom a section, `o`/Enter open, `d` diff, `Esc` back to the prompt.
- Files open in one nvim per tmux window: a split beside Claude when the
  window is ≥ 220 columns, below it otherwise; later files become tabs.

## DEV_PLAN.md

```markdown
## M1 Milestone title
- [x] S1.1 Short step title
  - detail goes in sub-bullets
- [~] S1.2 The one step in progress
- [-] S1.3 Cancelled
- [ ] S1.4 Todo
```

Stable IDs, at most one `[~]`, titles ≤ 28 characters. While toc is active
Claude gets these rules in its context, and while a step is `[~]`:

- Claude's `git commit` commands get `--trailer 'Plan-Step: <id>'`;
- files Claude writes, edits or changes from Bash are logged against the step
  in `.toc/ledger.jsonl`.

If the file stops parsing, the sidebar offers `Repair? y/n`; `y` backs the
file up to `.toc/DEV_PLAN.md.bak` and has a Haiku subagent fix it.

## Develop

```sh
claude plugin validate .   # static checks of the hooks module
claude plugin test         # unit + pane tests, no session needed
```

`hooks/register.ts` holds everything that touches the mods API; `hooks/lib/`
is pure and unit-tested. `SPEC.md` is the design, `DEV_PLAN.md` the plan
(rendered by the plugin itself), `KNOWLEDGE.md` the platform findings.
