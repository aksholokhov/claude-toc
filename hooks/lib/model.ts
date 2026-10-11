// Sidebar state, rows and navigation. Pure: (UI, Data, key) → (UI, Effect).

import type { Commit, FileState } from './git.ts'
import type { DiffFile } from './diff.ts'
import { diffCosts, diffRows, fitCount, lastOffset, pageBack, sourceCosts, sourceRowCount } from './diff.ts'
import { activeStep, allSteps, findStep, hasErrors, isActive, isComplete } from './plan.ts'
import type { Plan, Step } from './plan.ts'

export const SECTIONS = ['Context', 'Plan', 'Artifacts', 'Preview', 'Keys'] as const
export const CTX = 0
export const PLAN = 1
export const ART = 2
export const PREV = 3
export const KEYS = 4
export const UNATTRIBUTED = ''

export type CtxFile = { name: string; path: string; exists: boolean; mtimeMs: number }
export type ArtFile = { path: string; rel: string; state: FileState }

export type Data = {
  base: string
  root: string | null
  plan: Plan | null
  planPath: string
  context: CtxFile[]
  commits: Map<string, Commit[]>
  files: Map<string, ArtFile[]>
  now: number
}

export type RepairPhase = 'ask' | 'running' | 'dismissed'
export type Repair = { phase: RepairPhase; sig: string } | null

export type Target =
  | { kind: 'commit'; sha: string; short: string }
  | { kind: 'cfile'; sha: string; short: string; path: string }
  | { kind: 'file'; path: string; rel: string; state: FileState }

export type Preview = { key: string; files: DiffFile[] | null; source: string | null; path: string; error?: string }

export type UI = {
  sec: number
  zoom: number | null
  collapsed: number[]
  cursor: (string | null)[]
  offset: number[]
  fold: Record<string, boolean>
  open: Record<string, boolean>
  step: string | null
  previewOffset: number
}

export type Row =
  | { key: string; kind: 'ctx'; file: CtxFile }
  | { key: string; kind: 'ms'; id: string }
  | { key: string; kind: 'step'; step: Step }
  | { key: string; kind: 'unattr'; count: number }
  | { key: string; kind: 'issue'; text: string; severity: 'error' | 'warn' }
  | { key: string; kind: 'repair'; phase: RepairPhase; count: number }
  | { key: string; kind: 'note'; text: string }
  | { key: string; kind: 'commit'; commit: Commit; isOpen: boolean }
  | { key: string; kind: 'cfile'; commit: Commit; path: string; add: number; del: number }
  | { key: string; kind: 'file'; file: ArtFile }
  | { key: string; kind: 'empty'; text: string }

export type Effect =
  | { kind: 'none' }
  | { kind: 'open'; path: string; line?: number }
  | { kind: 'view'; target: Target }
  | { kind: 'history'; path: string | null }
  | { kind: 'repair'; yes: boolean }
  | { kind: 'scaffold' }
  | { kind: 'close' }

export function initialUI(): UI {
  // Keys starts folded: its header row still carries the hotkeys (view.ts).
  return { sec: PLAN, zoom: null, collapsed: [KEYS], cursor: [null, null, null, null, null], offset: [0, 0, 0, 0, 0], fold: {}, open: {}, step: null, previewOffset: 0 }
}

// ── rows ────────────────────────────────────────────────────────────────

export function isFolded(ui: UI, plan: Plan, id: string): boolean {
  if (id in ui.fold) return ui.fold[id]
  const m = plan.milestones.find((x) => x.id === id)
  return !!m && isComplete(m) && !isActive(m)
}

export function selectedStep(ui: UI, data: Data): string | null {
  if (ui.step !== null) return ui.step
  const plan = data.plan
  const a = plan ? activeStep(plan) : null
  if (a) return a.id
  const steps = plan ? allSteps(plan) : []
  return steps.length ? steps[0].id : null
}

