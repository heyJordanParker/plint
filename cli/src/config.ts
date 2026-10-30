import { existsSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Config, Level, RuleSettings } from './api.ts'
import { importDefault } from './modules.ts'

export const CONFIG_FILE = 'plint.config.ts'

export type LoadedConfig = {
  readonly file: string
  readonly dir: string
  readonly plugins: Readonly<Record<string, string>>
  readonly probes: readonly string[]
}

export type RuleOverride = Level | 'off' | RuleSettings

export type Settings = {
  readonly root: string
  readonly configs: readonly LoadedConfig[]
  readonly paths: readonly string[]
  readonly editTimeout: number
  readonly existingErrors: Level
  readonly rules: Readonly<Record<string, RuleOverride>>
}

const KEYS = new Set(['plugins', 'paths', 'probes', 'editTimeout', 'existingErrors', 'rules'])
const RULE_KEYS = new Set(['level', 'runs', 'paths', 'agent', 'model', 'effort'])

export function globalConfigFile(): string {
  return join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'plint', CONFIG_FILE)
}

export function projectRoot(folder: string, outsideGit: string): string {
  const git = Bun.spawnSync(['git', 'rev-parse', '--show-toplevel'], { cwd: folder, stdout: 'pipe', stderr: 'ignore' })
  return realpathSync(git.exitCode === 0 ? git.stdout.toString().trim() : outsideGit)
}

export async function loadSettings(folder: string, outsideGit = folder): Promise<Settings> {
  const root = projectRoot(folder, outsideGit)
  const files = [globalConfigFile(), join(root, CONFIG_FILE)].filter((file) => existsSync(file)).map((file) => realpathSync(file))
  const configs: { loaded: LoadedConfig; config: Config }[] = []
  for (const file of new Set(files)) configs.push(await loadConfig(file))

  const plugins = new Map<string, string>()
  for (const { loaded } of configs) {
    for (const name of Object.keys(loaded.plugins)) {
      if (plugins.has(name)) throw new Error(`${loaded.file}: the plugin "${name}" is already named by ${plugins.get(name)}. Give each plugin its own name.`)
      plugins.set(name, loaded.file)
    }
  }

  const rules: Record<string, RuleOverride> = {}
  for (const { config } of configs) {
    for (const [id, override] of Object.entries(config.rules ?? {})) {
      const earlier = rules[id]
      rules[id] = typeof earlier === 'object' && typeof override === 'object' ? { ...earlier, ...override } : override
    }
  }

  const latest = configs.map(({ config }) => config).toReversed()

  return {
    root,
    configs: configs.map(({ loaded }) => loaded),
    paths: [...new Set(configs.flatMap(({ config }) => config.paths ?? []))],
    editTimeout: latest.find(({ editTimeout }) => editTimeout !== undefined)?.editTimeout ?? 30_000,
    existingErrors: latest.find(({ existingErrors }) => existingErrors !== undefined)?.existingErrors ?? 'warning',
    rules,
  }
}

async function loadConfig(file: string): Promise<{ loaded: LoadedConfig; config: Config }> {
  const config = validConfig(file, await importDefault(file))
  const dir = file.slice(0, -CONFIG_FILE.length - 1)
  const plugins = Object.fromEntries(Object.entries(config.plugins ?? {}).map(([name, folder]) => [name, realFolder(file, join(dir, folder))]))
  return { loaded: { file, dir, plugins, probes: config.probes ?? [] }, config }
}

function realFolder(file: string, folder: string): string {
  if (!existsSync(folder)) throw new Error(`${file}: the plugin folder ${folder} does not exist.`)
  return realpathSync(folder)
}

function validConfig(file: string, value: unknown): Config {
  const fail = (problem: string): never => {
    throw new Error(`${file}: ${problem}`)
  }
  if (!isRecord(value)) return fail('the default export is not a config object. Export defineConfig({ … }).')
  for (const key of Object.keys(value)) if (!KEYS.has(key)) fail(`"${key}" is not a plint config key. The keys are ${[...KEYS].join(', ')}.`)
  if (value.plugins !== undefined && !(isRecord(value.plugins) && Object.values(value.plugins).every((folder) => typeof folder === 'string'))) fail('plugins maps each plugin name to a folder.')
  for (const name of Object.keys(value.plugins ?? {})) if (!/^[a-z][a-z0-9-]*$/.test(name)) fail(`"${name}" is not a plugin name: use lowercase letters, digits, and "-".`)
  for (const key of ['paths', 'probes'] as const) if (value[key] !== undefined && !isStrings(value[key])) fail(`${key} is a list of globs.`)
  if (value.editTimeout !== undefined && !(Number.isInteger(value.editTimeout) && (value.editTimeout as number) > 0)) fail('editTimeout is a whole number of milliseconds above 0.')
  if (value.existingErrors !== undefined && !isLevel(value.existingErrors)) fail('existingErrors is "error" or "warning".')
  if (value.rules !== undefined && !isRecord(value.rules)) fail('rules maps each rule name, such as "global/block-em-dashes", to a level or to settings.')
  for (const [id, override] of Object.entries(isRecord(value.rules) ? value.rules : {})) validOverride(file, id, override)
  return value as Config
}

function validOverride(file: string, id: string, override: unknown): void {
  const fail = (problem: string): never => {
    throw new Error(`${file}: rules["${id}"] ${problem}`)
  }
  if (override === 'off' || isLevel(override)) return
  if (!isRecord(override)) return fail('is "error", "warning", "off", or an object of rule settings.')
  for (const key of Object.keys(override)) if (!RULE_KEYS.has(key)) fail(`sets "${key}", which no rule has. A rule's settings are ${[...RULE_KEYS].join(', ')}.`)
  if (override.level !== undefined && override.level !== 'off' && !isLevel(override.level)) fail('level is "error", "warning", or "off".')
  if (override.runs !== undefined && override.runs !== 'edit' && override.runs !== 'manual') fail('runs is "edit" or "manual".')
  if (override.paths !== undefined && !isStrings(override.paths)) fail('paths is a list of globs.')
  for (const key of ['agent', 'model', 'effort'] as const) if (override[key] !== undefined && typeof override[key] !== 'string') fail(`${key} is a string.`)
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isStrings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

export function isLevel(value: unknown): value is Level {
  return value === 'error' || value === 'warning'
}
