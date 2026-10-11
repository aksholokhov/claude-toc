import { expect, mock, test } from 'claude-code/testing'

import { LOG, SHOW } from './fixtures/git.ts'

const BASE = '/work/proj'
const PLAN_TEXT = `## M1 First
- [x] S1.1 Parse things
  - a note
- [~] S1.2 Doing it
- [-] S1.3 Dropped
## M2 Second
- [ ] S2.1 Later
`

const PANE = {
  plugin: 'toc',
  component: 'Pane',
  requestId: 'toc',
  viewport: { columns: 200, rows: 50 },
  props: { title: 'toc', isFocused: true, bodyColumns: 42, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

type Files = Record<string, string>

// Stand in for Claude Code: a tiny in-memory file system, git, store and env.
function host(on, files: Files, opts: { git?: boolean; mtime?: () => number; status?: () => string; tmux?: string[][] } = {}) {
  const clock = mock.clock(on, { now: 1_000_000 })
  const store = new Map<string, unknown>([['bases', { [BASE]: BASE }]])
  const writes: Record<string, string> = {}
  const focused: string[] = []
  const toasts: string[] = []
  const spawned: unknown[] = []
  on('env.get', ($, e) => ({ value: { HOME: '/home/u' }[e.name] }))
  on('agent.register', () => ({ value: { agent: 'toc:repair' } }))
  on('agent.spawn', ($, e) => {
    spawned.push(e)
    return { model: 'claude-haiku-5-5', agentId: 'agent-1' }
  })
  on('tool.register', () => ({ value: undefined }))
  on('command.register', () => ({ value: undefined }))
  on('session.cwd', () => ({ value: BASE }))
  on('session.id', () => ({ value: 'sess' }))
  on('session.messages', () => ({ value: [{ role: 'user', text: 'work on S1.2', toolUses: [] }] }))
  on('store.get', ($, e) => ({ value: store.get(e.key) }))
  on('store.set', ($, e) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  on('fs.exists', ($, e) => ({ value: e.path in files }))
  on('fs.stat', ($, e) => (e.path in files ? { value: { kind: files[e.path] === '<dir>' ? 'dir' : 'file', size: 1, mtimeMs: opts.mtime ? opts.mtime() : 999_000, isLink: false } } : { deny: 'ENOENT' }))
  on('fs.read', ($, e) => (e.path in files ? { value: files[e.path] } : { deny: 'ENOENT' }))
  on('fs.write', ($, e) => {
    files[e.path] = e.text
    writes[e.path] = e.text
    return { value: undefined }
  })
  on('process.run', ($, e) => {
    const argv = e.argv.join(' ')
    if (opts.tmux && (e.argv[0] === 'tmux' || e.argv[0] === 'nvim')) {
      opts.tmux.push(e.argv)
      if (argv === 'tmux display-message -p #{pane_id}') return { value: { exitCode: 0, stdout: '%5\n', stderr: '' } }
      if (argv.startsWith('tmux display-message -p -t %5 ')) return { value: { exitCode: 0, stdout: '@1 200\n', stderr: '' } }
      if (argv.startsWith('tmux display-message -p -t %9 ')) return { value: { exitCode: 0, stdout: '%9\n', stderr: '' } }
      if (e.argv[1] === 'split-window') return { value: { exitCode: 0, stdout: '%9\n', stderr: '' } }
      if (e.argv[1] === 'respawn-pane' || e.argv[1] === 'select-pane') return { value: { exitCode: 0, stdout: '', stderr: '' } }
      return { value: { exitCode: 1, stdout: '', stderr: 'no server' } }
    }
    if (!opts.git) return { value: { exitCode: 128, stdout: '', stderr: 'not a git repository' } }
    if (argv.includes('rev-parse --show-toplevel')) return { value: { exitCode: 0, stdout: BASE + '\n', stderr: '' } }
    if (argv.includes('rev-parse --git-path')) return { value: { exitCode: 0, stdout: '.git/info/exclude\n', stderr: '' } }
    if (argv.includes(' log ')) return { value: { exitCode: 0, stdout: LOG, stderr: '' } }
    if (argv.includes(' status ')) return { value: { exitCode: 0, stdout: opts.status ? opts.status() : '', stderr: '' } }
    if (argv === 'git --version') return { value: { exitCode: 0, stdout: 'git version 2.43.0\n', stderr: '' } }
    if (argv.includes(' show ')) return { value: { exitCode: 0, stdout: SHOW, stderr: '' } }
    return { value: { exitCode: 1, stdout: '', stderr: 'unexpected ' + argv } }
  })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.panes', () => ({ value: [{ id: 'toc', title: 'toc', isShown: true, isFocused: true, isPlaced: true }] }))
  on('ui.focus', ($, e) => {
    focused.push(e.key ?? e.element ?? '')
    return {}
  })
  on('ui.toast', ($, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.log', () => ({ value: undefined }))
  on('session.start', () => ({ cwd: BASE }))
  return { clock, store, writes, focused, toasts, spawned }
}

function baseFiles(plan = PLAN_TEXT): Files {
  return {
    [BASE]: '<dir>',
    [BASE + '/DEV_PLAN.md']: plan,
    [BASE + '/SPEC.md']: '# spec',
    [BASE + '/.toc/ledger.jsonl']: '{"ts":1,"path":"/work/proj/src/a.ts","step":"S1.2"}\n',
    [BASE + '/src/a.ts']: 'export const a = 1\n',
    '/home/u/.config/theme/mode': 'dark\n',
  }
}

// Every string in the drawn tree, one row per Box child of the root.
function textOf(node): string {
  if (node === null || node === undefined || node === false) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (node.type === 'Button') return node.props.label === ' ' ? '' : node.props.label
  if (node.type === 'Code') return node.props.source
  return (node.children ?? []).map(textOf).join('')
}

async function drawn(ui): Promise<string[]> {
  const root = await ui.find({ type: 'Box' })
  return (root.children ?? []).map(textOf)
}

async function start($) {
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: BASE })
}

test('draws the four sections from DEV_PLAN.md', async ($, on) => {
  host(on, baseFiles())
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const rows = await drawn(ui)
  const text = rows.join('\n')
  expect(text).toMatch(/Context/)
  expect(text).toMatch(/SPEC\.md/)
  expect(text).toMatch(/SCRATCHPAD\.md\s+missing/)
  expect(text).toMatch(/Plan .* 1\/3/)
  expect(text).toMatch(/◐ S1\.2 Doing it/)
  expect(text).toMatch(/✗ S1\.3 Dropped/)
  expect(text).toMatch(/Artifacts · S1\.2/)
  expect(text).toMatch(/Preview/)
  expect(text).toMatch(/zoom/)
})

test('j/k move the cursor and Artifacts follows the step under it', async ($, on) => {
  const h = host(on, baseFiles())
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'key:j' }) // M1
  await ui.press({ key: 'key:j' }) // S1.1
  let text = (await drawn(ui)).join('\n')
  expect(text).toMatch(/Artifacts · S1\.1/)
  expect(text).toMatch(/a note/)
  await ui.press({ key: 'key:k' })
  text = (await drawn(ui)).join('\n')
  expect(text).toMatch(/Artifacts · S1\.1/)
  // The focus ring itself follows via $.ui.focus, which the test kit can't
  // answer ("no implementation for ui.focus"); verified live instead.
})

test('h folds a milestone, l unfolds it; z zooms; collapsed sections keep a header', async ($, on) => {
  host(on, baseFiles())
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'key:j' }) // M1
  await ui.press({ key: 'key:h' })
  let text = (await drawn(ui)).join('\n')
  expect(text).toMatch(/▸ M1 First/)
  expect(text).not.toMatch(/S1\.2 Doing it/)
  await ui.press({ key: 'key:l' })
  text = (await drawn(ui)).join('\n')
  expect(text).toMatch(/▾ M1 First/)
  expect(text).toMatch(/S1\.2 Doing it/)

  await ui.press({ key: 'key:z' })
  text = (await drawn(ui)).join('\n')
  expect(text).toMatch(/▸┤ Context/)
  expect(text).not.toMatch(/SPEC\.md/)
  await ui.press({ key: 'key:z' })
  await ui.press({ key: 'key:g' }) // header row of Plan
  await ui.press({ key: 'key:h' }) // collapse Plan
  text = (await drawn(ui)).join('\n')
  expect(text).toMatch(/▸┤ Plan/)
  expect(text).not.toMatch(/S1\.1/)
})

