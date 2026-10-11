// Fixed text: the DEV_PLAN.md template, the rules block Claude reads, the
// repair agent's prompts, and the keybindings toc needs.

import type { Issue } from './plan.ts'
import { ACTIONS } from './view.ts'

export const GRAMMAR = `## M<n> Title           milestone ("chapter"), H2
- [ ] S<n>.<k> Title    step: checkbox + stable ID + title
  - note                indented sub-bullets: detail for the step
Markers: [ ] todo · [~] in progress · [x] done · [-] cancelled`

export function devPlanTemplate(name: string): string {
  return `---
toc:
  context: [SPEC.md, DEV_PLAN.md, KNOWLEDGE.md, SCRATCHPAD.md]
---
<!-- claude-toc grammar — the sidebar parses this file:
${GRAMMAR}
  IDs are stable, never reused. At most one [~]. Titles <= 28 chars;
  detail goes in sub-bullets. Prose outside steps is ignored. -->

# ${name} — DEV_PLAN

## M1 First milestone
- [ ] S1.1 First step
  - what "done" means for this step
`
}

// What Claude reads while toc is active (SPEC §7.4).
export function rulesBlock(planPath: string): string {
  return `The toc sidebar is showing ${planPath}. Keep that file in this grammar so it renders:
${GRAMMAR}
Rules: step IDs are stable (never renumber or reuse; reorder freely). Keep exactly one step [~] while you work on it and flip it to [x] when done (or [-] if dropped); start the next step by marking it [~]. Titles fit a 40-column sidebar: <= 28 chars, put detail in indented sub-bullets. While a step is [~], toc adds --trailer 'Plan-Step: <id>' to your git commit commands; don't add that trailer yourself. Edits you make are logged against the [~] step, so mark the step before you start on it.`
}

export const REPAIR_SYSTEM = `You repair a project's DEV_PLAN.md so the claude-toc sidebar can parse it again.
The grammar:
${GRAMMAR}
Rules for the repair:
- Make the smallest edits that fix the listed issues. Do not rewrite prose, titles or notes otherwise.
- Never change a step ID listed as "used by commits": commits point at those IDs.
- Duplicate ID: keep the first occurrence, give the later one the next unused ID in its milestone.
- More than one [~]: keep [~] on the step the recent conversation shows is being worked on; set the others to [ ] (or [x] if the conversation shows they were finished).
- Unknown marker: map it to the closest of [ ] [~] [x] [-].
- Step without an ID: give it the next unused ID in its milestone.
- Step outside a milestone: move it under the milestone it belongs to, or the last one.
Use the Edit tool on the file. Finish with one line: "Repaired: <what changed>".`

export function repairTask(path: string, issues: Issue[], usedIds: string[], excerpt: string): string {
  const list = issues.filter((i) => i.severity === 'error').map((i) => `- line ${i.line}: ${i.message} [${i.code}]`).join('\n')
  return `Repair ${path}.

Issues the parser found:
${list}

Step IDs used by commits (never change these): ${usedIds.length ? usedIds.join(', ') : 'none'}

Recent conversation (newest last), to judge which step is really in progress:
${excerpt || '(none)'}`
}

export function transcriptExcerpt(messages: { role: string; text: string }[], maxChars = 6000): string {
  const lines: string[] = []
  let used = 0
  for (let i = messages.length - 1; i >= 0 && used < maxChars; i--) {
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
  { context: 'Chat', key: 'ctrl+x t', action: ACTIONS.toggle },
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
