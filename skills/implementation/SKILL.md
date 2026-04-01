---
name: implementation
description: Implement features, bug fixes, and refactors with a verify-first, simple-first, test-first workflow. Use when writing code, fixing bugs, or shipping code changes that need strong verification and durable progress tracking.
---

# Implementation

Use this skill for code changes. Optimize for the simplest high-quality solution that fully satisfies the request.

## Required workflow

1. **Stabilize the target**
   - Restate the goal, constraints, and success criteria.
   - Read project instructions and discover relevant code, tests, configs, migrations, and callers before editing.
   - For failure-driven tasks (bug, regression, failing test, CI, production issue), first identify the observed failure from a concrete artifact such as a failing test, log, stack trace, or CI step before choosing a fix.
   - If the task is ambiguous, resolve that ambiguity before coding.
   - Identify the architectural boundary that should own the fix: UI/render path, request/action path, domain/service layer, worker/background job, persistence layer, or script.
   - Search for existing helpers, utilities, flows, hooks, schemas, and services that already solve part of the problem before designing a new mechanism.

2. **Frame and challenge the solution**
   - Explicitly identify:
     - what problem is being solved
     - what evidence shows this is the problem instead of a nearby latent issue
     - why it needs to be solved now
     - whether all requested work is actually needed to solve it
     - the minimum change that would solve the verified problem
     - at least one simpler alternative
     - whether the proposed change belongs in the current execution boundary
     - whether the change duplicates existing functionality or introduces a new path that existing code could cover
   - Do not accept the requested implementation shape as fixed.
   - If the chosen solution is not the simplest one, explain why the extra complexity is justified.
   - If that justification is weak, unverified, or based on assumptions, stop and revisit the plan before coding.
   - Prefer extending an existing mechanism over creating a parallel one unless you can verify that the existing mechanism is unsuitable.
   - Treat boundary shifts with caution: do not move work into a more user-facing or operationally sensitive path unless that is clearly required.

3. **Choose the smallest clean design**
   - Briefly compare plausible approaches when there is real choice.
   - Pick the simplest approach that meets the requirement.
   - Reject speculative abstractions, compatibility layers, state, or future-proofing unless the current task truly needs them.
   - Prefer reuse over replacement and extension over duplication.
   - If a solution adds a new helper, token format, storage flow, validation path, or state mechanism, first verify that an equivalent or adjacent mechanism does not already exist in the codebase.
   - “Smallest” includes operational simplicity: avoid solutions that make a more sensitive path heavier, slower, or harder to reason about when the same outcome can be achieved in an existing downstream path.

4. **Create or restore a checkpoint for long tasks**
   - Use `task_checkpoint` at the start of multi-step work.
   - Save after planning, after each meaningful milestone, and before compaction.
   - Keep checkpoints factual: goal, verified state, files changed, checks run, remaining work, next step.

5. **Use TDD by default for non-trivial changes**
   - Bug fix: add a reproducer first.
   - Feature: add or update acceptance/behavior tests first.
   - Confirm the test/check fails for the expected reason before implementing.
   - Implement the minimal code to go green.
   - Refactor only while checks remain green.
   - Skip TDD only for trivial, documentation-only, or config-only changes, and say why.

6. **Implement in small verified steps**
   - Read before each edit.
   - Run targeted verification immediately after each step.
   - If something fails, fix the root cause with the smallest safe change.
   - Update the checkpoint when the task will continue beyond the current step.
   - If implementation starts drifting toward a new mechanism or duplicated logic, pause and re-check whether an existing abstraction or execution path should be reused instead.

7. **Do a focused final audit**
   - Run the relevant test/lint/type/build/syntax commands.
   - Review the diff for accidental edits, dead code, stale comments, and unused imports.
   - For non-trivial diffs, run at least one focused review subagent before presenting results.

## Recommended subagent pattern

For non-trivial implementation work:
1. Use `scout` to map the code and tests. For failure-driven tasks, have `scout` start from the failing artifact and trace outward.
2. Use `planner` to produce the smallest clean plan, including the minimum viable change and simpler alternatives considered. If the failure is not yet identified, the plan must add a discovery step instead of proposing code changes.
3. Implement the plan yourself.
4. Run `correctness-reviewer` and `simplicity-reviewer` on the resulting diff.

Give subagents only task-local context. Do not leak your preferred answer.

During planning, explicitly answer:
- What existing functionality already covers some of this problem?
- Why is reuse or extension insufficient, if you are not choosing it?
- Which boundary should own this behavior, and why?

## Anti-patterns to avoid

- Accepting the requested implementation shape without first questioning whether it is needed.
- Adding permanent complexity before ruling out a simpler approach.
- Introducing new abstractions, state, helper layers, compatibility paths, or refactors when a smaller direct change would solve the problem.
- Validating only that the new code works, without validating whether the code should exist at all.
- Using assumptions about constraints, rollout, architecture, or ergonomics to justify complexity before those assumptions are verified.
- Duplicating existing helpers, token/signing logic, validation rules, storage flows, polling/state persistence, or repository behavior without first verifying whether an existing mechanism can be reused or extended.
- Solving a problem in the nearest editable code path when a more appropriate existing boundary already owns comparable work.

## Output requirements

Use this structure in the final response:
- `## Result`
- `## Simplest approach chosen`
- `## Files changed`
- `## Verification` with `VERIFIED`, `LIKELY`, and `UNVERIFIED` labels
- `## Remaining risks / follow-ups`

## Reference

If you need a checkpoint template or compact execution checklist, read [references/checklists.md](references/checklists.md).
