---
name: pr-investigated-review
description: Review a GitHub pull request in an isolated worktree, diff it against the merge base with its base branch, and run a two-pass investigated review where specialist reviewers verify candidate issues through focused issue-investigator subagents before final synthesis.
---

# PR Investigated Review

Use this skill for pull request review workflows that should run in a dedicated worktree instead of the current main checkout, and where candidate issues should be verified before they reach the final synthesis across two sequential review passes.

## Goals

1. Make sure the review happens in a non-main worktree (existing or newly created), not the user's main checkout.
2. Review the PR against the merge base with the PR base branch.
3. Run a first review pass where the four core specialist reviewers, plus any additional scope-driven targeted reviewers you judge necessary, review the PR broadly and verify candidate issues through focused issue-investigator subagents before returning confirmed findings.
4. Create a grounded pass-1 handoff artifact and second-pass review brief, then run the same core reviewers again plus any pass-2-specific targeted reviewers, with the brief as guidance, not truth, while still requiring issue-investigator verification for candidate issues.
5. Synthesize pass-1 and pass-2 results carefully, while keeping review findings separate from the PR comment drafting step.

## Inputs to confirm early

When starting, identify:

- PR URL, PR number, or source branch
- remote to use (`upstream` if available and it points at the canonical repo; otherwise verify)
- base branch for the PR

If the base branch cannot be verified from the remote PR metadata or local refs, say so explicitly and ask.

If the user did not provide a PR URL/number and the branch is already checked out in a non-main worktree, use the current branch/worktree as the review target first. Try to verify the base branch from PR metadata for the current branch (for example with `gh pr view`) before asking the user. Only ask the user when the base branch still cannot be verified.

## Required workflow

### 1. Ensure isolated worktree and checked out PR branch

Always check `git worktree list` and your current branch first.

If you are already in a non-main worktree on the branch being reviewed, stay in that worktree and continue there.

Only create or switch worktrees if you are in the main checkout or on the wrong branch/worktree.

If you need to switch:
- create a dedicated review worktree first
- then switch all subsequent work to that worktree path
- fetch the PR head before checkout so the branch is up to date

Preferred behavior:

- If the environment has an existing trusted repo helper command for PR worktrees, you may use it.
- Otherwise, use `git worktree` directly.

If the worktree path already exists:

- verify it points at the expected branch/commit
- fetch the PR head again
- fast-forward or reset the local review branch only if that is safe and clearly explained

Do not modify the user's existing branch or working tree when a separate review worktree is required.

### 2. Verify base branch and prepare the review diff

Inside the PR worktree:

- verify the PR base branch
- fetch the base branch
- compute the merge base with the checked out PR head

Use the verified base branch, not an assumption, when possible.

Prepare the diff in the same merge-base form that `pr-review` and `code-review` expect:

```bash
BASE=$(git merge-base origin/main HEAD)
git diff "$BASE..HEAD" > /tmp/branch-review.diff
git diff --stat "$BASE..HEAD" | head -n 200
git diff --name-only "$BASE..HEAD" | head -n 200
```

If the actual base branch is not `origin/main`, replace it with the verified base ref, for example:

```bash
BASE_REF="upstream/release/2026-03"
BASE=$(git merge-base "$BASE_REF" HEAD)
```

Also write a short 2-5 bullet summary of what the change does based on the stat and file list.

### 3. Run pass 1 as an investigated specialist review

Do not load `code-review` directly for this skill. Reuse its four core specialist reviewers, expand with extra targeted reviewers when the PR scope warrants it, and require verification of each candidate issue before it becomes a finding.

Before launching any pass-1 broad reviewers, spawn one `scout` subagent with the diff file path, diff stat, changed-file list, short summary, and review worktree cwd. Instruct it to inspect the diff and enough nearby code to understand the changed surfaces, categorize the main risk areas, identify suspicious interactions, and recommend whether pass 1 needs **0–6** extra targeted reviewers beyond the core four.

Always include these four first-pass core reviewers in parallel:

- `correctness-reviewer`
- `security-reviewer`
- `performance-reviewer`
- `simplicity-reviewer`

After the scout returns, make the pass-1 coverage plan from the scout output, diff stat, changed-file list, and short summary:

