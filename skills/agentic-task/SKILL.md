---
name: agentic-task
description: Orchestrate ambiguous or multi-step tasks with a small number of focused subagents, bounded parallel fan-out, and parent-owned synthesis.
---

# Agentic Task

Use this skill when the work is broad enough that focused delegation will beat a few direct tool calls.

## Fast path

Do **not** orchestrate when the task is answerable directly in 1-3 tool calls.

Use subagents when you need one or more of:
- surface discovery across multiple files or systems
- independent specialist passes
- compare/contrast or conflict-checking
- long-running independent checks that can run in the background

## Current-stack defaults

- Prefer **one bounded parallel fan-out** over iterative serial delegation.
- Use **2-4 focused subagents** by default.
- Run **one scout first only if the surface is unclear**. If the lanes are already obvious, skip the scout.
- Same-checkout parallel subagents must stay **read-only**.
- For concurrent writes, use isolated worktrees (`subagent` worktree mode or `worktree_create`).
- Use **async subagents** only for independent work that does not need immediate synthesis.
- The **parent session** owns `task_tracker`, durable state, sync-point tracking, and the final answer.

## Current-stack agent menu

- `scout` — fast evidence-first recon
- `planner` — smallest viable plan from verified context
- `delegate` — focused analysis with minimal inherited assumptions
- `worker` — implementation or deep repo investigation
- review specialists — when the task is actually review (`reviewer`, `correctness-reviewer`, `security-reviewer`, `performance-reviewer`, `simplicity-reviewer`, `spec-reviewer`)
- `researcher` — only for web/external research

## Parent workflow

1. **Lock the deliverable**
   - Decide whether you are producing an answer, analysis, recommendation, plan, or implementation result.

2. **Split the work cleanly**
   - Define lanes by subsystem, question, or specialty.
   - Keep scopes non-overlapping when possible.

3. **Track parallel lanes when continuity matters**
   - If the work is long-lived or compaction-prone, create sibling tasks and keep `activeTaskIds` honest.
   - Record explicit sync points for async runs.

4. **Launch one bounded batch**
   - Prefer a single `PARALLEL` call when lanes are independent.
   - Do not make later lanes wait on earlier ones unless there is a real dependency.

5. **Synthesize in the parent**
   - Merge evidence, resolve disagreements explicitly, and produce the final recommendation.
   - Do not just relay subagent output.

## Brief template for each subagent

Give each subagent:
- one-sentence goal
- exact files / paths / IDs / cwd it owns
- boundaries and stop condition
- required output shape
- explicit evidence + uncertainty requirements

Pass artifacts and questions, not your preferred conclusion.

## Good patterns

### Clear repo split
- 2-4 parallel `delegate` / `worker` lanes
- each lane owns one subsystem or question
- parent reconciles results once

### Unclear surface
- one `scout` pass
- optional parent read/search on the scout's best starting point
- then one focused parallel batch

### Async background lane
- launch one independent subagent with `async: true`
- keep working in the parent on other lanes
- poll with `subagent_status` at the recorded sync point
- reconcile results back in the parent

## Final rule

Delegate to compress thinking and wall-clock time, not to create ceremony. If the split is real, fan out early; if it is not, stay direct.
