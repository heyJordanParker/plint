---
name: write-rule
description: Write or change a plint rule, the lint that checks Claude Code Prompts such as Claude.md, rules, Skills, and agent files. TRIGGER when asked to add, change, or test a plint rule, or to edit a plint.config.ts. DO NOT TRIGGER to fix a Prompt that a plint rule flagged; fix the Prompt.
---

# Write a plint rule

plint checks every Prompt an Agent edits. An error refuses the edit, and a warning lets it land with a note. `plint` in a terminal, or `/plint` in a session, checks every Prompt of the project with every rule.

## 1. Find the config that holds the rule

- `~/.config/plint/plint.config.ts` holds the rules that apply to every project.
- `plint.config.ts` at a project's root holds the project's own rules, and changes the level of any rule for that project.
- `plugins` names each rule folder. A rule's name is `<plugin>/<file or folder name>`, such as `global/block-em-dashes`.
- `paths` lists the files that count as Prompts, and `probes` the probe files.

## 2. Name the rule for what it does

Start the name with a verb: `block` when the thing is refused everywhere the rule covers, `limit` when it is allowed only in one place, `require` when every match must take one shape.
Example: `block-em-dashes`, `require-true-facts`.

## 3. Write a static rule when a program can decide

A static rule is `<rules folder>/<name>.ts`. It returns each line it flags.

```ts
import { defineRule } from '@cmodjs/plint'

export default defineRule({
  level: 'error',
  check: ({ lines }) =>
    lines.flatMap((text, index) => (text.includes('—') ? [{ line: index + 1, message: 'An em dash joins two ideas in one sentence. Split it into two sentences.' }] : [])),
})
```

## 4. Write an agentic rule when it takes judgment

An agentic rule is a Skill: `<rules folder>/<name>/SKILL.md`. Its frontmatter is Claude Code's Skill frontmatter, and plint's own keys sit under `metadata`. Its body is the check.

```md
---
name: block-domain-words-for-code
description: Flags Domain.md words used to name code.
context: fork
model: haiku
effort: low
paths:
  - "**/Claude.md"
metadata:
  level: error
  runs: edit
---

A Domain.md word names the business, never code. Report each sentence that uses a Domain.md word to name a file, method, or class.
```

- `context: fork` is required. plint runs each agentic rule the way Claude Code runs a forked Skill, in a subagent in the project, so it reads the project's Claude.md files.
- `agent` names the subagent type, `general-purpose` when it is left out. That agent's frontmatter applies: its tools, its model, and the Skills it preloads.
- `model`, `effort`, `allowed-tools`, and `disallowed-tools` work as in any Skill. No rule can edit a file.
- `metadata.level` is `error` or `warning`, `error` by default.
- `metadata.runs` is `edit`, the default, or `manual`. A manual rule runs only when someone runs `plint` or `/plint`. Make a rule manual when it needs more than the config's `editTimeout`, 30 seconds by default.

## 5. Write a probe for the rule

A probe is a file the config's `probes` names, such as `probes/<name>.md`. Put each line the rule must flag under a pin, and add lines it must leave alone.

```md
<!-- plint-expect global/block-em-dashes -->
Run the sync script — it restows every package.

Run the sync script. It restows every package.
```

A probe runs only the rules it pins. A pin works only in a probe file.

## 6. Run the rule

Run `plint <probe>` and `plint <a Prompt the rule covers>`. A probe passes with no output above the count line.
