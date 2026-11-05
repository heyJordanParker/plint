import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'

const LINTERS = ['oxlint', '@biomejs/biome', 'stylelint']

const PARSER_FOLDERS = {
  'darwin-arm64': 'prebuild-macOS-ARM64',
  'darwin-x64': 'prebuild-macOS-X64',
  'linux-arm64': 'prebuild-Linux-ARM64',
  'linux-x64': 'prebuild-Linux-X64',
} as const

type Machine = keyof typeof PARSER_FOLDERS

const root = import.meta.dir
const archive = join(root, 'dist', `linters-${process.pid}.tgz`)
const named = (process.env.CMOD_MACHINES || Object.keys(PARSER_FOLDERS).join(' ')).trim().split(/\s+/)
const machines = named.filter((name): name is Machine => Object.hasOwn(PARSER_FOLDERS, name))
if (machines.length < named.length) throw new Error(`CMOD_MACHINES names ${named.join(' ')}, and rulebook builds only ${Object.keys(PARSER_FOLDERS).join(' ')}.`)

const embeddedParserPaths: Bun.BunPlugin = {
  name: 'embedded-parser-paths',
  setup(build) {
    build.onLoad({ filter: /[\\/]@ast-grep[\\/]lang-[a-z]+[\\/]index\.js$/ }, async ({ path }) => ({
      contents: (await Bun.file(path).text()).replaceAll('__dirname', JSON.stringify(`/$bunfs/root/${relative(root, dirname(path))}`)),
      loader: 'js',
    }))
  },
}

process.chdir(root)
try {
  const install = Bun.spawnSync([process.execPath, 'install', '--os=*', '--cpu=*', '--libc=glibc'], { stdout: 'inherit', stderr: 'inherit' })
  if (install.exitCode !== 0) throw new Error(`bun install exited ${install.exitCode}.`)

  for (const machine of machines) {
    const parsers = [...new Bun.Glob(`node_modules/@ast-grep/lang-*/prebuilds/${PARSER_FOLDERS[machine]}/parser.so`).scanSync({ cwd: root, absolute: true })]
    const folders = packageFolders(LINTERS, machine).map((folder) => relative(root, folder))
    mkdirSync(dirname(archive), { recursive: true })
    const tar = Bun.spawnSync(['tar', '-czf', archive, ...folders.filter((folder) => !folders.some((outer) => folder.startsWith(`${outer}/`)))], { env: { ...process.env, COPYFILE_DISABLE: '1' }, stdout: 'inherit', stderr: 'inherit' })
    if (tar.exitCode !== 0) throw new Error(`tar exited ${tar.exitCode} while it packed the linters for ${machine}.`)
    await Bun.build({
      entrypoints: [join(root, 'src', 'main.ts'), join(root, 'src', 'worker.ts'), ...parsers, archive],
      root,
      minify: true,
      naming: { asset: '[dir]/[name]-[hash].[ext]' },
      plugins: [embeddedParserPaths],
      compile: { target: `bun-${machine}`, outfile: join(root, 'dist', `rulebook-${machine}`), autoloadDotenv: false, autoloadBunfig: false },
    })
  }
} finally {
  rmSync(archive, { force: true })
  for (const leftover of new Bun.Glob('*.bun-build').scanSync({ cwd: root, dot: true })) rmSync(join(root, leftover))
}

function packageFolders(names: readonly string[], machine: Machine): readonly string[] {
  const [os, cpu] = machine.split('-')
  const folders = new Set<string>()
  const visit = (name: string, from: string, isOptional: boolean): void => {
    const folder = installedFolder(name, from)
    if (folder === undefined && isOptional) return
    if (folder === undefined) throw new Error(`${name} is not installed in ${from} or a folder above it.`)
    const manifest = JSON.parse(readFileSync(join(folder, 'package.json'), 'utf8')) as { os?: string[]; cpu?: string[]; dependencies?: Record<string, string>; optionalDependencies?: Record<string, string> }
    if (folders.has(folder) || (isOptional && !(fits(manifest.os, os) && fits(manifest.cpu, cpu)))) return
    folders.add(folder)
    for (const dependency of Object.keys(manifest.dependencies ?? {})) visit(dependency, folder, false)
    for (const dependency of Object.keys(manifest.optionalDependencies ?? {})) visit(dependency, folder, true)
  }
  for (const name of names) visit(name, root, false)
  return [...folders]
}

function installedFolder(name: string, from: string): string | undefined {
  for (let folder = from; folder.startsWith(root); folder = dirname(folder)) {
    const installed = join(folder, 'node_modules', name)
    if (existsSync(join(installed, 'package.json'))) return installed
  }
  return undefined
}

function fits(allowed: readonly string[] | undefined, value: string | undefined): boolean {
  return allowed === undefined || (value !== undefined && allowed.includes(value))
}