test('Alt keys: next section and paging through a commit diff in Preview', async ($, on) => {
  host(on, baseFiles(PLAN_TEXT.replace('- [x] S1.1', '- [x] S1.1').replace('S1.2 Doing it', 'S1.2 Doing it')), { git: true })
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  let text = (await drawn(ui)).join('\n')
  // The fixture log's commits name S1.1 and S1.2.
  expect(text).toMatch(/Artifacts · S1\.2/)
  expect(text).toMatch(/Rename/)
  expect(text).toMatch(/Second change/)
  await ui.press({ key: 'act:nextsec' }) // Artifacts
  await ui.press({ key: 'act:nextsec' }) // Preview
  text = (await drawn(ui)).join('\n')
  expect(text).toMatch(/Preview · \w+/)
  await ui.press({ key: 'act:pagedown' })
  await ui.press({ key: 'act:pageup' })
  await ui.press({ key: 'act:prevsec' })
  text = (await drawn(ui)).join('\n')
  expect(text).toMatch(/Artifacts/)
})

test('commits fold to their files with h/l', async ($, on) => {
  host(on, baseFiles(), { git: true })
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'act:nextsec' }) // Artifacts
  await ui.press({ key: 'key:j' }) // first commit (newest, open)
  let text = (await drawn(ui)).join('\n')
  expect(text).toMatch(/▾ \w+ Rename/)
  expect(text).toMatch(/dir\/new\.txt/)
  await ui.press({ key: 'key:h' })
  text = (await drawn(ui)).join('\n')
  expect(text).toMatch(/▸ \w+ Rename/)
  expect(text).not.toMatch(/dir\/new\.txt/)
  await ui.press({ key: 'key:j' })
  await ui.press({ key: 'key:l' })
  text = (await drawn(ui)).join('\n')
  expect(text).toMatch(/one\.txt/)
})

