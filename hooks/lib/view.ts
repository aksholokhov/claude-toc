// The sidebar drawing: state + data → element tree. Elements come from
// $.ui.resolve(e) in register.ts and are passed in as `el`.

import { diffPage, diffRows, fitCount, pageStarts, sourcePage } from './diff.ts'
import type { Segment } from './diff.ts'
import {
  ART, CTX, KEYS, PLAN, PREV, SECTIONS, isFolded, isShown, planRows, previewCosts, previewTarget, rowsOf, selectedStep, targetTitle,
} from './model.ts'
import type { Data, Preview, Repair, Row, UI } from './model.ts'
import { isActive, isComplete, progress } from './plan.ts'
import type { Roles } from './palette.ts'

type El = { Box: Function; Text: Function; Button: Function; Code: Function }
type Act = { row: (key: string) => () => void; key: (k: string) => () => void }

export type ViewInput = {
  el: El
  ui: UI
  data: Data
  repair: Repair
  preview: Preview | null
  alloc: number[]
  width: number
  roles: Roles
  act: Act
  focused: boolean
}

// Keys a mod can't get as hotkeys arrive through these spare engine actions
// (KNOWLEDGE.md: Alt bindings in the Global context press the Button). They
// must have no engine handler: app:toggleReplTab (v0.1) is Claude's "switch
// tab" as soon as a second pane such as /diff is open, and took the chord.
export const ACTIONS = {
  toggle: 'strip:jump1',
  pagedown: 'strip:jump2',
  pageup: 'strip:jump3',
  prevsec: 'confirm:previousField',
  nextsec: 'permission:toggleDebug',
} as const

// What earlier versions bound, for /toc keys to move off.
export const OLD_ACTIONS: Record<string, string> = {
  'app:toggleReplTab': 'toggle',
  'app:toggleDiffNoiseFilter': 'pagedown',
  'app:toggleDiffPreSession': 'pageup',
}

export const STATUS_GLYPH = { todo: '○', doing: '◐', done: '✓', cancelled: '✗' } as const

export function fit(s: string, n: number): string {
  if (n <= 0) return ''
  const chars = Array.from(s)
  return chars.length > n ? chars.slice(0, Math.max(0, n - 1)).join('') + '…' : s + ' '.repeat(n - chars.length)
}

export function age(now: number, mtimeMs: number): string {
  const s = Math.max(0, Math.round((now - mtimeMs) / 1000))
  if (s < 60) return s + 's'
  if (s < 3600) return Math.round(s / 60) + 'm'
  if (s < 86400) return Math.round(s / 3600) + 'h'
  if (s < 86400 * 14) return Math.round(s / 86400) + 'd'
  return Math.round(s / (86400 * 7)) + 'w'
}

function len(s: string): number {
  return Array.from(s).length
}

export function render(v: ViewInput) {
  const { el, ui, roles } = v
  const children: unknown[] = []
  for (let sec = 0; sec < SECTIONS.length; sec++) {
    children.push(header(v, sec))
    if (sec === KEYS) children.push(legend(v, isShown(ui, KEYS)))
    if (!isShown(ui, sec) || sec === KEYS) continue
    if (sec === PREV) children.push(...previewBody(v))
    else {
      const rows = rowsOf(sec, ui, v.data, v.repair)
      const off = ui.offset[sec]
      rows.slice(off, off + v.alloc[sec]).forEach((r) => children.push(rowView(v, sec, r)))
    }
  }
  return el.Box({ flexDirection: 'column', children })
}

// One row: colored prefix, the label as a plain Button (the click target and
// the focus ring, as /diff's file rows do — a Button's label can't be
// colored, only dimmed), then a colored tail.
function line(v: ViewInput, key: string, isCursor: boolean, prefix: unknown[], label: string, dim: boolean, tail: unknown[]) {
  const { el, roles } = v
  const button = el.Button(dim
    ? { key: 'r:' + key, label: label || ' ', plain: true, dimColor: true, onPress: v.act.row(key) }
    : { key: 'r:' + key, label: label || ' ', plain: true, onPress: v.act.row(key) })
  const children = [...prefix.map((p) => (typeof p === 'string' ? el.Text({ children: [p] }) : p)), button, ...tail]
  const props: Record<string, unknown> = { key: 'row:' + key, flexDirection: 'row', children }
  if (isCursor && roles.sel) props.backgroundColor = roles.sel
  return el.Box(props)
}

// Plain informational line (preview placeholders): not focusable.
function note(v: ViewInput, key: string, parts: unknown[]) {
  return v.el.Box({ key: 'row:' + key, flexDirection: 'row', children: [v.el.Text({ wrap: 'truncate-end', children: parts })] })
}

