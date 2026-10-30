export type Level = 'error' | 'warning'

export type Runs = 'edit' | 'manual'

export type PromptFile = {
  readonly path: string
  readonly text: string
  readonly lines: readonly string[]
}

export type Finding = {
  readonly line: number
  readonly message: string
}

export type Rule = {
  readonly level?: Level
  readonly runs?: Runs
  readonly paths?: readonly string[]
  check(file: PromptFile): readonly Finding[] | Promise<readonly Finding[]>
}

export type RuleSettings = {
  readonly level?: Level | 'off'
  readonly runs?: Runs
  readonly paths?: readonly string[]
  readonly agent?: string
  readonly model?: string
  readonly effort?: string
}

export type Config = {
  readonly plugins?: Readonly<Record<string, string>>
  readonly paths?: readonly string[]
  readonly probes?: readonly string[]
  readonly editTimeout?: number
  readonly existingErrors?: Level
  readonly rules?: Readonly<Record<string, Level | 'off' | RuleSettings>>
}

export function defineRule(rule: Rule): Rule {
  return rule
}

export function defineConfig(config: Config): Config {
  return config
}
