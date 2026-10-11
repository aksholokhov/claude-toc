// The editor half (SPEC §7.5): one nvim per tmux window, reached over a
// socket; files open as tabs. Pure argv builders — register.ts runs them.

export type TmuxInfo = { windowId: string; windowWidth: number }

export function tmuxInfoArgs(pane: string): string[] {
  return ['tmux', 'display-message', '-p', '-t', pane, '#{window_id} #{window_width}']
}

export function parseTmuxInfo(out: string): TmuxInfo | null {
  const m = /^(@\d+)\s+(\d+)/.exec(out.trim())
  return m ? { windowId: m[1], windowWidth: Number(m[2]) } : null
}

export function socketPath(runtimeDir: string, windowId: string): string {
  return runtimeDir.replace(/\/$/, '') + '/toc-nvim-' + windowId.replace('@', 'w') + '.sock'
}

export function aliveArgs(socket: string): string[] {
  return ['nvim', '--server', socket, '--remote-expr', '1']
}

export function remoteTabArgs(socket: string, path: string): string[] {
  return ['nvim', '--server', socket, '--remote-tab', path]
}

export function selectPaneArgs(pane: string): string[] {
  return ['tmux', 'select-pane', '-t', pane]
}

export function paneAliveArgs(pane: string): string[] {
  return ['tmux', 'display-message', '-p', '-t', pane, '#{pane_id}']
}

// ── the viewer: a diff or lazygit in the left column ────────────────────
// The left of Claude's pane is one column shared by nvim and the viewer:
// the first to open splits Claude's pane in half, the second splits that
// pane top/bottom so Claude keeps its width. The viewer runs in the pane
// itself and the pane closes when it quits (q in the pager / lazygit).

export type ViewTarget =
  | { kind: 'commit'; sha: string }
  | { kind: 'cfile'; sha: string; path: string }
  | { kind: 'file'; path: string; untracked: boolean }

// `git show`/`git diff` through the pager the person configured (core.pager:
// delta here); viewerEnv keeps the pager from quitting on a short diff.
export function diffViewArgs(root: string, t: ViewTarget): string[] {
  const git = ['git', '-C', root]
  if (t.kind === 'commit') return [...git, 'show', '--stat', '--patch', '-M', t.sha]
  if (t.kind === 'cfile') return [...git, 'show', '-M', t.sha, '--', t.path]
  if (t.untracked) return [...git, 'diff', '--no-index', '--', '/dev/null', t.path]
  return [...git, 'diff', 'HEAD', '--', t.path]
}

// lazygit at the commit log, or filtered to one file's history.
export function lazygitArgs(root: string, path: string | null): string[] {
  return path === null ? ['lazygit', '-p', root, 'log'] : ['lazygit', '-p', root, '-f', path]
}

// The environment the viewer needs from the person's shell, which a pane
// spawned by tmux doesn't get (the tmux global env can be stale): the theme
// for delta and lazygit (THEME.md), and a less that waits for q: delta
// runs its own `less --quit-if-one-screen` unless DELTA_PAGER says otherwise.
export function viewerEnv(mode: 'dark' | 'light', lazygitConfig: string | null): string[] {
  const env = ['LESS=-R', 'DELTA_PAGER=less -R', 'DELTA_FEATURES=+gm-' + mode]
  if (lazygitConfig) env.push('LG_CONFIG_FILE=' + lazygitConfig)
  return env.flatMap((kv) => ['-e', kv])
}

// Open `cmd` in the left column: below/above the other left pane when it is
// there (`beside`), else as the left half of Claude's pane.
export function leftSplitArgs(claudePane: string, beside: string | null, above: boolean, cwd: string, env: string[], cmd: string[]): string[] {
  const where = beside
    ? ['-v', ...(above ? ['-b'] : []), '-l', '50%', '-t', beside]
    : ['-h', '-b', '-l', '50%', '-t', claudePane]
  return ['tmux', 'split-window', ...where, '-c', cwd, ...env, '-P', '-F', '#{pane_id}', ...cmd]
}

// Reuse the viewer pane: replace what runs in it.
export function respawnArgs(pane: string, cwd: string, env: string[], cmd: string[]): string[] {
  return ['tmux', 'respawn-pane', '-k', '-t', pane, '-c', cwd, ...env, ...cmd]
}
