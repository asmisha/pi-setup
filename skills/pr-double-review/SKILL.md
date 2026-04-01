---
name: pr-double-review
description: "Run a two-pass pull request review in an isolated worktree: a normal first review cycle, then a grounded second-pass review brief, then a second focused review cycle to find deeper or cross-cutting issues."
---

# PR Double Review

Use this skill when a pull request is important enough to justify two sequential review passes instead of a single pass.

This skill intentionally reuses the normal PR review workflow for the first cycle, then adds a verified handoff step so the second cycle can review the same changes with better context and sharper focus.

## Goals

1. Run the first review cycle as a normal PR review in an isolated worktree.
2. Capture verified context from the first cycle without turning guesses into facts.
3. Generate a grounded brief for the second cycle that points reviewers at suspicious areas, relevant code paths, domain facts, and concrete inspection tactics.
4. Run a second review cycle that uses the brief as guidance, not as truth.
5. Return a final synthesis that distinguishes confirmed first-pass issues, new second-pass issues, and first-pass suspicions that did not hold up.

## Inputs to confirm early

When starting, identify:

- PR URL, PR number, or source branch
- remote to use (`upstream` if available and it points at the canonical repo; otherwise verify)
- base branch for the PR

If the base branch cannot be verified from remote PR metadata or local refs, say so explicitly and ask.

If the user did not provide a PR URL/number and the branch is already checked out in a non-main worktree, use the current branch/worktree as the review target first. Try to verify the base branch from PR metadata for the current branch before asking the user.

## Required workflow

### 1. Prepare the isolated review worktree exactly like a normal PR review

Follow the same worktree discipline as `pr-review`:

- check `git worktree list` and your current branch first
- stay in the existing non-main review worktree if it already matches the branch under review
- otherwise create or switch to a dedicated review worktree
- fetch the PR head before checkout so the review branch is current
- do not modify the user's main checkout when a separate review worktree is required

### 2. Verify the base branch and prepare one shared review diff

Inside the review worktree:

- verify the PR base branch
- fetch the base branch
- compute the merge base with the checked out PR head
- save the diff to a temp file
- collect the diff stat and changed file list

Use the verified base branch, not an assumption, when possible.

Use the same merge-base diff shape as `pr-review` and `code-review`:

```bash
BASE=$(git merge-base origin/main HEAD)
git diff "$BASE..HEAD" > /tmp/branch-review.diff
git diff --stat "$BASE..HEAD" | head -n 200
git diff --name-only "$BASE..HEAD" | head -n 200
```

If the actual base branch is not `origin/main`, replace it with the verified base ref.

Write a short 2-5 bullet summary of what the change does based on the stat and file list.

### 3. Run the first review cycle as the normal PR review pass

Reuse the normal PR review structure:

- use the prepared worktree and merge-base diff
- use the same four specialist reviewers that `code-review` uses:
  - `correctness-reviewer`
  - `security-reviewer`
  - `performance-reviewer`
  - `simplicity-reviewer`
- keep the review evidence-backed and priority-ordered
- do not run tests, builds, or linters unless the user separately asks for verification

Treat this as the baseline PR review pass. The reviewers should investigate the changes normally, with no special second-pass guidance yet.

After synthesizing the first-pass findings, do **not** stop for user discussion yet. In this skill, the pause happens only after both review cycles are complete.

### 4. Create a first-pass handoff artifact

After the first review cycle, create a structured temp-file artifact for the second cycle.

This artifact must contain only grounded information from the first cycle and directly observed code context.

Include these sections:

- `## Verified findings from pass 1`
- `## Verified code and domain context learned during pass 1`
- `## Suspicious areas and code paths that deserve deeper review`
- `## Concrete review tactics for pass 2`
- `## Open questions and uncertainties`

Rules:

