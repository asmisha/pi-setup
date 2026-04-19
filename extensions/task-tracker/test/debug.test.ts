import test from "node:test";
import assert from "node:assert/strict";
import { bootstrap } from "./helpers.ts";
import { applyTaskTrackerAction } from "../src/actions.ts";
import { renderProjectedState } from "../src/debug.ts";
import { projectLedger } from "../src/projector.ts";

test("renderProjectedState includes contract summary and proposal status", () => {
  const { state, events, nextId } = bootstrap("Summarize tracker state");
  const proposed = applyTaskTrackerAction(
    state,
    { action: "propose_contract_change", kind: "constraints", proposedValue: ["Stay minimal"], reason: "User requested smaller scope" },
    {
      now: "2026-04-19T13:00:00.000Z",
      actor: "assistant",
      authority: "authoritative",
      maxInferredTasksPerTurn: 3,
      createdInferredTasksThisTurn: 0,
      nextId,
    },
  );

  const rendered = renderProjectedState(projectLedger([...events, ...proposed.events]));
  assert.match(rendered, /Original objective: Summarize tracker state/);
  assert.match(rendered, /Active objective: Summarize tracker state/);
  assert.match(rendered, /Contract proposals: /);
});
