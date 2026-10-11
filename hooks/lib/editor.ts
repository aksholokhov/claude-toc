// The editor half (SPEC §7.5): one nvim per tmux window, reached over a
// socket; files open as tabs. Pure argv builders — register.ts runs them.

export const WIDE = 220

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

// Split beside Claude when the window is wide, else below it (D20).
export function splitArgs(claudePane: string, info: TmuxInfo, socket: string, cwd: string, path: string): string[] {
  const side = info.windowWidth >= WIDE ? ['-h', '-b', '-l', '45%'] : ['-v', '-l', '45%']
  return ['tmux', 'split-window', ...side, '-t', claudePane, '-c', cwd, '-P', '-F', '#{pane_id}', 'nvim', '--listen', socket, path]
}

export function selectPaneArgs(pane: string): string[] {
  return ['tmux', 'select-pane', '-t', pane]
}

export function paneAliveArgs(pane: string): string[] {
  return ['tmux', 'display-message', '-p', '-t', pane, '#{pane_id}']
}
