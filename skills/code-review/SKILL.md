---
name: code-review
description: Perform a thorough priority-ordered review of branch, PR, staged, or local code changes. Use when reviewing a diff before shipping, assessing a branch, or looking for bugs, security issues, edge cases, performance risks, and maintainability problems.
---

# Code Review

Use this skill when the goal is to find real problems in code changes, not to rubber-stamp them.

## Required workflow

### 1. Prepare the diff (orchestrator only — be fast)

- Determine what is being reviewed: staged changes, working tree changes, or a branch diff.
- If the base branch is unclear, inspect it and state the assumption.
- For branch diffs, always diff against the **merge base**:
  ```bash
  BASE=$(git merge-base origin/main HEAD)
  git diff $BASE..HEAD > /tmp/branch-review.diff
  git diff --stat $BASE..HEAD | head -n 200
  git diff --name-only $BASE..HEAD | head -n 200
  ```
- Write a **2–5 bullet summary** of what the change does based on the stat and file list.
- **Do NOT** read source files or the diff content yourself. The subagents will do that.
- **Do NOT** run tests, linters, or builds. This is a code review, not verification.
- **Do NOT** save checkpoints. The review is a single delegated operation.

### 2. Delegate to specialist reviewers immediately

Spawn **all four** in a single parallel subagent call:
- `correctness-reviewer`
- `security-reviewer`
- `performance-reviewer`
- `simplicity-reviewer`

Give each subagent:
- The path to the diff file on disk (e.g., `/tmp/branch-review.diff`)
- The list of changed files
- A brief summary of the change (2–5 bullets)
- The working directory / cwd

**Do NOT** include diff content, file contents, or your own analysis in the task text.
**Do NOT** use the generic `reviewer` agent — the four specialists cover everything.
- In each subagent task, explicitly require a concise final answer that the orchestrator can synthesize directly: priority, file/line, issue, impact.
- If a reviewer expects a long output or risks truncation, have it write the full findings to a temp file and return a short summary plus the file path in the same first pass.
- If one reviewer response comes back truncated or incomplete, recover that reviewer’s findings from its returned temp-file path instead of launching a second broad review pass or re-reviewing the diff yourself.

### 3. Synthesize without losing issues

- Merge findings from all four reviewers.
- Deduplicate only true duplicates (same file, same line, same issue).
- Preserve distinct issues even if there are many.
- Order everything by priority.
- Synthesis happens in the orchestrator.
- If a reviewer returned a temp-file path for full findings, read that file and synthesize from it.
- If a reviewer response is partial, missing detail, or truncated, recover the missing details from that reviewer’s first-pass artifact/path before doing any new analysis yourself.

### 4. Cite evidence and impact

- Each issue should include file path, line number or hunk, why it matters, and the concrete failure or maintenance risk.
- Prefer evidence-backed findings over speculative concerns.
- Explicitly check whether the change duplicates existing functionality or introduces a parallel mechanism where an existing helper, flow, or abstraction should have been reused.
- Explicitly check whether behavior has been placed in the wrong architectural boundary, especially when a more appropriate existing path already handles comparable work.
- Explicitly look for maintainability poor-code patterns when they create real risk: copy-pasted logic that will drift, inconsistent DTO/state shapes, hidden side effects, overly clever control flow, speculative abstractions, helper layers that add indirection without reducing complexity, UI/domain rule mismatches, and config written in one shape but read in another.
- Flag poor coding practices only when you can tie them to a concrete cost: future bug surface, harder debugging, unsafe refactors, silent behavior divergence, or needless operational complexity.

## Token efficiency rules

- The orchestrator should make **≤ 5 tool calls** before spawning subagents: get diff stat, save diff to file, get file list, spawn subagents.
- Do not pre-read files the subagents will read. Subagents have their own context windows.
- Do not embed large content in subagent task descriptions. Pass file paths.

## Severity scale

- **P0**: release blocker, data loss, security exposure, broken deploy, or severe correctness issue
- **P1**: high-risk problem that should be fixed before shipping
- **P2**: real issue worth fixing soon, but not a blocker
- **P3**: lower-severity issue or explicit watchlist item

## Review heuristics

Flag issues when a diff:
- duplicates existing validation, signing, storage, persistence, polling, or orchestration logic instead of reusing an existing mechanism
- introduces a second path for behavior that the codebase already centralizes elsewhere
- places behavior in a more sensitive or user-facing boundary when an existing downstream boundary already owns similar work
- adds "just enough abstraction to be confusing": wrappers, helpers, types, or adapters that do not reduce duplication, do not enforce a contract, and instead hide real behavior
- spreads one feature across multiple divergent implementations without a good reason, especially when each path now has slightly different defaults, error handling, or return shapes
- leaves code in a state where the happy path works but the resulting structure is brittle, misleading, or expensive to evolve

## Output requirements

Use this structure:
- `## Review scope`
- `## P0 - Release blockers`
- `## P1 - High priority`
- `## P2 - Medium priority`
- `## P3 - Low priority / watchlist`
- `## Test / verification gaps`
- `## Summary`

If no issues are found, still summarize what was reviewed and any residual risk.

## Reference

If you need a synthesis checklist or review prompt skeletons, read [references/severity-and-synthesis.md](references/severity-and-synthesis.md).
