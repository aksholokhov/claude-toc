// The sidebar drawing: state + data → element tree. Elements come from
// $.ui.resolve(e) in register.ts and are passed in as `el`.

import { diffPage, diffRows, sourcePage } from './diff.ts'
import type { Segment } from './diff.ts'
import {
  ART, CTX, PLAN, PREV, SECTIONS, isFolded, isShown, planRows, previewTarget, rowsOf, selectedStep, targetTitle,
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
// (KNOWLEDGE.md: Alt bindings in the Global context press the Button).
export const ACTIONS = {
  toggle: 'app:toggleReplTab',
  pagedown: 'app:toggleDiffNoiseFilter',
  pageup: 'app:toggleDiffPreSession',
  prevsec: 'confirm:previousField',
  nextsec: 'permission:toggleDebug',
} as const

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
    if (!isShown(ui, sec)) continue
    if (sec === PREV) children.push(...previewBody(v))
    else {
      const rows = rowsOf(sec, ui, v.data, v.repair)
      const off = ui.offset[sec]
      rows.slice(off, off + v.alloc[sec]).forEach((r) => children.push(rowView(v, sec, r)))
    }
  }
  children.push(legend(v))
  return el.Box({ flexDirection: 'column', children })
}

function gutter(v: ViewInput, key: string) {
  return v.el.Button({ key: 'r:' + key, label: ' ', plain: true, onPress: v.act.row(key) })
}

function line(v: ViewInput, key: string, isCursor: boolean, parts: unknown[]) {
  const { el, roles } = v
  const props: Record<string, unknown> = { key: 'row:' + key, flexDirection: 'row', children: [gutter(v, key), el.Text({ wrap: 'truncate-end', children: parts })] }
  if (isCursor && roles.sel) props.backgroundColor = roles.sel
  return el.Box(props)
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
  const lead = shown ? '─┤ ' : '▸┤ '
  const fill = Math.max(2, v.width - 1 - len(lead) - len(title) - 2 - len(right.text) - 1)
  const focusSec = ui.sec === sec
  const isCursor = focusSec && (sec === PREV || ui.cursor[sec] === null)
  return line(v, 'h:' + sec, isCursor, [
    t(v, lead, { color: roles.faint }),
    t(v, title, { bold: true, color: focusSec ? roles.accent : roles.header }),
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
  const total = previewTotal(v)
  const h = Math.max(1, v.alloc[PREV])
  if (!total) return { text: '', color: roles.dim }
  return isShown(ui, PREV)
    ? { text: Math.floor(ui.previewOffset / h) + 1 + '/' + Math.max(1, Math.ceil(total / h)), color: roles.dim }
    : { text: total + ' rows', color: roles.dim }
}

function rowView(v: ViewInput, sec: number, r: Row) {
  const { roles, ui, data } = v
  const w = v.width - 1
  const isCursor = ui.sec === sec && ui.cursor[sec] === r.key
  const right = (left: string, rightText: string, leftStyle: Record<string, unknown>, rightStyle: Record<string, unknown>, prefix: unknown[] = [], prefixLen = 0) => {
    const room = w - prefixLen - len(rightText) - (rightText ? 1 : 0)
    return line(v, r.key, isCursor, [...prefix, t(v, fit(left, room), leftStyle), rightText ? t(v, ' ' + rightText, rightStyle) : ''])
  }
  switch (r.kind) {
    case 'ctx': {
      const f = r.file
      return right(f.name, f.exists ? age(data.now, f.mtimeMs) : 'missing', { color: f.exists ? roles.text : roles.faint }, { color: roles.dim },
        [t(v, '▤ ', { color: f.exists ? roles.accent : roles.faint })], 2)
    }
    case 'ms': {
      const plan = data.plan!
      const m = plan.milestones.find((x) => x.id === r.id)!
      const { done, live } = progress(m.steps)
      const complete = isComplete(m)
      const active = isActive(m)
      const style = complete ? { color: roles.done, dimColor: true } : active ? { color: roles.doing, bold: true } : { color: roles.strong, bold: true }
      const glyph = isFolded(ui, plan, m.id) ? '▸ ' : '▾ '
      return right(glyph + m.id + ' ' + m.title, done + '/' + live + (complete ? ' ✓' : '  '), style, complete ? { color: roles.done, dimColor: true } : { color: roles.dim })
    }
    case 'step': {
      const s = r.step
      const c = (data.commits.get(s.id) ?? []).length
      const f = (data.files.get(s.id) ?? []).length
      const counters = (c ? '⇡' + c : '') + (f ? (c ? ' ' : '') + '+' + f : '')
      const glyphColor = { todo: roles.text, doing: roles.doing, done: roles.done, cancelled: roles.cancelled }[s.status]
      const titleStyle =
        s.status === 'doing' ? { color: roles.doing, bold: true }
          : s.status === 'done' ? { color: roles.dim }
            : s.status === 'cancelled' ? { color: roles.cancelled, italic: true }
              : { color: roles.text }
      const selected = selectedStep(ui, data) === s.id
      const mark = selected && ui.sec !== PLAN ? '›' : ' '
      return right(s.id + ' ' + s.title, counters, titleStyle, { color: roles.accent },
        [t(v, mark, { color: roles.accent }), t(v, ' ' + STATUS_GLYPH[s.status] + ' ', { color: glyphColor, bold: s.status === 'doing' })], 4)
    }
    case 'unattr':
      return right('unattributed edits', '+' + r.count, { color: roles.dim, italic: true }, { color: roles.accent }, [t(v, '  · ', { color: roles.faint })], 4)
    case 'issue':
      return right(r.text, '', { color: roles.err, dimColor: r.severity === 'warn' }, {}, [t(v, '  ! ', { color: roles.err })], 4)
    case 'repair':
      return r.phase === 'running'
        ? right('haiku is repairing DEV_PLAN.md…', '', { color: roles.doing, bold: true }, {}, [t(v, '◐ ', { color: roles.doing })], 2)
        : right('DEV_PLAN.md is broken. Repair?', 'y/n', { color: roles.err, bold: true }, { color: roles.doing, bold: true }, [t(v, '✗ ', { color: roles.err })], 2)
    case 'note':
      return right(r.text, '', { color: roles.dim, italic: true }, {}, [t(v, '  ', {})], 2)
    case 'commit': {
      const c = r.commit
      return right(c.subject, '+' + c.add + '-' + c.del, { color: roles.text }, { color: roles.dim },
        [t(v, r.isOpen ? '▾ ' : '▸ ', { color: roles.faint }), t(v, c.short.slice(0, 7) + ' ', { color: roles.sha })], 2 + Math.min(7, c.short.length) + 1)
    }
    case 'cfile':
      return right(r.path, '+' + r.add + ' -' + r.del, { color: roles.file }, { color: roles.dim }, [t(v, '    ', {})], 4)
    case 'file': {
      const st = r.file.state
      const color = st === 'A' ? roles.add : st === 'M' ? roles.doing : st === 'D' ? roles.del : roles.dim
      return right(r.file.rel, '', { color: st === '✓' ? roles.dim : roles.text }, {},
        [t(v, ' ' + st + ' ', { color, bold: st !== '✓' })], 3)
    }
    case 'empty':
      return right(r.text, '', { color: roles.faint, italic: true }, {}, [t(v, '  ', {})], 2)
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
  if (!p) return [line(v, 'pv:none', false, [t(v, '  nothing to preview', { color: roles.faint, italic: true })])]
  if (p.error) return [line(v, 'pv:err', false, [t(v, '  ' + p.error, { color: roles.err })])]
  let segs: Segment[] = []
  if (p.files) segs = diffPage(p.files, diffRows(p.files), ui.previewOffset, n)
  else if (p.source !== null) segs = sourcePage(p.path, p.source, ui.previewOffset, n)
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
      out.push(el.Code({ key: 'pv:d:' + i, source: s.source, format: 'diff', path: s.path, wrap: 'truncate-end' }))
    } else {
      out.push(el.Code({ key: 'pv:s:' + i, source: s.source, path: s.path, startLine: s.startLine, wrap: 'truncate-end' }))
    }
  })
  if (!out.length) out.push(line(v, 'pv:empty', false, [t(v, '  (empty)', { color: roles.faint, italic: true })]))
  return out
}

