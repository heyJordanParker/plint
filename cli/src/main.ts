#!/usr/bin/env bun
import { existsSync, realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import packageJson from '../package.json' with { type: 'json' }
import { checkFile, type FileReport } from './check.ts'
import { isRecord, loadSettings } from './config.ts'
import { checkEdit } from './edit.ts'
import { probeFiles, promptFiles } from './files.ts'
import { textReport } from './report.ts'
import { loadRules } from './rules.ts'

const MANUAL_TIMEOUT_MS = 600_000

const HELP = `plint ${packageJson.version}: lints Claude Code Prompts against static and agentic rules.

Usage:
  plint [files...]           Check every Prompt and probe of this project, or only the files named, with every rule.
  plint --static [files...]  Check with the static rules only.
  plint --json [files...]    Print the results as JSON.
  plint edit                 Check the Edit, Write, or MultiEdit call Claude Code sends on stdin, before it runs.

Rules and settings come from ~/.config/plint/plint.config.ts and the project's plint.config.ts.`

async function main(argv: readonly string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    options: { static: { type: 'boolean' }, json: { type: 'boolean' }, version: { type: 'boolean' }, help: { type: 'boolean', short: 'h' } },
  })
  if (values.version) return print(packageJson.version)
  if (values.help) return print(HELP)
  if (positionals[0] === 'edit') return edit()
  return check(positionals, values.static === true, values.json === true)
}

async function edit(): Promise<number> {
  const call: unknown = JSON.parse(await Bun.stdin.text())
  if (!isRecord(call) || typeof call.tool_name !== 'string' || !isRecord(call.tool_input) || typeof call.cwd !== 'string') throw new Error('plint edit reads {"tool_name", "tool_input", "cwd"} on stdin.')
  return print(JSON.stringify(await checkEdit({ tool_name: call.tool_name, tool_input: call.tool_input, cwd: call.cwd })))
}

async function check(named: readonly string[], isStatic: boolean, isJson: boolean): Promise<number> {
  const settings = await loadSettings(process.cwd())
  const rules = await loadRules(settings)
  const files = named.length > 0 ? named.map((file) => realFile(file)) : [...promptFiles(settings), ...probeFiles(settings)]
  const reports: FileReport[] = []
  for (const file of files) {
    const report = await checkFile(settings, rules, file, await Bun.file(file).text(), { scope: isStatic ? 'static' : 'all', timeoutMs: MANUAL_TIMEOUT_MS })
    if (report === undefined) throw new Error(`${file} is not a Prompt or a probe of any plint config.`)
    reports.push(report)
  }
  await print(isJson ? JSON.stringify({ reports }) : textReport(reports))
  return reports.some(({ findings, failures }) => failures.length > 0 || findings.some(({ level }) => level === 'error')) ? 1 : 0
}

function realFile(file: string): string {
  const path = resolve(file)
  if (!existsSync(path)) throw new Error(`${file} does not exist.`)
  return realpathSync(path)
}

async function print(text: string): Promise<number> {
  await Bun.write(Bun.stdout, `${text}\n`)
  return 0
}

main(Bun.argv.slice(2)).then(
  (code) => process.exit(code),
  (error: unknown) => {
    process.stderr.write(`plint: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exit(2)
  },
)
