import { afterEach, beforeEach, expect, test } from 'bun:test'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

const MAIN = join(import.meta.dir, '..', 'src', 'main.ts')

const EM_DASH_RULE = `import { defineRule } from '@cmodjs/plint'

export default defineRule({
  check: ({ lines }) => lines.flatMap((text, index) => (text.includes('—') ? [{ line: index + 1, message: 'Split the sentence at the em dash.' }] : [])),
})
`

const HEDGING_RULE = `import { defineRule } from '@cmodjs/plint'

export default defineRule({
  level: 'warning',
  check: ({ lines }) => lines.flatMap((text, index) => (/\\bprobably\\b/.test(text) ? [{ line: index + 1, message: 'Check the claim, then state it.' }] : [])),
})
`

let home: string
let project: string
let calls: string

beforeEach(() => {
  home = realpathSync(mkdtempSync(join(tmpdir(), 'plint-home-')))
  project = join(home, 'project')
  calls = join(home, 'claude-calls')
  mkdirSync(project)
  Bun.spawnSync(['git', 'init', '-q'], { cwd: project })
  write(join(home, 'config', 'plint', 'plint.config.ts'), `import { defineConfig } from '@cmodjs/plint'
export default defineConfig({ plugins: { global: './rules' }, paths: ['**/Claude.md'], probes: ['probes/*.md'] })
`)
  write(join(home, 'config', 'plint', 'rules', 'block-em-dashes.ts'), EM_DASH_RULE)
  write(join(home, 'config', 'plint', 'rules', 'block-hedging.ts'), HEDGING_RULE)
})

afterEach(() => rmSync(home, { recursive: true, force: true }))

function write(file: string, text: string): string {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, text)
  return file
}

function fakeClaude(answer: string, delaySeconds = 0): string {
  const program = write(join(home, 'claude'), `#!/bin/sh
printf '%s\\n' "$*" >> '${calls}'
while [ $# -gt 0 ]; do
  if [ "$1" = "--plugin-dir" ]; then cat "$2/skills/check/SKILL.md" >> '${calls}'; fi
  shift
done
cat > /dev/null
sleep ${delaySeconds}
cat <<'JSON'
${answer}
JSON
`)
  chmodSync(program, 0o755)
  return program
}

function agenticRule(name: string, frontmatter: string): void {
  write(join(home, 'config', 'plint', 'rules', name, 'SKILL.md'), `---\nname: ${name}\ndescription: Flags words Domain.md keeps for the business.\ncontext: fork\n${frontmatter}\n---\n\nReport each Domain.md word that names code.\n`)
}

function plint(args: readonly string[], stdin?: string, claude = fakeClaude('{"type":"result","is_error":false,"structured_output":{"findings":[]}}')) {
  const run = Bun.spawnSync([process.execPath, MAIN, ...args], {
    cwd: project,
    stdin: stdin === undefined ? 'ignore' : new Blob([stdin]),
    env: { ...process.env, XDG_CONFIG_HOME: join(home, 'config'), CLAUDE_CODE_EXECPATH: claude },
  })
  return { code: run.exitCode, stdout: run.stdout.toString(), stderr: run.stderr.toString() }
}

function edit(tool: string, input: Record<string, unknown>, claude?: string) {
  const run = plint(['edit'], JSON.stringify({ tool_name: tool, tool_input: input, cwd: project }), claude)
  expect(run.stderr).toBe('')
  return JSON.parse(run.stdout) as { refuse?: string; note?: string; failures?: string[] }
}

test('an error refuses the edit and names the rule and the line', () => {
  const answer = edit('Write', { file_path: join(project, 'Claude.md'), content: '# Facts\n\nRun it — it restows.\n' })
  expect(answer.refuse).toBe('plint refused this edit to Claude.md. Fix every error, then edit again.\n\n  3  error  global/block-em-dashes  Split the sentence at the em dash.')
})

