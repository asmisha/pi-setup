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
- `APPEND_SYSTEM.md` - extra system-level guidance appended to prompts
- `AGENTS.md` - project instructions for agents working in this repo

## Extensions

### `extensions/superset-lifecycle/`
Sends lightweight lifecycle hooks for Pi activity to a local Superset listener. It detects Superset-related environment variables, emits `Start` and `Stop` events around agent activity, and skips subagent and `--no-session` runs.

See `extensions/superset-lifecycle/README.md`.

### `extensions/workflow-foundation/`
Adds a shared evidence-first instruction block to agent system prompts and registers the `task_checkpoint` tool for saving and restoring concise task checkpoints by repo and branch.

See `extensions/workflow-foundation/README.md`.

### `extensions/worktree.ts`
Adds worktree-aware Pi commands and path-sensitive tool wrappers so a session can switch into another git worktree and keep using Pi against the new working directory.

See `extensions/worktree.md`.

## Other notable files

### `themes/superset-light-contrast.json`
A light, higher-contrast Pi theme named `superset-light-contrast`.

### `prompts/pr-ready.md`
A prompt template for moving the current PR out of draft and requesting review from recent contributors, using `scripts/select-pr-reviewers.sh` as the source of truth.

### `scripts/select-pr-reviewers.sh`
A shell script that inspects the current PR with `gh`, ranks recent contributors for changed files, filters out unsuitable reviewers, and prints tab-separated results.

## Scope note

This repo contains configuration, extensions, prompts, and workflow helpers. It does **not** currently document a build, packaging, or installation flow in the checked-in files verified for this rewrite.
