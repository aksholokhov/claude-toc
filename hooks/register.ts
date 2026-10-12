// claude-toc: the hooks module. Everything that touches `$` lives here (the
// mods validator only follows `$` into top-level functions of this file);
// hooks/lib/* is pure and unit-tested.

import { parseDiff } from './lib/diff.ts'
import {
  aliveArgs, diffViewArgs, isPaneAlive, lazygitArgs, nvimArgs, leftSplitArgs, paneAliveArgs, parseWindowId, remoteTabArgs, respawnArgs, selectPaneArgs, socketPath,
  tmuxInfoArgs, viewerEnv,
} from './lib/editor.ts'
import type { Spawn, ViewTarget } from './lib/editor.ts'
import {
  changedBetween, commitsByStep, diffArgs, fileState, logArgs, parseLog, parseStatus, relativeTo, rootArgs, showArgs, statusArgs,
  supportsTrailer, withTrailer,
} from './lib/git.ts'
import type { Snapshot } from './lib/git.ts'
import { appendEntry, editedPath, filesByStep, LEDGER_DIR, LEDGER_FILE, parseLedger, WRITE_TOOLS } from './lib/ledger.ts'
import {
  PLAN, PREV, allocate, fileRowIndex, focusRow, initialUI, isShown, joinPath, planSignature,
  press, previewCosts, previewRowCount, previewTarget, reconcile, rowsOf, targetKey,
} from './lib/model.ts'
import type { ArtFile, CtxFile, Data, Effect, Key, Preview, Repair, Target, UI } from './lib/model.ts'
import { parseMode, rolesFor } from './lib/palette.ts'
import { activeStep, errorsOf, orphanTrailers, parsePlan } from './lib/plan.ts'
import { REPAIR_SYSTEM, devPlanTemplate, mergeKeybindings, repairTask, rulesBlock, transcriptExcerpt } from './lib/text.ts'
import { ACTIONS, drawnOrder, isRepairAsk, legendRows, render } from './lib/view.ts'

const PANE = 'toc'
const PLAN_FILE = 'DEV_PLAN.md'
const DEFAULT_CONTEXT = ['SPEC.md', 'DEV_PLAN.md', 'KNOWLEDGE.md', 'SCRATCHPAD.md']
const COLUMNS = 42
const REPAIR_AGENT = 'toc:repair'

// ── session state (module-level; lost on reload, rebuilt by refresh) ────
let base: string | null = null
let root: string | null = null
let home = ''
let data: Data | null = null
let ui: UI = initialUI()
let repair: Repair = null
let repairAgent: string | null = null
let preview: Preview | null = null
let previewWanted = ''
let roles = rolesFor(null)
let stamp = ''
let width = COLUMNS
let bodyRows = 30
let lastFocus: string | null = null
let refreshing = false
let again = false
let trailerOk: boolean | null = null

// ── small helpers ───────────────────────────────────────────────────────

async function run($, argv: string[], cwd?: string): Promise<{ ok: boolean; out: string; err: string }> {
  try {
    const r = await $.process.run(argv, { cwd: cwd ?? base ?? undefined, timeoutMs: 15000 })
    return { ok: r.exitCode === 0, out: r.stdout, err: r.stderr }
  } catch (err) {
    return { ok: false, out: '', err: String(err) }
  }
}

async function readText($, path: string): Promise<string | null> {
  try {
    return await $.fs.read(path)
  } catch {
    return null
  }
}

async function mtime($, path: string): Promise<number> {
  try {
    if (!(await $.fs.exists(path))) return 0
    return (await $.fs.stat(path)).mtimeMs
  } catch {
    return 0
  }
}

function abs(dir: string, p: string): string {
  return joinPath(dir, p)
}

function under(dir: string, p: string): boolean {
  const d = dir.endsWith('/') ? dir : dir + '/'
  return p === dir || p.startsWith(d)
}

function counts(): number[] {
  if (!data) return [0, 0, 0, 0, 0]
  return [0, 1, 2].map((s) => rowsOf(s, ui, data!, repair).length).concat([previewRowCount(preview), 0])
}

function alloc(): number[] {
  return allocate(ui, counts(), bodyRows, data ? legendRows(width - 1, isRepairAsk(repair, data)).length : undefined)
}

// ── data ────────────────────────────────────────────────────────────────

