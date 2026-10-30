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

export type Run =
  | { readonly status: 'idle' }
  | { readonly status: 'running'; readonly files: readonly string[] }
  | { readonly status: 'done'; readonly reports: readonly Report[] }
  | { readonly status: 'failed'; readonly error: string }

export type PlintState = { memory: { run: Run } }

export const initialState: PlintState = { memory: { run: { status: 'idle' } } }
