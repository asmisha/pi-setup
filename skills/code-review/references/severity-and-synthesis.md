# Code Review Synthesis Notes

## Orchestrator efficiency

The orchestrator's only job before spawning broad reviewers is:
1. Compute the merge-base diff and save it to a temp file
2. Get the file list and diff stat
3. Write a 2–5 bullet summary
4. Spawn one `scout` subagent to inspect the diff and nearby code, then use its coverage plan to choose any extra reviewers
5. Spawn all four core specialist reviewers plus any scout-justified targeted reviewers in one parallel call

**Do NOT**:
- Read source files yourself as a broad review pass — the scout and reviewers have their own context windows
- Run tests, linters, or builds — this is analysis, not verification
- Include diff content, file contents, or unverified scout conclusions in reviewer task descriptions

## Scout prompt skeleton

Give the scout:
- **the path to the diff file on disk** (e.g., `/tmp/branch-diff.patch`) — NOT the diff content inline
- the diff stat and changed-file list
- a brief summary of what the change does (2–5 bullet points)
- the working directory so it can read source files as needed
- a request to return the changed surfaces, risky interactions, and recommended specialist coverage

Treat scout output as planning input, not as final findings.

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
Do **not** pass scout suspicions as facts; at most pass the chosen specialty scope and leads to inspect.

## Merge checklist

- [ ] Keep every substantiated issue
- [ ] Deduplicate only true duplicates (same file, same line, same root cause)
- [ ] Preserve distinct failure modes in the same file
- [ ] Move missing tests into either findings or verification gaps
- [ ] Order by impact, not by discovery order
- [ ] Call out uncertainty explicitly instead of smoothing it over