function t(v: ViewInput, text: string, style: Record<string, unknown> = {}) {
  return v.el.Text({ ...style, children: [text] })
}

function header(v: ViewInput, sec: number) {
  const { ui, roles, data } = v
  const title =
    sec === ART ? 'Artifacts · ' + (selectedStep(ui, data) === '' ? 'unattributed' : selectedStep(ui, data) ?? '—')
      : sec === PREV ? 'Preview · ' + targetTitle(previewTarget(ui, data))
        : SECTIONS[sec]
  const right = summary(v, sec)
  const shown = isShown(ui, sec)
  const focusSec = ui.sec === sec
  const lead = (shown ? (focusSec ? '━┥ ' : '─┤ ') : '▸┤ ')
  // digit + lead + title + ' ├' + fill + ' ' + summary must fit the width exactly.
  const fill = Math.max(2, v.width - 1 - len(lead) - len(title) - 2 - 1 - len(right.text) - 1)
  const isCursor = focusSec && (sec === PREV || ui.cursor[sec] === null)
  return line(v, 'h:' + sec, isCursor, [t(v, (sec + 1) + lead, { color: focusSec ? roles.accent : roles.faint, bold: focusSec })], title, false, [
    t(v, ' ├' + '─'.repeat(fill) + ' ', { color: roles.faint }),
    t(v, right.text, { color: right.color }),
  ])
}

function summary(v: ViewInput, sec: number): { text: string; color: string } {
  const { data, roles, ui } = v
  if (sec === CTX) {
    const have = data.context.filter((c) => c.exists).length
    return { text: have + '/' + data.context.length, color: roles.dim }
  }
  if (sec === PLAN) {
    const plan = data.plan
    if (!plan) return { text: 'missing', color: roles.err }
    const errors = plan.issues.filter((i) => i.severity === 'error').length
    if (errors) return { text: '✗ ' + errors + ' issue' + (errors > 1 ? 's' : ''), color: roles.err }
    const { done, live } = progress(plan.milestones.flatMap((m) => m.steps))
    const filled = live ? Math.round((done / live) * 6) : 0
    return { text: done + '/' + live + ' ' + '▰'.repeat(filled) + '▱'.repeat(6 - filled), color: roles.dim }
  }
  if (sec === ART) {
    const id = selectedStep(ui, data)
    if (id === null) return { text: '', color: roles.dim }
    const c = (data.commits.get(id) ?? []).length
    const f = (data.files.get(id) ?? []).length
    return { text: '⇡' + c + ' +' + f, color: roles.accent }
  }
  if (sec === KEYS) return { text: isShown(ui, KEYS) ? '' : 'l: show', color: roles.faint }
  const total = previewTotal(v)
  if (!total) return { text: '', color: roles.dim }
  if (!isShown(ui, PREV)) return { text: total + ' rows', color: roles.dim }
  const starts = pageStarts(previewCosts(v.preview, v.width), Math.max(1, v.alloc[PREV]))
  const at = starts.filter((s) => s <= ui.previewOffset).length
  return { text: Math.max(1, at) + '/' + starts.length, color: roles.dim }
}

