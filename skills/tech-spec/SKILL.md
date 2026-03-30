---
name: tech-spec
description: Create a technical specification for a new feature or change. Use when starting a new feature that needs a written design before implementation.
---

# Tech Spec

Create a technical specification for a new feature or change.

## Feature

$ARGUMENTS

## Workflow

### Phase 1: Gather Context

Use exploration to understand:

- Existing related functionality
- Patterns and conventions in the codebase
- Dependencies and integration points
- Similar implementations to reference

### Phase 2: Create Specification

Create a spec file at `.claude-docs/specs/spec-{feature-slug}-{timestamp}.md`:

```markdown
# Technical Specification: [Feature Name]

Created: [timestamp]
Status: draft | review | approved | implemented

## Overview

**Problem**: [What problem does this solve?]
**Solution**: [High-level approach]
**Scope**: [What's in/out of scope]

## Requirements

### Functional

- [User-facing requirements]

### Non-Functional

- Performance: [expectations]
- Security: [considerations]
- Scalability: [requirements]

## Technical Design

### Architecture

[How it fits into the existing system]

### Data Model

[New/modified database schemas, types]

### API Changes

[New endpoints, modified contracts]

### Components

[New/modified components, services, etc.]

## Implementation Plan

### Phase 1: [Name]

- [ ] Task 1
- [ ] Task 2

### Phase 2: [Name]

- [ ] Task 3
- [ ] Task 4

## Testing Strategy

- Unit tests: [what to test]
- Integration tests: [what to test]
- E2E tests: [critical flows]

## Rollout Plan

- [ ] Feature flag setup
- [ ] Gradual rollout steps
- [ ] Monitoring/alerting

## Open Questions

- [Questions needing answers before implementation]

## References

- [Links to related docs, PRs, issues]
```

### Phase 3: Output

1. Create the spec file
2. Print the file path and a summary
3. Suggest running `/skill:review-spec {filepath}` to validate

## Guidelines

- Keep it concise - only include what's necessary
- Focus on decisions and rationale, not obvious details
- Link to existing code rather than duplicating
- Call out risks and unknowns explicitly
- Make implementation tasks actionable and estimable