- decide whether to add **0–6** extra targeted reviewers, staying at **10 total broad review subagents max** for the pass
- choose extra reviewers from the available subagent list only when they materially improve coverage for this PR
- if a suitable named specialist does not exist, use `worker` with a sharply scoped specialty brief
- optimize for distinct risk coverage, not redundant overlap; each extra reviewer must own a different investigation angle
- common reasons to add extras include migrations/data integrity, API contracts, auth/permissions, frontend/accessibility, background jobs/concurrency, infra/observability, rollout/flags, or another clearly specialized domain surface
- if the scout shows the core four already cover the PR well, explicitly say no extra pass-1 reviewers are needed

Give each first-pass reviewer:

- the path to the diff file on disk
- the changed file list
- the short summary of the change
- the working directory / cwd

For each extra first-pass reviewer, explicitly say why that specialty was chosen and what non-overlapping risk surface it owns.

Explicit instructions for each first-pass reviewer:

- first, review the PR within your assigned specialty and identify candidate issues
- do not return a candidate issue as a finding until it has been investigated
- whenever you identify a candidate issue, spawn a focused issue-investigator subagent in a **fresh** context to verify or falsify that one issue
- if the environment does not already provide a dedicated `issue-investigator` agent, use `worker` and frame the task explicitly as focused issue investigation
- each issue-investigator should receive only the minimum context needed: diff file path, relevant file paths/hunks, the concrete suspected issue, and the cwd
- each issue-investigator must trace the relevant code path, verify or falsify the issue, and return concise evidence
- do not forbid an issue-investigator from spawning its own focused subagents if that is the smallest reliable way to verify a detail
- the **10-agent cap applies to the broad reviewer set for the pass**, not to these narrow issue-investigator helpers; still keep investigators minimal and only spawn them when needed
- if you identify more than 10 plausible issues, investigate the highest-risk candidates first and return at most 10 confirmed issues total
- after your investigations, return only confirmed issues, priority-ordered, with file/hunk evidence and impact
- do not pad the list with speculative concerns just to reach the cap

After pass 1, synthesize the reviewer issue lists into one first-pass result:

- collect each core reviewer's and extra targeted reviewer's confirmed issue list
- deduplicate only true duplicates (same file, same line or hunk, same underlying issue)
- preserve distinct issues even if they came from the same area
- order the synthesis by priority
- do not promote unconfirmed candidate issues into the review

### 4. Create a grounded pass-1 handoff artifact

After the first review pass, create a structured temp-file artifact for pass 2.

This artifact must contain only grounded information from pass 1 and directly observed code context.

Include these sections:

- `## Verified findings from pass 1`
- `## Verified code and domain context learned during pass 1`
- `## Suspicious areas and code paths that deserve deeper review`
- `## Concrete review tactics for pass 2`
- `## Open questions and uncertainties`

Rules:

- every item must be tied to observed code, diff hunks, file paths, line numbers, command output, or clearly traced call flows
- do not include assumptions, guesses, or generic filler
- do not claim a suspected bug is real unless pass 1 actually verified it
- it is fine to include leads for pass 2, but label them clearly as leads to verify
- prefer actionable instructions such as `compare this new path to existing helper X`, `trace authorization from A -> B -> C`, or `inspect how failure handling differs between file1 and file2`

Save this handoff artifact to a temp file and keep the path.

### 5. Generate the second-pass review brief

Spawn one focused subagent whose only job is to turn the pass-1 handoff into a better prompt for the second review pass.

Give it:

- the diff file path
- the changed file list
- the short summary of the change
- the pass-1 handoff artifact path
- the review worktree cwd

The subagent must produce a concise second-pass review brief in a temp file with this structure:

- `## Review scope`
- `## Verified context from pass 1`
- `## Candidate issues to verify or falsify`
- `## Suspicious interactions and cross-file paths`
- `## Reviewer-specific guidance`
- `## Things the second pass must not assume`

Rules for the brief:

- it must be grounded in observed code and pass-1 evidence
- it must not invent new facts
- it must not restate the entire first review
- it should sharpen the second pass by identifying where deeper investigation is most likely to pay off
- reviewer-specific guidance should tell the reviewers what to look at, not what conclusion to reach

Prefer a `worker` subagent for this step unless the environment has a more specialized prompt-synthesis agent.

### 6. Run pass 2 with the brief as guidance, not truth

Before launching any pass-2 broad reviewers, spawn one more `scout` subagent with the diff file path, changed-file list, short summary, second-pass review brief path, and review worktree cwd. Instruct it to inspect the diff and nearby code again, use the second-pass brief as guidance rather than truth, and recommend whether pass 2 needs the same extra reviewers, a different set of extra reviewers, or no extras at all.

