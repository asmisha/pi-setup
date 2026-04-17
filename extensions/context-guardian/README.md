# context-guardian

Pi extension that keeps durable task state outside normal LLM context and tightens context-management behavior for long sessions.

## What it does

Verified from `extensions/context-guardian/index.ts`:

- stores branch-local durable task state snapshots with `pi.appendEntry()` under the custom entry type `context-guardian-state`
- restores the latest durable task state from the current session branch on `session_start`
- bootstraps a minimal durable task state from the first prompt when no prior state exists
- injects a merged active checkpoint into the system prompt on `before_agent_start`, combining the latest compaction resume packet with durable task state instead of pasting either source verbatim
- triggers early compaction on `turn_end` when `ctx.getContextUsage().percent` crosses a soft threshold of 60%
- customizes `session_before_compact` to synthesize a structured resume packet from the whole current session context
- registers a `task_state` tool so the model can read, patch, or clear durable task state explicitly
- registers `/task-state` for human inspection/edit/clear operations
- registers `/handoff` to start a new session seeded from the current durable task state and a new phase goal

## Durable task-state shape

The extension normalizes and persists these fields:

- `originalObjective`
- `objective`
- `phase`
- `successCriteria`
- `constraints`
- `userPreferences`
- `done`
- `inProgress`
- `blocked`
- `nextAction`
- `relevantFiles`
- `artifacts`
- `openQuestions`
- `facts`
- `assumptions`

Snapshots are append-only custom entries, so they follow the active session branch instead of acting like one mutable global record.

## Placement

The implementation lives at:

- `extensions/context-guardian/index.ts`

This repo already uses `extensions/` for project Pi extensions, so no extra shim is needed here.

## Practical use

Use this extension when Pi starts losing the objective too early in long sessions and you want:

- a durable task-state object outside the normal conversation history for manual handoffs and explicit progress updates
- earlier compaction than Pi's default overflow behavior
- a structured resume packet derived from the whole current context, merged with durable task state into an active checkpoint instead of blindly treating either one as auto-resume ground truth
- deliberate phase changes through `/handoff` instead of relying on compaction alone
