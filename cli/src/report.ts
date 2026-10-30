import type { FileReport, Reported } from './check.ts'

export type EditAnswer = {
  readonly refuse?: string
  readonly note?: string
  readonly failures?: readonly string[]
}

export function findingLines(findings: readonly Reported[]): string {
  const lineWidth = Math.max(...findings.map(({ line }) => String(line).length))
  const levelWidth = Math.max(...findings.map(({ level }) => level.length))
  const ruleWidth = Math.max(...findings.map(({ rule }) => rule.length))
  return findings
    .map(({ line, level, rule, message, isExisting }) => `  ${String(line).padStart(lineWidth)}  ${level.padEnd(levelWidth)}  ${rule.padEnd(ruleWidth)}  ${message}${isExisting ? ' (already in the file before this edit)' : ''}`)
    .join('\n')
}

export function failureLines(report: FileReport): readonly string[] {
  return report.failures.map(({ rule, reason }) => `${rule} did not run on ${report.path}: ${reason}`)
}

export function editAnswer(report: FileReport): EditAnswer {
  const errors = report.findings.filter(({ level }) => level === 'error')
  const warnings = report.findings.filter(({ level }) => level === 'warning')
  const failures = failureLines(report)
  const failed = failures.length === 0 ? '' : `\n\n${failures.join('\n')}`
  if (errors.length > 0) {
    const also = warnings.length === 0 ? '' : `\n\nWarnings:\n${findingLines(warnings)}`
    return { refuse: `plint refused this edit to ${report.path}. Fix every error, then edit again.\n\n${findingLines(errors)}${also}${failed}`, failures }
  }
  if (warnings.length > 0) return { note: `plint warnings in ${report.path}:\n\n${findingLines(warnings)}${failed}`, failures }
  if (failures.length > 0) return { note: `plint checked ${report.path}, but not with every rule:${failed}`, failures }
  return {}
}

export function textReport(reports: readonly FileReport[]): string {
  const flagged = reports.filter(({ findings }) => findings.length > 0)
  const all = reports.flatMap(({ findings }) => findings)
  const errors = all.filter(({ level }) => level === 'error').length
  const failures = reports.flatMap(failureLines)
  const blocks = flagged.map((report) => `${report.path}\n${findingLines(report.findings)}`)
  const counts = `${errors} ${errors === 1 ? 'error' : 'errors'}, ${all.length - errors} ${all.length - errors === 1 ? 'warning' : 'warnings'} in ${reports.length} ${reports.length === 1 ? 'Prompt' : 'Prompts'}`
  return [...blocks, ...(failures.length === 0 ? [] : [failures.join('\n')]), counts].join('\n\n')
}
