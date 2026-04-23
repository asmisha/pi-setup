# compaction

A small Pi extension that does exactly two things by default:

- triggers compaction once context usage crosses **65%**
- auto-prefers an installed `pi-vcc` package for compaction hooks; otherwise it overrides Pi's generic compaction prompt with a repo-local structured advisory prompt

It also supports a **session-scoped compaction mode** switch so you can force the local implementation or an installed `pi-vcc` package (for example the published `@sting8k/pi-vcc` package).

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

- the extension resolves a real installed package from the current session cwd (`pi-vcc` alias or `@sting8k/pi-vcc`)
- it still uses the same 65% threshold before invoking `pi-vcc`
- when the package exposes only a `session_before_compact` hook, the extension triggers compaction with the package's compaction instruction
- if `pi-vcc` cannot be loaded after being explicitly selected, the extension warns once and **fails open**; it does not fall back to the local implementation

## Session-scoped mode switching

Use the slash command below inside Pi:

```text
/compaction-mode
/compaction-mode local
/compaction-mode pi-vcc
```

- by default, sessions auto-use `pi-vcc` when a compatible package is installed; otherwise they stay in `local`
- `local` forces the existing repo implementation for the current session
- `pi-vcc` can only be selected when a compatible package is currently installed for the session cwd
- if a session already has `pi-vcc` selected and the package later becomes unavailable, compaction fails open and does not route through the local implementation
- calling `/compaction-mode` with no argument shows the current effective mode and whether `pi-vcc` is available

## Local setup

Inside this repo, the checked-in `.pi/settings.json` already loads the repo `extensions/` directory, so this extension is auto-discovered.

For another local Pi setup, load this extension by either:

- placing `compaction/` under `~/.pi/agent/extensions/`
- adding the absolute path to this directory under `"extensions"` in your Pi `settings.json`
- launching Pi with `--extension /absolute/path/to/compaction/index.ts`

Then run `/reload` or restart Pi.

## Structure

- `index.ts` — hook wiring for early compaction and prompt override
- `src/config.ts` — threshold and timing configuration
- `src/compaction.ts` — advisory prompt, JSON parsing, normalization, and summary rendering
- `src/turn-end-policy.ts` — threshold and turn-end action policy
- `test/*.test.ts` — focused prompt/config tests

## Tests

Run from this directory:

```bash
npm test
```