test('a broken plan asks to repair; y backs up and spawns the haiku agent', async ($, on) => {
  const broken = PLAN_TEXT + '- [~] S2.2 Also doing\n- [ ] S2.1 dup\n'
  const h = host(on, baseFiles(broken))
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  let text = (await drawn(ui)).join('\n')
  expect(text).toMatch(/✗ 2 issues/)
  expect(text).toMatch(/DEV_PLAN\.md is broken\. Repair\?/)
  await ui.press({ key: 'key:y' })
  expect(h.writes[BASE + '/.toc/DEV_PLAN.md.bak']).toBe(broken)
  expect(h.spawned.length).toBe(1)
  expect(h.spawned[0]).toMatchObject({ subagent_type: 'toc:repair', run_in_background: true })
  expect(String((h.spawned[0] as { prompt: string }).prompt)).toMatch(/duplicate ID S2\.1/)
  // A test stub can't hand back an agentId (only core assigns one), so the
  // "repairing" state is verified live.
})

test('n dismisses the repair prompt but the header stays red', async ($, on) => {
  host(on, baseFiles(PLAN_TEXT + '- [ ] S2.1 dup\n'))
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'key:n' })
  const text = (await drawn(ui)).join('\n')
  expect(text).toMatch(/✗ 1 issue/)
  expect(text).not.toMatch(/Repair\?/)
})

test('PostToolUse records the active step in the ledger', async ($, on) => {
  const h = host(on, baseFiles())
  on('classic.PostToolUse', () => ({}))
  await start($)
  await $.classic.PostToolUse({ hook_event_name: 'PostToolUse', tool_name: 'Write', tool_input: { file_path: BASE + '/src/b.ts' }, cwd: BASE })
  const ledger = h.writes[BASE + '/.toc/ledger.jsonl']
  expect(ledger).toMatch(/"path":"\/work\/proj\/src\/b\.ts","step":"S1\.2"/)
})

