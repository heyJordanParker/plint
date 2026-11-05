# Changelog

What changed in each version of rulebook, for the people who use it. cmod publish releases the section for the version, and Settings shows it.

## [0.2.0]

### Changed
- plint is now rulebook. The program is `rulebook`, the package is `@cmodjs/rulebook`, the slash command is `/rulebook`, and the repository is `heyJordanParker/rulebook`.
- The configs are `~/.config/rulebook/rulebook.config.ts` and a project's `rulebook.config.ts`, and a probe pin is `rulebook-expect`. rulebook reads no `plint.config.ts` and no `plint-expect` pin, so rename yours.
- A rule is one file, at any depth of its rule folder, and its path is its name: `rules/writing/block-em-dashes.ts` is `global/writing/block-em-dashes`. A config setting or a probe pin that names a moved rule's old name fails and names it.
- An agentic rule is one `.md` file named for the rule, holding what its `SKILL.md` held without `name` and `context`. Move each `<name>/SKILL.md` to `<name>.md` and remove those two keys.
- Every rule has a one-line `description`, the Rule in plain words, such as "Don't write em dashes." A rule without one fails to load.
- `runs` is `always` or `manual`, in rules and in config settings. Change each `runs: edit` to `runs: always`.
- The config's `timeout` replaces `editTimeout` and is every agentic rule's default, 30 000 ms. An agentic rule's `metadata.timeout`, or a config setting for one agentic rule, sets its own. The agentic rules of one file share one deadline, the longest `timeout` among them, which starts when they start. Every agentic rule of a run starts at once. A `rulebook` run no longer gives every agentic rule 10 minutes, so give a slow manual rule the `timeout` it needs.
- A rule's `paths` decide what it checks: any file, not only a Prompt. A rule without `paths` still checks every Prompt. An edit to any file a rule covers is checked, and a full run checks each file a rule covers, except a binary file.
- A refusal names what it refused, never the program: `Edit to <path> refused.`, or the message, such as `Reply refused.` or `Inbox refused.`. Each finding quotes the line it flags.
- `rulebook edit` answers `failures` and `findings` every time, and `{ failures: [], findings: [] }` for a file no rule covers.
- The `rulebook/imports` message names the missing file, and the line it quotes shows the import.
- An edit's refusal or note lists only the findings on lines the edit wrote, by a line diff of the file before and after, so a written line counts even when the same text sits elsewhere in the file. The findings already in the file collapse into one line, such as "183 more warnings in this file were there before this edit. `rulebook palette.mjs` lists them." An edit that adds and removes more than 1,000 lines in all counts every line as written, so a rewrite of a large file answers in a fraction of a second.
- The count line says "in N files", in the terminal and in the Sidebar, because a run counts every file a rule covers.
- Each file is checked with the global config and the nearest `rulebook.config.ts` in its folder or a folder above it, the way ESLint 10 and oxlint find theirs, so a nested package holds its own config. Only that one project config applies to the file. A full run checks each file with its own nearest config.
- rulebook turns on no rule by itself. `rulebook/imports` runs only when a config extends `recommended`, so add `extends: [recommended]` to your global config to keep your Claude.md imports checked.
- A config's `paths`, and its rules' `paths`, are relative to the config's folder. The global config's paths, and those of a config outside the project, stay relative to the project root.
- `rulebook rules` lists the rules of each folder that holds a `rulebook.config.ts`, and the mod shows each file the rules of its nearest folder.
- A full run lints a file outside every linter config folder with the linter's own defaults, as an edit does, and lints each file only with the linters its own configs list.
- Every session's checks go to one `rulebook serve` on the computer, which keeps each project's configs, rules, and parsers loaded, so a write, a turn-end reply check, and a checked tool call each take a fraction of what a fresh `rulebook` process takes. A changed config or rule file applies to the next check, and so does a plugin folder or `extends` file a config names, once it appears or is fixed, so a config that failed on a missing or broken one answers again. A server that is down fails each check with an error toast.
- A write's Stylelint check runs Stylelint in process, with the same findings its command line gives. A Stylelint failure now reads as its message, with no stack trace.
- A later `rules` setting merges over an earlier one key by key, as ESLint merges its rule settings, and a level written as a string sets only `level`. A project's `'warning'` keeps the `runs` or `paths` the global config gave the rule.
- A script rule with a key rulebook does not read, such as a misspelled `levle`, fails to load and names the key.
- A rule that reads `text` of a Claude.md flags the same line as one that reads `lines`, because `text` keeps a blank line for each line Claude Code removes.
- A write through a symlinked folder, such as `~/.claude/rules`, is checked as a write to the file the link reaches.
- A probe skips each pin of a rule the run leaves out, such as a `runs: manual` rule's pin in an edit or a `--static` run. A pin that names no rule still fails.
- A config, rule, or `extends` file that does not parse fails and names the file.

