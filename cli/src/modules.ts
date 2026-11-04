import * as api from './api.ts'

let isRegistered = false

export async function importDefault(path: string): Promise<unknown> {
  if (!isRegistered) {
    Bun.plugin({
      name: 'rulebook',
      setup(build) {
        build.module('@cmodjs/rulebook', () => ({ exports: { ...api }, loader: 'object' }))
      },
    })
    isRegistered = true
  }
  const loaded: { default?: unknown } = await import(path).catch((error: unknown) => {
    throw new Error(`${path}: ${error instanceof Error ? error.message : String(error)}`)
  })
  if (loaded.default === undefined) throw new Error(`${path} has no default export.`)
  return loaded.default
}
