// The step ledger: one JSON line per file Claude wrote or edited, stamped with
// the step that was in progress (SPEC §6.2).

export type Entry = { ts: number; path: string; step: string | null; session?: string }

export const LEDGER_DIR = '.toc'
export const LEDGER_FILE = '.toc/ledger.jsonl'
export const MAX_LINES = 5000

export function parseLedger(text: string): Entry[] {
  const out: Entry[] = []
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    try {
      const e = JSON.parse(line)
      if (e && typeof e.path === 'string') out.push({ ts: Number(e.ts) || 0, path: e.path, step: e.step ?? null, session: e.session })
    } catch {
      // A torn or hand-edited line is skipped, never fatal.
    }
  }
  return out
}

// Append, keeping the file bounded; returns the new text.
export function appendEntry(text: string, entry: Entry): string {
  const lines = text.split('\n').filter((l) => l.trim())
  lines.push(JSON.stringify(entry))
  return lines.slice(-MAX_LINES).join('\n') + '\n'
}

// step id ('' = unattributed) → paths, most recent first, each path once per step.
export function filesByStep(entries: Entry[]): Map<string, string[]> {
  const map = new Map<string, string[]>()
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i]
    const key = e.step ?? ''
    if (!map.has(key)) map.set(key, [])
    const list = map.get(key)!
    if (!list.includes(e.path)) list.push(e.path)
  }
  return map
}

export const WRITE_TOOLS = ['Write', 'Edit', 'NotebookEdit', 'MultiEdit']

export function editedPath(toolInput: unknown): string | null {
  if (!toolInput || typeof toolInput !== 'object') return null
  const t = toolInput as Record<string, unknown>
  const p = t.file_path ?? t.notebook_path ?? t.path
  return typeof p === 'string' ? p : null
}
