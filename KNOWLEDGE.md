# KNOWLEDGE — claude-toc

Hard-won facts about the platform. Verified against the docs on 2026-10-10
(Claude Code 2.1.296); re-check against the types for your installed build.

## Mods (code.claude.com/docs/en/plugins/mods/*)
- A mod = plugin + `hooks/hooks.json` `{"modules": ["./register.ts"]}` +
  an ES module exporting `register(on, options)`. `.ts` loads directly.
- Sidebar: `$.ui.open({id, columns, focus: true})` → docks beside the
  transcript only in fullscreen TUI (`"tui": "fullscreen"`) and wide enough;
  otherwise an inline pane above the prompt. Unprompted opens need ≥144 cols
  (110 after the user opened it once).
- **Keys:** a mod never reads keys. Only Button `hotkey`s — one digit or one
  *lowercase* letter. Tab / arrows / Enter / PgUp/PgDn / Home/End / Esc are
  Claude's. No `G`, `gg`, `/`, counts.
- Focus a pane: `Ctrl+X Tab`; close: `Ctrl+X X`; resize: `Ctrl+X ←/→`.
- **Keybindings can't run slash commands** (no `command:` action). Button
  `action:` can borrow a built-in action: the user's chord for it presses the
  button.
- No file watcher: use `$.clock.every` + `$.fs.stat`. `$.process.run` has no
  shell (argv list), 30 s default timeout.
- `$.state` resets on `/clear` `/resume` `/branch`; re-seed in
  `classic.SessionStart` with `source` filter. `$.store` persists (shared by
  all sessions, 4 MiB).
- Hooks have a 10 s own-time budget; redraws throttle at 30/s for the
  visible pane.
- `attribution.text` event lets a mod rewrite commit/PR attribution text —
  that's where the `Plan-Step:` trailer goes.
- Mods spend no usage unless they call `$.model.*` — Pro-plan safe.
- Reference implementation: built-in `cc-plugin-diff`
  (github.com/anthropics/claude-code/tree/main/mods/diff).
