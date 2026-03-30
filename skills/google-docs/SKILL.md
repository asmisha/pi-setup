---
name: google-docs
description: Read Google Docs from the CLI, compare suggested changes, and check for comments. Use when a task references a Google Doc, asks to sync code/content from a doc, or says to account for doc comments or suggestions.
---

# Google Docs

Use this skill when work is driven by a Google Doc.

## Auth

Prefer the local CLI wrapper first:

```bash
gdocs whoami
gdocs cat <doc-url-or-id>
gdocs export <doc-url-or-id> --mime-type text/html -o /tmp/doc.html
```

If auth is missing or scopes are insufficient:

```bash
gdocs auth
# or
 gcloud auth login --enable-gdrive-access --update-adc
```

## Important rule: comments and suggestions are different

Do not assume Google Drive comments cover all review feedback.

1. Check Drive comments:

```bash
DOC_ID=...
TOKEN="$(gcloud auth print-access-token)"
curl -sS \
  -H "Authorization: Bearer $TOKEN" \
  "https://www.googleapis.com/drive/v3/files/${DOC_ID}/comments?fields=comments(id,content,resolved,quotedFileContent/value,author/displayName,replies(id,content,action,author/displayName)),nextPageToken" \
  | python3 -m json.tool
```

2. Also check Docs suggestions by comparing these two views:

```bash
curl -sS -H "Authorization: Bearer $TOKEN" \
  "https://docs.googleapis.com/v1/documents/${DOC_ID}?suggestionsViewMode=PREVIEW_WITHOUT_SUGGESTIONS" \
  -o /tmp/doc_without.json

curl -sS -H "Authorization: Bearer $TOKEN" \
  "https://docs.googleapis.com/v1/documents/${DOC_ID}?suggestionsViewMode=PREVIEW_SUGGESTIONS_ACCEPTED" \
  -o /tmp/doc_accepted.json
```

If Drive comments are empty, there may still be inline suggestions in the Docs API.

## Working approach

- Read the current code/content first.
- Export the doc text with `gdocs cat` for the baseline.
- If the user mentions comments, review both Drive comments and Docs suggestions.
- Build a verification table:
  - doc item
  - current code/content
  - planned diff
  - status
- Preserve newer repo changes if the doc contains older wording; call out the conflict explicitly.
- After implementing, re-run verification and update any PR description with the verification table.

## Notes

- `gdocs cat` is good for quick text extraction.
- `gdocs export ... --mime-type text/html` is useful when link text matters.
- Prefer evidence from API output over guessing what the doc contains.
