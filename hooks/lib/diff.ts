// Unified-diff parsing and paging. A page must hand `Code format:'diff'`
// whole hunks, so each page slice gets a synthetic, correct `@@` header.

export type Hunk = { oldStart: number; newStart: number; lines: string[] }
export type DiffFile = { path: string; hunks: Hunk[]; binary: boolean; add: number; del: number }

export type PRow =
  | { kind: 'file'; file: number }
  | { kind: 'line'; file: number; hunk: number; line: number }

export type Segment =
  | { kind: 'file'; file: DiffFile }
  | { kind: 'diff'; path: string; source: string; rows: number }
  | { kind: 'source'; path: string; source: string; startLine: number; rows: number }

export function parseDiff(text: string): DiffFile[] {
  const files: DiffFile[] = []
  let file: DiffFile | null = null
  let hunk: Hunk | null = null
  for (const line of text.split('\n')) {
    const head = /^diff --git a\/(.*?) b\/(.*)$/.exec(line)
    if (head) {
      file = { path: head[2], hunks: [], binary: false, add: 0, del: 0 }
      files.push(file)
      hunk = null
      continue
    }
    if (!file) continue
    if (/^Binary files /.test(line)) {
      file.binary = true
      continue
    }
    const h = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line)
    if (h) {
      hunk = { oldStart: Number(h[1]), newStart: Number(h[2]), lines: [] }
      file.hunks.push(hunk)
      continue
    }
    if (!hunk) continue
    const c = line[0]
    if (c === '+' || c === '-' || c === ' ' || c === '\\') {
      hunk.lines.push(line)
      if (c === '+') file.add++
      if (c === '-') file.del++
    }
  }
  return files
}

export function diffRows(files: DiffFile[]): PRow[] {
  const rows: PRow[] = []
  files.forEach((f, fi) => {
    rows.push({ kind: 'file', file: fi })
    f.hunks.forEach((h, hi) => h.lines.forEach((_, li) => rows.push({ kind: 'line', file: fi, hunk: hi, line: li })))
  })
  return rows
}

function counts(lines: string[]): { old: number; neu: number } {
  let old = 0
  let neu = 0
  for (const l of lines) {
    if (l[0] === ' ') {
      old++
      neu++
    } else if (l[0] === '-') old++
    else if (l[0] === '+') neu++
  }
  return { old, neu }
}

// The visible window [offset, offset+count) as drawable segments.
export function diffPage(files: DiffFile[], rows: PRow[], offset: number, count: number): Segment[] {
  const out: Segment[] = []
  const slice = rows.slice(offset, offset + count)
  let i = 0
  while (i < slice.length) {
    const r = slice[i]
    if (r.kind === 'file') {
      out.push({ kind: 'file', file: files[r.file] })
      i++
      continue
    }
    let j = i
    while (j + 1 < slice.length) {
      const n = slice[j + 1]
      if (n.kind !== 'line' || n.file !== r.file || n.hunk !== r.hunk) break
      j++
    }
    const last = slice[j] as Extract<PRow, { kind: 'line' }>
    const hunk = files[r.file].hunks[r.hunk]
    const before = counts(hunk.lines.slice(0, r.line))
    const body = hunk.lines.slice(r.line, last.line + 1)
    const c = counts(body)
    const header = `@@ -${hunk.oldStart + before.old},${c.old} +${hunk.newStart + before.neu},${c.neu} @@`
    out.push({ kind: 'diff', path: files[r.file].path, source: header + '\n' + body.join('\n'), rows: body.length })
    i = j + 1
  }
  return out
}

// A whole file (untracked, so no diff): plain source, paged by line.
export function sourcePage(path: string, text: string, offset: number, count: number): Segment[] {
  const lines = text.split('\n')
  const body = lines.slice(offset, offset + count)
  return [{ kind: 'source', path, source: body.join('\n'), startLine: offset + 1, rows: body.length }]
}

export function sourceRowCount(text: string): number {
  return text.split('\n').length
}

// ── wrapped paging ──────────────────────────────────────────────────────
// Code wraps long lines onto rows under its gutter, so a page holds as many
// diff/source lines as fit in its screen rows, not a fixed count. Costs are
// screen rows per PRow (or per source line); an overestimate only leaves a
// page a row short, an underestimate would push rows out of the pane.

// Rows `text` takes when Code wraps it at `room` cells: it breaks at the
// cell, not the word (tabs drawn as 4).
export function wrapRows(text: string, room: number): number {
  return Math.max(1, Math.ceil(Array.from(text.replace(/\t/g, '    ')).length / Math.max(1, room)))
}

export function diffCosts(files: DiffFile[], room: number): number[] {
  return diffRows(files).map((r) => (r.kind === 'file' ? 1 : wrapRows(files[r.file].hunks[r.hunk].lines[r.line].slice(1), room)))
}

export function sourceCosts(text: string, room: number): number[] {
  return text.split('\n').map((l) => wrapRows(l, room))
}

// How many rows from `offset` fit in `budget` screen rows (at least one).
export function fitCount(costs: number[], offset: number, budget: number): number {
  let used = 0
  let n = 0
  for (let i = offset; i < costs.length; i++) {
    if (n > 0 && used + costs[i] > budget) break
    used += costs[i]
    n++
  }
  return n
}

// The earliest offset whose page still reaches the end: the last page.
export function lastOffset(costs: number[], budget: number): number {
  let used = 0
  let i = costs.length
  while (i > 0 && used + costs[i - 1] <= budget) used += costs[--i]
  return Math.min(i, Math.max(0, costs.length - 1))
}

// The offset of the page that ends just above `offset` (paging back).
export function pageBack(costs: number[], offset: number, budget: number): number {
  let used = 0
  let i = offset
  while (i > 0 && used + costs[i - 1] <= budget) used += costs[--i]
  return i === offset ? Math.max(0, offset - 1) : i
}

// Page starts from the top, for an "n/m" counter.
export function pageStarts(costs: number[], budget: number): number[] {
  const out: number[] = []
  for (let i = 0; i < costs.length; i += fitCount(costs, i, budget)) out.push(i)
  return out.length ? out : [0]
}