test('PostToolUse ignores files outside the project, inside .toc, and the knowledge files', async ($, on) => {
  const h = host(on, baseFiles())
  on('classic.PostToolUse', () => ({}))
  await start($)
  await $.classic.PostToolUse({ hook_event_name: 'PostToolUse', tool_name: 'Edit', tool_input: { file_path: '/elsewhere/x.ts' }, cwd: BASE })
  await $.classic.PostToolUse({ hook_event_name: 'PostToolUse', tool_name: 'Write', tool_input: { file_path: BASE + '/.toc/diffs/a.diff' }, cwd: BASE })
  await $.classic.PostToolUse({ hook_event_name: 'PostToolUse', tool_name: 'Read', tool_input: { file_path: BASE + '/src/a.ts' }, cwd: BASE })
  await $.classic.PostToolUse({ hook_event_name: 'PostToolUse', tool_name: 'Edit', tool_input: { file_path: BASE + '/DEV_PLAN.md' }, cwd: BASE })
  await $.classic.PostToolUse({ hook_event_name: 'PostToolUse', tool_name: 'Edit', tool_input: { file_path: BASE + '/SPEC.md' }, cwd: BASE })
  expect(h.writes[BASE + '/.toc/ledger.jsonl']).toBeUndefined()
})

test('git commit in Bash gets --trailer for the in-progress step; Bash-made files reach the ledger', async ($, on) => {
  let status = ''
  const h = host(on, baseFiles(), { git: true, status: () => status })
  const ran: string[] = []
  on('tool.call', ($, e) => {
    ran.push(e.command)
    status = '?? src/new.ts\0'
    return { result: 'ok' }
  })
  await start($)
  await $.tool.call({ tool: 'Bash', command: 'echo x > src/new.ts && git add . && git commit -m "Add new"' })
  expect(ran[0]).toBe(`echo x > src/new.ts && git add . && git commit --trailer 'Plan-Step: S1.2' -m "Add new"`)
  expect(h.writes[BASE + '/.toc/ledger.jsonl']).toMatch(/"path":"\/work\/proj\/src\/new\.ts","step":"S1\.2"/)
})

test('no trailer when nothing is in progress', async ($, on) => {
  host(on, baseFiles(PLAN_TEXT.replace('[~]', '[ ]')), { git: true })
  const ran: string[] = []
  on('tool.call', ($, e) => {
    ran.push(e.command)
    return { result: 'ok' }
  })
  await start($)
  await $.tool.call({ tool: 'Bash', command: 'git commit -m x' })
  expect(ran[0]).toBe('git commit -m x')
})

