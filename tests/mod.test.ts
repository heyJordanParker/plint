import { expect, test } from 'bun:test'
import { testMod } from '../node_modules/@cmodjs/core/testing.js'
import { plint } from '../src/mod.js'

function ran(stdout: string, exitCode = 0) {
  return async () => ({ exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false })
}

test('an error from plint refuses the edit with its text', async () => {
  const tested = testMod(plint)
  tested.fakes.process.run = ran(JSON.stringify({ refuse: 'plint refused this edit to Claude.md.', failures: [] }))
  expect(await tested.raise.beforeToolCall({ name: 'Edit', input: { file_path: '/work/Claude.md', old_string: 'a', new_string: 'b' } })).toEqual({ refuse: 'plint refused this edit to Claude.md.' })
  expect(tested.calls.filter(({ call }) => call === 'process.run').map(({ args }) => args[0])).toEqual([['plint', 'edit']])
})

test('warnings from plint reach the agent beside the edit', async () => {
  const tested = testMod(plint)
  tested.fakes.process.run = ran(JSON.stringify({ note: 'plint warnings in Claude.md:', failures: [] }))
  expect(await tested.raise.beforeToolCall({ name: 'Write', input: { file_path: '/work/Claude.md', content: 'x' } })).toEqual({ note: 'plint warnings in Claude.md:' })
})

test('a rule that did not run shows a toast, and the edit goes on', async () => {
  const tested = testMod(plint)
  tested.fakes.process.run = ran(JSON.stringify({ failures: ['global/block-domain-words-for-code did not run on Claude.md: it ran past 30 s'] }))
  expect(await tested.raise.beforeToolCall({ name: 'Write', input: { file_path: '/work/Claude.md', content: 'x' } })).toBeUndefined()
  expect(tested.shown.toasts.map(({ message }) => message)).toContain('global/block-domain-words-for-code did not run on Claude.md: it ran past 30 s')
})

test('plint never hears a tool that writes no file', async () => {
  const tested = testMod(plint)
  expect(await tested.raise.beforeToolCall({ name: 'Read', input: { file_path: '/work/Claude.md' } })).toBeUndefined()
  expect(tested.calls.filter(({ call }) => call === 'process.run')).toEqual([])
})

test('/plint lists every finding in the Sidebar', async () => {
  const tested = testMod(plint)
  const reports = [{ path: 'Claude.md', findings: [{ rule: 'global/block-em-dashes', line: 3, level: 'error', message: 'Split the sentence at the em dash.', isExisting: false }], failures: [] }]
  tested.fakes.process.run = ran(JSON.stringify({ reports }), 1)
  await tested.type('/plint')
  await Bun.sleep(10)
  expect(await tested.shown.page.lines()).toEqual(['1 error, 0 warnings in 1 Prompt', '', 'Claude.md', '  3  error  global/block-em-dashes  Split the sentence at the em dash.'])
})