export function planRows(ui: UI, data: Data, repair: Repair): Row[] {
  const plan = data.plan
  if (!plan) return [{ key: 'p:none', kind: 'empty', text: 'no DEV_PLAN.md: run /project' }]
  const rows: Row[] = []
  const errors = plan.issues.filter((i) => i.severity === 'error')
  if (errors.length && repair && repair.phase !== 'dismissed') {
    rows.push({ key: 'p:repair', kind: 'repair', phase: repair.phase, count: errors.length })
  }
  if (errors.length) {
    errors.slice(0, 4).forEach((i, n) => rows.push({ key: 'p:issue:' + n, kind: 'issue', text: (i.line ? 'L' + i.line + ' ' : '') + i.message, severity: 'error' }))
  }
  for (const m of plan.milestones) {
    rows.push({ key: 'm:' + m.id, kind: 'ms', id: m.id })
    if (isFolded(ui, plan, m.id)) continue
    for (const s of m.steps) rows.push({ key: 's:' + s.id, kind: 'step', step: s })
  }
  const loose = data.files.get(UNATTRIBUTED)
  if (loose && loose.length) rows.push({ key: 's:' + UNATTRIBUTED, kind: 'unattr', count: loose.length })
  if (!plan.milestones.length) rows.push({ key: 'p:empty', kind: 'empty', text: 'no milestones yet' })
  return rows
}

export function isCommitOpen(ui: UI, commits: Commit[], sha: string): boolean {
  if (sha in ui.open) return ui.open[sha]
  return commits.length > 0 && commits[0].sha === sha
}

export function artRows(ui: UI, data: Data): Row[] {
  const id = selectedStep(ui, data)
  if (id === null) return [{ key: 'a:none', kind: 'empty', text: 'select a step' }]
  const rows: Row[] = []
  const step = data.plan ? findStep(data.plan, id) : null
  if (step) step.notes.forEach((t, n) => rows.push({ key: 'n:' + n, kind: 'note', text: t }))
  const commits = data.commits.get(id) ?? []
  for (const c of commits) {
    const isOpen = isCommitOpen(ui, commits, c.sha)
    rows.push({ key: 'k:' + c.sha, kind: 'commit', commit: c, isOpen })
    if (isOpen) for (const f of c.files) rows.push({ key: 'kf:' + c.sha + ':' + f.path, kind: 'cfile', commit: c, path: f.path, add: f.add, del: f.del })
  }
  for (const f of data.files.get(id) ?? []) rows.push({ key: 'f:' + f.path, kind: 'file', file: f })
  if (!commits.length && !(data.files.get(id) ?? []).length) rows.push({ key: 'a:empty', kind: 'empty', text: 'no commits or files yet' })
  return rows
}

export function ctxRows(data: Data): Row[] {
  return data.context.map((f) => ({ key: 'c:' + f.name, kind: 'ctx', file: f }) as Row)
}

export function rowsOf(sec: number, ui: UI, data: Data, repair: Repair): Row[] {
  if (sec === CTX) return ctxRows(data)
  if (sec === PLAN) return planRows(ui, data, repair)
  if (sec === ART) return artRows(ui, data)
  return []
}

// ── preview target ──────────────────────────────────────────────────────

export function targetOf(row: Row | undefined): Target | null {
  if (!row) return null
  if (row.kind === 'commit') return { kind: 'commit', sha: row.commit.sha, short: row.commit.short }
  if (row.kind === 'cfile') return { kind: 'cfile', sha: row.commit.sha, short: row.commit.short, path: row.path }
  if (row.kind === 'file') return { kind: 'file', path: row.file.path, rel: row.file.rel, state: row.file.state }
  return null
}

// The Artifacts row under the cursor, else the first previewable one.
export function previewTarget(ui: UI, data: Data): Target | null {
  const rows = artRows(ui, data)
  const at = rows.find((r) => r.key === ui.cursor[ART])
  return targetOf(at) ?? rows.map(targetOf).find((t) => t !== null) ?? null
}

export function targetKey(t: Target): string {
  if (t.kind === 'commit') return 'commit:' + t.sha
  if (t.kind === 'cfile') return 'commit:' + t.sha
  return 'file:' + t.path + ':' + t.state
}

export function targetTitle(t: Target | null): string {
  if (!t) return '—'
  if (t.kind === 'file') return t.rel.split('/').pop() ?? t.rel
  if (t.kind === 'cfile') return t.short + ' ' + (t.path.split('/').pop() ?? '')
  return t.short
}

export function previewRowCount(p: Preview | null): number {
  if (!p) return 0
  if (p.files) return diffRows(p.files).length
  if (p.source !== null) return sourceRowCount(p.source)
  return 1
}

// Cells Code's gutter takes beside a line, measured live on 2.1.296: the
// line number padded by one, a space, then the +/-/space marker for a diff.
export function gutterWidth(p: Preview): number {
  if (p.files) {
    const top = Math.max(1, ...p.files.flatMap((f) => f.hunks.map((h) => Math.max(h.oldStart, h.newStart) + h.lines.length)))
    return String(top).length + 3
  }
  return String(p.source === null ? 1 : sourceRowCount(p.source)).length + 2
}

