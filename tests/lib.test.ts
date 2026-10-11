import { expect, test } from 'claude-code/testing'

import { diffPage, diffRows, parseDiff, sourcePage } from '../hooks/lib/diff.ts'
import { changedBetween, commitsByStep, fileState, parseLog, parseStatus, relativeTo, renamedTo, supportsTrailer, withTrailer } from '../hooks/lib/git.ts'
import { appendEntry, editedPath, filesByStep, parseLedger } from '../hooks/lib/ledger.ts'
import { parseMode, rolesFor } from '../hooks/lib/palette.ts'
import { LOG, SHOW, STATUS } from './fixtures/git.ts'

test('parseLog: trailers, numstat, renames; untrailed commits are not matched', () => {
  const commits = parseLog(LOG)
  expect(commits.map((c) => c.subject)).toEqual(['Rename', 'Second change', 'First'])
  expect(commits.map((c) => c.steps)).toEqual([['S1.2'], ['S1.2'], ['S1.1']])
  expect(commits[0].files).toEqual([{ path: 'dir/new.txt', add: 0, del: 0 }])
  expect(commits[1].add).toBe(3)
  expect(commits[1].del).toBe(1)
  const by = commitsByStep(commits)
  expect(by.get('S1.2')!.length).toBe(2)
  expect(by.get('S1.1')!.length).toBe(1)
})

test('renamedTo handles both numstat rename spellings', () => {
  expect(renamedTo('a/{b => c}/d.ts')).toBe('a/c/d.ts')
  expect(renamedTo('{x => y}.ts')).toBe('y.ts')
  expect(renamedTo('old.ts => new.ts')).toBe('new.ts')
  expect(renamedTo('plain.ts')).toBe('plain.ts')
})

test('parseStatus and fileState', () => {
  const st = parseStatus(STATUS)
  expect(st.get('one.txt')).toBe(' M')
  expect(st.get('untracked.txt')).toBe('??')
  expect(fileState(st.get('one.txt'), true)).toBe('M')
  expect(fileState(st.get('untracked.txt'), true)).toBe('A')
  expect(fileState(undefined, true)).toBe('✓')
  expect(fileState(undefined, false)).toBe('D')
  expect(relativeTo('/r', '/r/a/b.ts')).toBe('a/b.ts')
  expect(relativeTo('/r/', '/elsewhere/x')).toBe('/elsewhere/x')
})

test('parseDiff + paging keeps hunks valid with synthetic headers', () => {
  const files = parseDiff(SHOW)
  expect(files.map((f) => f.path)).toEqual(['dir/old.txt', 'one.txt'])
  expect(files[1].add).toBe(2)
  expect(files[1].del).toBe(1)
  const rows = diffRows(files)
  // one.txt hunk: ' a', '-b', '+B', ' c', '+d' → start the page at '+B'
  const start = rows.findIndex((r) => r.kind === 'line' && r.file === 1 && r.line === 2)
  const page = diffPage(files, rows, start, 3)
  expect(page.length).toBe(1)
  expect(page[0]).toMatchObject({ kind: 'diff', path: 'one.txt', rows: 3 })
  const src = (page[0] as { source: string }).source.split('\n')
  expect(src[0]).toBe('@@ -3,1 +2,3 @@')
  expect(src.slice(1)).toEqual(['+B', ' c', '+d'])
  const all = diffPage(files, rows, 0, rows.length)
  expect(all.map((s) => s.kind)).toEqual(['file', 'diff', 'file', 'diff'])
})

test('sourcePage numbers from the offset', () => {
  const [seg] = sourcePage('x.ts', 'a\nb\nc\nd', 2, 5)
  expect(seg).toMatchObject({ kind: 'source', startLine: 3, rows: 2, source: 'c\nd' })
})

test('ledger: parse tolerates junk, append bounds, group by step newest first', () => {
  const text = '{"ts":1,"path":"/a","step":"S1.1"}\nnot json\n{"ts":2,"path":"/b","step":null}\n{"ts":3,"path":"/a","step":"S1.1"}\n{"ts":4,"path":"/c","step":"S1.1"}\n'
  const entries = parseLedger(text)
  expect(entries.length).toBe(4)
  const by = filesByStep(entries)
  expect(by.get('S1.1')).toEqual(['/c', '/a'])
  expect(by.get('')).toEqual(['/b'])
  const appended = appendEntry(text, { ts: 5, path: '/d', step: 'S1.2' })
  expect(appended.endsWith('{"ts":5,"path":"/d","step":"S1.2"}\n')).toBe(true)
  expect(editedPath({ file_path: '/x' })).toBe('/x')
  expect(editedPath({ notebook_path: '/n.ipynb' })).toBe('/n.ipynb')
  expect(editedPath(null)).toBe(null)
})

test('palette follows the mode file and falls back to theme keys', () => {
  expect(parseMode('dark\n')).toBe('dark')
  expect(parseMode('weird')).toBe(null)
  expect(rolesFor('dark').done).toBe('#a9b665')
  expect(rolesFor('light').done).toBe('#6c782e')
  expect(rolesFor(null).done).toBe('success')
})

test('withTrailer rewrites every git commit, and only commits', () => {
  expect(withTrailer('git add . && git commit -m "x"', 'S1.2')).toBe(`git add . && git commit --trailer 'Plan-Step: S1.2' -m "x"`)
  expect(withTrailer('git -C /r commit -am x', 'S1.2')).toBe(`git -C /r commit --trailer 'Plan-Step: S1.2' -am x`)
  expect(withTrailer('git -c user.name=x commit --amend --no-edit', 'S3.1')).toBe(`git -c user.name=x commit --trailer 'Plan-Step: S3.1' --amend --no-edit`)
  expect(withTrailer('git commit-tree abc', 'S1.1')).toBe('git commit-tree abc')
  expect(withTrailer('git log --grep commit', 'S1.1')).toBe('git log --grep commit')
  expect(withTrailer("git commit -m 'a' -m 'Plan-Step: S9.9'", 'S1.1')).toBe("git commit -m 'a' -m 'Plan-Step: S9.9'")
  expect(withTrailer('echo hi', 'S1.1')).toBe('echo hi')
})

test('supportsTrailer and changedBetween', () => {
  expect(supportsTrailer('git version 2.43.0')).toBe(true)
  expect(supportsTrailer('git version 2.31.1')).toBe(false)
  expect(supportsTrailer('git version 3.0.0')).toBe(true)
  const before = new Map([['a', '?? 1'], ['b', ' M 5']])
  const after = new Map([['a', '?? 1'], ['b', ' M 9'], ['c', '?? 2']])
  expect(changedBetween(before, after)).toEqual(['b', 'c'])
})
