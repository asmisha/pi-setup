---
name: task-tracker
description: Use the repo `task_tracker` extension for long-lived, multi-step, or compaction-prone work where open tasks, blockers, evidence, and next actions must survive many turns or hours. Use when work needs durable continuity, not for one-shot or trivial tasks.
---

# Task Tracker

Use this skill when losing the current work graph would hurt after compaction.

`task_tracker` is the parent session's durable continuity layer. It is not a generic todo list, and it is not something delegated subagents should own.

## Use it when

- the task spans many turns, a long session, or multiple hours
- the work has real subtasks, checkpoints, blockers, or verification gates
- you expect compaction, pause/resume, or handoff risk
- the user wants visible progress or durable state

## Do not use it when

- the task is a one-shot factual answer
- the work can be finished safely before continuity matters
- you only have a fleeting note or hypothesis

## Core rules

- Treat `task_tracker` as the canonical ledger of durable work for the current objective.
- Create a small number of real subtasks early; do not recreate the root objective.
- Keep execution state current while you work, not retroactively at the end.
- Close tasks through evidence / acceptance, not vibes.
- **Parent session owns tracker state.** Subagents return evidence, file paths, and conclusions; the parent reconciles them into `task_tracker`.

## Parallel / async rules

- Parallelizable work should usually become **sibling subtasks**, not one giant serial task.
- `execution.activeTaskIds` may contain **multiple** task IDs when the work truly splits.
- Use `start_task` on each lane you actually begin.
- Use `set_next_action` with `activeTaskIds` to keep the visible active lane list honest.
- Same-checkout parallel subagents must be **read-only**.
- For concurrent writes, use isolated worktrees (`subagent` worktree mode or `worktree_create`).
- Async subagents need an explicit sync point: record the parent next action, poll `subagent_status`, then reconcile results back into the tracker.

## Required workflow

### 1. Create explicit subtasks early

Use `create_task` for:
- real deliverables
- distinct investigation or implementation lanes
- verification work that must not be forgotten
- follow-up work discovered during execution

Prefer 2-5 concrete subtasks over a noisy backlog.

### 2. Mark active work honestly

Before meaningful implementation, debugging, verification, or investigation, call `start_task` on the task you are actively starting.

For parallel work:
- start each real lane you actually begin
- then use `set_next_action(activeTaskIds: [...])` when you need to show the exact current active set

### 3. Keep `nextAction` current

Whenever the immediate next move becomes clear, call `set_next_action`.

Good `nextAction` values are short, concrete, and executable.

### 4. Reflect blockers and waiting states immediately

- Use `block_task` when a lane is blocked by a dependency, tool, or external system.
- Use `await_user` when a lane is waiting on the user.
- Do not leave a task `in_progress` when it is actually blocked or waiting.

### 5. Add evidence as it arrives

Use `add_evidence` for:
- tests run
- tool results
- changed files
- observed outputs
- explicit acceptance references

Evidence levels:
- `observed` = real signal, not enough to close safely
- `verified` = strong enough for the done gate
- `claimed` = only when you truly have no stronger signal

### 6. Use done as a two-step flow

Default pattern:
1. `propose_done`
2. add missing evidence or acceptance
3. `commit_done`

Remember:
- `done_candidate != done`
- short acknowledgements are not acceptance by default
- if child work is still open, the parent task is not done

### 7. Resume from the ledger

After a long pause, resume, or compaction-sensitive moment:
- `list_open`
- inspect active tasks and `nextAction`
- continue from tracked state, not from narrative memory

## Action map

- new durable subtask -> `create_task`
- begin working on it -> `start_task`
- active lane list / immediate next move changed -> `set_next_action`
- relevant file discovered -> `link_file`
- durable context learned -> `note`
- proof obtained -> `add_evidence`
- blocked by dependency / tool / external system -> `block_task`
- waiting on user -> `await_user`
- user explicitly accepts -> `record_acceptance`
- looks complete but gate not closed -> `propose_done`
- evidence / acceptance closes the gate -> `commit_done`

## Anti-patterns

Avoid:
- using `task_tracker` for trivial one-turn work
- creating endless inferred subtasks instead of doing the work
- serializing obviously parallel lanes into one vague task
- letting subagents invent their own durable tracker state
- leaving tasks `in_progress` while actually blocked or waiting
- trying to close work without evidence or explicit acceptance

## Good patterns

### Small long-running task

```json
{"action":"create_task","title":"Trace stale goal line in task widget","kind":"verification"}
{"action":"create_task","title":"Implement ask/objective fix for always-on UI","kind":"followup"}
{"action":"start_task","taskId":"task_123"}
{"action":"set_next_action","nextAction":"Inspect widget state derivation and confirm which field feeds the header.","activeTaskIds":["task_123"]}
```

### Parallel investigation

```json
{"action":"create_task","title":"Audit task-tracker execution semantics","kind":"verification"}
{"action":"create_task","title":"Audit subagent orchestration guidance","kind":"verification"}
{"action":"start_task","taskId":"task_exec"}
{"action":"start_task","taskId":"task_guidance"}
{"action":"set_next_action","nextAction":"Fan out read-only subagents for both audits, then reconcile findings in the parent session.","activeTaskIds":["task_exec","task_guidance"]}
```

### Async delegation sync point

```json
{"action":"set_next_action","nextAction":"Poll async subagent run 6634... with subagent_status, then attach evidence and update active tasks.","activeTaskIds":["task_exec"]}
```

### Safe closure

```json
{"action":"add_evidence","taskId":"task_123","evidence":{"kind":"test","ref":"npm test","summary":"Widget tests pass after fix.","level":"verified"}}
{"action":"propose_done","taskId":"task_123","note":"Fix implemented and verified by tests."}
{"action":"commit_done","taskId":"task_123","reason":"verified_evidence"}
```

## Final rule

If you would be annoyed to lose the current subtask graph after compaction, put it in `task_tracker` now.