async function stampOf($): Promise<string> {
  if (!base) return ''
  const parts = [
    await mtime($, abs(base, PLAN_FILE)),
    await mtime($, abs(base, LEDGER_FILE)),
    root ? await mtime($, abs(root, '.git/index')) : 0,
    root ? await mtime($, abs(root, '.git/HEAD')) : 0,
    root ? await mtime($, abs(root, '.git/logs/HEAD')) : 0,
    home ? await mtime($, home + '/.config/theme/mode') : 0,
  ]
  for (const name of data?.context.map((c) => c.path) ?? []) parts.push(await mtime($, name))
  return parts.join(':')
}

async function refresh($) {
  if (!base) return
  if (refreshing) {
    again = true
    return
  }
  refreshing = true
  try {
    do {
      again = false
      await load($)
    } while (again)
  } finally {
    refreshing = false
  }
}

async function load($) {
  const b = base!
  const planPath = abs(b, PLAN_FILE)
  const text = await readText($, planPath)
  const plan = text === null ? null : parsePlan(text)

  const names = plan?.context ?? DEFAULT_CONTEXT
  const context: CtxFile[] = []
  for (const name of names) {
    const path = abs(b, name)
    const m = await mtime($, path)
    context.push({ name, path, exists: m > 0, mtimeMs: m })
  }

  let commits = new Map()
  let status = new Map<string, string>()
  if (root) {
    const log = await run($, logArgs(root), root)
    if (log.ok) commits = commitsByStep(parseLog(log.out))
    const st = await run($, statusArgs(root), root)
    if (st.ok) status = parseStatus(st.out)
  }
  if (plan) plan.issues.push(...orphanTrailers(plan, commits.keys()))

  const ledger = parseLedger((await readText($, abs(b, LEDGER_FILE))) ?? '')
  const files = new Map<string, ArtFile[]>()
  for (const [step, paths] of filesByStep(ledger)) {
    const list: ArtFile[] = []
    for (const path of paths) {
      const exists = (await mtime($, path)) > 0
      const rel = root ? relativeTo(root, path) : relativeTo(b, path)
      list.push({ path, rel, state: root ? fileState(status.get(rel), exists) : exists ? 'M' : 'D' })
    }
    files.set(step, list)
  }

  roles = rolesFor(home ? parseMode(await readText($, home + '/.config/theme/mode')) : null)
  data = { base: b, root, plan, planPath, context, commits, files, now: await $.clock.now() }

  const sig = planSignature(plan)
  const broken = errorsOf(plan).length > 0
  if (!broken) repair = repair && repair.phase === 'running' ? repair : null
  else if (!repair || (repair.phase === 'dismissed' && repair.sig !== sig)) repair = { phase: 'ask', sig }

  ui = reconcile(ui, data, repair)
  stamp = await stampOf($)
  await loadPreview($)
  $.ui.invalidate('ui.render')
}

async function loadPreview($) {
  if (!data) return
  const t = previewTarget(ui, data)
  if (!t) {
    preview = null
    return
  }
  const key = targetKey(t)
  previewWanted = key
  if (preview && preview.key === key) {
    if (t.kind === 'cfile') ui = { ...ui, previewOffset: fileRowIndex(preview, t.path) }
    return
  }
  const p = await fetchPreview($, t, key)
  if (previewWanted !== key) return
  preview = p
  ui = { ...ui, previewOffset: 0 }
  if (t.kind === 'cfile') ui = { ...ui, previewOffset: fileRowIndex(p, t.path) }
}

async function fetchPreview($, t: Target, key: string): Promise<Preview> {
  const r = root ?? base!
  if (t.kind === 'brief') {
    const text = data ? await readText($, data.planPath) : null
    if (text === null) return { key, files: null, source: null, path: PLAN_FILE, error: 'cannot read ' + PLAN_FILE }
    const lines = text.replace(/\r\n?/g, '\n').split('\n').slice(t.from - 1, t.to)
    return { key, files: null, source: lines.join('\n'), path: PLAN_FILE, firstLine: t.from }
  }
  if (t.kind === 'commit' || t.kind === 'cfile') {
    const show = await run($, showArgs(r, t.sha), r)
    return show.ok ? { key, files: parseDiff(show.out), source: null, path: '' } : { key, files: null, source: null, path: '', error: 'git show failed' }
  }
  if (t.state === 'A' || !root) {
    const text = await readText($, t.path)
    return text === null ? { key, files: null, source: null, path: t.rel, error: 'cannot read ' + t.rel } : { key, files: null, source: text, path: t.rel }
  }
  if (t.state === '✓') {
    const text = await readText($, t.path)
    return { key, files: null, source: text ?? '', path: t.rel }
  }
  const diff = await run($, diffArgs(root, t.rel), root)
  return { key, files: diff.ok ? parseDiff(diff.out) : [], source: null, path: t.rel, error: diff.ok ? undefined : 'git diff failed' }
}

