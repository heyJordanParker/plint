import { dlopen, ptr } from 'bun:ffi'
import { afterEach, beforeEach, expect, setDefaultTimeout, test } from 'bun:test'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const MAIN = join(import.meta.dir, '..', 'src', 'main.ts')
const EM_DASH = String.fromCharCode(0x2014)

const EM_DASH_RULE = `import { defineRule } from '@cmodjs/rulebook'

export default defineRule({
  description: "Don't write em dashes.",
  check: ({ lines }) => lines.flatMap((text, index) => (text.includes('${EM_DASH}') ? [{ line: index + 1, message: 'Split the sentence at the em dash.' }] : [])),
})
`

const HEDGING_RULE = `import { defineRule } from '@cmodjs/rulebook'

export default defineRule({
  description: 'State a claim only once you checked it.',
  level: 'warning',
  check: ({ lines }) => lines.flatMap((text, index) => (/\\bprobably\\b/.test(text) ? [{ line: index + 1, message: 'Check the claim, then state it.' }] : [])),
})
`

setDefaultTimeout(120_000)

let home: string
let project: string
let environment: Record<string, string>
let server: { readonly pid: number; readonly socket: string; stop(): Promise<void> }

beforeEach(async () => {
  home = realpathSync(mkdtempSync('/tmp/rulebook-serve-'))
  project = join(home, 'project')
  mkdirSync(project)
  Bun.spawnSync(['git', 'init', '-q'], { cwd: project })
  write(join(home, 'config', 'rulebook', 'rulebook.config.ts'), "export default { plugins: { global: './rules' }, paths: ['**/Claude.md'] }\n")
  write(join(home, 'config', 'rulebook', 'rules', 'block-em-dashes.ts'), EM_DASH_RULE)
  write(join(home, 'config', 'rulebook', 'rules', 'block-hedging.ts'), HEDGING_RULE)
  environment = { ...(process.env as Record<string, string>), HOME: home, XDG_CONFIG_HOME: join(home, 'config') }
  delete environment.CLAUDE_CONFIG_DIR
  server = await served()
})

afterEach(async () => {
  await server.stop()
  rmSync(home, { recursive: true, force: true })
})

function write(file: string, text: string): string {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, text)
  return file
}

async function served() {
  const child = Bun.spawn([process.execPath, MAIN, 'serve'], { cwd: home, env: environment, stdout: 'pipe', stderr: 'inherit' })
  const { value } = await child.stdout.getReader().read()
  const address = new TextDecoder().decode(value).trim()
  expect(address).toMatch(/^unix:\/.+\.sock$/)
  return {
    pid: child.pid,
    socket: address.slice('unix:'.length),
    stop: async () => {
      child.kill('SIGTERM')
      await child.exited
    },
  }
}

async function ask(question: string, input: unknown): Promise<{ readonly status: number; readonly answer: unknown }> {
  const response = await fetch(`http://localhost/${question}`, { unix: server.socket, method: 'POST', body: JSON.stringify({ input, environment }) })
  const text = await response.text()
  return { status: response.status, answer: response.ok ? JSON.parse(text) : text }
}

function rulebook(args: readonly string[], stdin: string, cwd = project): unknown {
  const run = Bun.spawnSync([process.execPath, MAIN, ...args], { cwd, stdin: new Blob([stdin]), env: environment })
  expect(run.stderr.toString()).toBe('')
  return JSON.parse(run.stdout.toString())
}

function written(file: string, content: string, cwd = project) {
  return { tool_name: 'Write', tool_input: { file_path: file, content }, cwd }
}

async function idleFootprintKilobytes(pid: number): Promise<number> {
  await Bun.sleep(3000)
  const { symbols } = dlopen('/usr/lib/libproc.dylib', { proc_pid_rusage: { args: ['i32', 'i32', 'ptr'], returns: 'i32' } })
  const usage = new BigUint64Array(12)
  expect(symbols.proc_pid_rusage(pid, 0, ptr(usage))).toBe(0)
  return Number(usage[9]) / 1024
}

