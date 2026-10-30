import { existsSync, realpathSync } from 'node:fs'
import { isAbsolute, join, relative } from 'node:path'
import { isPrompt } from './check.ts'
import type { Settings } from './config.ts'

export function promptFiles(settings: Settings): readonly string[] {
  const listed = Bun.spawnSync(['git', 'ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: settings.root, stdout: 'pipe', stderr: 'ignore' })
  const candidates = listed.exitCode === 0
    ? listed.stdout.toString().split('\0').filter((path) => path !== '').map((path) => join(settings.root, path))
    : settings.paths.flatMap((glob) => [...new Bun.Glob(glob).scanSync({ cwd: settings.root, absolute: true, dot: true })])
  return [...new Set(candidates)].filter((file) => existsSync(file) && isPrompt(settings, file)).sort()
}

export function probeFiles(settings: Settings): readonly string[] {
  const probes = settings.configs.flatMap((config) => config.probes.flatMap((glob) => [...new Bun.Glob(glob).scanSync({ cwd: config.dir, absolute: true, dot: true })]))
  return [...new Set(probes.map((file) => realpathSync(file)))]
    .filter((file) => {
      const path = relative(settings.root, file)
      return !path.startsWith('..') && !isAbsolute(path)
    })
    .sort()
}