- Every item must be tied to observed code, diff hunks, file paths, line numbers, command output, or clearly traced call flows.
- Do not include assumptions, guesses, or generic filler.
- Do not claim a suspected bug is real unless pass 1 actually verified it.
- It is fine to include leads for pass 2, but label them clearly as leads to verify.
- Prefer actionable instructions such as `compare this new path to existing helper X`, `trace authorization from A -> B -> C`, or `inspect how failure handling differs between file1 and file2`.

Save this handoff artifact to a temp file and keep the path.

### 5. Generate the second-pass review brief with a dedicated subagent

Spawn one focused subagent whose only job is to turn the first-pass handoff into a better prompt for the second review cycle.

Give it:

- the diff file path
- the changed file list
- the short summary of the change
- the first-pass handoff artifact path
- the review worktree cwd

The subagent must produce a concise second-pass review brief in a temp file with this structure:

- `## Review scope`
- `## Verified context from pass 1`
- `## Candidate issues to verify or falsify`
- `## Suspicious interactions and cross-file paths`
- `## Reviewer-specific guidance`
- `## Things the second pass must not assume`

Rules for the brief:

- It must be grounded in observed code and first-pass evidence.
- It must not invent new facts.
- It must not restate the entire first review.
- It should sharpen the second pass by identifying where deeper investigation is most likely to pay off.
- Reviewer-specific guidance should tell the specialist reviewers what to look at, not what conclusion to reach.

Prefer a `worker` subagent for this step unless the environment has a more specialized prompt-synthesis agent.

### 6. Run the second review cycle with the brief as guidance, not truth

Run the same four specialist reviewers again in parallel against the same diff file and same worktree.

Give each reviewer:

- the diff file path
- the changed file list
- the short summary of the change
- the second-pass review brief path
- the working directory / cwd

Explicitly instruct them:

- use the second-pass brief to focus your investigation, not to inherit conclusions
- re-verify any pass-1 finding before repeating it
- look for deeper, cross-file, architectural, or business-logic issues that were easier to miss on the first pass
- call out when a pass-1 suspicion does not hold up after re-checking
- return only evidence-backed findings

Do not let the second pass degrade into a paraphrase of pass 1.

### 7. Synthesize both cycles carefully

Merge the second-pass results with the first-pass findings.

Use these buckets:

- `Confirmed or deepened from pass 1`
- `New issues found in pass 2`
- `Pass-1 concerns not confirmed`
- `Residual watchlist / uncertainty`

Rules:

- Deduplicate only true duplicates.
- Preserve genuinely new or better-evidenced second-pass findings.
- If pass 2 weakens or disproves a pass-1 concern, say so explicitly.
- Keep the final result priority-ordered.
- The final synthesis should represent your best review judgment after both cycles, not a raw concatenation of two reports.

### 8. Present the final review, then pause for discussion

After both cycles are complete:

- present the merged findings to the user
- briefly summarize what the second pass added or changed
- pause for discussion before drafting any PR comment

Only draft a PR review comment when the user explicitly asks.

If the user asks for a PR comment after the double review:

- load `pr-description`
- load `writing-voice`
- prefer a subagent drafting pass using `anthropic/claude-opus-4-6`
- draft from the final merged findings only
- do not resurrect a pass-1 concern that the second pass did not confirm

## Evidence rules

- VERIFIED: directly observed in code, git metadata, or command output
- LIKELY: strong inference from verified facts, but not independently executed
- UNCERTAIN: missing verified PR metadata, base branch, or code evidence

Call out uncertainty explicitly instead of guessing.

## Practical notes

- Use bounded shell output only.
- Use `read` for files instead of `cat`.
- Save the diff and both handoff artifacts to temp files and pass file paths to subagents.
- Save a `task_checkpoint` after worktree prep, after first-pass synthesis, and after final synthesis if the review is long-running.
- If the task resumes later, load the latest checkpoint first.

## Example user intents for this skill

- "Do a double review of PR 425"
- "Run two review passes on this PR and use the first pass to focus the second"
- "Review this PR twice and tell me what the second pass changed"
- "Double-review this branch in a separate worktree"
