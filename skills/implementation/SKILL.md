---
name: implementation
description: Implement features, bug fixes, and refactors with a verify-first, scope-controlled workflow. Use for code changes that need strong verification and disciplined execution.
---

# Implementation

Goal: ship the smallest correct change that satisfies the user's latest instruction.

## Workflow

1. **Stabilize scope**
   - Restate the goal, constraints, and success criteria.
   - Read the relevant code, tests, configs, and callers before editing.
   - For bug or failure work, start from a concrete failing artifact before choosing a fix.
   - Identify the boundary and existing mechanism that should own the change.

2. **Plan the minimum change**
   - Prefer extending existing code over adding new structure.
   - Preserve the current shape unless the user asked for a refactor or verified evidence shows it cannot support the fix.
   - If you do not choose the simplest path, explain why.

3. **Implement in small verified steps**
   - Use TDD by default for non-trivial work.
   - Keep tests and verification narrow to the requested behavior.
   - Read before each edit and run targeted checks after each step.
   - Prefer `structured_return` for noisy test, lint, type, build, and syntax commands.

4. **Respect scope corrections**
   - The user's latest instruction overrides old plans, reviewer preferences, and cleaner alternatives.
   - If the user narrows scope, says the change is too broad, or sets an explicit "do not X" boundary, stop and re-scope before more edits. If you think the narrowed scope cannot work, ask the user before making a broader change.
   - After meaningful scope changes, update `task_state` before more edits or review loops.

5. **Final audit**
   - Run the relevant checks and review the diff for accidental edits, dead code, stale comments, and unused imports.
   - Use `correctness-reviewer` for non-trivial diffs.
   - Use `simplicity-reviewer` only for actual refactors, new shared abstractions, public API changes, or when the user asked.
   - Treat reviewer findings as triage, not new requirements; ask before widening scope.
