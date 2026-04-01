---
name: pr-pending-review
description: Post verified pull request findings as a pending GitHub review with inline comments mapped to current diff chunks. Use when findings are already agreed and the user wants them staged on GitHub without submitting the review.
---

# PR Pending Review Posting

Use this skill after review findings already exist and the user wants them turned into a pending GitHub review with inline comments.

## Goals

1. Post only evidence-backed findings that were already reviewed and agreed.
2. Map each finding to a current diff chunk on the PR head before drafting or posting.
3. Draft the review body and inline comments in the user's voice.
4. Confirm with the user before any GitHub write.
5. Leave the review pending. Do not submit it.

## Inputs to confirm early

When starting, identify:

- PR URL, PR number, and repo
- exact findings to post
- whether GitHub write access is available
- whether unmappable findings should be skipped or returned for user review

If the findings are missing, fuzzy, or still under discussion, stop. This skill is for posting verified findings, not discovering new ones.

## Required workflow

### 1. Freeze the finding set

Create a short posting manifest from the already-reviewed findings:

- severity / priority
- file path
- line or hunk evidence from the review
- one-sentence issue statement
- one-sentence impact
- supporting evidence

Rules:

- Do not invent, upgrade, or add new issues while drafting.
- If you change wording, keep the substance identical.
- If a finding is no longer verified against current `HEAD`, drop it or ask the user.

### 2. Verify PR metadata and current diff

Use GitHub CLI to verify the live PR state:

```bash
gh pr view <pr> --json number,url,headRefOid,baseRefName,headRefName
gh api repos/<owner>/<repo>/pulls/<number>/files --paginate > /tmp/pr-files.json
```

Use the current PR diff, not stale local notes, when mapping comment locations.

### 3. Map each finding to a diff comment target

For every finding, map it to an exact current diff location:

- `path`
- `line`
- `side` (`RIGHT` for added lines unless you verified a left-side case)
- optional `start_line` / `start_side` for multi-line comments

Prefer current `line` / `side` fields over deprecated `position`.

Only post inline comments when you can verify that the target line exists in the current PR diff chunk.

If a finding cannot be mapped unambiguously, do not guess. Ask the user whether to skip it or keep it out of the pending review.

### 4. Draft the pending review text

Before drafting, load `writing-voice` and `humor`.

Prefer a subagent drafting pass with `model: anthropic/claude-opus-4-6` for:

- the top-level review body
- inline comment wording
- the final joke

Recommended drafting pattern:

- agent: `worker`
- skills: `writing-voice`, `humor`
- model: `anthropic/claude-opus-4-6`
- input: frozen finding manifest, verified diff mappings, and any user tone constraints

Then do a final factual pass yourself against the manifest and diff mappings.

Review body rules:

- the first line must be exactly: `Misha's terminal here`
- keep the body short and high-signal
- mention only the already-verified findings being posted
- the last line must be a short joke grounded in the actual findings and generated via `humor`

Inline comment rules:

- concise
- specific about the problem and impact
- no new issues, no severity inflation, no generic filler
- if a finding is really a summary theme rather than a diff-local issue, keep it out of inline comments

### 5. Confirm before posting

Show the user:

- the final review body
- each inline comment with `path` + `line`
- the total comment count
- any findings skipped because they could not be mapped

Ask for explicit confirmation before any GitHub write.

### 6. Create the pending review and stop

Use the GitHub review API, not a submitting review command.

Preferred path:

```bash
gh api repos/<owner>/<repo>/pulls/<number>/reviews \
  --method POST \
  --input /tmp/pending-review.json
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

Important:

- Do not set `event` if you want the review to remain pending.
- Do not call a follow-up submit endpoint.
- After posting, report the review ID or URL if available and state that it is still pending.

## Evidence rules

- VERIFIED: the finding existed before posting and its diff location was re-verified on the current PR head
- LIKELY: wording or tone choice that does not change substance
- UNCERTAIN: stale finding, unmapped diff location, or missing PR metadata

Do not post UNCERTAIN findings as inline comments.

## Practical notes

- Prefer temp files for the manifest and JSON payload.
- Re-check the PR head SHA right before posting if the task sat idle for a while.
- If the diff changed after mapping, redo the mapping before posting.
- Save a `task_checkpoint` after manifest + mapping and again before posting if the task is long-running.

## Example user intents for this skill

- "Turn these review findings into a pending GitHub review with inline comments"
- "Post the agreed PR findings as a pending review, but don't submit it"
- "Map these findings to the diff and stage a pending PR review"
