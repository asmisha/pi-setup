# compaction

A small Pi extension that does exactly two things:

- overrides Pi's generic compaction prompt with a repo-local structured advisory prompt
- triggers compaction once context usage crosses **65%**

It does **not** own task tracking, UI widgets, or durable task state. In this repo, `extensions/task-tracker/` owns the durable ledger; this extension only changes how discarded conversation is summarized.

## Safety

This extension is always on when loaded.

## What it changes

- `turn_end` watches context usage and requests compaction after crossing 65%
- `session_before_compact` replaces Pi's default prompt with a repo-local structured advisory prompt
- compaction still summarizes only the discarded span Pi is removing, including split-turn discarded prefixes when present
- the compaction summary is non-canonical; durable task state stays in `task_tracker`

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
- `test/*.test.ts` — focused prompt/config tests

## Tests

Run from this directory:

```bash
npm test
```
