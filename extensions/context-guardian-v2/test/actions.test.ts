import test from "node:test";
import assert from "node:assert/strict";
import { bootstrap } from "./helpers.ts";
import { applyTaskTrackerAction } from "../src/actions.ts";
import { projectLedger } from "../src/projector.ts";
import { isWeakAcknowledgement } from "../src/utils.ts";

function createContext(nextId: (prefix: string) => string, overrides: Partial<Parameters<typeof applyTaskTrackerAction>[2]> = {}) {
  return {
    now: overrides.now ?? "2026-04-18T10:05:00.000Z",
    actor: overrides.actor ?? "assistant",
    authority: overrides.authority ?? "authoritative",
    maxInferredTasksPerTurn: overrides.maxInferredTasksPerTurn ?? 3,
    createdInferredTasksThisTurn: overrides.createdInferredTasksThisTurn ?? 0,
    nextId,
  };
}

test("inferred task creation is capped per turn", () => {
  const { state, nextId } = bootstrap();
  const result = applyTaskTrackerAction(
    state,
    { action: "create_task", title: "Tiny inferred task", kind: "inferred" },
    createContext(nextId, { createdInferredTasksThisTurn: 3, maxInferredTasksPerTurn: 3 }),
  );

  assert.equal(result.events.length, 0);
  assert.match(result.message, /cap 3 reached/i);
});

test("duplicate open tasks are deduped", () => {
  const { state, nextId } = bootstrap("Investigate auth issue");
  const result = applyTaskTrackerAction(
    state,
    { action: "create_task", title: "Investigate auth issue", kind: "user_requested" },
    createContext(nextId),
  );

  assert.equal(result.events.length, 0);
  assert.match(result.message, /skipped duplicate task/i);
});

test("user acceptance can close a done_candidate task", () => {
  const { state, events, nextId } = bootstrap("Explain result");
  const rootTaskId = state.openTaskIds[0];

  const proposed = applyTaskTrackerAction(state, { action: "propose_done", taskId: rootTaskId }, createContext(nextId));
  const candidateEvents = [...events, ...proposed.events];
  const candidateState = projectLedger(candidateEvents);

  const acceptance = applyTaskTrackerAction(
    candidateState,
    { action: "record_acceptance", taskId: rootTaskId, note: "Да, это именно то, что нужно" },
    createContext(nextId),
  );
  const withAcceptanceEvents = [...candidateEvents, ...acceptance.events];
  const acceptanceState = projectLedger(withAcceptanceEvents);

  const committed = applyTaskTrackerAction(
    acceptanceState,
    { action: "commit_done", taskId: rootTaskId, reason: "user_acceptance" },
    createContext(nextId),
  );
  const finalState = projectLedger([...withAcceptanceEvents, ...committed.events]);

  assert.equal(finalState.tasks[rootTaskId]?.status, "done");
  assert.equal(finalState.tasks[rootTaskId]?.doneReason, "user_acceptance");
});


test("commit_done can satisfy open asks in the same done-gated commit", () => {
  const { state, events, nextId } = bootstrap("Explain result");
  const rootTaskId = state.openTaskIds[0];
  const rootAskId = state.openAskIds[0];

  const proposed = applyTaskTrackerAction(state, { action: "propose_done", taskId: rootTaskId }, createContext(nextId));
  const candidateEvents = [...events, ...proposed.events];
  const candidateState = projectLedger(candidateEvents);

  const evidence = applyTaskTrackerAction(
    candidateState,
    {
      action: "add_evidence",
      taskId: rootTaskId,
      evidence: { kind: "test", ref: "npm test", summary: "All tests passed", level: "verified" },
    },
    createContext(nextId),
  );
  const withEvidenceEvents = [...candidateEvents, ...evidence.events];
  const evidenceState = projectLedger(withEvidenceEvents);

  const committed = applyTaskTrackerAction(
    evidenceState,
    { action: "commit_done", taskId: rootTaskId, reason: "verified_evidence", askIdsToSatisfy: [rootAskId] },
    createContext(nextId),
  );
  const finalState = projectLedger([...withEvidenceEvents, ...committed.events]);

  assert.equal(finalState.tasks[rootTaskId]?.status, "done");
  assert.equal(finalState.contract?.explicitAsks.find((ask) => ask.id === rootAskId)?.status, "satisfied");
  assert.deepEqual(finalState.openAskIds, []);
});

test("weak acknowledgements are not treated as implicit acceptance", () => {
  assert.equal(isWeakAcknowledgement("ок"), true);
  assert.equal(isWeakAcknowledgement("спасибо"), true);
  assert.equal(isWeakAcknowledgement("Да, задача закрыта, всё ок"), false);
});

test("cancel_ask requires manual authority or explicit user provenance", () => {
  const { state, nextId } = bootstrap("Plan work");
  const result = applyTaskTrackerAction(
    state,
    { action: "cancel_ask", askId: state.openAskIds[0] },
    createContext(nextId),
  );

  assert.equal(result.events.length, 0);
  assert.match(result.message, /manual authority or an explicit sourceMessageId/i);
});


test("start_task updates execution focus", () => {
  const { state, events, nextId } = bootstrap("Plan work");
  const created = applyTaskTrackerAction(
    state,
    { action: "create_task", title: "Read the spec", kind: "verification" },
    createContext(nextId),
  );
  const createdState = projectLedger([...events, ...created.events]);
  const newTaskId = Object.keys(createdState.tasks).find((taskId) => !state.tasks[taskId]);
  assert.ok(newTaskId);

  const started = applyTaskTrackerAction(createdState, { action: "start_task", taskId: newTaskId! }, createContext(nextId));
  const nextState = projectLedger([...events, ...created.events, ...started.events]);

  assert.equal(nextState.tasks[newTaskId!]?.status, "in_progress");
  assert.deepEqual(nextState.execution.activeTaskIds, [newTaskId!]);
  assert.equal(nextState.execution.stage, "investigating");
});
