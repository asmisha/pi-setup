# workflow-foundation

Pi extension that establishes a shared working baseline for agents in this repo.

## What it does

Verified from `extensions/workflow-foundation/index.ts`:

1. Appends an evidence-first instruction block to every agent system prompt via the `before_agent_start` hook.
2. Registers a `task_checkpoint` tool for saving, loading, listing, and clearing concise task checkpoints.

## Prompt behavior

The appended prompt text emphasizes:

- verify before writing
- progressive discovery
- minimal, scoped changes
- evidence-backed claims
- focused review priorities
- explicit uncertainty when something is not verified
- checkpoint use for long tasks

The prompt text is embedded directly in the extension source as `FOUNDATION_PROMPT`.

## `task_checkpoint` tool

The tool accepts these actions:

- `save`
- `load`
- `list`
- `clear`

Parameters verified in source:

- `action` - required
- `task` - optional for `save`, `load`, and `list`; required for `clear`
- `content` - required for `save`

## How checkpoint storage works

Verified behavior from the implementation:

- Storage lives under `~/.pi/agent/task-checkpoints/`
- Checkpoints are grouped by repository and branch
- Repository directories include a short slug and a SHA-1 hash of the repo root path
- The branch name is slugified and used as a subdirectory
- `_latest.json` tracks the most recently saved checkpoint for the current branch/workspace

The extension uses git to detect:

- repo root via `git rev-parse --show-toplevel`
- current branch via `git rev-parse --abbrev-ref HEAD`

If git metadata is unavailable, it falls back to the current working directory as the repo root.

## Practical use

Use this extension when you want Pi sessions to share the same evidence-first operating rules and to preserve short task checkpoints outside the conversation.

This repo documents the runtime behavior above. It does not include a separate checkpoint viewer or sync service.
