---
name: task-tracker
description: Use Context Guardian v2 `task_tracker` for long-lived, multi-step, or compaction-prone work where open tasks, blockers, evidence, and next actions must survive many turns or hours. Use when work needs durable continuity, not for one-shot or trivial tasks.
---

# Task Tracker

Use this skill when the session is likely to outlive the model's short-term working memory.

`task_tracker` is not a generic todo list. It is the durable continuity layer for long-running work in Context Guardian v2.

## When to use this skill

Load this skill when one or more of these are true:

- the task will likely span many turns, a long session, or multiple hours
- the work decomposes into several real deliverables or checkpoints
- you expect blockers, waiting states, or handoffs
- the user asked for progress tracking or wants the current todo state to stay visible
- the session is likely to hit compaction and you still need reliable continuity afterward
- completion will depend on evidence, verification, or explicit acceptance rather than a single quick reply

## When not to use this skill

Do **not** reach for `task_tracker` when:

- the task is a one-shot factual answer
- the work is a tiny single-step action with no real branching or follow-up
- a task can be completed safely before durable tracking would add value
- you only have a passing thought, note, or hypothesis that does not deserve its own task

For short tasks, answer directly and keep moving.

## Core principle

Treat `task_tracker` as the canonical ledger of open work for the current long-running objective.

That means:

- important open work should exist there before it is easy to forget
- blockers and waiting states should be reflected there when they change execution
- completion should flow through evidence / acceptance, not vibes
- task state should be updated as the work changes, not retroactively at the very end

## Decision rule

If losing the current subtask list would noticeably hurt the session after compaction, pause and update `task_tracker` now.

## Required workflow

### 1. Create explicit subtasks early

Do this once the work is clearly multi-step.

Use `create_task` for:
- real deliverables
- distinct investigation threads
- verification work that must not be forgotten
- follow-up work discovered during execution

Do **not** recreate the root objective as another task.
Create subtasks beneath the existing durable objective instead of cloning it.

Do **not** create a new task for every tiny thought.
If something is just context, use `note` instead.

Prefer a small number of concrete subtasks over a noisy backlog.

### 2. Mark the active task before doing the work

Before meaningful implementation, debugging, verification, or investigation, call `start_task` on the task you are actually working on.

This keeps the visible state honest and makes resuming after compaction much easier.

### 3. Keep execution state fresh

Whenever the next step becomes clear, use `set_next_action`.

Use it to record:
- the immediate next move
- which task is currently active
- what should happen after resume or compaction

A good `nextAction` is short, concrete, and executable.

### 4. Record blockers and waiting states immediately

If progress stops because of a dependency, use `block_task`.
If progress stops because you need the user, use `await_user`.

Examples:
- missing credentials
- flaky infra dependency
- waiting for a user choice
- waiting for an external system or review

Do not leave a task as `in_progress` when it is actually blocked or waiting.

### 5. Add evidence as work completes

When you obtain proof, attach it with `add_evidence`.

Use evidence for:
- tests run
- tool results
- changed files
- observed outputs
- explicit acceptance references

Evidence level guidance:
- `observed` = you saw a real signal, but it is not yet enough to close the task safely
- `verified` = strong enough to support the done gate for this task
- `claimed` = avoid unless you truly only have an assertion and no stronger signal

Be conservative with `verified`.

### 6. Use done as a two-step flow

Default pattern:
1. `propose_done`
2. add missing evidence or record acceptance if needed
3. `commit_done`

Do **not** jump straight from “looks done” to closure.

Remember:
- `done_candidate != done`
- short acknowledgements like “ok”, “thanks”, “понял” are not acceptance by default
- if the task still has unresolved child work, it is not done

### 7. Resume from the ledger, not from memory

After a long pause, resume, branch switch, or compaction-sensitive moment:
- call `list_open`
- inspect the visible widget / footer state
- continue from tracked tasks and `nextAction`

Do not rely on your own narrative memory if the ledger already has the state.

## Action map

Use this action when the session state changes:

- new durable subtask appears -> `create_task`
- you begin working on it -> `start_task`
- you found a file that matters -> `link_file`
- you learned something important but it is not a new task -> `note`
- you have proof -> `add_evidence`
- you are blocked by dependency / tool / external system -> `block_task`
- you need user input -> `await_user`
- the user explicitly accepts the result -> `record_acceptance`
- you believe the task is complete but gate is not closed yet -> `propose_done`
- evidence or acceptance now closes the gate -> `commit_done`
- the immediate next move changed -> `set_next_action`

## Anti-patterns

Avoid these mistakes:

- using `task_tracker` for every trivial one-turn task
- creating inferred subtasks endlessly instead of doing the work
- leaving a task `in_progress` while actually waiting or blocked
- forgetting to add evidence before trying to close work
- treating user chatter or polite acknowledgements as completion
- rewriting scope or objective through task titles
- storing everything as tasks when some items should just be notes or evidence
- waiting until the very end of a long session to reconstruct task state from memory

## Minimal good pattern

For a real long-running task, the usual shape is:

1. create 2-5 concrete subtasks
2. start one subtask
3. set the next action
4. add notes / files / evidence as you go
5. block or await_user when reality changes
6. propose_done then commit_done only when the gate is truly satisfied

## Examples

### Start a long-running workstream

```json
{"action":"create_task","title":"Trace stale goal line in CG2 widget","kind":"verification"}
{"action":"create_task","title":"Implement ask/objective fix for always-on UI","kind":"followup"}
{"action":"start_task","taskId":"task_123"}
{"action":"set_next_action","nextAction":"Inspect widget state derivation and confirm which field feeds the header.","activeTaskIds":["task_123"]}
```

### Record a blocker

```json
{"action":"block_task","taskId":"task_123","reason":"Need the production screenshot or exact reproduction context to confirm the stale-goal path."}
```

### Record evidence and close safely

```json
{"action":"add_evidence","taskId":"task_123","evidence":{"kind":"test","ref":"npm test","summary":"Widget tests pass after ask/objective fix.","level":"verified"}}
{"action":"propose_done","taskId":"task_123","note":"Fix implemented and verified by tests."}
{"action":"commit_done","taskId":"task_123","reason":"verified_evidence"}
```

### Close through explicit user acceptance

```json
{"action":"record_acceptance","taskId":"task_123","note":"User confirmed the fix matches the expected behavior."}
{"action":"commit_done","taskId":"task_123","reason":"user_acceptance"}
```

## Final rule

If the session is long enough that you would be annoyed to lose the current plan after compaction, the plan belongs in `task_tracker` already.