// Screen rows each preview row takes at this pane width (Code wraps).
export function previewCosts(p: Preview | null, width: number): number[] {
  if (!p || p.error) return []
  const room = Math.max(8, width - gutterWidth(p))
  if (p.files) return diffCosts(p.files, room)
  if (p.source !== null) return sourceCosts(p.source, room)
  return []
}

// For a commit-file target the preview starts at that file's header.
export function fileRowIndex(p: Preview | null, path: string): number {
  if (!p || !p.files) return 0
  const rows = diffRows(p.files)
  const fi = p.files.findIndex((f) => f.path === path)
  const idx = rows.findIndex((r) => r.kind === 'file' && r.file === fi)
  return Math.max(0, idx)
}

// ── layout ──────────────────────────────────────────────────────────────

export const LEGEND_ROWS = 3
const ALL = SECTIONS.map((_, i) => i)

export function isShown(ui: UI, sec: number): boolean {
  return ui.zoom === null ? !ui.collapsed.includes(sec) : ui.zoom === sec
}

// Body rows for each section's content (headers and legend excluded).
export function allocate(ui: UI, counts: number[], bodyRows: number, legendRows = LEGEND_ROWS): number[] {
  const al = ALL.map(() => 0)
  const keys = !ui.collapsed.includes(KEYS) || ui.zoom === KEYS ? legendRows : 0
  const avail = Math.max(4, bodyRows - SECTIONS.length - keys)
  if (ui.zoom !== null) {
    al[ui.zoom] = ui.zoom === KEYS ? legendRows : avail
    return al
  }
  al[KEYS] = keys
  const shown = ALL.map((s) => isShown(ui, s))
  if (shown[CTX]) al[CTX] = Math.min(counts[CTX], 6)
  let rest = avail - al[CTX]
  if (shown[ART]) al[ART] = Math.min(counts[ART], Math.max(3, Math.round(rest * 0.3)))
  if (shown[PREV]) al[PREV] = counts[PREV] ? Math.max(4, Math.round(rest * 0.3)) : 1
  rest -= al[ART] + al[PREV]
  if (shown[PLAN]) al[PLAN] = Math.max(0, rest)
  else if (shown[PREV]) al[PREV] += Math.max(0, rest)
  else if (shown[ART]) al[ART] += Math.max(0, rest)
  else if (shown[CTX]) al[CTX] += Math.max(0, rest)
  return al
}

// ── navigation ──────────────────────────────────────────────────────────

function indexOf(rows: Row[], key: string | null): number {
  if (key === null) return -1
  const i = rows.findIndex((r) => r.key === key)
  return i < 0 ? (rows.length ? 0 : -1) : i
}

function withCursor(ui: UI, sec: number, rows: Row[], idx: number, alloc: number): UI {
  const i = Math.max(-1, Math.min(idx, rows.length - 1))
  const cursor = ui.cursor.slice()
  cursor[sec] = i < 0 ? null : rows[i].key
  const offset = ui.offset.slice()
  offset[sec] = keepVisible(offset[sec], i, alloc, rows.length)
  const next = { ...ui, cursor, offset }
  return sec === ART ? { ...next, previewOffset: 0 } : sec === PLAN ? followStep(next, rows[i]) : next
}

// Artifacts follows the step under the Plan cursor.
function followStep(ui: UI, row: Row | undefined): UI {
  if (!row || (row.kind !== 'step' && row.kind !== 'unattr')) return ui
  const id = row.kind === 'step' ? row.step.id : UNATTRIBUTED
  if (ui.step === id) return ui
  const cursor = ui.cursor.slice()
  cursor[ART] = null
  const offset = ui.offset.slice()
  offset[ART] = 0
  return { ...ui, step: id, cursor, offset, previewOffset: 0 }
}

export function keepVisible(offset: number, idx: number, alloc: number, n: number): number {
  let o = offset
  if (idx >= 0) {
    if (idx < o) o = idx
    if (idx >= o + alloc) o = idx - alloc + 1
  }
  return Math.max(0, Math.min(o, Math.max(0, n - alloc)))
}

export type Ctx = { data: Data; repair: Repair; alloc: number[]; previewCosts: number[]; preview: Preview | null }

