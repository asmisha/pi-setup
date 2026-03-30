# Implementation Checklists

## Checkpoint template

Use concise checkpoint content like this:

```text
Goal: <what must be accomplished>
Verified state: <facts established from code/tests/logs>
Files changed: <paths>
Checks run: <command -> result>
Remaining work: <unfinished pieces>
Next step: <very next concrete action>
```

## Compact execution checklist

- [ ] Re-read the user goal and project instructions
- [ ] Search for relevant code, tests, configs, docs, and migrations
- [ ] Pick the simplest viable approach
- [ ] Load/save a checkpoint if the task is multi-step
- [ ] Add/update failing test first unless the task is genuinely trivial
- [ ] Implement the minimal change to go green
- [ ] Run targeted verification after each meaningful step
- [ ] Run broader verification before finishing
- [ ] Review the diff for accidental scope creep
- [ ] Use a focused review subagent on non-trivial changes
