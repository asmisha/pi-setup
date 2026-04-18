import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../src/tool-schema.ts", import.meta.url), "utf8");

test("task_tracker schema enumerates supported actions explicitly", () => {
  assert.match(source, /actionSchema\("list_open"/);
  assert.match(source, /actionSchema\("list_open_asks"/);
  assert.match(source, /actionSchema\("create_task"/);
  assert.match(source, /actionSchema\("commit_done"/);
  assert.match(source, /actionSchema\("cancel_ask"/);
  assert.doesNotMatch(source, /Type\.String\(\).*action/);
});

test("commit_done schema exposes typed done reasons and ask closure", () => {
  assert.match(source, /DoneReasonSchema/);
  assert.match(source, /askIdsToSatisfy/);
  assert.match(source, /manual_override/);
  assert.match(source, /verified_evidence/);
  assert.match(source, /user_acceptance/);
});
