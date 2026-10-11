// DEV_PLAN.md parser: the grammar in SPEC §5. Pure — text in, Plan out.

export type Status = 'todo' | 'doing' | 'done' | 'cancelled'

export type Step = {
  id: string
  status: Status
  title: string
  notes: string[]
  line: number
  milestone: string
  group?: string
}

export type Milestone = {
  id: string
  title: string
  line: number
  steps: Step[]
}

export type IssueCode =
  | 'dup-id'
  | 'multi-doing'
  | 'bad-marker'
  | 'missing-id'
  | 'orphan-step'
  | 'dup-milestone'
  | 'long-title'
  | 'orphan-trailer'

export type Issue = {
  code: IssueCode
  severity: 'error' | 'warn'
  line: number
  message: string
}

export type Plan = {
  context: string[] | null
  milestones: Milestone[]
  issues: Issue[]
}

export const MAX_TITLE = 28

const MARKERS: Record<string, Status> = { ' ': 'todo', '~': 'doing', x: 'done', X: 'done', '-': 'cancelled' }

const MILESTONE_RE = /^##\s+(M\d+)\s+(.*?)\s*$/
const H2_RE = /^##\s/
const H3_RE = /^###\s+(.*?)\s*$/
const STEP_RE = /^- \[(.)\]\s+(S\d+\.\d+)\s+(.*?)\s*$/
const CHECKBOX_RE = /^- \[(.)\]\s*(.*?)\s*$/
const NOTE_RE = /^\s+(?:[-*+]\s+)?(.*?)\s*$/

export function parsePlan(text: string): Plan {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const issues: Issue[] = []
  const milestones: Milestone[] = []
  const seen = new Map<string, number>()
  const seenMilestones = new Set<string>()
  let context: string[] | null = null
  let start = 0

  if (lines[0] === '---') {
    const end = lines.indexOf('---', 1)
    if (end > 0) {
      context = frontMatterContext(lines.slice(1, end))
      start = end + 1
    }
  }

  let milestone: Milestone | null = null
  let group: string | undefined
  let step: Step | null = null
  let inComment = false
  let inFence = false

  for (let i = start; i < lines.length; i++) {
    const raw = lines[i]
    const lineNo = i + 1

    if (inComment) {
      if (raw.includes('-->')) inComment = false
      continue
    }
    if (/^\s*```/.test(raw)) {
      inFence = !inFence
      step = null
      continue
    }
    if (inFence) continue
    if (/^\s*<!--/.test(raw)) {
      if (!raw.includes('-->')) inComment = true
      continue
    }

    const m = MILESTONE_RE.exec(raw)
    if (m) {
      if (seenMilestones.has(m[1])) {
        issues.push(issue('dup-milestone', 'error', lineNo, `duplicate milestone ${m[1]}`))
      }
      seenMilestones.add(m[1])
      milestone = { id: m[1], title: m[2], line: lineNo, steps: [] }
      milestones.push(milestone)
      group = undefined
      step = null
      continue
    }
    if (H2_RE.test(raw) || /^#\s/.test(raw)) {
      milestone = null
      group = undefined
      step = null
      continue
    }
    const h3 = H3_RE.exec(raw)
    if (h3) {
      group = h3[1]
      step = null
      continue
    }

    const s = STEP_RE.exec(raw)
    if (s) {
      const status = MARKERS[s[1]]
      const [, marker, id, title] = s
      if (!status) {
        issues.push(issue('bad-marker', 'error', lineNo, `${id}: unknown marker [${marker}]`))
      }
      if (seen.has(id)) {
        issues.push(issue('dup-id', 'error', lineNo, `duplicate ID ${id} (first on line ${seen.get(id)})`))
      } else {
        seen.set(id, lineNo)
      }
      if (title.length > MAX_TITLE) {
        issues.push(issue('long-title', 'warn', lineNo, `${id}: title over ${MAX_TITLE} chars`))
      }
      if (!milestone) {
        issues.push(issue('orphan-step', 'error', lineNo, `${id} is outside any milestone`))
        step = null
        continue
      }
      step = { id, status: status ?? 'todo', title, notes: [], line: lineNo, milestone: milestone.id, group }
      milestone.steps.push(step)
      continue
    }

    const c = CHECKBOX_RE.exec(raw)
    if (c && milestone) {
      issues.push(issue('missing-id', 'error', lineNo, `step without an ID: "${c[2].slice(0, 30)}"`))
      step = null
      continue
    }

    if (step && raw.trim() !== '') {
      const n = NOTE_RE.exec(raw)
      if (n) {
        step.notes.push(n[1])
        continue
      }
    }
    if (raw.trim() !== '') step = null
  }

  const doing = milestones.flatMap((ms) => ms.steps).filter((st) => st.status === 'doing')
  if (doing.length > 1) {
    issues.push(
      issue('multi-doing', 'error', doing[1].line, `${doing.length} steps in progress: ${doing.map((d) => d.id).join(', ')}`),
    )
  }

  issues.sort((a, b) => a.line - b.line)
  return { context, milestones, issues }
}

function issue(code: IssueCode, severity: Issue['severity'], line: number, message: string): Issue {
  return { code, severity, line, message }
}

// Minimal YAML for the one key we read: toc.context as an inline or block list.
function frontMatterContext(lines: string[]): string[] | null {
  let inToc = false
  let list: string[] | null = null
  let inList = false
  for (const raw of lines) {
    if (/^toc:\s*$/.test(raw)) {
      inToc = true
      continue
    }
    if (/^\S/.test(raw)) {
      inToc = false
      inList = false
      continue
    }
    if (!inToc) continue
    const inline = /^\s+context:\s*\[(.*)\]\s*$/.exec(raw)
    if (inline) {
      list = inline[1].split(',').map(unquote).filter(Boolean)
      inList = false
      continue
    }
    if (/^\s+context:\s*$/.test(raw)) {
      list = []
      inList = true
      continue
    }
    const item = /^\s+-\s+(.*)$/.exec(raw)
    if (inList && item && list) {
      list.push(unquote(item[1]))
      continue
    }
    inList = false
  }
  return list
}

function unquote(s: string): string {
  return s.trim().replace(/^['"]|['"]$/g, '')
}

export function allSteps(plan: Plan): Step[] {
  return plan.milestones.flatMap((m) => m.steps)
}

export function activeStep(plan: Plan): Step | null {
  return allSteps(plan).find((s) => s.status === 'doing') ?? null
}

export function findStep(plan: Plan, id: string): Step | null {
  return allSteps(plan).find((s) => s.id === id) ?? null
}

export function hasErrors(plan: Plan): boolean {
  return plan.issues.some((i) => i.severity === 'error')
}

export function progress(steps: Step[]): { done: number; live: number } {
  const live = steps.filter((s) => s.status !== 'cancelled').length
  const done = steps.filter((s) => s.status === 'done').length
  return { done, live }
}

export function isComplete(m: Milestone): boolean {
  const { done, live } = progress(m.steps)
  return live > 0 ? done === live : m.steps.length > 0
}

export function isActive(m: Milestone): boolean {
  return m.steps.some((s) => s.status === 'doing')
}

// Trailer IDs that point at no step in the plan: warns, never errors.
export function orphanTrailers(plan: Plan, trailerIds: Iterable<string>): Issue[] {
  const ids = new Set(allSteps(plan).map((s) => s.id))
  const out: Issue[] = []
  for (const id of new Set(trailerIds)) {
    if (!ids.has(id)) out.push(issue('orphan-trailer', 'warn', 0, `commits name ${id}, which the plan no longer has`))
  }
  return out
}
