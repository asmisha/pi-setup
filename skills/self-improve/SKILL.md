---
name: self-improve
description: Analyze recent agent session failures against user feedback, then propose precise prompt/config changes. Use when the user is unhappy with agent behavior and wants to improve prompts, skills, or agent definitions.
---

# Self-Improve

Use this skill when the user provides feedback (explicit or implicit) that recent agent work was wrong, suboptimal, or misaligned. The goal is to trace the failure to specific prompt text and propose minimal, precise edits — not blanket additions.

## Core principle

Context window tokens are precious. Every byte in a prompt must earn its place. The default action is to **edit or remove** existing prompt text, not add new text. New text is a last resort when no existing section covers the gap.

## Required workflow

### 1. Gather evidence (orchestrator)

Collect the following and write them to temp files:

**a) Recent session context:**
```bash
# Get the current session file (most recent .jsonl in the session dir)
SESSION_DIR=~/.pi/agent/sessions/--$(echo "$PWD" | sed 's|/|-|g; s|^-||')--
ls -t "$SESSION_DIR"/*.jsonl | head -1
```

**b) Extract the relevant conversation tail:**
Use `tail` on the session .jsonl to get the last ~100 lines (recent turns). Write to `/tmp/self-improve-session.jsonl`.

**c) Gather subagent artifacts from the session:**
List recent subagent artifacts (inputs, outputs, meta) sorted by time. Write paths to `/tmp/self-improve-artifacts.txt`.
```bash
ls -lt ~/.pi/agent/sessions/*/subagent-artifacts/*_meta.json | head -20
```

**d) Identify the user's feedback:**
The user's most recent message(s) expressing dissatisfaction — extract the specific complaint.

**e) Collect the prompt files that were active in the session:**
- `~/.pi/agent/AGENTS.md`
- `~/.pi/agent/APPEND_SYSTEM.md`
- `~/.pi/agent/extensions/workflow-foundation/index.ts` (the FOUNDATION_PROMPT)
- Any skill SKILL.md files that were loaded (check subagent meta for `skills` field)
- Any agent .md files that were used (check subagent meta for `agent` field, then read `~/.pi/agent/agents/<agent>.md`)

Write the list of active prompt files and their paths to `/tmp/self-improve-prompts.txt`.

### 2. Delegate root cause analysis

Launch a **single subagent** with `model: openai-codex/gpt-5.4` and thinking enabled. Give it:
- Path to the session tail (`/tmp/self-improve-session.jsonl`)
- Paths to relevant subagent artifacts (inputs + outputs that relate to the failure)
- The user's feedback text
- Paths to all prompt files that were active

The subagent's task:

```
You are analyzing why an AI agent session produced a result the user is unhappy with.

## Inputs
- Session tail: {session_file}
- Subagent artifacts: {artifact_paths}
- User feedback: "{feedback_text}"
- Active prompt files: {prompt_file_paths}

## Your job

1. Read the session tail and subagent artifacts to understand what happened.
2. Read the user feedback to understand what SHOULD have happened.
3. Read every active prompt file.
4. Trace the failure to specific prompt text (or absence of text) that caused the wrong behavior.

## Analysis requirements

For each identified issue:
- Quote the exact prompt text that caused the problem (file path + the text)
- Explain the causal chain: how this text led to the observed failure
- Classify: is this a MISSING rule, a VAGUE rule, a CONTRADICTORY rule, or a WRONG rule?

## Output format

Write your analysis to /tmp/self-improve-analysis.md with this structure:

### Root Cause Analysis

For each issue found:

#### Issue N: <short title>
- **Type**: MISSING | VAGUE | CONTRADICTORY | WRONG
- **File**: <path to prompt file>
- **Current text**: <exact quote or "N/A" if missing>
- **Causal chain**: <how this text → observed failure>
- **Impact**: How many tokens does the current text use? Is it worth its cost?
```

### 3. Delegate change proposal

After root cause analysis completes, launch another subagent with `model: openai-codex/gpt-5.4` and thinking enabled. Give it:
- The analysis from step 2 (`/tmp/self-improve-analysis.md`)
- Paths to all active prompt files (so it can read current content)
- The user's original feedback

The subagent's task:

```
You are proposing precise prompt edits to fix agent behavior issues.

## Inputs
- Root cause analysis: /tmp/self-improve-analysis.md
- Active prompt files: {prompt_file_paths}
- User feedback: "{feedback_text}"

## Constraints

1. PREFER editing existing text over adding new text. Every prompt byte costs context window tokens on every turn.
2. If existing text is vague, make it precise — don't add a second rule that says the same thing differently.
3. If text is contradictory, remove the wrong part — don't add a third rule to arbitrate.
4. If text is missing, add the minimum necessary — one precise sentence beats a paragraph.
5. Never add subjective qualifiers ("be careful", "try to", "when appropriate"). Use concrete, testable language.
6. Consider whether the fix belongs in APPEND_SYSTEM.md (global, always loaded), FOUNDATION_PROMPT (global, always loaded), a skill SKILL.md (loaded on demand), or an agent .md (loaded per subagent invocation). Put it in the narrowest scope that covers the problem.
7. Measure the token impact: how many tokens does the edit add/remove net?

## Output format

Write to /tmp/self-improve-proposal.md:

### Proposed Changes

For each change:

#### Change N: <short title>
- **File**: <path>
- **Action**: EDIT | DELETE | ADD
- **Current text** (if edit/delete):
```
<exact current text>
```
- **Proposed text** (if edit/add):
```
<exact new text>
```
- **Net token impact**: +N / -N tokens (estimate)
- **Rationale**: <why this fixes the root cause without bloating the prompt>
- **Risk**: <what could go wrong with this change>
```

### 4. Present to user (orchestrator)

Read `/tmp/self-improve-proposal.md` and present it to the user. For each proposed change:
- Show the file, the current text, and the proposed replacement
- Show the net token impact
- Show the rationale

**Do NOT apply any changes.** Wait for the user to approve, modify, or reject each change individually.

## Anti-patterns

- Do NOT add generic "be more careful" rules. They waste tokens and don't change behavior.
- Do NOT add rules that duplicate what FOUNDATION_PROMPT already says.
- Do NOT propose changes to files you haven't read.
- Do NOT propose adding text without first checking if existing text could be edited to cover the gap.
- Do NOT conflate "the agent made a mistake" with "the prompt needs changing" — some failures are one-off reasoning errors, not systemic prompt issues. Say so when that's the case.
