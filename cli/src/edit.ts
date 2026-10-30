import { existsSync } from 'node:fs'
import { dirname, isAbsolute, resolve } from 'node:path'
import { checkFile } from './check.ts'
import { isRecord, loadSettings } from './config.ts'
import { editAnswer, type EditAnswer } from './report.ts'
import { loadRules } from './rules.ts'

type Replacement = { readonly old_string: string; readonly new_string: string; readonly replace_all?: boolean }

export type ToolCall = {
  readonly tool_name: string
  readonly tool_input: Readonly<Record<string, unknown>>
  readonly cwd: string
}

export async function checkEdit(call: ToolCall): Promise<EditAnswer> {
  const path = call.tool_input.file_path
  if (typeof path !== 'string') return {}
  const file = isAbsolute(path) ? path : resolve(call.cwd, path)
  const previous = existsSync(file) ? await Bun.file(file).text() : undefined
  const next = editedText(call.tool_name, call.tool_input, previous)
  if (next === undefined) return {}
  const folder = existsSync(dirname(file)) ? dirname(file) : call.cwd
  const settings = await loadSettings(folder, file.startsWith(`${call.cwd}/`) ? call.cwd : folder)
  const report = await checkFile(settings, await loadRules(settings), file, next, { scope: 'edit', timeoutMs: settings.editTimeout, previous: previous ?? '' })
  return report === undefined ? {} : editAnswer(report)
}

export function editedText(tool: string, input: Readonly<Record<string, unknown>>, previous: string | undefined): string | undefined {
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
