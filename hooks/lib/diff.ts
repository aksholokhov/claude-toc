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
