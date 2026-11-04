import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { isClaudeMd, readClaudeMd } from '../src/claude-md.ts'
import expected from './claude-md/expected.json'

const FIXTURES = join(import.meta.dir, 'claude-md')

for (const [file, cases] of Object.entries(expected.cases)) {
  test(`every case in ${file} imports what Claude Code does, and blanks each line Claude Code hides`, () => {
    const docs = readFileSync(join(FIXTURES, file), 'utf8').split('\n=====\n')
    const read = docs.map((doc) => {
      const claudeMd = readClaudeMd(doc)
      return { case: doc.split('\n')[0], imports: claudeMd.imports.map(({ path }) => path), lines: claudeMd.lines.join('\n') }
    })
    expect(read).toEqual(cases)
  })
}

for (const [file, lines] of Object.entries(expected.files)) {
  test(`${file} as one file blanks each line Claude Code hides`, () => {
    expect(readClaudeMd(readFileSync(join(FIXTURES, file), 'utf8')).lines.join('\n')).toBe(lines)
  })
}

test('each line reads as Claude sees it, and each import names the line it is written on', () => {
  const claudeMd = readClaudeMd(['---', 'title: @fm.md', '---', '# Rules', '', '<!-- a note — hidden -->', '', 'Read @a.md first.', '', '<!-- b --> Then read @b.md', ''].join('\n'))
  expect(claudeMd.lines).toEqual(['', '', '', '# Rules', '', '', '', 'Read @a.md first.', '', ' Then read @b.md', ''])
  expect(claudeMd.imports).toEqual([{ path: 'a.md', line: 8 }, { path: 'b.md', line: 10 }])
})

test('every .md file in a .claude/rules folder, at any depth, reads as Claude Code reads a Claude.md', () => {
  for (const file of ['/p/CLAUDE.md', '/p/Agents.md', '/p/CLAUDE.local.md', '/p/.claude/rules/style.md', '/p/.claude/rules/frontend/react.md', '/p/app/.claude/rules/api.md']) expect(isClaudeMd(file)).toBe(true)
  for (const file of ['/p/rules/style.md', '/p/.claude/rules/notes.txt', '/p/.claude/rules/STYLE.MD', '/p/.claude/rules.md', '/p/.claude/skills/a/SKILL.md']) expect(isClaudeMd(file)).toBe(false)
})