test('a warning lets the edit land and tells the agent', () => {
  const answer = edit('Write', { file_path: join(project, 'Claude.md'), content: 'It probably works.\n' })
  expect(answer).toEqual({ note: 'plint warnings in Claude.md:\n\n  1  warning  global/block-hedging  Check the claim, then state it.', failures: [] })
})

test('a file outside every config paths is not checked', () => {
  expect(edit('Write', { file_path: join(project, 'notes.md'), content: 'Run it — now.\n' })).toEqual({})
})

test('an error already in the file is a warning, unless existingErrors makes it an error', () => {
  const file = write(join(project, 'Claude.md'), 'Old line — here.\nSecond line.\n')
  const answer = edit('Edit', { file_path: file, old_string: 'Second line.', new_string: 'Second line, now edited.' })
  expect(answer.refuse).toBeUndefined()
  expect(answer.note).toContain('1  warning  global/block-em-dashes  Split the sentence at the em dash. (already in the file before this edit)')

  write(join(project, 'plint.config.ts'), `export default { existingErrors: 'error' }\n`)
  expect(edit('Edit', { file_path: file, old_string: 'Second line.', new_string: 'Second line, now edited.' }).refuse).toContain('(already in the file before this edit)')
})

test('a MultiEdit is checked as the file reads after every replacement', () => {
  const file = write(join(project, 'Claude.md'), 'One.\nTwo.\n')
  const answer = edit('MultiEdit', { file_path: file, edits: [{ old_string: 'One.', new_string: 'One — more.' }, { old_string: 'Two.', new_string: 'Two.' }] })
  expect(answer.refuse).toContain('1  error  global/block-em-dashes')
})

test("a project config turns a global rule off or changes its level, and adds the project's own rules", () => {
  write(join(project, 'plint.config.ts'), `import { defineConfig } from '@cmodjs/plint'
export default defineConfig({ plugins: { dent: './tools/plint/rules' }, rules: { 'global/block-em-dashes': 'warning', 'global/block-hedging': 'off' } })
`)
  write(join(project, 'tools', 'plint', 'rules', 'block-artisan.ts'), `export default { check: ({ lines }) => lines.flatMap((text, index) => (text.includes('php artisan') ? [{ line: index + 1, message: 'Run dnt.' }] : [])) }\n`)
  const answer = edit('Write', { file_path: join(project, 'Claude.md'), content: 'Run it — probably.\nRun php artisan migrate.\n' })
  expect(answer.refuse).toBe('plint refused this edit to Claude.md. Fix every error, then edit again.\n\n  2  error  dent/block-artisan  Run dnt.\n\nWarnings:\n  1  warning  global/block-em-dashes  Split the sentence at the em dash.')
})

test('a config that names a rule no plugin holds fails loudly', () => {
  write(join(project, 'plint.config.ts'), `export default { rules: { 'global/no-such-rule': 'off' } }\n`)
  const run = plint(['edit'], JSON.stringify({ tool_name: 'Write', tool_input: { file_path: join(project, 'Claude.md'), content: 'x\n' }, cwd: project }))
  expect(run.code).toBe(2)
  expect(run.stderr).toContain('sets the rule "global/no-such-rule", which no plugin holds')
})

test('an agentic rule runs as a forked Skill with its own frontmatter, and its findings refuse the edit', () => {
  agenticRule('block-domain-words-for-code', 'agent: explorer\nmodel: haiku\neffort: low\nallowed-tools: Read\npaths:\n  - "**/Claude.md"\nmetadata:\n  level: error')
  const claude = fakeClaude('{"type":"result","is_error":false,"result":"{\\"findings\\": [{\\"line\\": 1, \\"message\\": \\"Slice names a commit here.\\"}]}"}')
  const answer = edit('Write', { file_path: join(project, 'Claude.md'), content: 'Each Slice is a commit.\n' }, claude)
  expect(answer.refuse).toContain('1  error  global/block-domain-words-for-code  Slice names a commit here.')
  const recorded = readFileSync(calls, 'utf8')
  for (const part of ['-p', '--output-format stream-json', '--plugin-dir', '{"disableAllHooks":true}', '"context":"fork"', '"agent":"explorer"', '"model":"haiku"', '"effort":"low"', '"allowed-tools":["Read"]', '"disallowed-tools":["Edit","Write","MultiEdit","NotebookEdit"]', '1 | Each Slice is a commit.']) expect(recorded).toContain(part)
})

