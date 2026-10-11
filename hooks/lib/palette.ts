// gruvbox-material (medium) hues, mirrored from dotfiles nvim/lua/config/palette.lua.
// The mode comes from ~/.config/theme/mode; unknown → Claude Code theme keys.

export type Mode = 'dark' | 'light' | null

export type Roles = {
  text: string
  strong: string
  dim: string
  faint: string
  done: string
  doing: string
  cancelled: string
  accent: string
  header: string
  add: string
  del: string
  err: string
  sha: string
  file: string
  group: string
  sel: string | undefined
}

const DARK = {
  fg0: '#d4be98', fg1: '#ddc7a1', red: '#ea6962', orange: '#e78a4e', yellow: '#d8a657', green: '#a9b665',
  aqua: '#89b482', blue: '#7daea3', purple: '#d3869b', grey0: '#7c6f64', grey1: '#928374', grey2: '#a89984', sel: '#45403d',
}
const LIGHT = {
  fg0: '#654735', fg1: '#4f3829', red: '#c14a4a', orange: '#c35e0a', yellow: '#b47109', green: '#6c782e',
  aqua: '#4c7a5d', blue: '#45707a', purple: '#945e80', grey0: '#a89984', grey1: '#928374', grey2: '#7c6f64', sel: '#eee0b7',
}

export function parseMode(text: string | null | undefined): Mode {
  const t = (text ?? '').trim()
  return t === 'dark' || t === 'light' ? t : null
}

export function rolesFor(mode: Mode): Roles {
  if (!mode) {
    return {
      text: 'text', strong: 'text', dim: 'inactive', faint: 'subtle', done: 'success', doing: 'warning',
      cancelled: 'subtle', accent: 'suggestion', header: 'text', add: 'success', del: 'error', err: 'error',
      sha: 'warning', file: 'suggestion', group: 'claude', sel: undefined,
    }
  }
  const p = mode === 'dark' ? DARK : LIGHT
  return {
    text: p.fg0, strong: p.fg1, dim: p.grey1, faint: p.grey0, done: p.green, doing: p.yellow, cancelled: p.grey0,
    accent: p.aqua, header: p.fg1, add: p.green, del: p.red, err: p.red, sha: p.orange, file: p.blue, group: p.purple,
    sel: p.sel,
  }
}
