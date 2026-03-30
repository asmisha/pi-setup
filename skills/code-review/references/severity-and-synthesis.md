# Code Review Synthesis Notes

## Orchestrator efficiency

The orchestrator's only job before spawning subagents is:
1. Compute the merge-base diff and save it to a temp file
2. Get the file list and diff stat
3. Write a 2–5 bullet summary
4. Spawn all four specialist subagents in one parallel call

**Do NOT**:
- Read source files yourself — subagents have their own context windows
- Run tests, linters, or builds — this is analysis, not verification
- Save checkpoints — the review is a single delegated operation
- Include diff content or file contents in subagent task descriptions

## Reviewer prompt skeleton

Give specialist reviewers:
- **the path to the diff file on disk** (e.g., `/tmp/branch-diff.patch`) — NOT the diff content inline
- the list of changed files (from `git diff --name-only`)
- a brief summary of what the change does (2–5 bullet points)
- the working directory so they can read source files as needed
- a request for exhaustive findings with P0/P1/P2/P3 priority
- a requirement to cite file paths/lines and explain impact

Do **not** give them your conclusions or the answer you hope they find.
Do **not** embed diff content in the task text — it wastes tokens in the orchestrator context.

## Merge checklist

- [ ] Keep every substantiated issue
- [ ] Deduplicate only true duplicates (same file, same line, same root cause)
- [ ] Preserve distinct failure modes in the same file
- [ ] Move missing tests into either findings or verification gaps
- [ ] Order by impact, not by discovery order
- [ ] Call out uncertainty explicitly instead of smoothing it over