async function poll($) {
  if (!base || refreshing) return
  const s = await stampOf($)
  if (s !== stamp) await refresh($)
}

// ── ledger ──────────────────────────────────────────────────────────────

async function activeStepId($): Promise<string | null> {
  if (!base) return null
  const text = await readText($, abs(base, PLAN_FILE))
  const step = text ? activeStep(parsePlan(text)) : null
  return step ? step.id : null
}

async function record($, paths: string[]) {
  if (!base || !paths.length) return
  const scope = root ?? base
  // Knowledge files have their own section; logging them would only fill
  // the unattributed bucket with plan edits.
  const known = new Set((data?.context ?? []).map((c) => c.path).concat(abs(base, PLAN_FILE)))
  const keep = paths.filter((p) => under(scope, p) && !under(abs(base!, LEDGER_DIR), p) && !known.has(p))
  if (!keep.length) return
  const step = await activeStepId($)
  const ledgerPath = abs(base, LEDGER_FILE)
  let text = (await readText($, ledgerPath)) ?? ''
  const ts = await $.clock.now()
  const session = await $.session.id()
  for (const path of keep) text = appendEntry(text, { ts, path, step, session })
  await $.fs.write(ledgerPath, text)
}

// git status plus mtimes: what a Bash command changed shows up as a new
// entry or a moved mtime.
async function snapshot($): Promise<Snapshot | null> {
  if (!root) return null
  const st = await run($, statusArgs(root), root)
  if (!st.ok) return null
  const snap: Snapshot = new Map()
  for (const [rel, code] of parseStatus(st.out)) snap.set(rel, code + ' ' + (await mtime($, abs(root, rel))))
  return snap
}

// ── activation & scaffolding ────────────────────────────────────────────

async function activate($, dir: string, opts: { create: boolean }): Promise<string> {
  const cwd = await $.session.cwd()
  const target = abs(cwd, dir || '.').replace(/\/\.$/, '').replace(/\/$/, '') || '/'
  let isDir = false
  try {
    isDir = (await $.fs.stat(target)).kind === 'dir'
  } catch {
    isDir = false
  }
  if (!isDir) return `toc: ${target} is not a directory`

  const planPath = abs(target, PLAN_FILE)
  const hasPlan = await $.fs.exists(planPath)
  if (!hasPlan && !opts.create) return `toc: no ${PLAN_FILE} in ${target}`

  base = target
  const top = await run($, rootArgs(target), target)
  root = top.ok ? top.out.trim() : null

  const notes: string[] = []
  if (!hasPlan) {
    await $.fs.write(planPath, devPlanTemplate(target.split('/').pop() || 'project'))
    notes.push('created ' + PLAN_FILE)
  }
  const ledgerPath = abs(target, LEDGER_FILE)
  if (!(await $.fs.exists(ledgerPath))) await $.fs.write(ledgerPath, '')
  if (root) {
    const ex = await run($, ['git', '-C', root, 'rev-parse', '--git-path', 'info/exclude'], root)
    if (ex.ok) {
      const exPath = abs(root, ex.out.trim())
      const rel = relativeTo(root, abs(target, LEDGER_DIR))
      const pattern = '/' + rel.replace(/^\/+/, '') + '/'
      const cur = (await readText($, exPath)) ?? ''
      if (!cur.split('\n').includes(pattern)) {
        await $.fs.write(exPath, cur + (cur && !cur.endsWith('\n') ? '\n' : '') + pattern + '\n')
        notes.push('excluded ' + pattern + ' from git')
      }
    }
  }
  const map = ((await $.store.get('bases')) ?? {}) as Record<string, string>
  if (map[cwd] !== target) await $.store.set('bases', { ...map, [cwd]: target })

  ui = initialUI()
  preview = null
  repair = null
  await refresh($)
  return ['toc: showing ' + target + (notes.length ? ' (' + notes.join(', ') + ')' : ''), '', rulesBlock(planPath)].join('\n')
}

