import { readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import type { Finding, Level, PromptFile, Runs } from './api.ts'
import { isLevel, isRecord, isStrings, type RuleOverride, type Settings } from './config.ts'
import { importDefault } from './modules.ts'

type Common = {
  readonly id: string
  readonly source: string
  readonly level: Level | 'off'
  readonly runs: Runs
  readonly paths: readonly string[] | undefined
}

export type StaticRule = Common & {
  readonly kind: 'static'
  check(file: PromptFile): readonly Finding[] | Promise<readonly Finding[]>
}

export type AgenticRule = Common & {
  readonly kind: 'agentic'
  readonly body: string
  readonly agent: string | undefined
  readonly model: string | undefined
  readonly effort: string | undefined
  readonly allowedTools: string | readonly string[] | undefined
  readonly disallowedTools: string | readonly string[] | undefined
}

export type LoadedRule = StaticRule | AgenticRule

const SKILL_KEYS = new Set(['name', 'description', 'context', 'agent', 'model', 'effort', 'paths', 'allowed-tools', 'disallowed-tools', 'metadata'])
const METADATA_KEYS = new Set(['level', 'runs'])

export async function loadRules(settings: Settings): Promise<readonly LoadedRule[]> {
  const rules: LoadedRule[] = []
  for (const config of settings.configs) {
    for (const [plugin, folder] of Object.entries(config.plugins)) {
      for (const entry of readdirSync(folder, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts') && !entry.name.endsWith('.test.ts')) {
          rules.push(await staticRule(`${plugin}/${entry.name.slice(0, -3)}`, join(folder, entry.name)))
        } else if (entry.isDirectory() && existsSync(join(folder, entry.name, 'SKILL.md'))) {
          rules.push(await agenticRule(`${plugin}/${entry.name}`, entry.name, join(folder, entry.name, 'SKILL.md')))
        }
      }
    }
  }
  const ids = new Set(rules.map(({ id }) => id))
  for (const id of Object.keys(settings.rules)) if (!ids.has(id)) throw new Error(`A plint config sets the rule "${id}", which no plugin holds. The rules are ${[...ids].join(', ')}.`)
  return rules.map((rule) => overridden(rule, settings.rules[rule.id]))
}

async function staticRule(id: string, source: string): Promise<StaticRule> {
  const rule = await importDefault(source)
  const fail = (problem: string): never => {
    throw new Error(`${source}: ${problem}`)
  }
  if (!isRecord(rule) || typeof rule.check !== 'function') return fail('the default export is not a rule. Export defineRule({ check }).')
  if (rule.level !== undefined && !isLevel(rule.level)) fail('level is "error" or "warning".')
  if (rule.runs !== undefined && rule.runs !== 'edit' && rule.runs !== 'manual') fail('runs is "edit" or "manual".')
  if (rule.paths !== undefined && !isStrings(rule.paths)) fail('paths is a list of globs.')
  const check = rule.check as StaticRule['check']
  return {
    kind: 'static',
    id,
    source,
    level: (rule.level as Level | undefined) ?? 'error',
    runs: (rule.runs as Runs | undefined) ?? 'edit',
    paths: rule.paths as readonly string[] | undefined,
    check: (file) => check(file),
  }
}

async function agenticRule(id: string, folder: string, source: string): Promise<AgenticRule> {
  const fail = (problem: string): never => {
    throw new Error(`${source}: ${problem}`)
  }
  const text = await Bun.file(source).text()
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text)
  if (match === null) return fail('the Skill has no frontmatter between --- lines.')
  const frontmatter: unknown = Bun.YAML.parse(match[1] ?? '')
  const body = (match[2] ?? '').trim()
  if (!isRecord(frontmatter)) return fail('the frontmatter is not a map of keys.')
  for (const key of Object.keys(frontmatter)) if (!SKILL_KEYS.has(key)) fail(`plint does not run the Skill key "${key}". It reads ${[...SKILL_KEYS].join(', ')}.`)
  if (frontmatter.name !== folder) fail(`name is "${String(frontmatter.name)}", and a Skill's name matches its folder, "${folder}".`)
  if (typeof frontmatter.description !== 'string' || frontmatter.description.trim() === '') fail('description says what the rule flags.')
  if (frontmatter.context !== 'fork') fail('context is fork, because a rule runs in its own subagent.')
  for (const key of ['agent', 'model', 'effort'] as const) if (frontmatter[key] !== undefined && typeof frontmatter[key] !== 'string') fail(`${key} is a string.`)
  for (const key of ['allowed-tools', 'disallowed-tools'] as const) if (frontmatter[key] !== undefined && typeof frontmatter[key] !== 'string' && !isStrings(frontmatter[key])) fail(`${key} is a string or a list.`)
  const metadata = frontmatter.metadata ?? {}
  if (!isRecord(metadata)) return fail('metadata is a map.')
  for (const key of Object.keys(metadata)) if (!METADATA_KEYS.has(key)) fail(`metadata.${key} is not a plint key. plint reads metadata.level and metadata.runs.`)
  if (metadata.level !== undefined && !isLevel(metadata.level)) fail('metadata.level is "error" or "warning".')
  if (metadata.runs !== undefined && metadata.runs !== 'edit' && metadata.runs !== 'manual') fail('metadata.runs is "edit" or "manual".')
  if (body === '') fail('the Skill has no body. The body is the check.')
  return {
    kind: 'agentic',
    id,
    source,
    level: (metadata.level as Level | undefined) ?? 'error',
    runs: (metadata.runs as Runs | undefined) ?? 'edit',
    paths: pathsOf(source, frontmatter.paths),
    body,
    agent: frontmatter.agent as string | undefined,
    model: frontmatter.model as string | undefined,
    effort: frontmatter.effort as string | undefined,
    allowedTools: frontmatter['allowed-tools'] as string | readonly string[] | undefined,
    disallowedTools: frontmatter['disallowed-tools'] as string | readonly string[] | undefined,
  }
}

function pathsOf(source: string, paths: unknown): readonly string[] | undefined {
  if (paths === undefined) return undefined
  if (typeof paths === 'string') return paths.split(',').map((path) => path.trim()).filter((path) => path !== '')
  if (isStrings(paths)) return paths
  throw new Error(`${source}: paths is a list of globs or a comma-separated string.`)
}

function overridden(rule: LoadedRule, override: RuleOverride | undefined): LoadedRule {
  if (override === undefined) return rule
  if (typeof override === 'string') return { ...rule, level: override }
  const { level, runs, paths } = override
  const common = { ...rule, ...(level === undefined ? {} : { level }), ...(runs === undefined ? {} : { runs }), ...(paths === undefined ? {} : { paths }) }
  if (common.kind === 'static') {
    for (const key of ['agent', 'model', 'effort'] as const) if (override[key] !== undefined) throw new Error(`A plint config sets ${key} on ${rule.id}, a static rule, which runs no agent.`)
    return common
  }
  return { ...common, ...(override.agent === undefined ? {} : { agent: override.agent }), ...(override.model === undefined ? {} : { model: override.model }), ...(override.effort === undefined ? {} : { effort: override.effort }) }
}
