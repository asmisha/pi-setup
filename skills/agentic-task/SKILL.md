---
name: agentic-task
description: Orchestrate ambiguous or multi-step tasks by understanding the goal, delegating focused subagents, and synthesizing an evidence-based report. Use for complex analysis, investigation, planning, or cross-cutting tasks where multiple specialist passes help.
---

# Agentic Task

Use this skill when the task is broad, ambiguous, or benefits from several isolated specialist passes before you write the final answer.

## Required workflow

1. **Lock the goal**
   - Clarify the deliverable, scope, constraints, and decision deadline.
   - Decide whether the output is an analysis, recommendation, plan, or implementation strategy.

2. **Scope the terrain**
   - Search first.
   - Use `scout` when the code or document surface is not obvious.
   - Load or save a `task_checkpoint` for long-running work.

3. **Choose the minimum useful set of subagents**
   - Prefer 2-4 focused agents over a swarm.
   - Match agents to the task: planner for design, specialist reviewers for audits, reviewer for broad sweep, spec-reviewer for design-doc alignment, etc.
   - Give each agent a narrow objective and explicit output shape.

4. **Protect independence**
   - Pass raw artifacts and task-local context.
   - Do not leak your hypothesis, expected answer, or preferred fix unless the delegation truly requires it.
   - Ask agents to cite evidence and uncertainty.

5. **Synthesize carefully**
   - Separate observed facts, corroborated conclusions, open questions, and recommendations.
   - Resolve conflicts between subagents explicitly; do not average them away.
   - Preserve important minority findings when they are evidence-backed.

6. **Close with an action-oriented report**
   - Summarize what matters now.
   - Order recommendations by impact and urgency.
   - Save a final checkpoint if the task is likely to continue.

## Output requirements

Use this structure:
- `## Goal`
- `## Method`
- `## Findings`
- `## Confidence`
- `## Recommendations`
- `## Next steps`

## Reference

If you need orchestration patterns or a delegation checklist, read [references/orchestration.md](references/orchestration.md).