async function openPane($, focus: boolean) {
  // rows only matters inline (narrow terminal): a third of the screen is too
  // little for a plan.
  const pane = { id: PANE, title: 'toc', columns: COLUMNS, rows: 26 }
  await $.ui.open(focus ? { ...pane, focus: true } : pane)
}

async function togglePane($) {
  const panes = await $.ui.panes()
  const mine = panes.find((p) => p.id === PANE)
  if (mine && mine.isShown && mine.isFocused) {
    await $.ui.close({ id: PANE })
    return
  }
  if (!base) {
    const msg = await activate($, '.', { create: false })
    if (!base) {
      $.ui.toast('toc: no DEV_PLAN.md here; run /project <dir>')
      return
    }
    $.ui.log(msg.split('\n')[0])
  }
  await openPane($, true)
}

// The band click: open it when it's away, put it away when it's up.
async function clickPane($) {
  const mine = (await $.ui.panes()).find((p) => p.id === PANE)
  if (mine && mine.isShown) return $.ui.close({ id: PANE })
  return togglePane($)
}

async function installKeys($): Promise<string> {
  if (!home) return 'toc: HOME is not set'
  const path = home + '/.claude/keybindings.json'
  const cur = await readText($, path)
  try {
    const merged = mergeKeybindings(cur)
    if (merged.added.length) await $.fs.write(path, merged.text)
    const lines = []
    lines.push(merged.added.length ? 'toc: added ' + merged.added.join(', ') + ' to ' + path : 'toc: keybindings already in place')
    if (merged.conflicts.length) lines.push('toc: left alone (already bound): ' + merged.conflicts.join('; '))
    return lines.join('\n')
  } catch (err) {
    return 'toc: ' + String((err as Error).message ?? err)
  }
}

// ── keys & effects ──────────────────────────────────────────────────────

// `before`: the state Preview was last loaded for, when the caller moved the
// cursor itself first (a click).
async function handleKey($, key: Key, surface?: string, before: UI = ui) {
  if (!data) return
  const r = press(ui, key, { data, repair, alloc: alloc(), previewCosts: previewCosts(preview, width) })
  ui = r.ui
  if (shownKey(before) !== shownKey(ui)) await loadPreview($)
  $.ui.invalidate('ui.render')
  await effect($, r.effect, surface)
  syncRing($)
}

// What Preview shows for this state; a change means reload it.
function shownKey(u: UI): string {
  const t = data ? previewTarget(u, data) : null
  return t ? targetKey(t) : ''
}

// Keep the focus ring on the cursor row after our own moves.
function syncRing($) {
  const sec = ui.sec
  const key = sec === PREV || ui.cursor[sec] === null ? 'h:' + sec : ui.cursor[sec]
  if (key === lastFocus) return
  lastFocus = key
  $.clock.after(40, () => {
    $.ui.focus({ requestId: PANE, key: 'r:' + key }).catch(() => undefined)
  })
}

async function effect($, e: Effect, surface?: string) {
  if (e.kind === 'open') return openInEditor($, e.path, surface, e.line)
  if (e.kind === 'view') return viewDiff($, e.target, surface)
  if (e.kind === 'history') return history($, e.path)
  if (e.kind === 'repair') return e.yes ? startRepair($) : dismissRepair($)
  if (e.kind === 'close') return $.ui.close({ id: PANE })
  if (e.kind === 'scaffold') {
    const msg = await activate($, base ?? '.', { create: true })
    $.ui.log(msg.split('\n')[0])
  }
}

// Since 2.1.29x the session runs under a daemon's pty host, which doesn't
// inherit TMUX/TMUX_PANE. Fall back to asking the default tmux server for
// the pane its most recent client is on: the one the key was just pressed in.
async function tmuxPane($): Promise<string | null> {
  const fromEnv = await $.env.get('TMUX_PANE')
  if (fromEnv) return fromEnv
  const r = await run($, ['tmux', 'display-message', '-p', '#{pane_id}'])
  const id = r.out.trim()
  return r.ok && /^%\d+$/.test(id) ? id : null
}

// Claude's tmux pane and window, or null (toasted) when there's no tmux.
async function claudeWindow($, fallback: () => Promise<void>) {
  const pane = await tmuxPane($)
  if (!pane) {
    await fallback()
    return null
  }
  const windowId = parseWindowId((await run($, tmuxInfoArgs(pane))).out)
  if (!windowId) {
    $.ui.toast('toc: could not read the tmux window')
    return null
  }
  return { pane, windowId }
}

