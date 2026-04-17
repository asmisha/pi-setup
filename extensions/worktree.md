# worktree

Pi extension for switching the active session into another git worktree without leaving Pi, exposing worktree creation to agents, and handing worktree switches off into new Herdr tabs when Pi is running inside Herdr.

## What it does

Verified from `extensions/worktree.ts`:

- Registers `/wt` for interactive switching between existing worktrees
- Registers `/worktree` for switching to or creating a worktree from:
  - a branch name
  - a PR number
  - a GitHub PR URL
- Registers `worktree_create` so agents can create or reuse a worktree from:
  - a branch name
  - a PR number
  - a GitHub PR URL
- Updates Pi's status bar with the active worktree branch and, when available, PR metadata
- when `HERDR_ENV=1` and `herdr` is available, opens a new Herdr tab rooted at the target worktree, launches a fresh `pi` process there, and starts it from a forked session when the current session is persisted
- Rewrites relative `path` arguments for built-in `find`, `grep`, and `ls` calls so they resolve against the current `process.cwd()` after a worktree switch
- Patches agent system prompts so the working directory shown to the model matches the new worktree path

The file comment also notes that `bash`, `read`, `write`, and `edit` are expected to be handled by a separate global worktree extension, to avoid tool conflicts.

## Commands and tools

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

### `worktree_create`
LLM-callable tool for agents.

Verified parameters from `extensions/worktree.ts`:

- `target` — branch name, PR number, or GitHub PR URL
- `targetKind` — optional; defaults to `auto`, or use `branch` to force the target to be treated as a branch name instead of PR input or the `main` alias
- `switchTo` — optional; defaults to `false`; normally switches the current Pi session into the resolved worktree/main checkout, but inside Herdr it opens a new tab and launches a fresh Pi process there instead

Verified behavior:

- reuses an existing worktree when one already exists for the branch
- reuses the candidate worktree directory when it is already a valid worktree for the same repo and branch
- creates a new worktree when needed
- returns the resolved `worktreePath` to the agent
- leaves the current Pi session where it is by default
- switches the current Pi session and cwd when `switchTo: true`
- inside Herdr, `switchTo: true` hands work off to a new Herdr tab and fresh Pi process instead of calling `process.chdir()` in the current process
- accepts `target: "main"` as an alias for the current main-worktree branch and returns or switches to the main worktree path

## How worktree creation works

Verified behavior:

- If a worktree already exists for the branch, the extension reuses it
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

- `scripts.setup` runs after a local cwd/state update but before the switch call returns; inside Herdr it runs in the new tab before the handed-off Pi session starts
- `scripts.archive` runs for `/worktree archive`

The extension reads these values only from `conductor.json` in the target worktree root.

## Practical use

Use this extension when you regularly hop between branch worktrees or PR worktrees and want Pi's built-in path-sensitive tools and status bar to follow the active checkout. Inside Herdr, it also keeps the actual Pi process in the target worktree by handing the job off into a new tab instead of keeping the original process in the old cwd.

## Limitations visible in this repo

- PR-specific features depend on the GitHub CLI (`gh`)
- Herdr handoff depends on `HERDR_ENV=1` plus the `herdr` CLI being available in `PATH`
- worktree creation may optionally depend on `alto` if you want its creation flow
- if the current Pi session cannot be forked (for example because it is ephemeral or its session file is unavailable), the Herdr handoff starts a fresh Pi session without forked history
- this repo does not include broader installation or extension-loading instructions beyond the runtime behavior verified in source
