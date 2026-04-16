---
name: linear
description: Investigate Linear issues and documents through Executor. Use when the user asks about a Linear issue URL/ID, issue details, project status, comments, or Linear documents.
---

# Linear via Executor in Pi

This Pi setup accesses Linear through Executor's `execute` tool, not the old `mcp` proxy.

## Required setup

- Load the `executor-usage` skill before the first `execute` call.
- If Linear is not configured in Executor yet, stop and tell the user to add the Linear MCP source in Executor and finish OAuth.
- If the user provides a Linear URL/ID or asks about Linear issue/document state, query Linear through Executor before answering. Do not answer from the URL slug, repo state, or guesswork alone.

## Discovery workflow

Inside `execute`:

1. Search first:
   - `const matches = await tools.search({ query: "linear issue document comment project", limit: 10 });`
2. If the namespace is unclear, inspect configured sources:
   - `await tools.executor.sources.list({})`
3. Describe unfamiliar tools before calling them:
   - `await tools.describe.tool({ path })`
4. Call the selected tool through its full namespace path.
   - If the source was added with namespace `linear`, calls will look like `tools.linear.<tool>(args)`.
   - If the user kept Executor's auto-derived namespace, use the path returned by `tools.search(...)`.

## Auth behavior

- Executor handles OAuth and approval flows in its UI.
- In Pi UI sessions, let `execute` handle the interaction inline.
- In headless sessions, if execution pauses for auth or approval, report that clearly instead of guessing.

## Suggested patterns

### Given a Linear issue ID or URL

1. Resolve the issue tool via search
2. Fetch the issue details
3. Extract:
   - issue identifier
   - title and description
   - status / assignee / project
   - linked documents or attachments if present
4. If needed, follow up with comments, linked docs, or project details

### Given a Linear document request

1. Search for document tools
2. Fetch the document by URL, slug, or ID
3. Summarize:
   - title
   - linked issue
   - last updated time
   - main content / decisions

### Given an update request

1. Search for the smallest tool that can do the update
2. Describe it if the parameters are unclear
3. Confirm destructive changes before overwriting content

## Reporting guidance

When summarizing Linear findings, separate:

- **OBSERVED**: exact issue fields, status, assignee, comments, linked docs
- **CORRELATED**: relationships between ticket state, docs, and implementation context
- **HYPOTHESIZED**: inferred intent, rollout plan, or root cause not stated directly in Linear

Do not invent issue fields, document content, or workflow state names. Search/describe first when tool names or parameters are uncertain.
