# context-guardian-v2

A separate, opt-in rewrite of `context-guardian` built around:

- append-only ledger events
- deterministic projector
- explicit authority model
- evidence / acceptance gated completion
- advisory-only compaction
- persistent footer status + todo widget derived from the ledger
- TDD-friendly pure core modules

## Safety

This extension is intentionally **disabled by default** so it can live next to the current `context-guardian` without both hook sets fighting each other.

Enable it explicitly:

```bash
export PI_CONTEXT_GUARDIAN_V2_ENABLED=1
```

## Structure

- `index.ts` — Pi hook wiring, tool registration, commands, compaction integration
- `src/types.ts` — canonical domain model
- `src/actions.ts` — task tracker action -> ledger event logic
- `src/projector.ts` — deterministic replay + invariants
- `src/prompt.ts` — Active Work Packet rendering
- `src/compaction.ts` — advisory compaction prompt/parse/render
- `src/bootstrap.ts` — contract/root-task bootstrap helpers
- `src/widget.ts` — footer status + todo widget rendering from projected state
- `src/branch-store.ts` — load/store ledger events from Pi custom entries
- `src/migration.ts` — legacy v1 migration helpers
- `src/debug.ts` — explain / debug rendering helpers
- `test/*.test.ts` — invariant-focused tests

## Commands

- `/cg2-state`
- `/cg2-ledger [limit]`
- `/cg2-why-open <taskId>`
- `/cg2-why-done <taskId>`
- `/cg2-contract`
- `/cg2-handoff <goal>`

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
