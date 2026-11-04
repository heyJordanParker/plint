import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { projectRoot } from '../src/config.ts'

let home: string
let repo: string

beforeEach(() => {
  home = realpathSync(mkdtempSync('/tmp/rulebook-root-'))
  repo = join(home, 'repo')
  mkdirSync(join(repo, 'src', 'deep'), { recursive: true })
  git(repo, 'init', '-q')
  writeFileSync(join(repo, 'README.md'), 'A repo.\n')
  git(repo, 'add', '.')
  git(repo, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-q', '-m', 'start')
})

afterEach(() => rmSync(home, { recursive: true, force: true }))

function git(cwd: string, ...args: readonly string[]): string {
  const run = Bun.spawnSync(['git', ...args], { cwd, stdout: 'pipe', stderr: 'pipe', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' } })
  return run.exitCode === 0 ? run.stdout.toString().trim() : `exited ${run.exitCode}`
}

function gitRoot(folder: string, outsideGit: string): string {
  const shown = git(folder, 'rev-parse', '--show-toplevel')
  return realpathSync(shown.startsWith('exited') ? outsideGit : shown)
}

test('a folder deep in a repository has the root git rev-parse --show-toplevel gives', () => {
  const folder = join(repo, 'src', 'deep')
  expect(projectRoot(folder, folder)).toBe(repo)
  expect(projectRoot(folder, folder)).toBe(gitRoot(folder, folder))
})

test('a folder in a worktree has the worktree as its root, as git rev-parse --show-toplevel gives', () => {
  const worktree = join(home, 'worktree')
  git(repo, 'worktree', 'add', '-q', worktree)
  const folder = join(worktree, 'src')
  mkdirSync(folder, { recursive: true })
  expect(projectRoot(folder, folder)).toBe(worktree)
  expect(projectRoot(folder, folder)).toBe(gitRoot(folder, folder))
})

test('a folder in a submodule has the submodule as its root, as git rev-parse --show-toplevel gives', () => {
  const library = join(home, 'library')
  mkdirSync(library)
  git(library, 'init', '-q')
  writeFileSync(join(library, 'index.ts'), 'export {}\n')
  git(library, 'add', '.')
  git(library, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-q', '-m', 'start')
  git(repo, '-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', library, 'vendor/library')
  const folder = join(repo, 'vendor', 'library')
  expect(projectRoot(folder, folder)).toBe(folder)
  expect(projectRoot(folder, folder)).toBe(gitRoot(folder, folder))
})

test('a folder outside every repository, and a folder inside .git, take the folder given for outside git, as git rev-parse --show-toplevel fails there', () => {
  const outside = join(home, 'notes')
  mkdirSync(outside)
  expect(projectRoot(outside, outside)).toBe(gitRoot(outside, outside))
  expect(projectRoot(outside, home)).toBe(home)
  const hooks = join(repo, '.git', 'hooks')
  expect(projectRoot(hooks, outside)).toBe(gitRoot(hooks, outside))
  expect(projectRoot(hooks, outside)).toBe(outside)
})

test('a folder reached through a symbolic link has the root of the folder it links to, as git rev-parse --show-toplevel gives', () => {
  const link = join(home, 'linked')
  symlinkSync(join(repo, 'src'), link)
  expect(projectRoot(link, link)).toBe(repo)
  expect(projectRoot(link, link)).toBe(gitRoot(link, link))
})
