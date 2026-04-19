import test from "node:test";
import assert from "node:assert/strict";
import { TASK_TRACKER_TOOL_PARAMS } from "../src/tool-schema.ts";

test("task_tracker schema stays top-level object without top-level combinators", () => {
  assert.equal(TASK_TRACKER_TOOL_PARAMS.type, "object");
  assert.deepEqual(TASK_TRACKER_TOOL_PARAMS.required, ["action"]);
  assert.equal("oneOf" in TASK_TRACKER_TOOL_PARAMS, false);
  assert.equal("anyOf" in TASK_TRACKER_TOOL_PARAMS, false);
  assert.equal("allOf" in TASK_TRACKER_TOOL_PARAMS, false);
  assert.equal("enum" in TASK_TRACKER_TOOL_PARAMS, false);
  assert.equal("not" in TASK_TRACKER_TOOL_PARAMS, false);
});

test("task_tracker schema enumerates supported actions and typed fields", () => {
  const properties = TASK_TRACKER_TOOL_PARAMS.properties as Record<string, any>;
  assert.deepEqual(properties.action.enum.slice(0, 5), [
    "list_open",
    "list_open_asks",
    "list_archived",
    "create_task",
    "start_task",
  ]);
  assert.ok(properties.action.enum.includes("commit_done"));
  assert.ok(properties.action.enum.includes("cancel_ask"));
  assert.match(properties.reason.description, /verified_evidence/);
  assert.match(properties.reason.description, /user_acceptance/);
  assert.match(properties.reason.description, /manual_override/);
  assert.equal(properties.askIdsToSatisfy.type, "array");
  assert.equal(properties.evidence.type, "object");
});