function legend(v: ViewInput) {
  const { el, roles } = v
  const hot = (k: string, label: string) => el.Button({ key: 'key:' + k, label, hotkey: k, plain: true, dimColor: true, onPress: v.act.key(k) })
  const alt = (name: keyof typeof ACTIONS, label: string) =>
    el.Button({ key: 'act:' + name, label, plain: true, dimColor: true, action: ACTIONS[name], onPress: v.act.key(name) })
  const repairAsk = v.repair && v.repair.phase === 'ask' && v.data.plan && v.data.plan.issues.some((i) => i.severity === 'error')
  const row1 = [hot('j', '↓'), hot('k', '↑'), hot('h', '◂'), hot('l', '▸'), hot('g', '⤒'), hot('e', '⤓'), hot('z', 'zoom')]
  const row2 = [hot('o', 'open'), hot('d', 'diff'), alt('pagedown', '⌥j⇟'), alt('pageup', '⌥k⇞'), alt('prevsec', '⌥h'), alt('nextsec', '⌥l')]
  if (repairAsk) row2.unshift(hot('y', 'yes'), hot('n', 'no'))
  return el.Box({
    key: 'legend',
    flexDirection: 'column',
    children: [
      el.Box({ flexDirection: 'row', columnGap: 1, children: row1 }),
      el.Box({ flexDirection: 'row', columnGap: 1, flexWrap: 'wrap', children: row2 }),
    ],
  })
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
