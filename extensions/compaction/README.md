# compaction

A small Pi extension that does exactly two things by default:

- triggers compaction once context usage crosses **65%**
- auto-prefers an installed `pi-vcc` package for compaction hooks; otherwise it overrides Pi's generic compaction prompt with a repo-local structured advisory prompt

It also supports a **session-scoped compaction mode** switch so you can force the local implementation, an installed `pi-vcc` package (for example the published `@sting8k/pi-vcc` package), or a hosted `pi-lcm` integration.

It does **not** own task tracking, UI widgets, or durable task state. In this repo, `extensions/task-tracker/` owns the durable ledger; this extension only changes how discarded conversation is summarized.

## Safety

This extension is always on when loaded.

## What it changes

In `local` mode:

- `turn_end` watches context usage and requests compaction after crossing 65%
- `session_before_compact` replaces Pi's default prompt with a repo-local structured advisory prompt
- compaction still summarizes only the discarded span Pi is removing, including split-turn discarded prefixes when present
- the compaction summary is non-canonical; durable task state stays in `task_tracker`

In `pi-vcc` mode:

- the extension resolves a real installed package from the current session cwd, project Pi npm dir, `NODE_PATH`, or global npm root (`pi-vcc` alias or `@sting8k/pi-vcc`)
- it still uses the same 65% threshold before invoking `pi-vcc`
- when the package exposes only a `session_before_compact` hook, the extension triggers compaction with the package's compaction instruction
- if `pi-vcc` cannot be loaded after being explicitly selected, the extension warns once and **fails open**; it does not fall back to the local implementation

In `pi-lcm` mode:

- the extension hosts a discoverable `pi-lcm` package itself, so LCM can still register tools/commands and subscribe to `message_end`
- LCM's `session_before_compact` hook is gated: it only owns compaction while the session mode is explicitly `pi-lcm`
- the compaction tool keeps the same 65% threshold and triggers `ctx.compact()` without local/VCC instructions
- this avoids the unsafe ordering problem where a separately loaded package-level `pi-lcm` extension could override VCC/local compaction after this project extension runs
- if `pi-lcm` cannot be hosted after being explicitly selected, the extension warns once and **fails open**; it does not fall back to the local implementation

## Session-scoped mode switching

Use the slash command below inside Pi:

```text
/compaction-mode
/compaction-mode local
/compaction-mode pi-vcc
/compaction-mode pi-lcm   # alias: lcm
```

- by default, sessions auto-use `pi-vcc` when a compatible package is installed; otherwise they stay in `local`
- `local` forces the existing repo implementation for the current session
- `pi-vcc` can only be selected when a compatible package is currently installed for the session cwd/project/global npm roots
- `pi-lcm` can only be selected when this extension successfully hosted `pi-lcm` at extension startup; install/fix the package, then `/reload`
- if a session already has `pi-vcc` or `pi-lcm` selected and the package later becomes unavailable, compaction fails open and does not route through the local implementation
- calling `/compaction-mode` with no argument shows the current effective mode and whether `pi-vcc` and `pi-lcm` are available

Recommended LCM setup for this router: make the `pi-lcm` package discoverable to Node (for example global npm install or project `.pi/npm`) and let this compaction extension host it. Do not also load `npm:pi-lcm` as a separate Pi package in the same session unless the package itself supports router coordination, because package extensions run after project extensions and may otherwise override VCC/local compaction.

## Local setup

Inside this repo, the checked-in `.pi/settings.json` already loads the repo `extensions/` directory, so this extension is auto-discovered.

For another local Pi setup, load this extension by either:

- placing `compaction/` under `~/.pi/agent/extensions/`
- adding the absolute path to this directory under `"extensions"` in your Pi `settings.json`
- launching Pi with `--extension /absolute/path/to/compaction/index.ts`

Then run `/reload` or restart Pi.

## Structure

- `index.ts` — hook wiring for early compaction, mode routing, and prompt override
- `src/config.ts` — threshold and timing configuration
- `src/compaction.ts` — advisory prompt, JSON parsing, normalization, and summary rendering
- `src/turn-end-policy.ts` — threshold and turn-end action policy
- `src/pi-vcc.ts` — VCC delegate loading/routing
- `src/pi-lcm.ts` — hosted LCM integration that gates only the compaction hook
- `test/*.test.ts` — focused prompt/config/routing tests

## Tests

Run from this directory:

```bash
npm test
```
