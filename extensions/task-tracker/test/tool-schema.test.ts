import test from "node:test";
import assert from "node:assert/strict";
import { TASK_TRACKER_TOOL_PARAMS } from "../src/tool-schema.ts";

test("task_tracker schema stays top-level object without top-level combinators", () => {
  assert.equal(TASK_TRACKER_TOOL_PARAMS.type, "object");
  assert.deepEqual(TASK_TRACKER_TOOL_PARAMS.required, ["actions"]);
  assert.equal("oneOf" in TASK_TRACKER_TOOL_PARAMS, false);
  assert.equal("anyOf" in TASK_TRACKER_TOOL_PARAMS, false);
  assert.equal("allOf" in TASK_TRACKER_TOOL_PARAMS, false);
  assert.equal("enum" in TASK_TRACKER_TOOL_PARAMS, false);
  assert.equal("not" in TASK_TRACKER_TOOL_PARAMS, false);
});

test("task_tracker schema requires actions[] and enumerates atomic action fields", () => {
  const properties = TASK_TRACKER_TOOL_PARAMS.properties as Record<string, any>;
  const actionItem = properties.actions.items as Record<string, any>;
  const actionProperties = actionItem.properties as Record<string, any>;

  assert.equal(properties.actions.type, "array");
  assert.equal(properties.actions.minItems, 1);
  assert.equal(actionItem.type, "object");
  assert.deepEqual(actionItem.required, ["action"]);
  assert.deepEqual(actionProperties.action.enum.slice(0, 5), [
    "list_open",
    "list_open_asks",
    "list_archived",
    "create_task",
    "start_task",
  ]);
  assert.ok(actionProperties.action.enum.includes("commit_done"));
  assert.ok(actionProperties.action.enum.includes("cancel_ask"));
  assert.equal(actionProperties.kind.oneOf.length, 2);
  assert.match(actionProperties.reason.description, /verified_evidence/);
  assert.match(actionProperties.reason.description, /user_acceptance/);
  assert.match(actionProperties.reason.description, /manual_override/);
  assert.equal(actionProperties.askIdsToSatisfy.type, "array");
  assert.equal(actionProperties.evidence.type, "object");
});

test("actions[] item schema exposes alias fields without nested bulk mode", () => {
  const properties = TASK_TRACKER_TOOL_PARAMS.properties as Record<string, any>;
  const actionItem = properties.actions.items as Record<string, any>;
  const actionProperties = actionItem.properties as Record<string, any>;

  assert.match(actionProperties.taskAlias.description, /\$alias/);
  assert.match(actionProperties.evidenceAlias.description, /\$alias/);
  assert.equal(actionProperties.action.enum.includes("bulk"), false);
});
