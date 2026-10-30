import { defineConfig, defineRule } from './api.ts'

let isRegistered = false

export async function importDefault(path: string): Promise<unknown> {
  if (!isRegistered) {
    Bun.plugin({
      name: 'plint',
      setup(build) {
        build.module('@cmodjs/plint', () => ({ exports: { defineConfig, defineRule }, loader: 'object' }))
      },
    })
    isRegistered = true
  }
  const loaded: { default?: unknown } = await import(path)
  if (loaded.default === undefined) throw new Error(`${path} has no default export.`)
  return loaded.default
}
