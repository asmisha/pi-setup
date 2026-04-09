---
name: pr-description
description: Write or revise pull request titles and descriptions with a reason-first, technical-document style. Use when creating a PR body, rewriting a PR description, renaming a PR, or editing a draft PR. For draft PRs, load the writing-voice skill first and draft with Codex Spark instead of the default model.
---

# PR Title and Description

Use this skill when the user asks you to write, rewrite, or update a pull request title or description.

## Core rules

- Understand the actual change before writing. Read the diff, commits, relevant tests, and any issue or ticket context.
- Focus more on **why** the change exists than on listing file-by-file edits.
- Write like a short technical document: straightforward, complete, and easy to skim.
- Keep the description concrete. Avoid filler, hype, and vague summaries.

## Model and voice

- For **draft PRs**, load the `writing-voice` skill first and follow it.
- When drafting or rewriting PR title or description text, prefer a subagent pass with `model: openai-codex/gpt-5.3-codex-spark`, even if `openai-codex/gpt-5.4` is the default model.
- Use the Codex Spark draft as the base text, then do a final factual pass yourself against the actual diff before publishing.

Recommended subagent pattern:

- Agent: `worker` or `delegate`
- Skill: `writing-voice`
- Model: `openai-codex/gpt-5.3-codex-spark`
- Task: draft the PR title and/or body from the verified diff and tests, following the structure below

## Title guidelines

Apply the same reason-first rule to PR titles.

A good PR title should:

- foreground the capability or behavior unlocked, not the specific helper or implementation detail
- make a reviewer immediately understand what is now possible or what problem is gone
- stay concrete and literal
- use the repo's expected style, such as conventional commits when appropriate

Prefer titles like:

- `fix: support nullable per-feature columns on user_locks without backfill`
- `feat: allow new lock fields to ship immediately without migrating existing rows`

Avoid titles that name internal helpers or read like a diff summary:

- `fix: initialize nullable user lock fields before optimistic locking`
- `refactor: change lock initialization`

Also avoid titles that are too vague:

- `fix: update user locks`

## Required structure

Use the repo's required PR sections if they exist. In Alto, use exactly:

```md
## Description
...

## Security Implications
...

## How to test
...
```

## Content guidelines

### `## Description`

Write this section as a compact technical narrative with this flow:

1. **Why was the old approach hard or unsafe?**
   - Start with the operational, architectural, or safety limitation that motivated the change.
   - Be specific: what was fragile, what required manual steps, what blocked shipping.
2. **What does this unlock?**
   - State the capability or behavior that is now possible.
   - This is the core of the PR — a reviewer should understand the unlock before any code details.
3. **How does the new approach make it safe?**
   - Explain how the new design avoids the old limitation.
   - Include enough mechanism detail for reviewers to understand why it works, not every code edit.
4. **Implications**
   - Mention behavior changes, compatibility considerations, migration/rollout implications, and anything reviewers should pay attention to.

Prefer short paragraphs over long bullet lists unless bullets are materially clearer.

### `## Security Implications`

- State the actual security impact.
- If risk is low, say why.
- Call out any auth, validation, secrets, data exposure, or concurrency implications when relevant.

### `## How to test`

- List the exact commands, flows, or scenarios that verify the change.
- Prefer concrete commands and expected outcomes.

## Issue linking

When the PR references external issues:

- Use **verified tracker-specific linking syntax**.
- Do not write bare references like `Sentry issue 6250241855`.
- For **Linear**, prefer `Resolves [RVR-12345](https://linear.app/...)` when the PR is meant to close the ticket. Otherwise use `Linear: https://linear.app/...`.
- For **Sentry**, use a dedicated standalone line in the PR body: `Fixes [WEB-FH8](https://river-financial.sentry.io/issues/WEB-FH8/)`.
- The Sentry line must be on its **own separate line**, not embedded inside a paragraph.
- The Sentry short issue ID must always be a **markdown link to the Sentry issue URL itself**.
- Do not use the numeric issue ID, and do not rely on the full Sentry URL alone without the linked short ID.
- If the exact Linear URL, Sentry short ID, or Sentry issue URL is not verified, say so rather than inventing one.

## Style

- Reason-first, not diff-first.
- Straightforward and technical.
- Complete enough that a reviewer can understand the intent without re-deriving it from the code.
- Do not turn the description into release notes or marketing copy.

## Final verification before publishing

Before updating the PR title or body:

1. Re-read the final text against the actual diff
2. Remove claims that are not verified
3. Ensure the testing section matches commands actually run
4. Ensure the title describes the actual behavior change clearly
5. Ensure the description explains the motivation, mechanism, and implications clearly
