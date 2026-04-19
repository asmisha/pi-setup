# pi-config

Personal Pi configuration and support files.

## What is in this repo

Verified top-level contents:

- `extensions/` - Pi extensions that add workflow behavior
- `agents/` - custom agent definitions in Markdown
- `skills/` - custom skills and reference material
- `prompts/` - reusable prompt templates
- `themes/` - Pi theme files
- `scripts/` - small workflow scripts
- `APPEND_SYSTEM.md` - extra system-level guidance appended to prompts, including the repo's evidence-first baseline
- `AGENTS.md` - project instructions for agents working in this repo

## Extensions

### `extensions/superset-lifecycle/`
Sends lightweight lifecycle hooks for Pi activity to a local Superset listener. It detects Superset-related environment variables, emits `Start` and `Stop` events around agent activity, and skips subagent and `--no-session` runs.

See `extensions/superset-lifecycle/README.md`.

### `extensions/worktree.ts`
Adds worktree-aware Pi commands and path-sensitive built-in tool handling so a session can switch into another git worktree and keep using Pi against the new working directory.

See `extensions/worktree.md`.

### `extensions/bash-output-guard/`
Caps `bash` tool result text before it enters session context, so shell-heavy investigations do not balloon the conversation as easily.

See `extensions/bash-output-guard/README.md`.

### `extensions/task-tracker/`
The current durable task-tracking rewrite. It owns the event-sourced `task_tracker`, the parent-owned Active Work Packet, and the task widget/debug commands. Durable tracker state stays parent-owned across compaction.

See `extensions/task-tracker/README.md`.

### `extensions/compaction/`
A small compaction-only extension. It replaces Pi's generic compaction prompt with a repo-local structured advisory prompt and triggers compaction after context usage crosses 65%.

See `extensions/compaction/README.md`.

## Other notable files

### `themes/superset-light-contrast.json`
A light, higher-contrast Pi theme named `superset-light-contrast`.

### `prompts/pr-ready.md`
A prompt template for moving the current PR out of draft and requesting review from recent contributors, using `scripts/select-pr-reviewers.sh` as the source of truth.

### `scripts/select-pr-reviewers.sh`
A shell script that inspects the current PR with `gh`, ranks recent contributors for changed files, filters out unsuitable reviewers, and prints tab-separated results.

## Shared Pi project settings

This repo now includes `.pi/settings.json` to sync the repo-scoped Pi setup between machines.

Verified from Pi's package docs and the checked-in settings file:

- project-local `packages` are auto-installed by Pi on startup if missing
- the tracked package list currently includes:
  - `npm:pi-subagents`
  - `git:github.com/jo-inc/pi-mem`
  - `https://github.com/SamuelLHuber/pi-fff`
  - `npm:pi-executor`
  - `npm:@robhowley/pi-structured-return`
- the repo-local `extensions/` and `skills/` directories are wired through relative paths in `.pi/settings.json`
- Pi auto-loads the repo `task-tracker` and `compaction` extensions from `extensions/`
- project installs land under `.pi/npm/` and `.pi/git/`, which are intentionally gitignored

This keeps the extension/package list in the repo so a new machine can pick it up without redoing the package install list by hand.

## Local Pi wiring for task tracking and compaction

This repo does **not** rely on a standalone Pi setting like `compaction.prompt = ...` because Pi exposes compaction customization through the `session_before_compact` extension hook instead.

If you use this repo's checked-in `.pi/settings.json`, the wiring is already in place:

1. Pi loads the repo `extensions/` directory.
2. `extensions/task-tracker/index.ts` stays active for durable task state.
3. `extensions/compaction/index.ts` stays active for the custom compaction prompt and the 65% threshold.

If you want the same behavior in another local Pi setup, wire it one of these ways:

- **Auto-discovery:** place `extensions/task-tracker/` and `extensions/compaction/` under `~/.pi/agent/extensions/`
- **settings.json:** add the absolute paths to those directories under `"extensions"`
- **quick test:** run Pi with `--extension /absolute/path/to/extensions/task-tracker/index.ts --extension /absolute/path/to/extensions/compaction/index.ts`

After changing extension wiring, run `/reload` (or restart Pi).

Reference material:
- durable tracker wiring: `extensions/task-tracker/index.ts`
- task-tracker prompt rendering: `extensions/task-tracker/src/prompt.ts`
- compaction prompt/runtime override: `extensions/compaction/src/compaction.ts`
- compaction hook wiring: `extensions/compaction/index.ts`

## Scope note

This repo contains configuration, extensions, prompts, and workflow helpers. It does **not** currently document a build, packaging, or installation flow in the checked-in files verified for this rewrite.
