// Git argv builders and output parsers. Pure — register.ts runs the commands.

export type FileStat = { path: string; add: number; del: number }

export type Commit = {
  sha: string
  short: string
  time: number
  subject: string
  steps: string[]
  files: FileStat[]
  add: number
  del: number
}

// Artifact file state: A new/untracked, M modified, D deleted, ✓ clean (committed).
export type FileState = 'A' | 'M' | 'D' | '✓'

const RS = '\x1e'
const US = '\x1f'
export const TRAILER = 'Plan-Step'
const LOG_FORMAT = `${'%x1e'}%H${'%x1f'}%h${'%x1f'}%ct${'%x1f'}%s${'%x1f'}%(trailers:key=${TRAILER},valueonly,separator=%x2c)`

export function rootArgs(dir: string): string[] {
  return ['git', '-C', dir, 'rev-parse', '--show-toplevel']
}

// Only commits whose message has a Plan-Step line; numstat for their files.
export function logArgs(root: string, limit = 2000): string[] {
  return ['git', '-C', root, 'log', '-E', `--grep=^${TRAILER}: `, `--format=${LOG_FORMAT}`, '--numstat', '--no-color', '-n', String(limit)]
}

export function statusArgs(root: string): string[] {
  return ['git', '-C', root, 'status', '--porcelain=v1', '-z', '--untracked-files=all']
}

export function showArgs(root: string, sha: string): string[] {
  return ['git', '-C', root, 'show', '--format=', '--patch', '--no-color', '--no-ext-diff', '-M', sha]
}

export function diffArgs(root: string, rel: string): string[] {
  return ['git', '-C', root, 'diff', '--no-color', '--no-ext-diff', 'HEAD', '--', rel]
}

export function parseLog(out: string): Commit[] {
  const commits: Commit[] = []
  for (const record of out.split(RS)) {
    if (!record.trim()) continue
    const [head, ...rest] = record.split('\n')
    const [sha, short, time, subject, trailers] = head.split(US)
    if (!sha) continue
    const steps = (trailers ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => /^S\d+\.\d+$/.test(s))
    const files: FileStat[] = []
    for (const line of rest) {
      const m = /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(line)
      if (!m) continue
      files.push({ path: renamedTo(m[3]), add: m[1] === '-' ? 0 : Number(m[1]), del: m[2] === '-' ? 0 : Number(m[2]) })
    }
    commits.push({
      sha,
      short,
      time: Number(time),
      subject: subject ?? '',
      steps,
      files,
      add: files.reduce((n, f) => n + f.add, 0),
      del: files.reduce((n, f) => n + f.del, 0),
    })
  }
  return commits
}

// numstat spells renames as "a => b" or "dir/{a => b}/f".
export function renamedTo(path: string): string {
  const brace = /^(.*)\{(.*) => (.*)\}(.*)$/.exec(path)
  if (brace) return (brace[1] + brace[3] + brace[4]).replace(/\/\//g, '/')
  const plain = /^(.*) => (.*)$/.exec(path)
  return plain ? plain[2] : path
}

export function commitsByStep(commits: Commit[]): Map<string, Commit[]> {
  const map = new Map<string, Commit[]>()
  for (const c of commits) {
    for (const s of c.steps) {
      if (!map.has(s)) map.set(s, [])
      map.get(s)!.push(c)
    }
  }
  return map
}

// porcelain v1 -z: "XY path\0" and, for renames, "XY new\0old\0".
export function parseStatus(out: string): Map<string, string> {
  const map = new Map<string, string>()
  const parts = out.split('\0')
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]
    if (p.length < 4) continue
    const code = p.slice(0, 2)
    map.set(p.slice(3), code)
    if (code[0] === 'R' || code[0] === 'C') i++
  }
  return map
}

export function fileState(code: string | undefined, exists: boolean): FileState {
  if (!exists) return 'D'
  if (!code) return '✓'
  if (code === '??' || code.includes('A')) return 'A'
  if (code.includes('D')) return 'D'
  return 'M'
}

export function relativeTo(root: string, abs: string): string {
  const r = root.endsWith('/') ? root : root + '/'
  return abs.startsWith(r) ? abs.slice(r.length) : abs
}