test("an agentic rule's findings count when its subagent answers through the StructuredOutput tool", () => {
  agenticRule('require-true-facts', 'model: sonnet')
  const stream = [
    '{"type":"assistant","parent_tool_use_id":"forked-command-plint-rule:check","message":{"content":[{"type":"tool_use","name":"StructuredOutput","input":{"findings":[{"line":1,"message":"The code says otherwise."}]}}]}}',
    '{"type":"result","subtype":"success","is_error":false,"result":"Command completed"}',
  ].join('\n')
  expect(edit('Write', { file_path: join(project, 'Claude.md'), content: 'A fact.\n' }, fakeClaude(stream)).refuse).toContain('1  error  global/require-true-facts  The code says otherwise.')
})

test('a manual rule never runs on an edit, and runs when plint runs', () => {
  agenticRule('require-true-facts', 'metadata:\n  runs: manual')
  const claude = fakeClaude('{"type":"result","is_error":false,"structured_output":{"findings":[{"line":1,"message":"The code says otherwise."}]}}')
  expect(edit('Write', { file_path: join(project, 'Claude.md'), content: 'A fact.\n' }, claude)).toEqual({})
  write(join(project, 'Claude.md'), 'A fact.\n')
  const run = plint([], undefined, claude)
  expect(run.code).toBe(1)
  expect(run.stdout).toBe('Claude.md\n  1  error  global/require-true-facts  The code says otherwise.\n\n1 error, 0 warnings in 1 Prompt\n')
})

test('an agentic rule past editTimeout lets the edit through and names the rule', () => {
  write(join(project, 'plint.config.ts'), `export default { editTimeout: 300 }\n`)
  agenticRule('block-domain-words-for-code', 'model: haiku')
  const answer = edit('Write', { file_path: join(project, 'Claude.md'), content: 'Each Slice is a commit.\n' }, fakeClaude('{}', 5))
  expect(answer.refuse).toBeUndefined()
  expect(answer.failures).toEqual(['global/block-domain-words-for-code did not run on Claude.md: it ran past 300 ms'])
})

test('a probe passes while each pin fires, and fails on a pin that stops firing or a flag with no pin', () => {
  const probe = write(join(home, 'config', 'plint', 'probes', 'block-em-dashes.md'), '<!-- plint-expect global/block-em-dashes -->\nRun it — now.\n\nRun it now.\n')
  expect(plint([probe]).code).toBe(0)
  write(probe, '<!-- plint-expect global/block-em-dashes -->\nRun it now.\n\nRun it — now.\n')
  const run = plint([probe])
  expect(run.code).toBe(1)
  expect(run.stdout).toContain('1  error  global/block-em-dashes  The pin expects global/block-em-dashes to flag line 2, and it does not.')
  expect(run.stdout).toContain('4  error  global/block-em-dashes  Split the sentence at the em dash. (no pin expects this flag)')
})

test('a pin outside a probe is an error, and a pin shown in a code block is text', () => {
  const answer = edit('Write', { file_path: join(project, 'Claude.md'), content: '<!-- plint-expect global/block-em-dashes -->\nRun it now.\n' })
  expect(answer.refuse).toContain('1  error  plint/pins')
  expect(edit('Write', { file_path: join(project, 'Claude.md'), content: '```md\n<!-- plint-expect global/block-em-dashes -->\n```\n' })).toEqual({})
})
