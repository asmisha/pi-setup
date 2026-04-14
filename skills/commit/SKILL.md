---
name: commit
description: Run quality checks (format, credo, compile) and generate a conventional commit message for staged changes. Use when preparing to commit code.
---

# Commit

Run quality checks for staged changes and prepare a conventional commit.

**Default rule:** Do NOT stage any changes. Only operate on what is already staged by the user.

**Explicit-user-override:** If the user clearly and directly asks you to stage files or otherwise perform git operations yourself (for example `git add`, commit, push, branch creation, or PR creation), you may do so. When using this override, perform only the git operations the user asked for, keep the scope tight, and avoid including obviously generated artifacts unless the user explicitly wants them committed.

## Voice for branch + commit naming

When the user asks for a new branch before commit, or asks you to commit and create a branch as part of the workflow, do not invent the branch name or commit message yourself.

Instead:

1. Launch a subagent with `skill: writing-voice`.
2. Give it the verified diff, branch context, and user request.
3. Ask it to return both:
   - a branch name
   - a conventional commit message
4. Do a final factual pass yourself, then use those outputs.

If the user explicitly asked for a new branch:
- create the branch with the subagent-generated branch name before committing
- then commit with the subagent-generated commit message

If the user did not ask for a new branch:
- only the commit message needs to come from the `writing-voice` subagent when you are preparing the final commit text

## Steps

1. Run `alto format staged` to format staged files
2. Run `alto credo` and `alto compile` **in parallel** (use multiple Bash tool calls in a single message)
3. If all checks pass, get the final commit message, and if needed the branch name, from a subagent that explicitly loads `writing-voice`
4. If the user explicitly asked for a new branch, create it before committing
5. If the user explicitly asked you to commit, run `git commit` with that message. Otherwise, print the suggested branch name (if applicable) and commit message.
6. If the user also asked to create a PR or draft PR, generate the PR title/body from the verified diff and tests, then create or update the PR.

If any step fails, stop and report the error.

**Important:** Filter verbose output to keep context clean. Pipe commands through grep to remove noise:

```bash
alto format staged 2>&1 | grep -v -E "^Checking|Please report|Analysis took|mods/funs|Use \`mix credo|^running credo|^Running credo|Showing priority" | head -100
alto credo 2>&1 | grep -v -E "^[0-9]+>|^==>|Compiling|Generated|^Checking|Please report|Analysis took|mods/funs|Use \`mix credo|^running credo|^Running credo|Showing priority" | head -100
alto compile 2>&1 | grep -v -E "^[0-9]+>|^==>|Compiling|Generated" | head -100
```

Check exit codes with `$?` after each command to detect failures.

## Commit Message Format

Use conventional commits format:

- `feat:` - new feature
- `fix:` - bug fix
- `chore:` - maintenance tasks
- `refactor:` - code refactoring
- `docs:` - documentation changes
- `test:` - adding or updating tests

For feature branch work, include the ticket number: `feat(ukids): SEL-XXX description`

Keep the first line under 72 characters. Add a blank line and detailed description if needed.

## PR Issue Linking Rules

When generating a PR description as part of the commit workflow:

- Use **verified tracker-specific linking syntax**, not prose references.
- **Linear:** if the PR should close the ticket and you have the exact ticket, prefer `Resolves [RVR-12345](https://linear.app/...)`. If it should not close the ticket, use `Linear: https://linear.app/...`.
- **Sentry:** use a dedicated standalone line in the PR body: `Fixes [WEB-FH8](https://river-financial.sentry.io/issues/WEB-FH8/)`.
- The Sentry line must be on its **own separate line**, not embedded inside a paragraph.
- The Sentry short issue ID must always be a **markdown link to the Sentry issue URL itself**.
- Do not use bare numeric issue IDs like `6250241855`, and do not rely on the full Sentry URL alone without the linked short ID.
- If you do not have a verified Sentry short ID, Sentry issue URL, or exact Linear URL, say that explicitly instead of inventing one.

## Branch Name Format

When a branch name is requested, have the `writing-voice` subagent generate a short, concrete branch name that matches the actual change. Prefer lowercase kebab-case and include the ticket number when the repo or branch context calls for it.

Examples:

- `fix/user-lock-nullable-init`
- `sel-123-user-lock-nullable`
- `feat/immediate-user-lock-columns`
