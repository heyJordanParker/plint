# plint

plint lints Claude Code Prompts: every Claude.md, rule, Skill, and agent file. When any agent edits a Prompt, plint checks the file as the edit will leave it. An error refuses the edit, and the agent reads why. A warning lets the edit land, and the agent reads it beside the result.

```text
plint refused this edit to packages/claude/rules/scope.md. Fix every error, then edit again.

  12  error  global/block-em-dashes  An em dash joins two ideas in one sentence. Split it into two sentences.
```

plint is a [cmod](https://claudemodmanager.com) mod. Install it with `cmod install heyJordanParker/plint`, which also puts the `plint` program on your `PATH`.

A project with a `package.json` adds `@cmodjs/plint` as a dev dependency, for the types its rule files and config import and for `bun plint` in its scripts.

## Configure it

plint reads two configs and merges them, the project's over yours:

- `~/.config/plint/plint.config.ts` holds the rules that apply to every project.
- `plint.config.ts` at a project's root holds the project's own rules, and can change the level of any rule for that project.

```ts
import { defineConfig } from '@cmodjs/plint'

export default defineConfig({
  plugins: { dent: './tools/plint/rules' },
  paths: ['**/Claude.md', '.claude/**/*.md'],
  probes: ['tests/plint/**/*.md'],
  editTimeout: 30_000,
  existingErrors: 'warning',
  rules: {
    'global/require-file-links': 'off',
    'global/block-domain-words-for-code': { level: 'warning', model: 'sonnet' },
    'dent/require-module-owners': { runs: 'manual' },
  },
})
```

| Key | What it sets |
| --- | --- |
| `plugins` | Each rule folder, by the name its rules carry, such as `dent/require-module-owners`. |
| `paths` | The files that count as Prompts, relative to the project root. |
| `probes` | The probe files, relative to the config. |
| `editTimeout` | How long an edit waits for its agentic rules, in milliseconds. 30 000 by default. |
| `existingErrors` | `warning`, the default, lets an edit through an error that was already in the file. `error` blocks it too. |
| `rules` | A level, `"off"`, or the settings of any rule: `level`, `runs`, `paths`, `agent`, `model`, `effort`. |

## Write a rule

A static rule is a TypeScript file in a rule folder. It returns each line it flags.

```ts
import { defineRule } from '@cmodjs/plint'

export default defineRule({
  level: 'error',
  check: ({ lines }) => lines.flatMap((text, index) => (text.includes('—') ? [{ line: index + 1, message: 'Split the sentence at the em dash.' }] : [])),
})
```

An agentic rule is a Skill folder in a rule folder. Its frontmatter is Claude Code's Skill frontmatter, with plint's `level` and `runs` under `metadata`, and its body is the check. plint runs it the way Claude Code runs any `context: fork` Skill: in a subagent in the project, which reads the project's Claude.md files. `agent` picks the subagent, whose own frontmatter applies, its preloaded Skills included.

```md
---
name: require-true-facts
description: Flags each Claude.md Fact the code contradicts.
context: fork
model: sonnet
allowed-tools: Read, Grep, Glob
paths:
  - "**/Claude.md"
metadata:
  level: error
  runs: manual
---

Check each Fact in this Claude.md against the code, folders, and commands it names.
Report each Fact the code contradicts, with what the code shows instead.
```

`metadata.runs: manual` keeps a rule off edits, for a check that takes minutes. It runs when you run `plint`.

## Prove a rule with a probe

A probe holds lines the rule must flag, each under a pin, and lines it must leave alone. plint fails on a pin that stops firing and on a flag with no pin. A pin works only in a probe.

```md
<!-- plint-expect global/block-em-dashes -->
Run the sync script — it restows every package.

Run the sync script. It restows every package.
```

## Run it

```text
plint [files...]           Check every Prompt and probe of this project, or only the files named, with every rule.
plint --static [files...]  Check with the static rules only.
plint --json [files...]    Print the results as JSON.
```

`/plint` in a session runs the same check and lists the results in the Sidebar.