Run the same four core reviewers again in parallel against the same diff file and same worktree, then use that second scout pass to choose pass-2 extras. Stay at **10 total broad review subagents max** for the pass.

Give each second-pass reviewer:

- the diff file path
- the changed file list
- the short summary of the change
- the second-pass review brief path
- the working directory / cwd

For each extra pass-2 reviewer, explicitly say why that specialty is needed for the second pass and what non-overlapping risk surface it owns.

Explicitly instruct them:

- use the second-pass brief to focus your investigation, not to inherit conclusions
- review within your assigned specialty again; do not just paraphrase pass 1
- if you are an extra targeted reviewer, stay inside your assigned specialty instead of redoing a generic full review
- re-verify any pass-1 finding before repeating it
- whenever you identify a candidate issue, verify or falsify it through a focused issue-investigator subagent
- if the environment does not already provide a dedicated `issue-investigator` agent, use `worker` and frame the task explicitly as focused issue investigation
- each issue-investigator should receive only the minimum context needed: diff file path, relevant file paths/hunks, the concrete suspected issue, and the cwd
- each issue-investigator must trace the relevant code path, verify or falsify the issue, and return concise evidence
- do not forbid an issue-investigator from spawning its own focused subagents if that is the smallest reliable way to verify a detail
- the **10-agent cap applies to the broad reviewer set for the pass**, not to these narrow issue-investigator helpers; still keep investigators minimal and only spawn them when needed
- look for deeper, cross-file, architectural, or business-logic issues that were easier to miss on pass 1
- call out when a pass-1 suspicion does not hold up after re-checking
- return only evidence-backed findings, priority-ordered, with at most 10 confirmed issues total

### 7. Synthesize both passes carefully

Merge the second-pass results with the first-pass findings.

Use these buckets:

- `Confirmed or deepened from pass 1`
- `New issues found in pass 2`
- `Pass-1 concerns not confirmed`
- `Residual watchlist / uncertainty`

Rules:

- deduplicate only true duplicates
- preserve genuinely new or better-evidenced second-pass findings
- if pass 2 weakens or disproves a pass-1 concern, say so explicitly
- keep the final result priority-ordered
- the final synthesis should represent your best review judgment after both passes, not a raw concatenation of two reports

### 8. Pause for discussion before drafting any PR comment

After both review passes are complete:

- present the merged findings to the user
- briefly summarize what pass 2 added or changed
- let the user iterate on severity, wording, and whether specific items should be included
- do **not** draft the PR comment yet unless the user explicitly asks

This is required. Review and comment drafting are separate phases.

### 9. Only when explicitly asked, draft the PR comment

If the user asks to draft a PR comment from the reviewed findings:

- load `pr-description`
- load `writing-voice`
- use the `writing-voice` instructions explicitly when composing the comment
- prefer a subagent drafting pass using `openai-codex/gpt-5.3-codex-spark`
- then do a final factual pass yourself against the verified findings before returning the draft

The drafting task should include:

- the reviewed findings only
- exact file/line evidence when relevant
- requested tone constraints from the user
- whether the output is a top-level review comment or an inline comment draft
- include findings that cannot be mapped to a specific diff line in the review body text; do not silently drop them

Do not invent new issues during drafting. The comment should reflect the agreed review findings only.

## Comment drafting guidance

When turning findings into a PR review comment:

- keep it concise and direct
- preserve priority and impact
- use the user's natural conversational-but-technical tone from `writing-voice`
- prefer one short intro sentence followed by numbered issues when there are multiple findings
- mention test/review gaps only if they materially affect reviewer confidence
- end in a way that reads naturally for a PR review, not like a formal report

## Evidence rules

- VERIFIED: directly observed in code, git metadata, or command output
- LIKELY: strong inference from verified facts, but not independently executed
- UNCERTAIN: missing verified PR metadata, base branch, or branch/worktree state

Call out uncertainty explicitly instead of guessing.

## Practical notes

- Use bounded shell output only.
- Use `read` for files instead of `cat`.
- Save the diff, pass-1 handoff artifact, and second-pass review brief to temp files and pass file paths to the relevant subagents.
- Use a fresh context for each issue-investigator so one suspected issue does not contaminate another.

## Example user intents for this skill

- "Review PR 425 in a separate worktree, but investigate each issue before reporting it"
- "Run a two-pass investigated PR review on this branch"
- "Check out this PR, review it against its base branch twice, and only keep confirmed findings"
- "Now draft a PR comment from those findings"