export type Key =
  | 'j' | 'k' | 'h' | 'l' | 'g' | 'e' | 'o' | 'd' | 'v' | 'p' | 'z' | 'y' | 'n' | 'q' | 'f' | 'b'
  | '1' | '2' | '3' | '4' | '5' | 'pagedown' | 'pageup' | 'prevsec' | 'nextsec'

// Enter a section from the top (its header) or the bottom (its last row).
function enter(ui: UI, sec: number, from: 'top' | 'bottom', c: Ctx): UI {
  const next = { ...ui, sec, zoom: ui.zoom !== null ? sec : null }
  if (sec === PREV) return { ...next, previewOffset: from === 'top' ? 0 : next.previewOffset }
  const rows = rowsOf(sec, next, c.data, c.repair)
  if (from === 'top' || !isShown(next, sec) || !rows.length) {
    const cursor = next.cursor.slice()
    cursor[sec] = null
    return { ...next, cursor }
  }
  return withCursor(next, sec, rows, rows.length - 1, Math.max(1, c.alloc[sec]))
}

export function press(ui: UI, pressed: Key, c: Ctx): { ui: UI; effect: Effect } {
  let key = pressed
  const none: Effect = { kind: 'none' }
  const sec = ui.sec
  const rows = rowsOf(sec, ui, c.data, c.repair)
  const idx = indexOf(rows, ui.cursor[sec])
  const alloc = Math.max(1, c.alloc[sec])
  const page = Math.max(1, alloc - 1)

  if (key === 'q') return { ui, effect: { kind: 'close' } }
  if (key === 'f') key = 'pagedown'
  if (key === 'b') key = 'pageup'
  if (key === '1' || key === '2' || key === '3' || key === '4' || key === '5') {
    const n = Number(key) - 1
    return { ui: enter({ ...ui, collapsed: ui.collapsed.filter((x) => x !== n) }, n, 'top', c), effect: none }
  }
  if (key === 'y' || key === 'n') return { ui, effect: c.repair && c.repair.phase === 'ask' ? { kind: 'repair', yes: key === 'y' } : none }
  if (key === 'prevsec' || key === 'nextsec') return { ui: enter(ui, (sec + (key === 'nextsec' ? 1 : SECTIONS.length - 1)) % SECTIONS.length, 'top', c), effect: none }
  if (key === 'z') return { ui: { ...ui, zoom: ui.zoom === sec ? null : sec, collapsed: ui.collapsed.filter((s) => s !== sec) }, effect: none }

  if (sec === KEYS) {
    if (key === 'k' || key === 'g') return { ui: enter(ui, PREV, 'bottom', c), effect: none }
    if (key === 'h') return { ui: collapse(ui, KEYS, true), effect: none }
    if (key === 'l') return { ui: collapse(ui, KEYS, false), effect: none }
    if (key === 'o') return { ui: collapse(ui, KEYS, isShown(ui, KEYS)), effect: none }
    return { ui, effect: none }
  }

  if (sec === PREV) {
    const costs = c.previewCosts
    const off = ui.previewOffset
    const max = lastOffset(costs, alloc)
    const at = (o: number) => ({ ui: { ...ui, previewOffset: Math.max(0, Math.min(o, max)) }, effect: none })
    if (key === 'j' && (off >= max || !isShown(ui, PREV))) return { ui: enter(ui, KEYS, 'top', c), effect: none }
    if (key === 'j') return at(off + 1)
    if (key === 'k' && off === 0) return { ui: enter(ui, ART, 'bottom', c), effect: none }
    if (key === 'k') return at(off - 1)
    if (key === 'pagedown') return at(off + fitCount(costs, off, alloc))
    if (key === 'pageup') return at(pageBack(costs, off, alloc))
    if (key === 'g') return at(0)
    if (key === 'e') return at(max)
    if (key === 'h') return { ui: isShown(ui, PREV) ? { ...ui, sec: ART } : ui, effect: none }
    if (key === 'l' || key === 'o') return { ui: collapse(ui, PREV, false), effect: none }
    if (key === 'p') return { ui, effect: planLine(ui, c.data) }
    const t = previewTarget(ui, c.data)
    if (key === 'd' && t) return { ui, effect: { kind: 'view', target: t } }
    if (key === 'v' && t) return { ui, effect: historyOf(t, c.data) }
    return { ui, effect: none }
  }

  // j/k flow through the sections as one list.
  const last = isShown(ui, sec) ? rows.length - 1 : -1
  if (key === 'j' && idx >= last) return { ui: enter(ui, sec + 1, 'top', c), effect: none }
  if (key === 'k' && idx === -1) return { ui: sec > 0 ? enter(ui, sec - 1, 'bottom', c) : ui, effect: none }

  if (!isShown(ui, sec)) {
    if (key === 'l' || key === 'o') return { ui: collapse(ui, sec, false), effect: none }
    return { ui, effect: none }
  }

  if (key === 'j') return { ui: withCursor(ui, sec, rows, idx + 1, alloc), effect: none }
  if (key === 'k') return { ui: withCursor(ui, sec, rows, idx - 1, alloc), effect: none }
  if (key === 'pagedown') return { ui: withCursor(ui, sec, rows, Math.max(0, idx) + page, alloc), effect: none }
  if (key === 'pageup') return { ui: withCursor(ui, sec, rows, idx - page, alloc), effect: none }
  if (key === 'g') return { ui: withCursor(ui, sec, rows, -1, alloc), effect: none }
  if (key === 'e') return { ui: withCursor(ui, sec, rows, rows.length - 1, alloc), effect: none }

  const row = idx >= 0 ? rows[idx] : undefined
  if (!row) {
    // The section header.
    if (key === 'h') return { ui: collapse(ui, sec, true), effect: none }
    if (key === 'l') return { ui: collapse(ui, sec, false), effect: none }
    if (key === 'o') return { ui: collapse(ui, sec, isShown(ui, sec)), effect: none }
    return { ui, effect: none }
  }

  if (key === 'p') {
    if (row.kind === 'ms') return { ui, effect: { kind: 'open', path: c.data.planPath, line: c.data.plan?.milestones.find((m) => m.id === row.id)?.line } }
    if (row.kind === 'step') return { ui, effect: { kind: 'open', path: c.data.planPath, line: row.step.line } }
    if (sec === ART) return { ui, effect: planLine(ui, c.data) }
    return { ui, effect: none }
  }

  // h/l also move along the drill-down: step → its Artifacts → a commit or
  // file → Preview, and h back out again.
  if (key === 'h' || key === 'l') {
    const folding = key === 'h'
    const back = (to: number) => ({ ui: { ...ui, sec: to }, effect: none })
    if (sec === ART && folding && !(row.kind === 'cfile' || (row.kind === 'commit' && row.isOpen))) return back(PLAN)
    if (sec === ART && !folding && (row.kind === 'cfile' || row.kind === 'file' || (row.kind === 'commit' && row.isOpen))) {
      return { ui: { ...ui, sec: PREV, zoom: ui.zoom !== null ? PREV : null, collapsed: ui.collapsed.filter((s) => s !== PREV) }, effect: none }
    }
    if (!folding && (row.kind === 'step' || row.kind === 'unattr')) {
      const id = row.kind === 'step' ? row.step.id : UNATTRIBUTED
      return { ui: { ...followStep(ui, row), step: id, sec: ART, zoom: ui.zoom !== null ? ART : null, collapsed: ui.collapsed.filter((s) => s !== ART) }, effect: none }
    }
    if (row.kind === 'ms') return { ui: { ...ui, fold: { ...ui.fold, [row.id]: folding } }, effect: none }
    if (row.kind === 'step' && folding) {
      const next = { ...ui, fold: { ...ui.fold, [row.step.milestone]: true } }
      const r2 = rowsOf(PLAN, next, c.data, c.repair)
      return { ui: withCursor(next, PLAN, r2, r2.findIndex((r) => r.key === 'm:' + row.step.milestone), alloc), effect: none }
    }
    if (row.kind === 'commit') return { ui: { ...ui, open: { ...ui.open, [row.commit.sha]: !folding } }, effect: none }
    if (row.kind === 'cfile' && folding) {
      const next = { ...ui, open: { ...ui.open, [row.commit.sha]: false } }
      const r2 = rowsOf(ART, next, c.data, c.repair)
      return { ui: withCursor(next, ART, r2, r2.findIndex((r) => r.key === 'k:' + row.commit.sha), alloc), effect: none }
    }
    if (sec === CTX) return { ui: collapse(ui, sec, folding), effect: none }
    return { ui, effect: none }
  }

  if (key === 'o') {
    if (row.kind === 'ctx') return { ui, effect: row.file.exists ? { kind: 'open', path: row.file.path } : none }
    if (row.kind === 'ms') return { ui: { ...ui, fold: { ...ui.fold, [row.id]: !isFolded(ui, c.data.plan!, row.id) } }, effect: none }
    if (row.kind === 'step' || row.kind === 'unattr') {
      const id = row.kind === 'step' ? row.step.id : UNATTRIBUTED
      return { ui: { ...followStep(ui, row), step: id, sec: ART, collapsed: ui.collapsed.filter((s) => s !== ART) }, effect: none }
    }
    if (row.kind === 'repair') return { ui, effect: row.phase === 'ask' ? { kind: 'repair', yes: true } : none }
    // A past commit is read as its change, not as today's file.
    if (row.kind === 'commit' || row.kind === 'cfile') return { ui, effect: { kind: 'view', target: targetOf(row)! } }
    if (row.kind === 'file') return { ui, effect: row.file.state === 'D' ? none : { kind: 'open', path: row.file.path } }
    if (row.kind === 'empty' && row.key === 'p:none') return { ui, effect: { kind: 'scaffold' } }
    return { ui, effect: none }
  }

  if (key === 'd') {
    const t = targetOf(row)
    if (t) return { ui, effect: { kind: 'view', target: t } }
    if (row.kind === 'ctx' && row.file.exists) return { ui, effect: { kind: 'open', path: row.file.path } }
  }
  if (key === 'v') {
    const t = targetOf(row)
    if (t) return { ui, effect: historyOf(t, c.data) }
    if (row.kind === 'ctx' && row.file.exists) return { ui, effect: { kind: 'history', path: row.file.path } }
  }
  return { ui, effect: none }
}

