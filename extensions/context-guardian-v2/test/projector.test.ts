import test from "node:test";
import assert from "node:assert/strict";
import { bootstrap } from "./helpers.ts";
import { applyTaskTrackerAction } from "../src/actions.ts";
import { projectLedger, canCommitTaskDone, explainWhyTaskOpen, isRootObjectiveClosable } from "../src/projector.ts";
import { ENTRY_TYPES } from "../src/types.ts";
import { makeEventMeta } from "../src/utils.ts";

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

test("bootstrap builds immutable contract and root task", () => {
  const { state } = bootstrap("Rewrite context guardian");

  assert.equal(state.contract?.originalObjective, "Rewrite context guardian");
  assert.equal(state.contract?.activeObjective, "Rewrite context guardian");
  assert.equal(state.openAskIds.length, 1);
  assert.equal(state.openTaskIds.length, 1);
  assert.equal(state.execution.activeTaskIds.length, 1);
  assert.equal(state.execution.stage, "planning");
});

test("contract proposal stays advisory and does not mutate active contract", () => {
  const { state, events, nextId } = bootstrap("Keep objective stable");
  const proposal = applyTaskTrackerAction(
    state,
    { action: "propose_contract_change", kind: "objective", proposedValue: "Narrow the task", reason: "Seems smaller" },
    createContext(nextId),
  );

  const nextState = projectLedger([...events, ...proposal.events]);
  assert.equal(nextState.contract?.activeObjective, "Keep objective stable");
  assert.equal(nextState.contractChangeProposals.length, 1);
  assert.equal(nextState.contractChangeProposals[0]?.status, "open");
});

test("done gate rejects direct completion without verified evidence", () => {
  const { state, events, nextId } = bootstrap("Ship tests first");
  const rootTaskId = state.openTaskIds[0];

  const proposed = applyTaskTrackerAction(
    state,
    { action: "propose_done", taskId: rootTaskId, note: "Looks done" },
    createContext(nextId),
  );
  const proposedState = projectLedger([...events, ...proposed.events]);

  const gate = canCommitTaskDone(proposedState, rootTaskId, "verified_evidence");
  assert.equal(gate.ok, false);
  if (gate.ok) throw new Error("expected failed gate");
  assert.match(gate.reason, /no verified evidence/i);

  const committed = applyTaskTrackerAction(
    proposedState,
    { action: "commit_done", taskId: rootTaskId, reason: "verified_evidence" },
    createContext(nextId),
  );
  assert.equal(committed.events.length, 0);
  assert.match(committed.message, /cannot mark/i);
});

test("done_candidate closes only after verified evidence", () => {
  const { state, events, nextId } = bootstrap("Implement projector");
  const rootTaskId = state.openTaskIds[0];

  const proposed = applyTaskTrackerAction(state, { action: "propose_done", taskId: rootTaskId }, createContext(nextId));
  const withCandidateEvents = [...events, ...proposed.events];
  const candidateState = projectLedger(withCandidateEvents);

  const evidence = applyTaskTrackerAction(
    candidateState,
    {
      action: "add_evidence",
      taskId: rootTaskId,
      evidence: { kind: "test", ref: "npm test", summary: "All tests passed", level: "verified" },
    },
    createContext(nextId),
  );
  const withEvidenceEvents = [...withCandidateEvents, ...evidence.events];
  const evidenceState = projectLedger(withEvidenceEvents);

  const committed = applyTaskTrackerAction(
    evidenceState,
    { action: "commit_done", taskId: rootTaskId, reason: "verified_evidence" },
    createContext(nextId),
  );
  const finalState = projectLedger([...withEvidenceEvents, ...committed.events]);

  assert.equal(finalState.tasks[rootTaskId]?.status, "done");
  assert.equal(finalState.tasks[rootTaskId]?.doneReason, "verified_evidence");
});

test("root objective is not closable while open asks or tasks remain", () => {
  const { state } = bootstrap("Do the work");
  const closable = isRootObjectiveClosable(state);

  assert.equal(closable.ok, false);
  if (closable.ok) throw new Error("expected root objective to remain open");
  assert.ok(closable.reasons.some((reason) => reason.includes("open asks")));
  assert.ok(closable.reasons.some((reason) => reason.includes("open tasks")));
});


test("root objective becomes closable after done-gated ask satisfaction", () => {
  const { state, events, nextId } = bootstrap("Finish the work");
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
  const closable = isRootObjectiveClosable(finalState);

  assert.equal(closable.ok, true);
});

test("root task done while open asks remain emits a warning", () => {
  const { state, events, nextId } = bootstrap("Keep root open");
  const rootTaskId = state.openTaskIds[0];

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
    { action: "commit_done", taskId: rootTaskId, reason: "verified_evidence" },
    createContext(nextId),
  );
  const finalState = projectLedger([...withEvidenceEvents, ...committed.events]);

  assert.ok(finalState.warnings.some((warning) => warning.includes("Root task") && warning.includes("root objective remains open")));
});


test("execution.waitingFor=user is normalized away without open asks or awaiting_user tasks", () => {
  const now = "2026-04-18T11:00:00.000Z";
  const state = projectLedger([
    {
      type: ENTRY_TYPES.executionUpdated,
      ...makeEventMeta("system", "authoritative", now),
      payload: {
        patch: {
          waitingFor: "user",
          stage: "awaiting_user",
          activeTaskIds: [],
          nextAction: "wait",
          blocker: "none",
          lastMeaningfulProgress: "none",
        },
      },
    },
  ]);

  assert.equal(state.execution.waitingFor, "nothing");
  assert.ok(state.warnings.some((warning) => warning.includes("waitingFor=user")));
});

test("advisory cannot silently close an open task", () => {
  const { state, events, nextId } = bootstrap("Keep task open");
  const rootTaskId = state.openTaskIds[0];
  const advisoryEvent = {
    type: ENTRY_TYPES.advisoryStored,
    ...makeEventMeta("system", "advisory", "2026-04-18T12:00:00.000Z"),
    payload: {
      advisory: {
        version: 2,
        latestUserIntent: "Keep task open",
        recentFocus: ["Tried to finish"],
        suggestedNextAction: "do more work",
        blockers: [],
        relevantFiles: [],
        artifacts: [],
        avoidRepeating: ["do not claim done"],
        unresolvedQuestions: [],
        updatedAt: "2026-04-18T12:00:00.000Z",
      },
    },
  } as const;

  const nextState = projectLedger([...events, advisoryEvent]);
  assert.equal(nextState.tasks[rootTaskId]?.status, "in_progress");
  assert.match(explainWhyTaskOpen(nextState, rootTaskId), /status=in_progress/);
});