### Added
- Messages: a rule covers the agent's final reply with `@reply`, and any message a mod checks by name, such as `@inbox/**` for each item the inbox checks with `rulebook text`, with no config naming the mod. A config's `messages` let rulebook find a message by itself: `tools` checks each matching tool call as `@<name>`, and `folder` makes a full run check each file under that folder as `@<name>/<path>`. A glob that starts with `@` matches only a message, so `**` never covers one.
- `rulebook text <@name>` checks the message on stdin and answers as `rulebook edit` does. A full run also checks each file in every message `folder`.
- `extends` in a config pulls in other configs: paths relative to the config, with `~` read as the home folder, and config objects from packages, such as `recommended` from `@cmodjs/rulebook`. The global config merges first, then each `extends` entry from left to right, then the config's own keys, and a later `rules` setting turns an inherited rule off or down. An `extends` path that names no file fails and names it. A Claude Code plugin's rules, and the tool calls and folders its `messages` name, apply only when a config extends its `rulebook.config.ts`.
- A finding without a `message` shows its rule's description.
- Agents read each rule's description before they can break it. A rule whose `paths` cover every file (`**`) or a message (a path that starts with `@`) reaches every agent as its session starts, after each compaction, and as each subagent starts. A rule for some files, and a rule with no `paths`, reaches an agent with its first read or write of a file it covers. Each agent reads each description once per context.
- `rulebook rules` prints each rule that is on, with its id, description, and the paths it covers, and each registered message with the tools that send it, as JSON.
- `rulebook serve` answers `edit`, `text`, and `rules` as `POST /edit`, `/text`, and `/rules` on a Unix socket, with the JSON the commands print, and prints `unix:<socket path>` first.
- The main agent's final reply is checked before its turn ends. An error keeps the agent from stopping once per turn, and it writes the whole reply again. A rewrite that still breaks a rule ends the turn, and its findings show as a warning toast. A subagent's answer is never checked.
- A tool call that a config's `messages` `tools` match, by any agent, is checked as that message before it runs, with the text of every field it sends. An error refuses the call.
- Pattern rules: a `.yml` rule matches files with an ast-grep rule, in TypeScript, TSX, JavaScript, HTML, CSS, PHP, Python, Bash, Lua, JSON, YAML, TOML, or Markdown, and flags each match at its first line.
- Linters: `linters: ['oxlint', 'biome']` in any config runs those linters on every write, on the text it will leave, before it lands, with the project's own config and baseline: Mago (`mago.toml`, lint and analyze), oxlint (`.oxlintrc.json`), Biome (`biome.json`, lint only), Stylelint (`stylelint.config.*` or `.stylelintrc*`), ruff (`ruff.toml` or `[tool.ruff]`), selene (`selene.toml`), and shellcheck on every shell script. A linter no config lists never runs, and the lists of every config add up. A listed linter with no config file of its own runs with its own defaults, so a linter the global config lists runs in every project.
- Every finding a linter reports joins the same answer as `<linter>/<rule>`: an error refuses the write, and everything else, such as Mago's notes and help and shellcheck's info and style, is a warning. An error on a line already in the file is a warning too. The config's `timeout` also bounds each linter run.
- rulebook brings its own oxlint 1.86.0, Biome 2.6.4, and Stylelint 17.15.0, built into the program, and runs the project's own copy in `node_modules` when it has one. Mago, ruff, selene, and shellcheck run from the project's copy or `PATH`, and a missing program lands the write with a note that names it.
- A full `rulebook` run runs each listed linter once over its project and lists its findings with the rest.
- `rulebook/no-suppressions` bans the comments that silence a linter's rule: `oxlint-disable` and its `eslint-disable` forms, `biome-ignore`, `@mago-expect` and `@mago-ignore`, ruff's `noqa`, `shellcheck disable=`, `stylelint-disable`, and `selene: allow(`. It is off until a config turns it on with `rules: { 'rulebook/no-suppressions': 'error' }`, and it checks every file with an extension a linter covers or with no extension. A suppression already in the file is an existing finding.

## [0.1.0]

### Added
- Every Edit, Write, and MultiEdit of a Prompt, by any agent or subagent, is checked before it runs. An error refuses the edit with the rule, the line, and the fix. A warning lets the edit land with a note.
- Static rules as TypeScript files, and agentic rules as Skills that run the way Claude Code runs any forked Skill, with their `agent`'s tools, model, and preloaded Skills.
- The `@cmodjs/plint` package, which gives a project the rule and config types and the `plint` command.
- `~/.config/plint/plint.config.ts` for rules that apply to every project, and a project's `plint.config.ts` for its own rules and levels.
- `metadata.runs: manual` keeps a slow rule off edits. `plint` in a terminal and `/plint` in a session run every rule.
- Probes with `plint-expect` pins prove each rule still flags what it should, and nothing else.
- The write-rule Skill, which teaches Claude to write a rule and its probe.
