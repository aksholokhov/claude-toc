// DEV_PLAN.md parser: the v2 grammar in SPEC §5 (v1 is its subset). Pure —
// text in, Plan out. Only milestone headings, label lines and checkboxes
// inside milestones are read; everything else is prose for people.

export type Status = 'todo' | 'doing' | 'done' | 'cancelled'

export type Step = {
  id: string
  status: Status
  title: string
  notes: string[]
  line: number
  end: number
  milestone: string
  group?: string
}

export type Milestone = {
  id: string
  title: string
  line: number
  end: number
  steps: Step[]
  acceptance: { done: number; total: number }
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

const MILESTONE_RE = /^(#{2,3})\s+(M\d+)\b\s*(?:[—:-]\s*)?(.*?)\s*$/
const HEADING_RE = /^(#{1,6})\s+(.*?)\s*$/
const LABEL_RE = /^\*\*([^*]+?):?\*\*:?\s*$/
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
  let level = 0
  let label = ''
  let group: string | undefined
  let step: Step | null = null
  let inComment = false
  let inFence = false
  let lastText = start

  const close = (at: number) => {
    if (milestone) milestone.end = Math.max(milestone.line, at)
  }

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
      lastText = lineNo
      continue
    }
    if (inFence) {
      lastText = lineNo
      continue
    }
    if (/^\s*<!--/.test(raw)) {
      if (!raw.includes('-->')) inComment = true
      continue
    }

    const m = MILESTONE_RE.exec(raw)
    if (m) {
      close(lastText)
      if (seenMilestones.has(m[2])) {
        issues.push(issue('dup-milestone', 'error', lineNo, `duplicate milestone ${m[2]}`))
      }
      seenMilestones.add(m[2])
      milestone = { id: m[2], title: m[3], line: lineNo, end: lineNo, steps: [], acceptance: { done: 0, total: 0 } }
      milestones.push(milestone)
      level = m[1].length
      label = ''
      group = undefined
      step = null
      lastText = lineNo
      continue
    }
    const h = HEADING_RE.exec(raw)
    if (h) {
      step = null
      if (milestone && h[1].length > level) {
        group = h[2] // deeper than the milestone: a visual group inside it
        label = ''
        lastText = lineNo
        continue
      }
      close(lastText)
      milestone = null
      group = undefined
      label = ''
      continue
    }
    if (raw.trim() !== '') lastText = lineNo

    const lab = milestone ? LABEL_RE.exec(raw.trim()) : null
    if (lab) {
      label = lab[1].trim().toLowerCase()
      step = null
      continue
    }

    const tracked = label === '' || label === 'deliverables'
    const s = STEP_RE.exec(raw)
    if (s && (tracked || !milestone)) {
      const status = MARKERS[s[1]]
      const [, marker, id, text] = s
      if (!status) {
        issues.push(issue('bad-marker', 'error', lineNo, `${id}: unknown marker [${marker}]`))
      }
      if (seen.has(id)) {
        issues.push(issue('dup-id', 'error', lineNo, `duplicate ID ${id} (first on line ${seen.get(id)})`))
      } else {
        seen.set(id, lineNo)
      }
      const cut = text.indexOf(' — ')
      const title = cut >= 0 ? text.slice(0, cut).trim() : text
      const desc = cut >= 0 ? text.slice(cut + 3).trim() : ''
      if (title.length > MAX_TITLE) {
        issues.push(issue('long-title', 'warn', lineNo, `${id}: title over ${MAX_TITLE} chars`))
      }
      if (!milestone) {
        issues.push(issue('orphan-step', 'error', lineNo, `${id} is outside any milestone`))
        step = null
        continue
      }
      step = { id, status: status ?? 'todo', title, notes: desc ? [desc] : [], line: lineNo, end: lineNo, milestone: milestone.id, group }
      milestone.steps.push(step)
      continue
    }

    const c = CHECKBOX_RE.exec(raw)
    if (c && milestone) {
      step = null
      if (label === 'acceptance') {
        milestone.acceptance.total++
        if (c[1] === 'x' || c[1] === 'X') milestone.acceptance.done++
      } else if (tracked) {
        issues.push(issue('missing-id', 'error', lineNo, `deliverable without an ID: "${c[2].slice(0, 30)}"`))
      }
      continue
    }

    if (step && raw.trim() !== '') {
      const n = NOTE_RE.exec(raw)
      if (n) {
        step.notes.push(n[1])
        step.end = lineNo
        continue
      }
    }
    if (raw.trim() !== '') step = null
  }
  close(lastText)

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

// Done when every live step is done and every acceptance box is checked.
export function isComplete(m: Milestone): boolean {
  const { done, live } = progress(m.steps)
  const steps = live > 0 ? done === live : m.steps.length > 0
  return steps && m.acceptance.done === m.acceptance.total
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
