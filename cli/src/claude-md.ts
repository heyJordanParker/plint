import { existsSync, realpathSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, extname, join, resolve } from 'node:path'
import { Lexer } from 'marked'

export type Import = { readonly path: string; readonly line: number }

type ClaudeMd = {
  readonly lines: readonly string[]
  readonly imports: readonly Import[]
}

type Token = {
  readonly type: string
  readonly raw: string
  readonly text?: string | undefined
  readonly tokens?: readonly Token[] | undefined
  readonly items?: readonly Token[] | undefined
}

const NAMES = new Set(['claude.md', 'claude.local.md', 'agents.md'])

const TEXT_EXTENSIONS = new Set([
  '.md', '.txt', '.text', '.json', '.yaml', '.yml', '.toml', '.xml', '.csv', '.html', '.htm', '.css', '.scss', '.sass', '.less',
  '.js', '.ts', '.tsx', '.jsx', '.mjs', '.cjs', '.mts', '.cts', '.py', '.pyi', '.pyw', '.rb', '.erb', '.rake', '.go', '.rs',
  '.java', '.kt', '.kts', '.scala', '.c', '.cpp', '.cc', '.cxx', '.h', '.hpp', '.hxx', '.cs', '.swift', '.sh', '.bash', '.zsh',
  '.fish', '.ps1', '.bat', '.cmd', '.env', '.ini', '.cfg', '.conf', '.config', '.properties', '.sql', '.graphql', '.gql',
  '.proto', '.vue', '.svelte', '.astro', '.ejs', '.hbs', '.pug', '.jade', '.php', '.pl', '.pm', '.lua', '.r', '.dart', '.ex',
  '.exs', '.erl', '.hrl', '.clj', '.cljs', '.cljc', '.edn', '.hs', '.lhs', '.elm', '.ml', '.mli', '.f', '.f90', '.f95', '.for',
  '.cmake', '.make', '.makefile', '.gradle', '.sbt', '.rst', '.adoc', '.asciidoc', '.org', '.tex', '.latex', '.lock', '.log',
  '.diff', '.patch',
])

const FRONTMATTER = /^---\s*\n([\s\S]*?)---\s*\n?/
const COMMENT = /<!--[\s\S]*?-->/g
const IMPORT = /(?:^|\s)@((?:[^\s\\]|\\ )+)/g
const RULES_FOLDER = /(?:^|\/)\.claude\/rules\//

export function isClaudeMd(file: string): boolean {
  if (NAMES.has(basename(file).toLowerCase())) return true
  return file.endsWith('.md') && isRulesFolder(dirname(file))
}

export function isRulesFolder(folder: string): boolean {
  if (RULES_FOLDER.test(`${folder}/`)) return true
  if (!existsSync(folder)) return false
  const real = `${realpathSync(folder)}/`
  return userMemoryPaths().some((path) => real.startsWith(`${path}/`))
}

export function claudeConfigFolder(): string {
  return process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude')
}

export function claudeJsonFile(): string {
  const file = join(process.env.CLAUDE_CONFIG_DIR || homedir(), '.claude.json')
  const legacy = join(claudeConfigFolder(), '.config.json')
  const stats = statSync(legacy, { throwIfNoEntry: false })
  const isLegacy = stats?.isFile() === true && (stats.size > 0 || ((stats.mode & 0o222) !== 0 && !existsSync(file)))
  return isLegacy ? legacy : file
}

let userPaths: readonly string[] | undefined

export function userMemoryPaths(): readonly string[] {
  if (userPaths !== undefined) return userPaths
  const rules = join(claudeConfigFolder(), 'rules')
  const entries = existsSync(rules) ? [...new Bun.Glob('**').scanSync({ cwd: rules, absolute: true, dot: true, onlyFiles: false, followSymlinks: true })] : []
  const folders = [rules, ...entries].filter((path) => statSync(path, { throwIfNoEntry: false })?.isDirectory() === true)
  userPaths = [...new Set([join(claudeConfigFolder(), 'CLAUDE.md'), ...folders].filter((path) => existsSync(path)).map((path) => realpathSync(path)))]
  return userPaths
}

