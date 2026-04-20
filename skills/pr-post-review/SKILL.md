---
name: pr-post-review
description: "Create a verified GitHub PR review from agreed findings. Default use: create a pending review with inline comments. Only submit the review immediately, or approve with comments, when the user explicitly asks for that mode."
---

# PR Review Submission

Use this skill after review findings already exist and the user wants them turned into a GitHub PR review.

Default behavior: create a pending review with inline comments.

Only on explicit user request, this skill may instead:

- create and submit a non-pending comment review, or
- approve with comments

Do not silently switch from creating a pending review to submitting a review.

## Goals

1. Turn only evidence-backed findings that were already reviewed and agreed into a GitHub PR review.
2. Re-verify the current PR state and diff targets before any GitHub write.
3. Draft review text in the user's voice without changing the underlying findings.
4. Confirm with the user before any GitHub write.
5. Default to creating a pending review unless the user explicitly requests a different submission mode.

## Inputs to confirm early

When starting, identify:

- PR URL, PR number, and repo
- exact findings or comments to turn into review comments
- requested review mode:
  - default: create a pending review
  - explicit-only: create and submit a comment review immediately
  - explicit-only: approve with comments
- whether GitHub write access is available
- whether unmappable findings should go in the review body (default) or be skipped

If the findings are missing, fuzzy, or still under discussion, stop. This skill is for submitting verified findings, not discovering new ones.

## Required workflow

### 1. Freeze the finding set

Create a short submission manifest from the already-reviewed findings or comments:

- severity / priority when applicable
- file path
- line or hunk evidence from the review
- one-sentence issue statement
- one-sentence impact
- supporting evidence
- requested review mode

Rules:

- Do not invent, upgrade, or add new issues while drafting.
- If you change wording, keep the substance identical.
- If a finding is no longer verified against current `HEAD`, drop it or ask the user.

### 2. Verify PR metadata and current diff

Use GitHub CLI to verify the live PR state:

```bash
PI_TMP_DIR="${TMPDIR:-/tmp}"
PR_FILES_JSON="$(mktemp "$PI_TMP_DIR/pr-files.XXXXXX")"
gh pr view <pr> --json number,url,headRefOid,baseRefName,headRefName
gh api repos/<owner>/<repo>/pulls/<number>/files --paginate > "$PR_FILES_JSON"
```

Use the current PR diff, not stale local notes, when mapping comment locations.

### 3. Map each finding to a current diff comment target when needed

For every inline finding or comment, map it to an exact current diff location:

- `path`
- `line`
- `side` (`RIGHT` for added lines unless you verified a left-side case)
- optional `start_line` / `start_side` for multi-line comments

Prefer current `line` / `side` fields over deprecated `position`.

Only submit inline comments when you can verify that the target line exists in the current PR diff chunk.

If a finding cannot be mapped to a specific diff line, include it in the review body text instead of as an inline comment, and name the concrete file paths and/or function names that support it. Do not silently drop unmappable findings.

### 4. Draft or validate the review text

Before drafting, load `writing-voice`.

Prefer a subagent drafting pass for:

- the top-level review body
- inline comment wording when creating a new review

Recommended drafting pattern:

- agent: `worker`
- skills: `writing-voice`
- model: `openai-codex/gpt-5.3-codex-spark`
- input: frozen finding manifest, verified diff mappings, requested submission mode, and any user tone constraints

Then do a final factual pass yourself against the manifest and diff mappings.

Review body rules:

- the first line must be exactly: `Misha's terminal here`
- keep the text short and high-signal; compress wording, not the verified finding set
- mention all already-verified findings being submitted
- for findings included in the body because they are not inlineable, cite the concrete file paths and/or function names so a reviewer can find them quickly

Inline comment rules:

- concise
- specific about the problem and impact
- no new issues, no severity inflation, no generic filler
- if a finding is really a summary theme rather than a diff-local issue, keep it out of inline comments

The review body rules apply to all three modes. The review creation mode changes, but the findings and wording rules do not.

### 5. Confirm before writing

Show the user:

- the chosen review mode
- the final review body
- each inline comment with `path` + `line` when applicable
- the total comment count
- any findings included in the body because they could not be mapped to a diff line

Ask for explicit confirmation before any GitHub write.

### 6. Perform only the confirmed review path

#### Default: create a pending review

Use the review creation endpoint without `event` so the review remains pending:

```bash
PI_TMP_DIR="${TMPDIR:-/tmp}"
REVIEW_JSON="$(mktemp "$PI_TMP_DIR/review.XXXXXX")"
gh api repos/<owner>/<repo>/pulls/<number>/reviews \
  --method POST \
  --input "$REVIEW_JSON"
```

Payload shape:

```json
{
  "body": "...",
  "comments": [
    {
      "path": "path/to/file.ts",
      "line": 123,
      "side": "RIGHT",
      "body": "..."
    }
  ]
}
```

#### Explicit-only: create and submit a new comment review

Use the review creation endpoint with `event=COMMENT` only when the user explicitly asked to submit the review immediately.

Preferred payload shape:

```json
{
  "body": "...",
  "event": "COMMENT",
  "comments": [
    {
      "path": "path/to/file.ts",
      "line": 123,
      "side": "RIGHT",
      "body": "..."
    }
  ]
}
```

#### Explicit-only: approve with comments

Use the review creation endpoint with `event=APPROVE` only when the user explicitly requested approval with comments.

Important:

- Do not silently switch from pending-review creation to immediate submission.
- Do not approve unless the user explicitly requested approval.
- Re-check the PR head SHA right before the final write if the task sat idle for a while.
- After the write, report the review ID or URL if available and the exact review mode used.

## Evidence rules

- VERIFIED: the finding existed before review creation, the review mode matched the user's request, and each posted diff location was re-verified on the current PR head
- LIKELY: wording or tone choice that does not change substance
- UNCERTAIN: stale finding, unmapped diff location, unclear user intent about review mode, or missing PR metadata

Do not post UNCERTAIN findings as inline comments, and do not choose a non-default review mode without explicit user confirmation.

## Practical notes

- Prefer unique files in the system temp dir for the manifest, body text, and JSON payload.
- If the diff changed after mapping, redo the mapping before posting.

## Example user intents for this skill

Default path:

- "Turn these review findings into a pending GitHub review"
- "Post the agreed PR findings as a pending review"
- "Map these findings to the diff and stage a pending PR review"

Explicit-only alternate paths:

- "Create and submit a fresh comment review for these findings"
- "Submit this review now instead of leaving it pending"
- "Approve this PR with these comments"
