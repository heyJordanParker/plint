import { existsSync, realpathSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { checkFile } from './check.ts'
import { isClaudeMd } from './claude-md.ts'
import { existingFolder, isRecord, loadSettings, projectRoot } from './config.ts'
import { loadImportedFiles, watchImportSource } from './files.ts'
import { editAnswer, type EditAnswer } from './report.ts'
import { loadRules } from './rules.ts'

type Replacement = { readonly old_string: string; readonly new_string: string; readonly replace_all?: boolean }

export type ToolCall = {
  readonly tool_name: string
  readonly tool_input: Readonly<Record<string, unknown>>
  readonly cwd: string
}

export function editRoot(call: ToolCall): string {
  const edited = editedFile(call)
  if (edited === undefined) return projectRoot(call.cwd, call.cwd)
  return projectRoot(edited.folder, edited.file.startsWith(`${realpathSync(call.cwd)}/`) ? call.cwd : edited.folder)
}

export async function checkEdit(call: ToolCall, root: string): Promise<EditAnswer> {
  const edited = editedFile(call)
  if (edited === undefined) return editAnswer(undefined)
  const { file } = edited
  const previous = existsSync(file) ? await Bun.file(file).text() : undefined
  const next = editedText(call.tool_name, call.tool_input, previous)
  if (next === undefined) return editAnswer(undefined)
  if (isClaudeMd(file)) watchImportSource(file)
  const settings = await loadSettings(dirname(file), root)
  const rules = await loadRules(settings)
  const report = await checkFile(settings, rules, file, next, { scope: 'edit', previous: previous ?? '', imported: () => loadImportedFiles(root) })
  return editAnswer(report)
}

function editedFile(call: ToolCall): { readonly file: string; readonly folder: string } | undefined {
  const path = call.tool_input.file_path
  if (typeof path !== 'string') return undefined
  const file = isAbsolute(path) ? path : resolve(call.cwd, path)
  const nearest = existingFolder(file)
  const real = join(realpathSync(nearest), relative(nearest, file))
  return { file: real, folder: existingFolder(dirname(real)) }
}

function editedText(tool: string, input: Readonly<Record<string, unknown>>, previous: string | undefined): string | undefined {
  if (tool === 'Write') return typeof input.content === 'string' ? input.content : undefined
  if (previous === undefined) return undefined
  if (tool === 'Edit') return replaced(previous, [input])
  if (tool === 'MultiEdit') return Array.isArray(input.edits) ? replaced(previous, input.edits) : undefined
  return undefined
}

function replaced(text: string, edits: readonly unknown[]): string | undefined {
  let result = text
  for (const edit of edits) {
    if (!isReplacement(edit) || !result.includes(edit.old_string)) return undefined
    result = edit.replace_all === true ? result.replaceAll(edit.old_string, edit.new_string) : result.replace(edit.old_string, () => edit.new_string)
  }
  return result
}

function isReplacement(value: unknown): value is Replacement {
  return isRecord(value) && typeof value.old_string === 'string' && typeof value.new_string === 'string'
}
