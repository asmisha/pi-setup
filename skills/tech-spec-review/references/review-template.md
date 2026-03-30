# Tech Spec Review Template

## Minimal extraction pass

Capture these from the document before reviewing:
- Goal
- Scope
- Non-goals
- Acceptance criteria
- Data model / API / workflow changes
- Rollout / migration plan
- Monitoring / observability plan
- Security and performance assumptions

## Review checklist

- [ ] The codebase has a real place for each major concept in the spec
- [ ] Interfaces and data flow match current architecture
- [ ] Rollout, migration, fallback, and observability are defined when needed
- [ ] Security boundaries and failure modes are addressed
- [ ] Scaling and performance claims match the current system shape
- [ ] The design is not more abstract or distributed than necessary
- [ ] Open questions are explicit rather than hidden in assumptions
