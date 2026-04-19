# task-tracker

The current durable task-tracking rewrite for this repo.

It is built around:

- append-only ledger events
- deterministic projection
- explicit authority model
- evidence / acceptance gated completion
- persistent footer status + todo widget derived from the ledger
- parent-owned durable tracking for parallel subagent orchestration
- TDD-friendly pure core modules

This extension owns **task tracking only**. Compaction lives separately in `extensions/compaction/`.

## Safety

This extension is always on when loaded.

Subagent processes still skip the durable tracker, UI, and bootstrap parts so delegated runs do not create child-local ledgers or compete with the parent session's canonical state.

## What it owns

- immutable contract bootstrap and explicit-ask capture
- the `task_tracker` tool
- ledger persistence and projection
- the Active Work Packet injected on `before_agent_start`
- widget / debug / handoff commands
- parent-owned coordination for parallel and async subagent work

It does **not** override Pi compaction anymore.

## Local setup

Inside this repo, the checked-in `.pi/settings.json` already loads the repo `extensions/` directory.

For another local Pi setup, load this extension by either:

- placing `task-tracker/` under `~/.pi/agent/extensions/`
- adding the absolute path to this directory under `"extensions"` in your Pi `settings.json`
- launching Pi with `--extension /absolute/path/to/task-tracker/index.ts`

Then run `/reload` or restart Pi.

## Structure

- `index.ts` — Pi hook wiring, tool registration, commands, widget updates
- `src/types.ts` — canonical domain model
- `src/actions.ts` — task tracker action -> ledger event logic
- `src/projector.ts` — deterministic replay + invariants
- `src/prompt.ts` — Active Work Packet rendering
- `src/bootstrap.ts` — contract/root-task bootstrap helpers
- `src/widget.ts` — footer status + todo widget rendering from projected state
- `src/branch-store.ts` — load/store ledger events from Pi custom entries
- `src/migration.ts` — legacy v1 migration helpers
- `src/debug.ts` — explain / debug rendering helpers
- `test/*.test.ts` — invariant-focused tests

## Commands

- `/task-state`
- `/task-clear [reason]`
- `/task-ledger [limit]`
- `/task-why-open <taskId>`
- `/task-why-done <taskId>`
- `/handoff <goal>`

## Tool

- `task_tracker`

## Tests

Run from this directory:

```bash
npm test
```

Current tests cover:

- bootstrap of immutable contract + root task
- contract proposals staying advisory
- `done_candidate -> done` evidence gate
- acceptance gate
- weak acknowledgement not auto-closing work
- inferred-task cap
- duplicate task dedupe
- execution-state invariants
- prompt priority / archival exclusion
- advisory not mutating canonical open work