// The selected step's line in DEV_PLAN.md, where its notes live.
function planLine(ui: UI, data: Data): Effect {
  const id = selectedStep(ui, data)
  const step = id && data.plan ? findStep(data.plan, id) : null
  return step ? { kind: 'open', path: data.planPath, line: step.line } : { kind: 'none' }
}

// lazygit: a commit opens the log; a file opens that file's history.
function historyOf(t: Target, data: Data): Effect {
  if (t.kind === 'commit') return { kind: 'history', path: null }
  if (t.kind === 'cfile') return { kind: 'history', path: joinPath(data.root ?? data.base, t.path) }
  return { kind: 'history', path: t.path }
}

export function collapse(ui: UI, sec: number, on: boolean): UI {
  const collapsed = on ? [...new Set([...ui.collapsed, sec])] : ui.collapsed.filter((s) => s !== sec)
  const zoom = on && ui.zoom === sec ? null : !on && ui.zoom !== null && ui.zoom !== sec ? null : ui.zoom
  const cursor = ui.cursor.slice()
  if (on) cursor[sec] = null
  return { ...ui, collapsed, zoom, cursor, sec }
}

export function joinPath(dir: string, rel: string): string {
  return rel.startsWith('/') ? rel : dir.replace(/\/$/, '') + '/' + rel
}

