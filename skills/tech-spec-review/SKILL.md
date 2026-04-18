---
name: tech-spec-review
description: Review a technical spec, design doc, or implementation plan against the current branch and codebase. Use when checking spec-code alignment, feasibility, security, scaling, performance, architecture, and opportunities to simplify an approach.
---

# Tech Spec Review

Use this skill when the main artifact is a document, but the review must stay grounded in the current codebase and branch.

## Required workflow

1. **Read the full document**
   - Extract goals, scope, constraints, assumptions, non-goals, rollout expectations, and acceptance criteria.
   - Do not review from snippets alone if the full document is available.

2. **Map the current implementation surface**
   - Search for the code, configs, schemas, and tests that the spec touches.
   - Read enough nearby code to understand how the proposed design fits the current system.

3. **Run specialist passes**
   - If you plan to launch multiple review subagents, run one `scout` pass first. Give it the document, the mapped code surface, and the current branch context so it can inspect the subject and recommend the right review coverage.
   - Use `scout` for codebase mapping whenever the surface area is large or the affected boundaries are not obvious.
   - Always include `spec-reviewer`.
   - Then make an explicit coverage plan for the document's actual scope and decide which other reviewers to launch, using the scout output and your mapping rather than file names or assumptions alone.
   - Add `security-reviewer`, `performance-reviewer`, `simplicity-reviewer`, and/or other targeted reviewers only when they materially improve coverage for this spec.
   - You may launch up to **10 total review subagents**. Keep the set small when the spec is narrow, and expand it when the surface area genuinely warrants it.
   - Choose extra reviewers from the available subagent list when possible; if a needed specialty does not exist, use `worker` with a sharply scoped specialty brief.
   - Optimize for distinct risk coverage, not redundant overlap. Each extra reviewer must own a different investigation angle.
   - Common reasons to add extras include migrations/data model changes, API contracts, rollout/migration plans, observability, infra/operations, privacy/compliance, UX/accessibility, background jobs/concurrency, or a domain-specific boundary the base reviewers may miss.

4. **Compare document vs reality**
   - Flag contradictions with current code.
   - Flag missing requirements, hidden assumptions, rollout/migration gaps, observability gaps, and unclear ownership or boundaries.
   - Flag security, scaling, performance, and architecture risks.
   - Actively look for over-engineering and simpler ways to reach the same outcome.

5. **Separate evidence from advice**
   - Cite exact spec sections and code paths.
   - Distinguish verified mismatches from likely concerns and open questions.

## Output requirements

Use this structure:
- `## Executive summary`
- `## Spec-code mismatches`
- `## Risks` (priority ordered)
- `## Over-engineering / simplification opportunities`
- `## Open questions / missing decisions`
- `## Recommended next steps`

## Reference

If you need a compact checklist for document-vs-code review, read [references/review-template.md](references/review-template.md).
