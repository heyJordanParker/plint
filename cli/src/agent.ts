import type { Finding, PromptFile } from './api.ts'
import { isRecord } from './config.ts'
import type { AgenticRule } from './rules.ts'

const SCHEMA = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: { line: { type: 'integer' }, message: { type: 'string' } },
        required: ['line', 'message'],
      },
    },
  },
  required: ['findings'],
}

const WRITE_TOOLS = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit']

export function claudeProgram(): string {
  const program = process.env.CLAUDE_CODE_EXECPATH || Bun.which('claude')
  if (!program) throw new Error('plint runs agentic rules with Claude Code, and finds no claude on PATH.')
  return program
}

export function agentArguments(rule: AgenticRule): string[] {
  const list = (tools: string | readonly string[] | undefined): string[] => (tools === undefined ? [] : typeof tools === 'string' ? [tools] : [...tools])
  const allowed = list(rule.allowedTools)
  return [
    '-p',
    '--output-format', 'json',
    '--json-schema', JSON.stringify(SCHEMA),
    '--no-session-persistence',
    '--permission-prompts', 'none',
    '--settings', JSON.stringify({ disableAllHooks: true }),
    ...(rule.agent === undefined ? [] : ['--agent', rule.agent]),
    ...(rule.model === undefined ? [] : ['--model', rule.model]),
    ...(rule.effort === undefined ? [] : ['--effort', rule.effort]),
    ...(allowed.length === 0 ? [] : ['--allowedTools', ...allowed]),
    '--disallowedTools', ...WRITE_TOOLS, ...list(rule.disallowedTools),
  ]
}

export function agentPrompt(rule: AgenticRule, file: PromptFile, changed: readonly number[] | undefined): string {
  const width = String(file.lines.length).length
  const numbered = file.lines.map((line, index) => `${String(index + 1).padStart(width)} | ${line}`).join('\n')
  const edit = changed === undefined ? '' : `\n\nThis is the file as an edit will leave it. The edit wrote lines ${changed.length === 0 ? '(none, it only removed lines)' : changed.join(', ')}.`
  return `${rule.body}

---

Check the file \`${file.path}\` against the rule above. Its lines, numbered:

${numbered}${edit}

Answer with one finding per line that breaks the rule: its line number, and a message that tells the author what to change. A line that follows the rule gets no finding, so never write a finding that says a line is fine. When every line follows the rule, answer an empty findings list. Change no file.`
}

export async function runAgentic(rule: AgenticRule, file: PromptFile, root: string, changed: readonly number[] | undefined, timeoutMs: number): Promise<readonly Finding[]> {
  const child = Bun.spawn([claudeProgram(), ...agentArguments(rule)], {
    cwd: root,
    stdin: new Blob([agentPrompt(rule, file, changed)]),
    stdout: 'pipe',
    stderr: 'pipe',
  })
  let timer: Timer | undefined
  const timedOut = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      child.kill()
      reject(new Error(`it ran past ${timeoutMs < 1000 ? `${timeoutMs} ms` : `${timeoutMs / 1000} s`}`))
    }, timeoutMs)
  })
  const finished = Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
  const [stdout, stderr, exitCode] = await Promise.race([finished, timedOut]).finally(() => clearTimeout(timer))
  if (exitCode !== 0 && stdout.trim() === '') throw new Error(`claude exited ${exitCode}: ${lastLine(stderr)}`)
  return findingsOf(stdout)
}

export function findingsOf(stdout: string): readonly Finding[] {
  const answer: unknown = JSON.parse(stdout)
  if (!isRecord(answer)) throw new Error('claude answered no result object')
  if (answer.is_error === true) throw new Error(`claude failed: ${String(answer.result ?? answer.subtype ?? 'no reason')}`)
  const structured = isRecord(answer.structured_output) ? answer.structured_output : parsedResult(answer.result)
  if (!isRecord(structured) || !Array.isArray(structured.findings)) throw new Error(`claude answered no findings: ${String(answer.result ?? '').slice(0, 200)}`)
  return structured.findings.map((finding: unknown) => {
    if (!isRecord(finding) || !Number.isInteger(finding.line) || typeof finding.message !== 'string') throw new Error(`claude answered a finding without a line and a message: ${JSON.stringify(finding)}`)
    return { line: finding.line as number, message: finding.message }
  })
}

function parsedResult(result: unknown): unknown {
  if (typeof result !== 'string') return undefined
  const json = /\{[\s\S]*\}/.exec(result)?.[0]
  if (json === undefined) return undefined
  try {
    return JSON.parse(json)
  } catch {
    return undefined
  }
}

function lastLine(text: string): string {
  return text.trim().split('\n').at(-1) ?? ''
}
