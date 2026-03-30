---
name: pr-review
description: Review a GitHub pull request in an isolated worktree, diff it against the merge base with its base branch, and optionally draft a PR review comment after discussion. Use when asked to review a PR URL/number/branch or to turn reviewed findings into a PR comment.
---

# PR Review

Use this skill for pull request review workflows that should run in a dedicated worktree instead of the current main checkout.

## Goals

1. Make sure the review happens in a dedicated PR worktree, not the user's main checkout.
2. Review the PR against the merge base with the PR base branch.
3. Keep review findings separate from the PR comment drafting step.
4. Only draft a PR comment when the user explicitly asks for one.

## Inputs to confirm early

When starting, identify:

- PR URL, PR number, or source branch
- remote to use (`upstream` if available and it points at the canonical repo; otherwise verify)
- base branch for the PR

If the base branch cannot be verified from the remote PR metadata or local refs, say so explicitly and ask.

## Required workflow

### 1. Ensure isolated worktree and checked out PR branch

Always check whether you are already inside a dedicated PR worktree for the requested PR.

If you are in the main checkout or a different branch/worktree:

- create a dedicated worktree first
- then switch all subsequent work to that worktree path
- fetch the PR head before checkout so the branch is up to date

Preferred behavior:

- If the environment has an existing trusted repo helper command for PR worktrees, you may use it.
- Otherwise, use `git worktree` directly.

Safe fallback flow:

```bash
# inspect remotes/worktrees first
 git remote -v | head -n 20
 git worktree list | head -n 50

# example variables
 PR_NUMBER=425
 REMOTE=upstream
 BRANCH="review/pr-${PR_NUMBER}"
 WT_PATH="/absolute/path/to/worktree-root/pr-${PR_NUMBER}"

# fetch PR head into a local branch
 git fetch "$REMOTE" "pull/${PR_NUMBER}/head:${BRANCH}"

# create worktree if needed
 git worktree add "$WT_PATH" "$BRANCH"

# then operate from the worktree
 git -C "$WT_PATH" status --short --branch
```

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

Prepare the diff exactly as the `code-review` skill expects:

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

### 3. Run the actual review via the code-review skill

Load and follow the `code-review` skill.

Important:

- Review against the merge base with the PR base branch.
- Do not run tests/builds as part of the review unless the user separately asks for verification.
- Keep the review evidence-backed and priority-ordered.
- Summarize findings for the user first.

### 4. Pause for discussion before drafting any PR comment

After the review is complete:

- present the findings to the user
- let the user iterate on severity, wording, and whether specific items should be included
- do **not** draft the PR comment yet unless the user explicitly asks

This is required. Review and comment drafting are separate phases.

### 5. Only when explicitly asked, draft the PR comment

If the user asks to draft a PR comment from the reviewed findings:

- load `pr-description`
- load `writing-voice`
- use the `writing-voice` instructions explicitly when composing the comment
- prefer a subagent drafting pass using `anthropic/claude-opus-4-6`
- then do a final factual pass yourself against the verified findings before returning the draft

The drafting task should include:

- the reviewed findings only
- exact file/line evidence when relevant
- requested tone constraints from the user
- whether the output is a top-level review comment or an inline comment draft

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
- Save the diff to a temp file and pass the file path to reviewers.
- If the review becomes long-running, save a `task_checkpoint` after worktree prep and after review synthesis.
- If the user later resumes the task, load the latest checkpoint first.

## Example user intents for this skill

- "Review PR 425 in a separate worktree"
- "Check out this PR and review it against its base branch"
- "Now draft a PR comment from those findings"
- "Rewrite the review comment in my voice"