test("rulebook serve answers edit, text, and rules with the same JSON the rulebook command prints for the same input", async () => {
  write(join(project, 'rulebook.config.ts'), "export default { messages: { inbox: { tools: ['mcp__inbox__*'] } } }\n")
  const file = write(join(project, 'Claude.md'), `Old line ${EM_DASH} here.\nSecond line.\n`)
  const edits = [
    written(join(project, 'Claude.md'), `# Facts\n\nRun it ${EM_DASH} it restows.\n`),
    written(join(project, 'Claude.md'), 'It probably works.\n'),
    written(join(project, 'notes.md'), `Run it ${EM_DASH} now.\n`),
    { tool_name: 'Edit', tool_input: { file_path: file, old_string: 'Second line.', new_string: 'Second line, now edited.' }, cwd: project },
  ]
  for (const edit of edits) expect(await ask('edit', edit)).toEqual({ status: 200, answer: rulebook(['edit'], JSON.stringify(edit)) })
  for (const [name, text] of [['@reply', `It probably works.\nRun it ${EM_DASH} now.`], ['@inbox', 'Shipped.']]) {
    expect(await ask('text', { name, text, cwd: project })).toEqual({ status: 200, answer: rulebook(['text', name ?? ''], text ?? '') })
  }
  expect(await ask('rules', { cwd: project })).toEqual({ status: 200, answer: rulebook(['rules'], '') })
})

test('a rule file edited on disk takes effect on the next request, and a new rulebook config on the walk does too', async () => {
  const rule = join(home, 'config', 'rulebook', 'rules', 'block-em-dashes.ts')
  const claudeMd = join(project, 'docs', 'Claude.md')
  expect(await ask('edit', written(claudeMd, `Run it ${EM_DASH} now.\n`))).toMatchObject({ answer: { findings: [{ rule: 'global/block-em-dashes', message: 'Split the sentence at the em dash.' }] } })
  write(rule, EM_DASH_RULE.replace('Split the sentence at the em dash.', 'Write two sentences.'))
  expect(await ask('edit', written(claudeMd, `Run it ${EM_DASH} now.\n`))).toMatchObject({ answer: { findings: [{ rule: 'global/block-em-dashes', message: 'Write two sentences.' }] } })
  write(join(project, 'docs', 'rulebook.config.ts'), "export default { rules: { 'global/block-em-dashes': 'off' } }\n")
  expect(await ask('edit', written(claudeMd, `Run it ${EM_DASH} now.\n`))).toEqual({ status: 200, answer: { failures: [], findings: [] } })
})

test.if(process.platform === 'darwin')("rulebook serve's physical footprint stops growing: idle after edit 500 of a rule file, each edit followed by a request and a worker replacement, it stays under 1.5 times its idle footprint after edit 100", async () => {
  const rule = join(home, 'config', 'rulebook', 'rules', 'block-em-dashes.ts')
  const idle: number[] = []
  for (let edit = 1; edit <= 500; edit += 1) {
    write(rule, EM_DASH_RULE.replace('Split the sentence at the em dash.', `Split the sentence at the em dash, edit ${edit}.`))
    expect(await ask('edit', written(join(project, 'Claude.md'), `Run it ${EM_DASH} now.\n`))).toMatchObject({ answer: { findings: [{ message: `Split the sentence at the em dash, edit ${edit}.` }] } })
    if (edit === 100 || edit === 500) idle.push(await idleFootprintKilobytes(server.pid))
  }
  const [settled = 0, later = 0] = idle
  console.log(`idle physical footprint of rulebook serve: ${Math.round(settled)} KB after edit 100, ${Math.round(later)} KB after edit 500`)
  expect(later).toBeLessThan(settled * 1.5)
})

test('two projects with different configs, checked through one server, each get only their own rules', async () => {
  const other = join(home, 'other')
  mkdirSync(other)
  Bun.spawnSync(['git', 'init', '-q'], { cwd: other })
  write(join(project, 'rulebook.config.ts'), "export default { plugins: { dent: './rules' }, rules: { 'global/block-hedging': 'off' } }\n")
  write(join(project, 'rules', 'block-artisan.ts'), "export default { description: 'Run dnt, never php artisan.', check: ({ lines }) => lines.flatMap((text, index) => (text.includes('php artisan') ? [{ line: index + 1 }] : [])) }\n")
  write(join(other, 'rulebook.config.ts'), "export default { rules: { 'global/block-em-dashes': 'off' } }\n")
  const text = `It probably works.\nRun php artisan ${EM_DASH} now.\n`
  const rulesOf = async (cwd: string) => ((await ask('edit', written(join(cwd, 'Claude.md'), text, cwd))).answer as { findings: { rule: string }[] }).findings.map(({ rule }) => rule)
  expect(await rulesOf(project)).toEqual(['dent/block-artisan', 'global/block-em-dashes'])
  expect(await rulesOf(other)).toEqual(['global/block-hedging'])
  expect(await rulesOf(project)).toEqual(['dent/block-artisan', 'global/block-em-dashes'])
})

