# Implementation Checklists

## Compact execution checklist

- [ ] Re-read the user goal and project instructions
- [ ] Search for relevant code, tests, configs, docs, and migrations
- [ ] Pick the simplest viable approach
- [ ] Add/update failing test first unless the task is genuinely trivial
- [ ] Implement the minimal change to go green
- [ ] Run targeted verification after each meaningful step
- [ ] Prefer `structured_return` over `bash` for noisy verification commands
- [ ] Run broader verification before finishing
- [ ] Review the diff for accidental scope creep
- [ ] Use a focused review subagent on non-trivial changes
