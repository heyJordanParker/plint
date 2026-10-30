import { isAbsolute, relative } from 'node:path'
import type { Finding, Level, PromptFile } from './api.ts'
import { runAgentic } from './agent.ts'
import type { Settings } from './config.ts'
import type { LoadedRule } from './rules.ts'

export type Scope = 'edit' | 'all' | 'static'

export type Reported = {
  readonly rule: string
  readonly line: number
  readonly level: Level
  readonly message: string
  readonly isExisting: boolean
}

export type Failure = { readonly rule: string; readonly reason: string }

export type FileReport = {
  readonly path: string
  readonly findings: readonly Reported[]
  readonly failures: readonly Failure[]
}

export type CheckOptions = {
  readonly scope: Scope
  readonly timeoutMs: number
  readonly previous?: string | undefined
}

const PIN = /^\s*<!--\s*plint-expect\s+(\S+)\s*-->\s*$/
const FENCE = /^\s*(```|~~~)/
const AGENTS_AT_ONCE = 4

export function matches(globs: readonly string[], path: string): boolean {
  return globs.some((glob) => new Bun.Glob(glob).match(path))
}

export function displayPath(settings: Settings, file: string): string {
  const path = relative(settings.root, file)
  return path.startsWith('..') || isAbsolute(path) ? file : path
}

export function isProbe(settings: Settings, file: string): boolean {
  return settings.configs.some((config) => {
    const path = relative(config.dir, file)
    return !path.startsWith('..') && !isAbsolute(path) && matches(config.probes, path)
  })
}

export function isPrompt(settings: Settings, file: string): boolean {
  const path = relative(settings.root, file)
  return !path.startsWith('..') && !isAbsolute(path) && matches(settings.paths, path)
}

export async function checkFile(settings: Settings, rules: readonly LoadedRule[], file: string, text: string, options: CheckOptions): Promise<FileReport | undefined> {
  const probe = isProbe(settings, file)
  if (!probe && !isPrompt(settings, file)) return undefined
  const path = displayPath(settings, file)
  const prompt: PromptFile = { path, text, lines: text.split('\n') }
  const pins = pinsOf(prompt.lines)
  const pinned = new Set(pins.map(({ rule }) => rule))
  const chosen = rules.filter((rule) => inScope(rule, options.scope) && (probe ? pinned.has(rule.id) : rule.level !== 'off' && (rule.paths === undefined || matches(rule.paths, path))))
  const previous = options.previous === undefined ? undefined : new Set(options.previous.split('\n').map((line) => line.trim()).filter((line) => line !== ''))
  const changed = previous === undefined ? undefined : prompt.lines.flatMap((line, index) => (line.trim() !== '' && !previous.has(line.trim()) ? [index + 1] : []))

  const runs = await Promise.all(chosen.map(async (rule) => {
    try {
      const found = rule.kind === 'static' ? await rule.check(prompt) : await agentSlot(() => runAgentic(rule, prompt, settings.root, changed, options.timeoutMs))
      return { rule, found: validFindings(rule.id, prompt, found) }
    } catch (error) {
      return { rule, failure: error instanceof Error ? error.message : String(error) }
    }
  }))

  const failures = runs.flatMap((run) => ('failure' in run ? [{ rule: run.rule.id, reason: run.failure }] : []))
  const found = runs.flatMap((run) => ('found' in run ? run.found.map((finding) => ({ ...finding, rule: run.rule.id, level: run.rule.level === 'off' ? 'error' as const : run.rule.level })) : []))
  const findings = probe ? probeFindings(found, pins) : [...found, ...pins.map((pin) => ({ rule: 'plint/pins', line: pin.line, level: 'error' as const, message: 'A plint-expect pin works only in a probe file. Remove it.' }))]

  return {
    path,
    failures,
    findings: findings
      .map((finding) => {
        const isExisting = previous !== undefined && finding.level === 'error' && previous.has((prompt.lines[finding.line - 1] ?? '').trim())
        return { ...finding, isExisting, level: isExisting ? settings.existingErrors : finding.level }
      })
      .sort((a, b) => a.line - b.line || a.rule.localeCompare(b.rule)),
  }
}

function inScope(rule: LoadedRule, scope: Scope): boolean {
  if (scope === 'all') return true
  if (scope === 'static') return rule.kind === 'static'
  return rule.runs === 'edit'
}

type Pin = { readonly rule: string; readonly line: number; readonly target: number }

function pinsOf(lines: readonly string[]): readonly Pin[] {
  const pins: Pin[] = []
  const waiting: { rule: string; line: number }[] = []
  let isCode = false
  lines.forEach((text, index) => {
    if (FENCE.test(text)) isCode = !isCode
    const rule = isCode ? undefined : PIN.exec(text)?.[1]
    if (rule !== undefined) waiting.push({ rule, line: index + 1 })
    else for (const pin of waiting.splice(0)) pins.push({ ...pin, target: index + 1 })
  })
  return [...pins, ...waiting.map((pin) => ({ ...pin, target: lines.length + 1 }))]
}

type Flag = Omit<Reported, 'isExisting'>

function probeFindings(found: readonly Flag[], pins: readonly Pin[]): readonly Flag[] {
  const open = [...pins]
  const unexpected = found.filter((finding) => {
    const index = open.findIndex((pin) => pin.rule === finding.rule && pin.target === finding.line)
    if (index === -1) return true
    open.splice(index, 1)
    return false
  })
  return [
    ...unexpected.map((finding) => ({ ...finding, level: 'error' as const, message: `${finding.message} (no pin expects this flag)` })),
    ...open.map((pin) => ({ rule: pin.rule, line: pin.line, level: 'error' as const, message: `The pin expects ${pin.rule} to flag line ${pin.target}, and it does not.` })),
  ]
}

function validFindings(rule: string, file: PromptFile, found: readonly Finding[]): readonly Finding[] {
  for (const finding of found) {
    if (!Number.isInteger(finding.line) || finding.line < 1 || finding.line > file.lines.length) throw new Error(`${rule} flagged line ${finding.line}, which ${file.path} does not have`)
    if (typeof finding.message !== 'string' || finding.message.trim() === '') throw new Error(`${rule} flagged line ${finding.line} without a message`)
  }
  return found
}

let running = 0
const queue: (() => void)[] = []

async function agentSlot<T>(work: () => Promise<T>): Promise<T> {
  if (running >= AGENTS_AT_ONCE) await new Promise<void>((resolve) => queue.push(resolve))
  running += 1
  try {
    return await work()
  } finally {
    running -= 1
    queue.shift()?.()
  }
}