// A person's ring move onto a row button: adopt it as the cursor.
export function focusRow(ui: UI, data: Data, repair: Repair, rowKey: string, alloc: number[]): UI {
  for (let sec = 0; sec < 3; sec++) {
    const rows = rowsOf(sec, ui, data, repair)
    const i = rows.findIndex((r) => r.key === rowKey)
    if (i >= 0) return withCursor({ ...ui, sec }, sec, rows, i, Math.max(1, alloc[sec]))
  }
  const h = /^h:(\d)$/.exec(rowKey)
  if (h) {
    const sec = Number(h[1])
    const cursor = ui.cursor.slice()
    if (sec !== PREV) cursor[sec] = null
    return { ...ui, sec, cursor }
  }
  return ui
}

// Keep cursors and selection valid after the data changed underneath.
export function reconcile(ui: UI, data: Data, repair: Repair): UI {
  const cursor = ui.cursor.slice()
  for (let sec = 0; sec < 3; sec++) {
    if (cursor[sec] === null) continue
    const rows = rowsOf(sec, ui, data, repair)
    if (!rows.some((r) => r.key === cursor[sec])) cursor[sec] = rows.length ? rows[0].key : null
  }
  let step = ui.step
  if (step !== null && step !== UNATTRIBUTED && !(data.plan && findStep(data.plan, step))) step = null
  return { ...ui, cursor, step }
}

export function planSignature(plan: Plan | null): string {
  if (!plan) return 'none'
  return plan.issues.filter((i) => i.severity === 'error').map((i) => i.code + i.line).join('|')
}

export function planErrorCount(plan: Plan | null): number {
  return plan && hasErrors(plan) ? plan.issues.filter((i) => i.severity === 'error').length : 0
}
