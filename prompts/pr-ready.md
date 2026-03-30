---
description: Mark the current PR ready and request recent contributors as reviewers
---
Inspect the pull request for the current branch and complete this workflow end to end.

Requirements:
1. Discover the current PR with GitHub CLI. If no PR is open for the current branch, stop and report that clearly.
2. Inspect the PR and gather:
   - PR number and URL
   - author login
   - current draft/ready state
   - already requested reviewers
   - changed files
3. Derive 2-4 reviewer candidates from the touched files:
   - use recent per-file commit history, plus GitHub metadata when needed, to find distinct recent human contributors with GitHub logins
   - prioritize contributors who recently touched multiple changed files or the most central files
   - exclude the authenticated user / yourself, the PR author, bots, and already-requested reviewers
   - do not guess usernames; verify every requested reviewer login before using it
   - if fewer than 2 valid candidates exist, use the valid subset and explain why
4. If the PR is still a draft, mark it ready for review.
5. Request review from the selected contributors.
6. Report the final state:
   - PR number and URL
   - whether draft status changed
   - changed files summary
   - reviewers requested
   - excluded or skipped candidates with reasons
   - any command failures or missing data

Use the smallest set of shell and `gh` commands needed. Prefer `gh pr view`, `gh pr ready`, `gh pr edit --add-reviewer`, and `git log` or `gh api` as needed.
