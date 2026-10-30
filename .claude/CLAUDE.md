# plint

plint lints Claude Code Prompts. The `plint` program checks a Prompt against static and agentic rules, and the plint mod runs it before every Edit, Write, and MultiEdit, so an error refuses the edit.

- `node_modules/@cmodjs/core/docs/` holds the docs of the installed `@cmodjs/core`. They match this version, and training data does not. Read the doc for the part you change, starting at `index.md`, before Claude Mod Manager (cmod) work.
- The repository root is the mod: `src/mod.tsx` holds its `defineMod`, `hooks/register.ts` only registers it, and `src/pages/results.tsx` is the Sidebar page `/plint` opens.
- The mod is a pass-through: each check runs `plint edit` or `plint --json` and relays what it prints. Every lint behavior lives in `cli/src/`, never in `src/`.
- `cli/` is the `plint` program, in Bun. `package.json` `cmod.program` names it, so cmod builds it with `cli/package.json`'s `build` script and puts it on `PATH`.
- `cli/src/api.ts` is the Public API rule and config files import as `@cmodjs/plint`. `cli/src/modules.ts` serves it to them at runtime, because a rule folder such as `~/.config/plint/rules/` has no `node_modules`.
- An agentic rule runs as `claude -p` with the hooks of that session off, so it neither runs the plint mod again nor the person's hooks.
- `.claude-plugin/plugin.json` and `cli/package.json` carry the same version.
- `tsc` reads `.claude-plugin/types/`, which Claude Code writes when it loads the mod. `cmod check` writes it when it is missing, so run `cmod check` before `tsc` in a fresh clone.
- `bun test` in the root runs the mod's tests in `tests/` and the program's in `cli/tests/`. `bun run check` in `cli/` type-checks the program.
- `cmod link` loads this checkout in every Claude Code session and builds `plint` into cmod's programs folder. `cmod check` checks the mod and names the fix for each failure.
