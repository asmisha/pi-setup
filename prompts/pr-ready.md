---
description: Mark the current PR ready and request recent contributors as reviewers
---
Inspect the pull request for the current branch and complete this workflow end to end.

Requirements:
1. From the repo you are operating on, run `sh /Users/mikhailastashkevich/Projects/pi-config/scripts/select-pr-reviewers.sh`.
   - If it reports `STATUS\tno_pr`, stop and report that clearly.
   - Treat its tab-separated output as the source of truth for PR metadata, changed files, selected reviewers, and excluded/skipped candidates.
   - Do not re-implement reviewer ranking inline in this prompt. Only fall back to direct `gh` inspection if the script itself fails.
2. From the script output, gather and use:
   - `PR_NUMBER` and `PR_URL`
   - `PR_AUTHOR`
   - `PR_IS_DRAFT`
   - `REQUESTED_REVIEWER` entries
   - `CHANGED_FILE` entries
   - `SELECTED_REVIEWER` entries
   - `CANDIDATE` entries for skipped/excluded reasons
3. If the PR is still a draft, mark it ready for review.
4. Request review from the selected contributors.
   - If no valid candidates were selected, skip `gh pr edit --add-reviewer` and report that clearly.
   - If fewer than 2 valid candidates were selected, use the valid subset and explain why.
5. Report the final state:
   - PR number and URL
   - whether draft status changed
   - changed files summary
   - reviewers requested
   - excluded or skipped candidates with reasons
   - any command failures or missing data

Use the smallest set of shell and `gh` commands needed after running the script. Prefer `gh pr ready` and `gh pr edit --add-reviewer` for the mutation steps.
