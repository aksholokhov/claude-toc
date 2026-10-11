import { expect, test } from 'claude-code/testing'

import { activeStep, isComplete, orphanTrailers, parsePlan, progress } from '../hooks/lib/plan.ts'
import devPlan from './fixtures/dev-plan.ts'

const GOOD = `---
toc:
  context: [SPEC.md, DEV_PLAN.md, "KNOWLEDGE.md"]
---
<!-- grammar:
  ## M<n> Title
  - [ ] S<n>.<k> Title
-->
# Title

Prose is ignored.

## M1 First
- [x] S1.1 Parse things
  - a note
  - another note
- [~] S1.2 Doing it
### Group
- [-] S1.3 Dropped
- [ ] S1.4 Later

## Notes
- [ ] S9.9 not a step, outside milestones is an error

## M2 Second
- [x] S2.1 Done
\`\`\`
- [~] S2.9 inside a fence: ignored
\`\`\`
`

test('parses milestones, steps, notes, groups and front matter', () => {
  const plan = parsePlan(GOOD)
  expect(plan.context).toEqual(['SPEC.md', 'DEV_PLAN.md', 'KNOWLEDGE.md'])
  expect(plan.milestones.map((m) => m.id)).toEqual(['M1', 'M2'])
  const [m1, m2] = plan.milestones
  expect(m1.steps.map((s) => s.id + ':' + s.status)).toEqual(['S1.1:done', 'S1.2:doing', 'S1.3:cancelled', 'S1.4:todo'])
  expect(m1.steps[0].notes).toEqual(['a note', 'another note'])
  expect(m1.steps[2].group).toBe('Group')
  expect(m2.steps.map((s) => s.id)).toEqual(['S2.1'])
  expect(activeStep(plan)?.id).toBe('S1.2')
  expect(plan.issues.filter((i) => i.severity === 'error').map((i) => i.code)).toEqual(['orphan-step'])
})

test('block-list front matter', () => {
  const plan = parsePlan('---\ntoc:\n  context:\n    - A.md\n    - B.md\n---\n## M1 x\n')
  expect(plan.context).toEqual(['A.md', 'B.md'])
})

test('no front matter → null context', () => {
  expect(parsePlan('## M1 x\n- [ ] S1.1 y').context).toBe(null)
})

test('reports duplicate IDs, two in-progress steps, bad markers, missing IDs', () => {
  const plan = parsePlan(['## M1 A', '- [~] S1.1 one', '- [~] S1.2 two', '- [?] S1.3 three', '- [ ] S1.1 again', '- [ ] no id here'].join('\n'))
  expect(plan.issues.map((i) => i.code)).toEqual(['multi-doing', 'bad-marker', 'dup-id', 'missing-id'])
  expect(plan.issues.every((i) => i.severity === 'error')).toBe(true)
})

test('long titles warn but do not error', () => {
  const plan = parsePlan('## M1 A\n- [ ] S1.1 ' + 'x'.repeat(40))
  expect(plan.issues).toMatchObject([{ code: 'long-title', severity: 'warn' }])
})

test('progress ignores cancelled steps; completeness', () => {
  const plan = parsePlan('## M1 A\n- [x] S1.1 a\n- [-] S1.2 b\n## M2 B\n- [x] S2.1 a\n- [ ] S2.2 b')
  expect(progress(plan.milestones[0].steps)).toEqual({ done: 1, live: 1 })
  expect(isComplete(plan.milestones[0])).toBe(true)
  expect(isComplete(plan.milestones[1])).toBe(false)
})

test('orphan trailers warn', () => {
  const plan = parsePlan('## M1 A\n- [x] S1.1 a')
  expect(orphanTrailers(plan, ['S1.1', 'S7.7']).map((i) => i.message)).toEqual(['commits name S7.7, which the plan no longer has'])
})

test('parses the real DEV_PLAN.md of this repo without errors', () => {
  const plan = parsePlan(devPlan)
  expect(plan.issues.filter((i) => i.severity === 'error')).toEqual([])
  expect(plan.milestones.length).toBe(10)
})
