import { defineMod, longestMs, messageOf, process, sessions, type Mod } from '../node_modules/@cmodjs/core/mod.js'
import { slashCommand } from '../node_modules/@cmodjs/core/jobs/slash-command.js'
import { resultsPage } from './pages/results.js'
import { initialState, type PlintState, type Report } from './state.js'

type EditAnswer = {
  readonly refuse?: string
  readonly note?: string
  readonly failures?: readonly string[]
}

export const plint = defineMod({
  name: 'plint',
  state: initialState,

  setup(mod) {
    const page = mod.sidebar.add(resultsPage)

    sessions.current.goal.beforeToolCall(
      { name: /^(Edit|Write|MultiEdit)$/ },
      async (call) => {
        const checked = await process.run(['plint', 'edit'], { cwd: call.cwd, stdin: JSON.stringify({ tool_name: call.name, tool_input: call.input, cwd: call.cwd }), timeoutMs: longestMs })
        if (checked.exitCode !== 0) throw new Error(`plint edit exited ${checked.exitCode}: ${checked.stderr.trim()}`)
        const answer = JSON.parse(checked.stdout) as EditAnswer
        for (const failure of answer.failures ?? []) mod.toast.warning(failure)
        if (answer.refuse !== undefined) return { refuse: answer.refuse }
        if (answer.note !== undefined) return { note: answer.note }
        return undefined
      },
      { timeoutMs: longestMs },
    )

    mod.use(
      slashCommand({
        name: 'plint',
        description: 'Check every Prompt in this project, or the files named, with every plint rule',
        argumentHint: '[files]',
        reply: async ({ positionals }) => {
          mod.state.memory.run = { status: 'running', files: positionals }
          void checkProject(mod, positionals)
          await page.open()
          return undefined
        },
      }),
    )
  },
})

async function checkProject(mod: Mod<PlintState>, files: readonly string[]): Promise<void> {
  try {
    const checked = await process.run(['plint', '--json', ...files], { cwd: sessions.current.cwd, timeoutMs: longestMs })
    if (checked.exitCode > 1) throw new Error(checked.stderr.trim())
    const { reports } = JSON.parse(checked.stdout) as { readonly reports: readonly Report[] }
    mod.state.memory.run = { status: 'done', reports }
  } catch (error) {
    mod.state.memory.run = { status: 'failed', error: messageOf(error) }
  }
}