test('/project scaffolds DEV_PLAN.md and .toc in an empty folder, idempotently', async ($, on) => {
  const files: Files = { [BASE]: '<dir>', [BASE + '/.git/info/exclude']: '# git\n' }
  const h = host(on, files, { git: true })
  h.store.set('bases', {})
  await start($)
  const r1 = await $.command.run({ command: 'project', args: '.' })
  expect(r1.text).toMatch(/created DEV_PLAN\.md/)
  expect(files[BASE + '/DEV_PLAN.md']).toMatch(/## M1 First milestone/)
  expect(files[BASE + '/.toc/ledger.jsonl']).toBe('')
  expect(files[BASE + '/.git/info/exclude']).toBe('# git\n/.toc/\n')
  expect((h.store.get('bases') as Record<string, string>)[BASE]).toBe(BASE)
  const plan = files[BASE + '/DEV_PLAN.md']
  const r2 = await $.command.run({ command: 'project', args: '.' })
  expect(r2.text).not.toMatch(/created/)
  expect(files[BASE + '/DEV_PLAN.md']).toBe(plan)
  expect(files[BASE + '/.git/info/exclude']).toBe('# git\n/.toc/\n')
})

test('/project with no argument and no DEV_PLAN.md explains instead of creating', async ($, on) => {
  const files: Files = { [BASE]: '<dir>' }
  const h = host(on, files)
  h.store.set('bases', {})
  await start($)
  const r = await $.command.run({ command: 'project', args: '' })
  expect(r.text).toMatch(/no DEV_PLAN\.md/)
  expect(files[BASE + '/DEV_PLAN.md']).toBeUndefined()
})

test('the activate tool returns the rules Claude should follow', async ($, on) => {
  const files = baseFiles()
  const h = host(on, files)
  h.store.set('bases', {})
  on('tool.call', () => ({ result: 'engine' }))
  await start($)
  const r = await $.tool.call({ tool: 'mcp__toc__activate', dir: BASE })
  expect(String(r.result)).toMatch(/toc: showing \/work\/proj/)
  expect(String(r.result)).toMatch(/Keep exactly one step \[~\]/)
})

test('prompt.context adds the rules block only while active', async ($, on) => {
  host(on, baseFiles())
  on('prompt.context', ($, e) => ({ blocks: e.blocks }))
  await start($)
  const r = await $.prompt.context({ blocks: [] })
  expect(r.blocks.map((b) => b.name)).toEqual(['toc'])
})

test('/toc keys merges keybindings without clobbering the user', async ($, on) => {
  const files = baseFiles()
  files['/home/u/.claude/keybindings.json'] = JSON.stringify({ bindings: [{ context: 'Global', bindings: { 'meta+k': 'chat:modelPicker' } }] })
  host(on, files)
  await start($)
  const r = await $.command.run({ command: 'toc', args: 'keys' })
  expect(r.text).toMatch(/added Global ctrl\+x t/)
  expect(r.text).toMatch(/left alone \(already bound\): Global meta\+k is bound to chat:modelPicker/)
  const doc = JSON.parse(files['/home/u/.claude/keybindings.json'])
  const global = doc.bindings.find((b) => b.context === 'Global').bindings
  expect(global['meta+k']).toBe('chat:modelPicker')
  expect(global['meta+j']).toBe('app:toggleDiffNoiseFilter')
})

test('the poll redraws when DEV_PLAN.md changes on disk', async ($, on) => {
  const files = baseFiles()
  let mtime = 999_000
  const h = host(on, files, { mtime: () => mtime })
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  files[BASE + '/DEV_PLAN.md'] = PLAN_TEXT.replace('- [ ] S2.1 Later', '- [x] S2.1 Later')
  mtime = 1_500_000
  await h.clock.advance(2100)
  const text = (await drawn(ui)).join('\n')
  expect(text).toMatch(/Plan .* 2\/3/)
})

test("the repair agent's hand-back is dropped, other peer messages pass", async ($, on) => {
  const h = host(on, baseFiles(PLAN_TEXT + '- [ ] S2.1 dup\n'))
  h.store.set('repairAgents', ['abc123'])
  on('prompt.submit', ($, e) => ({ text: e.text }))
  await start($)
  const dropped = await $.prompt.submit({ text: '<agent-message from="abc123">\n[Subagent hand-back] Repaired', origin: { kind: 'peer' } })
  expect(dropped).toMatchObject({ drop: 'toc: the plan repair already reported in the sidebar' })
  expect(h.store.get('repairAgents')).toEqual([])
  const other = await $.prompt.submit({ text: '<agent-message from="zzz">\nhi', origin: { kind: 'peer' } })
  expect(other).toMatchObject({ text: '<agent-message from="zzz">\nhi' })
})

test('/toc keys moves an old Chat ctrl+x t binding to Global', async ($, on) => {
  const files = baseFiles()
  files['/home/u/.claude/keybindings.json'] = JSON.stringify({ bindings: [{ context: 'Chat', bindings: { 'ctrl+x t': 'app:toggleReplTab' } }] })
  host(on, files)
  await start($)
  await $.command.run({ command: 'toc', args: 'keys' })
  const doc = JSON.parse(files['/home/u/.claude/keybindings.json'])
  expect(doc.bindings.find((b) => b.context === 'Chat')).toBeUndefined()
  expect(doc.bindings.find((b) => b.context === 'Global').bindings['ctrl+x t']).toBe('app:toggleReplTab')
})

test('j/k flow across sections; digits jump; f/b page; q closes', async ($, on) => {
  host(on, baseFiles(), { git: true })
  const closed: string[] = []
  on('ui.close', ($, e) => {
    closed.push(e.id)
    return { value: undefined }
  })
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  // Context: header then 4 files (SPEC, DEV_PLAN, KNOWLEDGE, SCRATCHPAD).
  await ui.press({ key: 'key:1' })
  for (let i = 0; i < 5; i++) await ui.press({ key: 'key:j' })
  let text = (await drawn(ui)).join('\n')
  expect(text).toMatch(/2━┥ Plan/)
  await ui.press({ key: 'key:k' })
  text = (await drawn(ui)).join('\n')
  expect(text).toMatch(/1━┥ Context/)
  await ui.press({ key: 'key:4' })
  text = (await drawn(ui)).join('\n')
  expect(text).toMatch(/4━┥ Preview/)
  await ui.press({ key: 'key:f' })
  await ui.press({ key: 'key:b' })
  await ui.press({ key: 'key:k' }) // at offset 0: back up into Artifacts
  text = (await drawn(ui)).join('\n')
  expect(text).toMatch(/3━┥ Artifacts/)
  await ui.press({ key: 'key:q' })
  expect(closed).toEqual(['toc'])
})

test('row titles are buttons, so a click opens them', async ($, on) => {
  host(on, baseFiles())
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const step = await ui.find({ key: 'r:s:S1.1' })
  expect(step.type).toBe('Button')
  expect(step.props.label).toMatch(/^S1\.1 Parse things/)
  await ui.press({ key: 'r:s:S1.1' }) // click = focus + open → Artifacts of S1.1
  const text = (await drawn(ui)).join('\n')
  expect(text).toMatch(/3━┥ Artifacts · S1\.1/)
})

test('Keys is folded to its header, yet its hotkeys answer; 5 unfolds it', async ($, on) => {
  host(on, baseFiles())
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  let text = (await drawn(ui)).join('\n')
  expect(text).toMatch(/5▸┤ Keys ├─+ l: show/)
  expect(text).not.toMatch(/o: ?open/)
  expect((await ui.find({ key: 'key:j' })).props.hotkey).toBe('j')
  await ui.press({ key: 'key:4' })
  expect((await drawn(ui)).join('\n')).toMatch(/4━┥ Preview/)
  await ui.press({ key: 'key:5' })
  text = (await drawn(ui)).join('\n')
  expect(text).toMatch(/5━┥ Keys/)
  expect(text).toMatch(/open/)
  await ui.press({ key: 'key:h' })
  expect((await drawn(ui)).join('\n')).toMatch(/5▸┤ Keys/)
})

test('the band: a click closes a shown pane; the chord has its own button', async ($, on) => {
  host(on, baseFiles())
  const closed: string[] = []
  on('ui.close', ($, e) => {
    closed.push(e.id)
    return { value: undefined }
  })
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => $.ui.resolve(e).Text({ children: ['theirs'] }))
  await start($)
  const band = await $.ui.mount({ plugin: 'toc', component: 'AbovePrompt', requestId: 'band', surface: 'terminal', viewport: { columns: 200, rows: 50 }, props: {} })
  expect((await band.find({ key: 'toc-toggle' })).props.action).toBe('app:toggleReplTab')
  expect((await band.find({ key: 'toc-click' })).props.action).toBeUndefined()
  await band.press({ key: 'toc-click' })
  expect(closed).toEqual(['toc'])
})