test('an edited stylelint.config.mjs takes effect on the next request, though the server keeps Stylelint loaded', async () => {
  write(join(project, 'rulebook.config.ts'), "export default { linters: ['stylelint'] }\n")
  const config = write(join(project, 'stylelint.config.mjs'), "export default { rules: { 'color-no-invalid-hex': true } }\n")
  const css = written(join(project, 'src', 'app.css'), 'a {\n  color: #ggg;\n}\nb {}\n')
  const rulesOf = async () => ((await ask('edit', css)).answer as { findings: { rule: string }[] }).findings.map(({ rule }) => rule)
  expect(await rulesOf()).toEqual(['stylelint/color-no-invalid-hex'])
  write(config, "export default { rules: { 'block-no-empty': true } }\n")
  expect(await rulesOf()).toEqual(['stylelint/block-no-empty'])
})

test('a broken config fails the answer with its reason, and the fixed config answers on the next request', async () => {
  const config = write(join(project, 'rulebook.config.ts'), "export default { lint: true }\n")
  expect(await ask('edit', written(join(project, 'Claude.md'), 'A fact.\n'))).toEqual({ status: 500, answer: `${config}: "lint" is not a rulebook config key. The keys are extends, plugins, paths, probes, timeout, existingErrors, rules, linters, messages.` })
  write(config, 'export default {}\n')
  expect(await ask('edit', written(join(project, 'Claude.md'), 'A fact.\n'))).toEqual({ status: 200, answer: { failures: [], findings: [] } })
})

test("an agentic rule of a session on a profile runs claude with the profile's CLAUDE_CONFIG_DIR, and one of a session without a profile runs it without one", async () => {
  const profile = join(home, '.claude', 'profiles', 'copywriter')
  const seen = join(home, 'claude-config-dirs')
  const claude = write(join(home, 'bin', 'claude'), `#!/bin/sh\nprintf '%s\\n' "\${CLAUDE_CONFIG_DIR:-none}" >> '${seen}'\ncat > /dev/null\necho '{"type":"result","is_error":false,"structured_output":{"findings":[]}}'\n`)
  Bun.spawnSync(['chmod', '755', claude])
  write(join(home, 'config', 'rulebook', 'rules', 'require-true-facts.md'), "---\ndescription: Don't state a Fact the code contradicts.\n---\n\nReport each Fact the code contradicts.\n")
  environment.PATH = `${dirname(claude)}:${environment.PATH}`
  const edit = written(join(project, 'Claude.md'), 'A fact.\n')
  const onProfile = await fetch('http://localhost/edit', { unix: server.socket, method: 'POST', body: JSON.stringify({ input: edit, environment: { ...environment, CLAUDE_CONFIG_DIR: profile } }) })
  expect(await onProfile.json()).toEqual({ failures: [], findings: [] })
  expect(await ask('edit', edit)).toEqual({ status: 200, answer: { failures: [], findings: [] } })
  expect((await Bun.file(seen).text()).trim().split('\n')).toEqual([profile, 'none'])
})