// The left column of a tmux window: the nvim and viewer panes toc opened
// there, one record per window in $.store, read back only while alive.
type LeftKind = 'nvim' | 'viewer'
type Column = { nvim?: string; viewer?: string }
const COLUMNS_KEY = 'leftColumns'

async function columnOf($, windowId: string): Promise<Column> {
  const kept = (((await $.store.get(COLUMNS_KEY)) ?? {}) as Record<string, Column>)[windowId] ?? {}
  const alive = async (pane?: string) => (pane && isPaneAlive((await run($, paneAliveArgs(pane))).out, pane, windowId) ? pane : undefined)
  return { nvim: await alive(kept.nvim), viewer: await alive(kept.viewer) }
}

async function keepColumn($, windowId: string, column: Column) {
  const all = ((await $.store.get(COLUMNS_KEY)) ?? {}) as Record<string, Column>
  await $.store.set(COLUMNS_KEY, { ...all, [windowId]: column })
}

// Open `kind` in the left column: nvim above the viewer, the viewer below
// nvim, either as the left half of Claude's pane when it is alone.
async function openLeft($, w: { pane: string; windowId: string }, kind: LeftKind, spawn: Spawn): Promise<boolean> {
  const column = await columnOf($, w.windowId)
  const other = kind === 'nvim' ? column.viewer : column.nvim
  const above = kind === 'nvim'
  let split = await run($, leftSplitArgs(w.pane, other ?? null, above, spawn))
  if (!split.ok && other) split = await run($, leftSplitArgs(w.pane, null, above, spawn)) // it died just now
  if (!split.ok) {
    $.ui.toast('toc: tmux split failed: ' + split.err.trim().slice(0, 80))
    return false
  }
  const pane = split.out.trim()
  await keepColumn($, w.windowId, { ...column, [kind]: pane })
  watchPane($, pane, w.pane)
  return true
}

function workDir(): string {
  return root ?? base ?? '.'
}

async function openInEditor($, path: string, surface?: string, line?: number) {
  const w = await claudeWindow($, async () => {
    await $.ui.copy(surface ? { text: path, surface } : { text: path }).catch(() => undefined)
    $.ui.toast('toc: not in tmux — copied ' + path)
  })
  if (!w) return
  const runtime = (await $.env.get('XDG_RUNTIME_DIR')) || '/tmp'
  const sock = socketPath(runtime, w.windowId)
  if ((await run($, aliveArgs(sock))).ok) {
    const r = await run($, remoteTabArgs(sock, path, line))
    if (!r.ok) $.ui.toast('toc: nvim refused ' + path)
    const { nvim } = await columnOf($, w.windowId)
    if (nvim) await run($, selectPaneArgs(nvim))
    return
  }
  await openLeft($, w, 'nvim', { cwd: workDir(), env: [], cmd: nvimArgs(sock, path, line) })
}

// Panes toc started (nvim, the viewer), watched while they live: when one
// quits, tmux returns to Claude's pane and Claude to its prompt; the person
// came from toc, so hand the keys back to it.
let watched: { pane: string; claude: string }[] = []
let watchTimer: { cancel: () => void } | null = null

function watchPane($, pane: string, claude: string) {
  watched = [...watched.filter((w) => w.pane !== pane), { pane, claude }]
  if (watchTimer) return
  watchTimer = $.clock.every(400, () => {
    checkWatched($).catch(() => undefined)
  })
}

async function checkWatched($) {
  const r = await run($, ['tmux', 'list-panes', '-a', '-F', '#{pane_id}'])
  if (!r.ok) return
  const live = new Set(r.out.split('\n').map((l) => l.trim()))
  const gone = watched.filter((w) => !live.has(w.pane))
  if (!gone.length) return
  watched = watched.filter((w) => live.has(w.pane))
  if (!watched.length && watchTimer) {
    watchTimer.cancel()
    watchTimer = null
  }
  // Only once tmux is back on Claude's pane: the other left pane may have
  // taken the focus instead, and then it's the person's.
  const claude = gone[gone.length - 1].claude
  const active = await run($, ['tmux', 'display-message', '-p', '-t', claude, '#{pane_id} #{pane_active}'])
  if (active.out.trim() !== claude + ' 1') return
  await openPane($, true)
}

