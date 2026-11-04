import { statSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { claudeConfigFolder, userMemoryPaths } from './claude-md.ts'
import { settingsSources } from './config.ts'
import { importSources } from './files.ts'
import { answer, type Question } from './questions.ts'

declare const self: Worker

export type Asked = { readonly id: number; readonly question: Question; readonly input: unknown; readonly root: string }

export type Answered = { readonly id: number; readonly watched: readonly string[] } & ({ readonly answer: unknown } | { readonly error: string })

self.onmessage = async ({ data: { id, question, input, root } }: MessageEvent<Asked>) => {
  try {
    const answered = await answer(question, input, root)
    postMessage({ id, answer: answered, watched: watchedPaths() } satisfies Answered)
  } catch (error) {
    postMessage({ id, error: error instanceof Error ? error.message : String(error), watched: watchedPaths() } satisfies Answered)
  }
}

function watchedPaths(): readonly string[] {
  const modules = Object.keys(require.cache).filter((path) => isAbsolute(path))
  const sources = [...settingsSources(), ...importSources()].flatMap((path) => [path, ...entriesUnder(path)])
  const memory = [join(claudeConfigFolder(), 'CLAUDE.md'), join(claudeConfigFolder(), 'rules'), ...userMemoryPaths()]
  return [...new Set([...modules, ...sources, ...memory])]
}

function entriesUnder(path: string): readonly string[] {
  if (statSync(path, { throwIfNoEntry: false })?.isDirectory() !== true) return []
  return [...new Bun.Glob('**').scanSync({ cwd: path, absolute: true, onlyFiles: false })]
}