test('edits to an existing file list the project files once per worker, and a Claude.md that a checked write creates brings its imports in', async () => {
  const log = join(home, 'git-calls')
  const git = write(join(home, 'bin', 'git'), `#!/bin/sh\nprintf '%s\\n' "$*" >> '${log}'\nexec '${Bun.which('git')}' "$@"\n`)
  Bun.spawnSync(['chmod', '755', git])
  await server.stop()
  environment.PATH = `${dirname(git)}:${environment.PATH}`
  server = await served()
  const notes = write(join(project, 'docs', 'notes.md'), 'A note.\n')
  const edited = { tool_name: 'Edit', tool_input: { file_path: notes, old_string: 'A note.', new_string: `A note ${EM_DASH} edited.` }, cwd: project }
  expect(await ask('edit', edited)).toEqual({ status: 200, answer: { failures: [], findings: [] } })
  expect(await ask('edit', edited)).toEqual({ status: 200, answer: { failures: [], findings: [] } })
  expect((await Bun.file(log).text()).trim().split('\n').filter((call) => call.startsWith('ls-files'))).toHaveLength(1)

  expect(await ask('edit', written(join(project, 'docs', 'Claude.md'), '@notes.md\n'))).toEqual({ status: 200, answer: { failures: [], findings: [] } })
  write(join(project, 'docs', 'Claude.md'), '@notes.md\n')
  expect(await ask('edit', edited)).toMatchObject({ status: 200, answer: { refuse: expect.stringContaining('Edit to docs/notes.md refused.') } })
})

test("a Claude.md that a checked write creates brings its imports in, even when another session's check runs before the write lands", async () => {
  const notes = write(join(project, 'docs', 'notes.md'), 'A note.\n')
  const edited = { tool_name: 'Edit', tool_input: { file_path: notes, old_string: 'A note.', new_string: `A note ${EM_DASH} edited.` }, cwd: project }
  expect(await ask('edit', written(join(project, 'docs', 'Claude.md'), '@notes.md\n'))).toEqual({ status: 200, answer: { failures: [], findings: [] } })
  expect(await ask('edit', edited)).toEqual({ status: 200, answer: { failures: [], findings: [] } })
  write(join(project, 'docs', 'Claude.md'), '@notes.md\n')
  expect(await ask('edit', edited)).toMatchObject({ status: 200, answer: { refuse: expect.stringContaining('Edit to docs/notes.md refused.') } })
})

test('a config that fails on a missing plugin folder, a missing extends file, or an extends file that does not parse answers on the next request once that path is fixed', async () => {
  const artisan = "export default { description: 'Run dnt, never php artisan.', check: ({ lines }) => lines.flatMap((text, index) => (text.includes('php artisan') ? [{ line: index + 1 }] : [])) }\n"
  const extending = "export default { extends: ['./shared.config.ts'] }\n"
  const cases = [
    { name: 'plugin', config: "export default { plugins: { dent: './rules' } }\n", broken: undefined, fixed: ['rules/block-artisan.ts', artisan], rules: ['dent/block-artisan', 'global/block-em-dashes'] },
    { name: 'extends', config: extending, broken: undefined, fixed: ['shared.config.ts', 'export default {}\n'], rules: ['global/block-em-dashes'] },
    { name: 'parse', config: extending, broken: ['shared.config.ts', 'export default {\n'], fixed: ['shared.config.ts', 'export default {}\n'], rules: ['global/block-em-dashes'] },
  ] as const
  for (const { name, config, broken, fixed, rules } of cases) {
    const folder = join(home, name)
    mkdirSync(folder)
    Bun.spawnSync(['git', 'init', '-q'], { cwd: folder })
    write(join(folder, 'rulebook.config.ts'), config)
    if (broken !== undefined) write(join(folder, broken[0]), broken[1])
    const edit = written(join(folder, 'Claude.md'), `Run php artisan ${EM_DASH} now.\n`, folder)
    expect({ name, status: (await ask('edit', edit)).status }).toEqual({ name, status: 500 })
    write(join(folder, fixed[0]), fixed[1])
    const { status, answer } = await ask('edit', edit)
    expect({ name, status, rules: (answer as { findings?: { rule: string }[] }).findings?.map(({ rule }) => rule) }).toEqual({ name, status: 200, rules: [...rules] })
  }
})

test('a question that sends no environment fails, and never runs in the environment of the server', async () => {
  const response = await fetch('http://localhost/edit', { unix: server.socket, method: 'POST', body: JSON.stringify({ input: written(join(project, 'Claude.md'), 'A fact.\n') }) })
  expect({ status: response.status, text: await response.text() }).toEqual({ status: 500, text: 'rulebook serve reads {"input", "environment"}.' })
})
