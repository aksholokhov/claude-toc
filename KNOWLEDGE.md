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

## Spike results (2026-10-10, v2.1.296, verified live in a detached tmux)
- **Plugin name can't start with `claude-`** (`claude plugin validate`
  refuses it) → the plugin is `toc`; the tool is `mcp__toc__activate`.
- **Ctrl+X T works**: `Chat` context `"ctrl+x t": "app:toggleReplTab"` + an
  AbovePrompt Button with `action: 'app:toggleReplTab'` → pressed (S1.4).
  The action must have no engine handler mounted; with `cc-plugin-diff`
  enabled, `app:toggleReplTab`, `app:toggleDiffNoiseFilter`,
  `app:toggleDiffPreSession` only reach the old panel, so they are free.
  `confirm:previousField`, `permission:toggleDebug` are inert too.
- **Shift+letter can't be a binding that presses a Button** (S1.7). Hotkeys
  are lowercased on keydown (Shift+J hits the `j` hotkey); a `shift+j`
  binding in `Global` or `Pane` never pressed the action Button — the
  uppercase letter is typed into the prompt instead. **Alt+letter in the
  `Global` context does press it**, from the prompt and from a focused pane.
  `Pane`-context bindings never pressed a Button. → page/section keys are
  `Alt+j/k/h/l` (`meta+j` …), which tmux's root table leaves free here.
- A mod's `$.command.run` of its **own** command doesn't reach its own
  `command.run` hook ("no command.run hook answered it"); call a shared
  top-level function instead.
- **`$.agent.spawn` works** (S1.8): `$.agent.register({name:'repair',
  model:'haiku', tools:[...]})` then `$.agent.spawn({subagentType:
  'toc:repair', prompt, description})` → `{model:'claude-haiku-5-5',
  agentId}`; the answer arrives as `turn.complete` with `e.agentId`.
  Side effect: the background agent's completion is also delivered to the
  main model as a task notification, which spends a main-model turn —
  consume it in `session.receive`.
- `Ctrl+X Tab` focuses the band first, then each pane.
- Two `Ctrl+C` on an empty prompt exits Claude (careful when scripting).
- Pane docked at `columns: 42` in a 200-col window: `placement: 'dock'`,
  `bodyRows` = window rows − 7.
- `Code` with `format: 'diff'` needs whole hunks ("a diff cut mid-hunk does
  not parse") → pages carry synthetic `@@` headers.
- Text `color` accepts hex strings as well as theme keys.