// The theme for delta and lazygit, as the person's shell would set it.
async function viewerEnvFor($): Promise<string[]> {
  const mode = parseMode(home ? await readText($, home + '/.config/theme/mode') : null) ?? 'dark'
  const config = (await $.env.get('XDG_CONFIG_HOME')) || (home ? home + '/.config' : '')
  if (!config) return viewerEnv(mode, null)
  const dir = config + '/lazygit'
  const both = (await $.fs.exists(dir + '/config.yml')) && (await $.fs.exists(dir + '/theme-' + mode + '.yml'))
  return viewerEnv(mode, both ? dir + '/config.yml,' + dir + '/theme-' + mode + '.yml' : null)
}

// Run cmd in the viewer pane: reuse it, else open it in the left column.
async function inViewer($, cmd: string[]) {
  const w = await claudeWindow($, async () => {
    $.ui.toast('toc: not in tmux — run: ' + cmd.join(' ').slice(0, 120))
  })
  if (!w) return
  const spawn = { cwd: workDir(), env: await viewerEnvFor($), cmd }
  const { viewer } = await columnOf($, w.windowId)
  if (viewer && (await run($, respawnArgs(viewer, spawn))).ok) {
    await run($, selectPaneArgs(viewer))
    watchPane($, viewer, w.pane)
    return
  }
  await openLeft($, w, 'viewer', spawn)
}

// A commit, a file in a commit, or a working-tree change, in the pager.
async function viewDiff($, t: Target, surface?: string) {
  const r = root ?? base!
  if (t.kind === 'brief') return data ? openInEditor($, data.planPath, surface, t.from) : undefined
  if (t.kind === 'file' && (t.state === '✓' || !root)) return openInEditor($, t.path, surface)
  const vt: ViewTarget =
    t.kind === 'commit' ? { kind: 'commit', sha: t.sha }
      : t.kind === 'cfile' ? { kind: 'cfile', sha: t.sha, path: t.path }
        : { kind: 'file', path: t.path, untracked: t.state === 'A' } // new: diff it against nothing
  return inViewer($, diffViewArgs(r, vt))
}

async function history($, path: string | null) {
  if (!root) return $.ui.toast('toc: not a git repository')
  return inViewer($, lazygitArgs(root, path === null ? null : relativeTo(root, path)))
}

// ── repair (SPEC §7.6) ──────────────────────────────────────────────────

async function startRepair($) {
  if (!data || !data.plan || !base) return
  const text = (await readText($, data.planPath)) ?? ''
  await $.fs.write(abs(base, LEDGER_DIR + '/DEV_PLAN.md.bak'), text)
  let excerpt = ''
  try {
    excerpt = transcriptExcerpt((await $.session.messages()).slice(-40))
  } catch {
    excerpt = ''
  }
  const task = repairTask(data.planPath, data.plan.issues, [...data.commits.keys()], excerpt)
  repair = { phase: 'running', sig: planSignature(data.plan) }
  $.ui.invalidate('ui.render')
  const r = await $.agent.spawn({ subagentType: REPAIR_AGENT, prompt: task, description: 'repair DEV_PLAN.md' })
  if (r.deny || !r.agentId) {
    repair = { phase: 'ask', sig: planSignature(data.plan) }
    $.ui.toast('toc: repair could not start: ' + (r.deny ?? 'no agent'))
  } else {
    repairAgent = r.agentId
    // Kept in the store too: a reload between spawn and hand-back would
    // otherwise forget it and let the report cost a main-model turn.
    const kept = ((await $.store.get('repairAgents')) ?? []) as string[]
    await $.store.set('repairAgents', [...kept, r.agentId].slice(-20))
  }
  $.ui.invalidate('ui.render')
}

async function dismissRepair($) {
  if (!data) return
  repair = { phase: 'dismissed', sig: planSignature(data.plan) }
  $.ui.invalidate('ui.render')
}

// ── register ────────────────────────────────────────────────────────────

