// Fixed text: the DEV_PLAN.md template, the rules block Claude reads, the
// repair agent's prompts, and the keybindings toc needs.

import type { Issue } from './plan.ts'
import { ACTIONS } from './view.ts'

// The machine part of DEV_PLAN.md (SPEC §5). Everything else is prose.
export const GRAMMAR = `### M<n> — Title            milestone (H3 under "## Milestones"; runs to the next H3/H2)
**Deliverables**               label line; below it, checkboxes are steps:
- [ ] S<n>.<k> Short title — one-sentence description
  indented lines / sub-bullets: the step's detail
**Acceptance**                 checkboxes here are counted, never given IDs
**Tests** (or any other label) checkboxes here are ignored
Markers: [ ] todo · [~] in progress · [x] done · [-] cancelled`

export function devPlanTemplate(name: string): string {
  return `---
toc:
  context: [SPEC.md, DEV_PLAN.md, KNOWLEDGE.md, SCRATCHPAD.md]
---
<!-- toc reads milestones, steps and acceptance (grammar in the toc:dev-plan
skill); all other text is for people. Step IDs are stable, one [~] at a time. -->

# ${name} — dev plan

> **Status:** not started.
> **Goal:** <the outcome, in a sentence or two>

## Scope

**In:** …
**Out, deliberately:** …

## Milestones

### M1 — <What the first milestone delivers>
<Why it exists: what it proves, the risk it retires.>

**Deliverables**
- [ ] S1.1 <Short title> — <one-sentence description>

**Acceptance**
- [ ] <A binary, testable statement of done.>

**Tests**
1. <How the acceptance is demonstrated.>

## Decisions

## Definition of done
`
}

// What Claude reads while toc is active (SPEC §7.4).
export function rulesBlock(planPath: string): string {
  return `The toc sidebar is showing ${planPath}: a human-readable engineering plan whose milestones, steps and acceptance criteria toc reads. To write or restructure it, use the toc:dev-plan skill. Keep the machine part in this grammar:
${GRAMMAR}
Rules: step IDs are stable (never renumber or reuse; reorder freely). Keep exactly one step [~] while you work on it and flip it to [x] when done (or [-] if dropped, saying why in its description); start the next step by marking it [~]. Check an Acceptance box only once it has been demonstrated. Short titles (before " — ") fit a 40-column sidebar: <= 28 chars. While a step is [~], toc adds --trailer 'Plan-Step: <id>' to your git commit commands; don't add that trailer yourself. Edits you make are logged against the [~] step, so mark the step before you start on it.`
}

export const REPAIR_SYSTEM = `You repair a project's DEV_PLAN.md so the claude-toc sidebar can parse it again.
The grammar:
${GRAMMAR}
Rules for the repair:
- Make the smallest edits that fix the listed issues. The file is mostly prose for people: never rewrite prose, titles, descriptions or notes otherwise.
- Never change a step ID listed as "used by commits": commits point at those IDs.
- Duplicate ID: keep the first occurrence, give the later one the next unused ID in its milestone.
- More than one [~]: keep [~] on the step the recent conversation shows is being worked on; set the others to [ ] (or [x] if the conversation shows they were finished).
- Unknown marker: map it to the closest of [ ] [~] [x] [-].
- Deliverable without an ID: give it the next unused ID in its milestone. (Checkboxes under **Acceptance** never get IDs; if one was given an S-ID by mistake, move that line under **Deliverables** only if it really is a deliverable.)
- Step outside a milestone: move it under the milestone it belongs to, or the last one.
Use the Edit tool on the file. Finish with one line: "Repaired: <what changed>".`

export function repairTask(path: string, issues: Issue[], usedIds: string[], excerpt: string): string {
  const list = issues.map((i) => `- line ${i.line}: ${i.message} [${i.code}]`).join('\n')
  return `Repair ${path}.

Issues the parser found:
${list}

Step IDs used by commits (never change these): ${usedIds.length ? usedIds.join(', ') : 'none'}

Recent conversation (newest last), to judge which step is really in progress:
${excerpt || '(none)'}`
}

const EXCERPT_CHARS = 6000

export function transcriptExcerpt(messages: { role: string; text: string }[]): string {
  const lines: string[] = []
  let used = 0
  for (let i = messages.length - 1; i >= 0 && used < EXCERPT_CHARS; i--) {
    const m = messages[i]
    const text = (m.text ?? '').replace(/\s+/g, ' ').trim()
    if (!text) continue
    const line = `${m.role}: ${text.slice(0, 600)}`
    lines.unshift(line)
    used += line.length
  }
  return lines.join('\n')
}

// ── keybindings ─────────────────────────────────────────────────────────

export const KEYBINDINGS: { context: string; key: string; action: string }[] = [
  // Global, not Chat: Chat bindings are inactive while the pane has focus.
  { context: 'Global', key: 'ctrl+x t', action: ACTIONS.toggle },
  { context: 'Global', key: 'meta+j', action: ACTIONS.pagedown },
  { context: 'Global', key: 'meta+k', action: ACTIONS.pageup },
  { context: 'Global', key: 'meta+h', action: ACTIONS.prevsec },
  { context: 'Global', key: 'meta+l', action: ACTIONS.nextsec },
]

type Block = { context: string; bindings: Record<string, string | null> }

// Merge toc's bindings into keybindings.json text. Never overrides a key the
// user bound to something else; reports it as a conflict instead.
export function mergeKeybindings(text: string | null): { text: string; added: string[]; conflicts: string[] } {
  let doc: { bindings?: Block[]; [k: string]: unknown }
  try {
    doc = text && text.trim() ? JSON.parse(text) : {}
  } catch {
    throw new Error('keybindings.json is not valid JSON; fix it first')
  }
  const blocks: Block[] = Array.isArray(doc.bindings) ? doc.bindings : []
  const added: string[] = []
  const conflicts: string[] = []
  for (const b of KEYBINDINGS) {
    let block = blocks.find((x) => x.context === b.context)
    if (!block) {
      block = { context: b.context, bindings: {} }
      blocks.push(block)
    }
    const have = block.bindings[b.key]
    if (have === b.action) continue
    if (have !== undefined) {
      conflicts.push(`${b.context} ${b.key} is bound to ${have}`)
      continue
    }
    block.bindings[b.key] = b.action
    added.push(`${b.context} ${b.key}`)
  }
  const out = {
    $schema: 'https://www.schemastore.org/claude-code-keybindings.json',
    $docs: 'https://code.claude.com/docs/en/keybindings',
    ...doc,
    bindings: blocks,
  }
  return { text: JSON.stringify(out, null, 2) + '\n', added, conflicts }
}