test('Enter on a commit shows it in the pager beside Claude; v opens lazygit there', async ($, on) => {
  const tmux: string[][] = []
  host(on, baseFiles(), { git: true, tmux })
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'key:3' })
  await ui.press({ key: 'key:j' }) // the step's newest commit
  await ui.press({ key: 'key:o' })
  const split = tmux.find((a) => a[1] === 'split-window')!
  expect(split.slice(0, 7)).toEqual(['tmux', 'split-window', '-h', '-b', '-l', '50%', '-t'])
  expect(split).toContain('LESS=-R')
  expect(split).toContain('DELTA_PAGER=less -R')
  expect(split.join(' ')).toMatch(/ -P -F #\{pane_id\} git -C \/work\/proj show --stat --patch -M 06a4746\w+$/)
  await ui.press({ key: 'key:v' }) // the viewer pane is reused
  const again = tmux.filter((a) => a[1] === 'respawn-pane')
  expect(again.length).toBe(1)
  expect(again[0].slice(-4)).toEqual(['lazygit', '-p', BASE, 'log'])
  expect(tmux.filter((a) => a[1] === 'split-window').length).toBe(1)
})

test('l unfolds a commit; Enter on one of its files shows just that file of it', async ($, on) => {
  const tmux: string[][] = []
  host(on, baseFiles(), { git: true, tmux })
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'key:3' })
  for (const k of ['j', 'j', 'j', 'l', 'j']) await ui.press({ key: 'key:' + k })
  await ui.press({ key: 'key:o' })
  const split = tmux.find((a) => a[1] === 'split-window')!
  expect(split.join(' ')).toMatch(/git -C \/work\/proj show -M d1741b3\w+ -- dir\/old\.txt$/)
})