function rowView(v: ViewInput, sec: number, r: Row) {
  const { roles, ui, data } = v
  const w = v.width
  const isCursor = ui.sec === sec && ui.cursor[sec] === r.key
  // leftStyle only decides dim-or-not now: the label is a Button.
  const right = (left: string, rightText: string, leftStyle: Record<string, unknown>, rightStyle: Record<string, unknown>, prefix: unknown[] = [], prefixLen = 0) => {
    const room = w - prefixLen - len(rightText) - (rightText ? 1 : 0)
    const dim = !!leftStyle.dim
    return line(v, r.key, isCursor, prefix, fit(left, room), dim, rightText ? [t(v, ' ' + rightText, rightStyle)] : [])
  }
  switch (r.kind) {
    case 'ctx': {
      const f = r.file
      return right(f.name, f.exists ? age(data.now, f.mtimeMs) : 'missing', { dim: !f.exists }, { color: roles.dim },
        [t(v, '▤ ', { color: f.exists ? roles.accent : roles.faint })], 2)
    }
    case 'ms': {
      const plan = data.plan!
      const m = plan.milestones.find((x) => x.id === r.id)!
      const { done, live } = progress(m.steps)
      const complete = isComplete(m)
      const active = isActive(m)
      const glyphStyle = complete ? { color: roles.doneDim } : active ? { color: roles.doing, bold: true } : { color: roles.strong, bold: true }
      const glyph = isFolded(ui, plan, m.id) ? '▸ ' : '▾ '
      const acc = m.acceptance.total && !complete ? ' ☐' + m.acceptance.done + '/' + m.acceptance.total : ''
      return right(m.id + ' ' + m.title, done + '/' + live + acc + (complete ? ' ✓' : '  '), { dim: complete }, complete ? { color: roles.doneDim } : active ? { color: roles.doing, bold: true } : { color: roles.dim },
        [t(v, glyph, glyphStyle)], 2)
    }
    case 'step': {
      const s = r.step
      const c = (data.commits.get(s.id) ?? []).length
      const f = (data.files.get(s.id) ?? []).length
      const counters = (c ? '⇡' + c : '') + (f ? (c ? ' ' : '') + '+' + f : '')
      const glyphColor = { todo: roles.text, doing: roles.doing, done: roles.done, cancelled: roles.cancelled }[s.status]
      const titleStyle = { dim: s.status === 'done' || s.status === 'cancelled' }
      const selected = selectedStep(ui, data) === s.id
      const mark = selected && ui.sec !== PLAN ? '›' : ' '
      return right(s.id + ' ' + s.title, counters, titleStyle, { color: roles.accent },
        [t(v, mark, { color: roles.accent }), t(v, ' ' + STATUS_GLYPH[s.status] + ' ', { color: glyphColor, bold: s.status === 'doing' })], 4)
    }
    case 'unattr':
      return right('unattributed edits', '+' + r.count, { dim: true }, { color: roles.accent }, [t(v, '  · ', { color: roles.faint })], 4)
    case 'issue':
      return right(r.text, '', { dim: r.severity === 'warn' }, {}, [t(v, '  ! ', { color: roles.err, bold: true })], 4)
    case 'repair':
      return r.phase === 'running'
        ? right('haiku is repairing DEV_PLAN.md…', '', {}, {}, [t(v, '◐ ', { color: roles.doing, bold: true })], 2)
        : right('DEV_PLAN.md is broken. Repair?', 'y/n', {}, { color: roles.doing, bold: true }, [t(v, '✗ ', { color: roles.err, bold: true })], 2)
    case 'note':
      return right(r.text, '', { dim: true }, {}, ['  '], 2)
    case 'commit': {
      const c = r.commit
      return right(c.subject, '+' + c.add + '-' + c.del, {}, { color: roles.dim },
        [t(v, r.isOpen ? '▾ ' : '▸ ', { color: roles.faint }), t(v, c.short.slice(0, 7) + ' ', { color: roles.sha })], 2 + Math.min(7, c.short.length) + 1)
    }
    case 'cfile':
      return right(r.path, '+' + r.add + ' -' + r.del, {}, { color: roles.dim }, [t(v, '    ▪ ', { color: roles.file })], 6)
    case 'file': {
      const st = r.file.state
      const color = st === 'A' ? roles.add : st === 'M' ? roles.doing : st === 'D' ? roles.del : roles.dim
      return right(r.file.rel, '', { dim: st === '✓' }, {},
        [t(v, ' ' + st + ' ', { color, bold: st !== '✓' })], 3)
    }
    case 'empty':
      return right(r.text, '', { dim: true }, {}, ['  '], 2)
  }
}

function previewTotal(v: ViewInput): number {
  const p = v.preview
  if (!p) return 0
  if (p.files) return diffRows(p.files).length
  if (p.source !== null) return p.source.split('\n').length
  return 0
}

function previewBody(v: ViewInput): unknown[] {
  const { el, roles, ui } = v
  const p = v.preview
  const n = v.alloc[PREV]
  if (!p) return [note(v, 'pv:none', [t(v, '  nothing to preview', { color: roles.faint, italic: true })])]
  if (p.error) return [note(v, 'pv:err', [t(v, '  ' + p.error, { color: roles.err })])]
  let segs: Segment[] = []
  // n is screen rows; Code wraps, so take the lines that fit when wrapped.
  const count = fitCount(previewCosts(p, v.width), ui.previewOffset, n)
  if (p.files) segs = diffPage(p.files, diffRows(p.files), ui.previewOffset, count)
  else if (p.source !== null) segs = sourcePage(p.path, p.source, ui.previewOffset, count, p.firstLine)
  const out: unknown[] = []
  segs.forEach((s, i) => {
    if (s.kind === 'file') {
      const f = s.file
      out.push(el.Box({ key: 'pv:f:' + i, flexDirection: 'row', children: [el.Text({ wrap: 'truncate-end', children: [
        t(v, '▌', { color: roles.file }),
        t(v, fit(' ' + f.path, v.width - 2 - len('+' + f.add + ' -' + f.del) - 1), { color: roles.file, bold: true }),
        t(v, ' +' + f.add, { color: roles.add }),
        t(v, ' -' + f.del, { color: roles.del }),
        f.binary ? t(v, ' bin', { color: roles.dim }) : '',
      ] })] }))
    } else if (s.kind === 'diff') {
      out.push(el.Code({ key: 'pv:d:' + i, source: s.source, format: 'diff', path: s.path }))
    } else {
      out.push(el.Code({ key: 'pv:s:' + i, source: s.source, path: s.path, startLine: s.startLine }))
    }
  })
  if (!out.length) out.push(note(v, 'pv:empty', [t(v, '  (empty)', { color: roles.faint, italic: true })]))
  return out
}