export function importedFile(doc: string, path: string): string | undefined {
  const extension = extname(path).toLowerCase()
  if (extension !== '' && !TEXT_EXTENSIONS.has(extension)) return undefined
  if (path.startsWith('~/')) return join(homedir(), path.slice(2))
  return resolve(dirname(existsSync(doc) ? realpathSync(doc) : doc), path)
}

export function readClaudeMd(text: string): ClaudeMd {
  const source = text.replace(/\r\n|\r/g, '\n')
  const body = withoutFrontmatter(source)
  const start = source.length - body.length
  const strips = body.includes('<!--')
  const hidden: [number, number][] = [[0, start]]
  const found = new Map<string, number>()
  const tokens: readonly Token[] = strips || body.includes('@') ? [...new Lexer().lex(body)] : []
  let cursor = 0
  for (const token of tokens) {
    const at = body.indexOf(token.raw, cursor)
    if (at === -1) throw new Error(`marked read a ${token.type} the text does not hold: ${JSON.stringify(token.raw.slice(0, 60))}`)
    if (strips) hidden.push([start + cursor, start + at], ...commentsOf(token).map(([from, to]): [number, number] => [start + at + from, start + at + to]))
    walk([token], (scanned) => {
      for (const match of scanned.matchAll(IMPORT)) {
        const path = importPath(match[1] ?? '')
        if (path === undefined || found.has(path)) continue
        const offset = token.raw.indexOf(`@${match[1]}`)
        found.set(path, lineOf(source, start + at + Math.max(offset, 0)))
      }
    })
    cursor = at + token.raw.length
  }
  if (strips) hidden.push([start + cursor, source.length])

  let masked = ''
  let kept = 0
  for (const [from, to] of hidden) {
    masked += source.slice(kept, from) + source.slice(from, to).replace(/[^\n]/g, '')
    kept = to
  }
  return {
    lines: (masked + source.slice(kept)).split('\n'),
    imports: [...found].map(([path, line]) => ({ path, line })),
  }
}

function withoutFrontmatter(text: string): string {
  const plain = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  if (plain.indexOf('---', 3) < 0) return text
  const match = FRONTMATTER.exec(plain)
  return match === null ? text : plain.slice(match[0].length)
}

function isComment(token: Token): boolean {
  const start = token.raw.trimStart()
  return token.type === 'html' && start.startsWith('<!--') && start.includes('-->')
}

function commentsOf(token: Token): readonly (readonly [number, number])[] {
  if (!isComment(token)) return []
  if (token.raw.replace(COMMENT, '').trim().length === 0) return [[0, token.raw.length]]
  return [...token.raw.matchAll(COMMENT)].map((comment) => [comment.index, comment.index + comment[0].length])
}

function walk(tokens: readonly Token[], scan: (text: string) => void): void {
  for (const token of tokens) {
    if (token.type === 'code' || token.type === 'codespan') continue
    if (token.type === 'html') {
      const rest = token.raw.replace(COMMENT, '')
      if (isComment(token) && rest.trim().length > 0) scan(rest)
      continue
    }
    if (token.type === 'text') scan(token.text || '')
    if (token.tokens) walk(token.tokens, scan)
    if (token.items) walk(token.items, scan)
  }
}

function importPath(written: string): string | undefined {
  const hash = written.indexOf('#')
  const path = (hash === -1 ? written : written.substring(0, hash)).replaceAll('\\ ', ' ')
  if (path === '') return undefined
  const isPath = path.startsWith('./') || path.startsWith('~/') || (path.startsWith('/') && path !== '/') || (!path.startsWith('@') && !/^[#%^&*()]+/.test(path) && /^[a-zA-Z0-9._-]/.test(path))
  return isPath ? path : undefined
}

function lineOf(text: string, offset: number): number {
  return text.slice(0, offset).split('\n').length
}