export function register(on) {
  on('session.start', async ($, e, next) => {
    home = (await $.env.get('HOME')) ?? ''
    await $.agent.register({
      name: 'repair',
      description: 'Repairs a DEV_PLAN.md that the toc sidebar cannot parse. Dispatched by the toc plugin only.',
      prompt: REPAIR_SYSTEM,
      tools: ['Read', 'Edit'],
      model: 'haiku',
    })
    await $.tool.register({
      name: 'activate',
      description:
        'Show the toc sidebar for a project folder that holds (or should hold) DEV_PLAN.md: knowledge files, plan progress, and per-step commits and files. Idempotent; creates DEV_PLAN.md from a template only if missing. Call it once you know the project folder, e.g. after writing or finding a DEV_PLAN.md.',
      inputSchema: { type: 'object', properties: { dir: { type: 'string', description: 'Project folder, absolute or relative to the working directory' } }, required: ['dir'] },
      isDeferred: false,
    })
    await $.command.register({ name: 'toc', description: 'Show or hide the toc sidebar (also: /toc keys, /toc refresh)', argumentHint: '[keys|refresh]', immediate: true })
    await $.command.register({ name: 'project', description: 'Point the toc sidebar at a project folder and scaffold DEV_PLAN.md', argumentHint: '[dir]' })

    const cwd = await $.session.cwd()
    const map = ((await $.store.get('bases')) ?? {}) as Record<string, string>
    if (map[cwd] && (await $.fs.exists(abs(map[cwd], PLAN_FILE)))) {
      base = map[cwd]
      const top = await run($, rootArgs(base), base)
      root = top.ok ? top.out.trim() : null
      await refresh($)
      await openPane($, false)
    }
    $.clock.every(2000, () => {
      poll($).catch(() => undefined)
    })
    return next(e)
  })

  on('agent.offer', { agent: REPAIR_AGENT }, () => ({ isOffered: false })).catch(() => ({ isOffered: false }))

  on('command.run', { command: 'toc' }, async ($, e) => {
    const arg = (e.args ?? '').trim()
    if (arg === 'keys') return { text: await installKeys($) }
    if (arg === 'refresh') {
      stamp = ''
      await refresh($)
      return {}
    }
    await togglePane($)
    return {}
  })

  on('command.run', { command: 'project' }, async ($, e) => {
    const arg = (e.args ?? '').trim()
    if (!arg) {
      const cwd = await $.session.cwd()
      if (!(await $.fs.exists(abs(cwd, PLAN_FILE)))) {
        return { text: `toc: no ${PLAN_FILE} in ${cwd}. Run /project <dir> to point at a project folder, or /project . to create one here.` }
      }
    }
    const msg = await activate($, arg || '.', { create: true })
    // Unfocused: the next thing typed is usually a prompt, not panel keys.
    if (base) await openPane($, false)
    return { text: msg }
  })

  on('tool.call', { tool: 'mcp__toc__activate' }, async ($, e) => {
    const msg = await activate($, String(e.dir ?? '.'), { create: true })
    if (base) await openPane($, false)
    return { result: msg }
  }).catch(() => ({ result: 'toc: activate failed; see the debug log' }))

  on('prompt.context', async ($, e, next) => {
    const r = await next(e)
    if (!base) return r
    return { ...r, blocks: [...r.blocks, { name: 'toc', text: rulesBlock(abs(base, PLAN_FILE)) }] }
  })

  // Claude's commits carry the in-progress step: git adds the trailer itself,
  // so it doesn't depend on the model following an instruction (SPEC §6.1).
  // The same hook snapshots git status around the command so files a Bash
  // command creates or edits reach the ledger too (SPEC §6.2).
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    if (!base || !root) return next(e)
    const command = String(e.command ?? '')
    let ev = e
    if (/\bgit\b/.test(command) && /\bcommit\b/.test(command)) {
      if (trailerOk === null) trailerOk = supportsTrailer((await run($, ['git', '--version'])).out)
      const step = trailerOk ? await activeStepId($) : null
      if (step) {
        const rewritten = withTrailer(command, step)
        if (rewritten !== command) ev = { ...e, command: rewritten }
      }
    }
    const before = await snapshot($)
    const result = await next(ev)
    const after = before ? await snapshot($) : null
    if (before && after) await record($, changedBetween(before, after).map((rel) => abs(root!, rel)))
    await refresh($)
    return result
  }).catch(($, e, next) => next(e))

  on('classic.PostToolUse', async ($, e, next) => {
    const result = await next(e)
    if (!base || !WRITE_TOOLS.includes(e.tool_name)) return result
    const raw = editedPath(e.tool_input)
    if (!raw) return result
    await record($, [abs(e.cwd ?? (await $.session.cwd()), raw)])
    await refresh($)
    return result
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (repairAgent && e.agentId === repairAgent) {
      repairAgent = null
      repair = null
      const said = String(e.answer ?? '').trim().split('\n').pop() ?? ''
      $.ui.toast('toc: ' + (said || 'repair finished').slice(0, 120))
      stamp = ''
    }
    if (base) await refresh($)
    return r
  })

  // The repair agent's report reaches the main model as a peer message
  // (<agent-message from="<agentId>">); swallow it so a repair costs no
  // main-model turn. The toast already told the person what changed.
  on('prompt.submit', async ($, e, next) => {
    const from = /<agent-message from="([^"]+)"/.exec(String(e.text ?? ''))
    if (!from) return next(e)
    const kept = ((await $.store.get('repairAgents')) ?? []) as string[]
    if (!kept.includes(from[1])) return next(e)
    await $.store.set('repairAgents', kept.filter((id) => id !== from[1]))
    return { drop: 'toc: the plan repair already reported in the sidebar' }
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const theirs = await next(e)
    if (!base) return theirs
    const { Box, Button } = $.ui.resolve(e)
    // A press doesn't say whether it was a click or the chord, and a click
    // leaves the band holding the keys (so the pane can't take focus): the
    // chord's toggle is a zero-height button of its own.
    const mine = Box({ flexDirection: 'row', children: [
      Button({ key: 'toc-click', label: '≡ toc ⌃X T', plain: true, dimColor: true, onPress: () => clickPane($) }),
      Box({ height: 0, overflow: 'hidden', children: [
        Button({ key: 'toc-toggle', label: 'toc', plain: true, action: ACTIONS.toggle, onPress: () => togglePane($) }),
      ] }),
    ] })
    return theirs ? Box({ flexDirection: 'column', children: [theirs, mine] }) : mine
  })

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (e.requestId !== PANE) return next(e)
    const el = $.ui.resolve(e)
    width = Math.max(24, e.props.bodyColumns ?? COLUMNS)
    bodyRows = Math.max(10, (e.props.scroll && e.props.scroll.bodyRows) || 30)
    if (!data) {
      return el.Text({ color: 'subtle', children: [base ? 'loading…' : 'toc: run /project <dir>'] })
    }
    return render({
      el,
      ui,
      data,
      repair,
      preview,
      alloc: alloc(),
      width,
      roles,
      focused: !!e.props.isFocused,
      act: {
        row: (key: string) => () => onRow($, key),
        key: (k: string) => () => handleKey($, k as Key),
      },
    })
  })

  on('ui.focus', { requestId: PANE }, async ($, e, next) => {
    const el = e.element ?? ''
    if (!data || !el.startsWith('r:')) return next(e)
    const key = el.slice(2)
    if (e.origin.kind === 'person' && lastFocus && lastFocus !== key) {
      const order = drawnOrder(ui, data, repair, alloc())
      const from = order.indexOf(lastFocus)
      const to = order.indexOf(key)
      const edge = edgeMove(from, to)
      if (edge) {
        await handleKey($, edge)
        return {}
      }
    }
    lastFocus = key
    const before = ui
    ui = focusRow(ui, data, repair, key, alloc())
    if (shownKey(before) !== shownKey(ui)) await loadPreview($)
    $.ui.invalidate('ui.render')
    return next(e)
  }).catch(($, e, next) => next(e))

  on('ui.scroll', { requestId: PANE }, async ($, e, next) => {
    if (!data || e.origin.kind !== 'person') return next(e)
    const big = Math.abs(e.by) >= 3
    await handleKey($, (e.by > 0 ? (big ? 'pagedown' : 'j') : big ? 'pageup' : 'k') as Key)
    return {}
  }).catch(($, e, next) => next(e))
}

// Arrow onto the next section while this one still has hidden rows → scroll it.
function edgeMove(from: number, to: number): Key | null {
  if (from < 0 || to < 0 || !data) return null
  const sec = ui.sec
  if (sec === PREV || !isShown(ui, sec)) return null
  const rows = rowsOf(sec, ui, data, repair)
  const a = alloc()[sec]
  const idx = rows.findIndex((r) => r.key === ui.cursor[sec])
  if (idx < 0) return null
  if (to > from && idx === ui.offset[sec] + a - 1 && idx < rows.length - 1) return 'j'
  if (to < from && idx === ui.offset[sec] && idx > 0) return 'k'
  return null
}

async function onRow($, key: string) {
  if (!data) return
  const before = ui
  ui = focusRow(ui, data, repair, key, alloc())
  lastFocus = key
  await handleKey($, 'o', undefined, before)
}
