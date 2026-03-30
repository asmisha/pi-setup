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
   - Use `scout` for codebase mapping if the surface area is large.
   - Run focused reviewers in parallel as needed:
     - `spec-reviewer`
     - `security-reviewer`
     - `performance-reviewer`
     - `simplicity-reviewer`

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
