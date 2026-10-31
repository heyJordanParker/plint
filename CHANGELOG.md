# Changelog

What changed in each version of plint, for the people who use it. cmod publish releases the section for the version, and Settings shows it.

## [Unreleased]

## [0.1.0]

### Added
- Every Edit, Write, and MultiEdit of a Prompt, by any agent or subagent, is checked before it runs. An error refuses the edit with the rule, the line, and the fix. A warning lets the edit land with a note.
- Static rules as TypeScript files, and agentic rules as Skills that run the way Claude Code runs any forked Skill, with their `agent`'s tools, model, and preloaded Skills.
- The `@cmodjs/plint` package, which gives a project the rule and config types and the `plint` command.
- `~/.config/plint/plint.config.ts` for rules that apply to every project, and a project's `plint.config.ts` for its own rules and levels.
- `metadata.runs: manual` keeps a slow rule off edits. `plint` in a terminal and `/plint` in a session run every rule.
- Probes with `plint-expect` pins prove each rule still flags what it should, and nothing else.
- The write-rule Skill, which teaches Claude to write a rule and its probe.
