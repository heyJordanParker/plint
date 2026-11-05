export type Finding = {
  readonly rule: string
  readonly line: number
  readonly level: 'error' | 'warning'
  readonly message: string
}

export type Report = {
  readonly path: string
  readonly findings: readonly Finding[]
  readonly failures: readonly { readonly rule: string; readonly reason: string }[]
}

type Run =
  | { readonly status: 'idle' }
  | { readonly status: 'running'; readonly files: readonly string[] }
  | { readonly status: 'done'; readonly reports: readonly Report[] }
  | { readonly status: 'failed'; readonly error: string }

export type RulebookState = { memory: { run: Run; shown: Readonly<Record<string, readonly string[]>>; refusedTurn: string | undefined } }

export const initialState: RulebookState = { memory: { run: { status: 'idle' }, shown: {}, refusedTurn: undefined } }