type LegendItem = { hotkey?: string; action?: keyof typeof ACTIONS; label: string }

// The legend's items in groups (moves, actions, sections), each group
// packed into as few rows as the width allows. Shared with the layout, so
// the Keys section is given exactly the rows it draws.
export function legendRows(width: number, repairAsk: boolean): LegendItem[][] {
  const h = (hotkey: string, label: string): LegendItem => ({ hotkey, label })
  const a = (action: keyof typeof ACTIONS, label: string): LegendItem => ({ action, label })
  const groups: LegendItem[][] = [
    [h('j', '↓'), h('k', '↑'), h('f', '⇟'), h('b', '⇞'), h('h', '◂'), h('l', '▸'), h('g', '⤒'), h('e', '⤓')],
    [...(repairAsk ? [h('y', 'yes'), h('n', 'no')] : []), h('o', 'open'), h('d', 'diff'), h('v', 'git'), h('p', 'plan'), h('z', 'zoom'), h('q', 'close')],
    // Alt keys only reach us in terminals that send them (iTerm2: Option as Esc+).
    [h('1', 'ctx'), h('2', 'plan'), h('3', 'art'), h('4', 'prev'), h('5', 'keys'), a('pagedown', '⌥j'), a('pageup', '⌥k'), a('prevsec', '⌥h'), a('nextsec', '⌥l')],
  ]
  const cells = (it: LegendItem) => (it.hotkey ? 3 : 0) + len(it.label)
  const rows: LegendItem[][] = []
  for (const g of groups) {
    let row: LegendItem[] = []
    let used = 0
    for (const it of g) {
      const need = (row.length ? 1 : 0) + cells(it)
      if (row.length && used + need > width) {
        rows.push(row)
        row = []
        used = 0
      }
      used += row.length ? 1 + cells(it) : cells(it)
      row.push(it)
    }
    if (row.length) rows.push(row)
  }
  return rows
}

export function isRepairAsk(repair: Repair, data: Data): boolean {
  return !!(repair && repair.phase === 'ask' && data.plan && data.plan.issues.some((i) => i.severity === 'error'))
}

// The key buttons are drawn even while Keys is folded: a mod's hotkeys are
// its drawn Buttons, so folded means drawn into zero rows, not left out.
function legend(v: ViewInput, open: boolean) {
  const { el } = v
  const button = (it: LegendItem) => it.hotkey
    ? el.Button({ key: 'key:' + it.hotkey, label: it.label, hotkey: it.hotkey, plain: true, dimColor: true, onPress: v.act.key(it.hotkey) })
    : el.Button({ key: 'act:' + it.action, label: it.label, plain: true, dimColor: true, action: ACTIONS[it.action!], onPress: v.act.key(it.action!) })
  const rows = legendRows(v.width - 1, isRepairAsk(v.repair, v.data))
    .map((r) => el.Box({ flexDirection: 'row', columnGap: 1, children: r.map(button) }))
  return el.Box(open
    ? { key: 'legend', flexDirection: 'column', children: rows }
    : { key: 'legend', flexDirection: 'column', height: 0, overflow: 'hidden', children: rows })
}

// Order of focusable row buttons as drawn, for edge-scroll decisions.
export function drawnOrder(ui: UI, data: Data, repair: Repair, alloc: number[]): string[] {
  const out: string[] = []
  for (let sec = 0; sec < SECTIONS.length; sec++) {
    out.push('h:' + sec)
    if (!isShown(ui, sec) || sec === PREV) continue
    const rows = sec === PLAN ? planRows(ui, data, repair) : rowsOf(sec, ui, data, repair)
    rows.slice(ui.offset[sec], ui.offset[sec] + alloc[sec]).forEach((r) => out.push(r.key))
  }
  return out
}
