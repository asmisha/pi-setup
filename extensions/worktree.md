# worktree

Pi extension for switching the active session into another git worktree without leaving Pi.

## What it does

Verified from `extensions/worktree.ts`:

- Registers `/wt` for interactive switching between existing worktrees
- Registers `/worktree` for switching to or creating a worktree from:
  - a branch name
  - a PR number
  - a GitHub PR URL
- Updates Pi's status bar with the active worktree branch and, when available, PR metadata
- Re-registers `find`, `grep`, and `ls` so relative paths resolve against the current `process.cwd()` after a worktree switch
- Patches agent system prompts so the working directory shown to the model matches the new worktree path

The file comment also notes that `bash`, `read`, `write`, and `edit` are expected to be handled by a separate global worktree extension, to avoid tool conflicts.

## Commands

### `/wt`
Opens an interactive selector listing known git worktrees.

Verified selector behavior:

- shows current and main worktrees distinctly
- loads PR metadata in the background when possible
- switches on Enter
- removes a non-main, non-current worktree with `d`
- supports `/wt --help`

### `/worktree`
Direct worktree command.

Verified forms from the built-in help text:

- `/worktree <branch>`
- `/worktree <pr-number>`
- `/worktree <pr-url>`
- `/worktree main`
- `/worktree archive`
- `/worktree --list`

Verified optional flags:

- `--shared`
- `--isolated`

These flags are only passed through when the extension creates a worktree with `alto worktree new`.

## How worktree creation works

Verified behavior:

- If a worktree already exists for the branch, the extension switches to it
- If a matching candidate directory already exists and belongs to the same repo/worktree setup, it reuses it
- Otherwise it creates a new worktree
- If `alto` is available, it runs:
  - `alto worktree new <branch> --print-path`
  - plus `--shared` or `--isolated` when provided
- If `alto` is not available, it falls back to `git worktree add`
- For PR-based creation without an existing branch, it fetches `pull/<pr>/head` and creates a branch from `FETCH_HEAD`

Candidate paths are derived from the main worktree directory and a branch-based directory name with `/` replaced by `-`.

## PR metadata and status bar

When `gh` can resolve a PR for the target branch, the extension tracks:

- PR number and URL
- PR state
- draft status
- review decision
- merge state status
- summarized check status: `passing`, `failing`, `pending`, or none

It refreshes metadata for the active worktree roughly once per minute.

## Optional `conductor.json` support

If the active worktree contains `conductor.json` with `scripts.setup` or `scripts.archive`, the extension uses those values:

- `scripts.setup` runs after switching into a worktree or the main worktree
- `scripts.archive` runs for `/worktree archive`

The extension reads these values only from `conductor.json` in the target worktree root.

## Practical use

Use this extension when you regularly hop between branch worktrees or PR worktrees and want Pi's path-sensitive tools and status bar to follow the active checkout.

## Limitations visible in this repo

- PR-specific features depend on the GitHub CLI (`gh`)
- worktree creation may optionally depend on `alto` if you want its creation flow
- this repo does not include broader installation or extension-loading instructions beyond the runtime behavior verified in source
