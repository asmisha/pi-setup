---
name: linear
description: Investigate Linear issues and documents through Pi's MCP proxy. Use when the user asks about a Linear issue URL/ID, issue details, project status, comments, or Linear documents.
---

# Linear MCP Usage in Pi

This Pi setup accesses Linear through the single `mcp` proxy tool, backed by `mcp-remote`.

## Important Context Rules

- Do **not** expect first-class `linear_*` tools in Pi's normal tool list by default.
- If the user provides a Linear URL/ID or asks about Linear issue/document state, query Linear via the `mcp` tool before answering. Do not answer from the URL slug, repo state, or guesswork alone.
- Keep context small:
  1. search tools first,
  2. describe the selected tool if needed,
  3. call only the specific tool you need.
- `mcp.args` must be a **JSON string**, not an object.

## Auth Behavior

- Linear auth is handled by `mcp-remote` with browser-based OAuth.
- On first use, a browser may open for authorization.
- If auth is required, tell the user to finish the browser flow and retry the same `mcp` call.
- The verified Linear MCP endpoint configured in Pi is:
  - `https://mcp.linear.app/mcp`

## Server Name

Always target server:

- `linear`

## Discovery Workflow

1. List/search Linear tools through `mcp`:
   - `mcp({ server: "linear" })`
   - `mcp({ search: "linear issue document comment project", server: "linear" })`
2. If parameters are unclear, describe the tool:
   - `mcp({ describe: "linear_<tool_name>" })`
3. Call the selected tool:
   - `mcp({ tool: "linear_<tool_name>", server: "linear", args: "{\"id\":\"...\"}" })`

## Suggested Patterns

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

## Reporting Guidance

When summarizing Linear findings, separate:

- **OBSERVED**: exact issue fields, status, assignee, comments, linked docs
- **CORRELATED**: relationships between ticket state, docs, and implementation context
- **HYPOTHESIZED**: inferred intent, rollout plan, or root cause not stated directly in Linear

Do not invent issue fields, document content, or workflow state names. Search/describe first when tool names or parameters are uncertain.
