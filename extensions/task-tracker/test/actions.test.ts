import test from "node:test";
import assert from "node:assert/strict";
import { bootstrap } from "./helpers.ts";
import { applyTaskTrackerAction, applyTaskTrackerInput } from "../src/actions.ts";
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

test("start_task accumulates parallel sibling work without reviving the root objective lane", () => {
  const { state, events, nextId } = bootstrap("Parallel plan work");
  const createdOne = applyTaskTrackerAction(
    state,
    { action: "create_task", title: "Read the spec", kind: "verification" },
    createContext(nextId),
  );
  const stateOne = projectLedger([...events, ...createdOne.events]);
  const firstTaskId = Object.keys(stateOne.tasks).find((taskId) => !state.tasks[taskId]);
  assert.ok(firstTaskId);

  const createdTwo = applyTaskTrackerAction(
    stateOne,
    { action: "create_task", title: "Audit callers", kind: "verification" },
    createContext(nextId, { now: "2026-04-18T10:06:00.000Z" }),
  );
  const stateTwo = projectLedger([...events, ...createdOne.events, ...createdTwo.events]);
  const secondTaskId = Object.keys(stateTwo.tasks).find((taskId) => !stateOne.tasks[taskId]);
  assert.ok(secondTaskId);

  const firstStarted = applyTaskTrackerAction(
    stateTwo,
    { action: "start_task", taskId: firstTaskId! },
    createContext(nextId, { now: "2026-04-18T10:07:00.000Z" }),
  );
  const firstStartedState = projectLedger([...events, ...createdOne.events, ...createdTwo.events, ...firstStarted.events]);

  const secondStarted = applyTaskTrackerAction(
    firstStartedState,
    { action: "start_task", taskId: secondTaskId! },
    createContext(nextId, { now: "2026-04-18T10:08:00.000Z" }),
  );
  const finalState = projectLedger([...events, ...createdOne.events, ...createdTwo.events, ...firstStarted.events, ...secondStarted.events]);

  assert.deepEqual(finalState.execution.activeTaskIds, [firstTaskId!, secondTaskId!]);
  assert.equal(finalState.execution.activeTaskIds.includes(state.openTaskIds[0]!), false);
});

test("blocking one parallel lane keeps runnable sibling work active", () => {
  const { state, events, nextId } = bootstrap("Parallel blockers");
  const createdOne = applyTaskTrackerAction(
    state,
    { action: "create_task", title: "Read the spec", kind: "verification" },
    createContext(nextId),
  );
  const stateOne = projectLedger([...events, ...createdOne.events]);
  const firstTaskId = Object.keys(stateOne.tasks).find((taskId) => !state.tasks[taskId]);
  assert.ok(firstTaskId);

  const createdTwo = applyTaskTrackerAction(
    stateOne,
    { action: "create_task", title: "Audit callers", kind: "verification" },
    createContext(nextId, { now: "2026-04-18T10:06:00.000Z" }),
  );
  const stateTwo = projectLedger([...events, ...createdOne.events, ...createdTwo.events]);
  const secondTaskId = Object.keys(stateTwo.tasks).find((taskId) => !stateOne.tasks[taskId]);
  assert.ok(secondTaskId);

  const firstStarted = applyTaskTrackerAction(
    stateTwo,
    { action: "start_task", taskId: firstTaskId! },
    createContext(nextId, { now: "2026-04-18T10:07:00.000Z" }),
  );
  const firstStartedState = projectLedger([...events, ...createdOne.events, ...createdTwo.events, ...firstStarted.events]);
  const secondStarted = applyTaskTrackerAction(
    firstStartedState,
    { action: "start_task", taskId: secondTaskId! },
    createContext(nextId, { now: "2026-04-18T10:08:00.000Z" }),
  );
  const secondStartedState = projectLedger([...events, ...createdOne.events, ...createdTwo.events, ...firstStarted.events, ...secondStarted.events]);

  const blocked = applyTaskTrackerAction(
    secondStartedState,
    { action: "block_task", taskId: firstTaskId!, reason: "Need API owner" },
    createContext(nextId, { now: "2026-04-18T10:09:00.000Z" }),
  );
  const finalState = projectLedger([...events, ...createdOne.events, ...createdTwo.events, ...firstStarted.events, ...secondStarted.events, ...blocked.events]);

  assert.deepEqual(finalState.execution.activeTaskIds, [secondTaskId!]);
  assert.equal(finalState.execution.waitingFor, "nothing");
  assert.equal(finalState.execution.blocker, null);
  assert.equal(finalState.tasks[firstTaskId!]?.status, "blocked");
});

test("actions[] can create, reference, and complete a task in one call", () => {
  const { state, events, nextId } = bootstrap("Bulk plan work");

  const result = applyTaskTrackerInput(
    state,
    events,
    {
      actions: [
        { action: "create_task", title: "Investigate logs", kind: "verification", taskAlias: "lane" },
        { action: "start_task", taskId: "$lane" },
        {
          action: "add_evidence",
          taskId: "$lane",
          evidence: { kind: "test", ref: "npm test", summary: "All tests passed", level: "verified" },
          evidenceAlias: "tests",
        },
        { action: "propose_done", taskId: "$lane", note: "Verified by tests" },
        { action: "commit_done", taskId: "$lane", reason: "verified_evidence", evidenceIds: ["$tests"] },
      ],
    },
    createContext(nextId),
  );
  const finalState = projectLedger([...events, ...result.events]);
  const createdTask = Object.values(finalState.tasks).find((task) => task.title === "Investigate logs");

  assert.match(result.message, /Applied task_tracker actions/i);
  assert.ok(createdTask);
  assert.equal(createdTask?.status, "done");
  assert.equal(createdTask?.evidence.length, 1);
  assert.equal(createdTask?.doneReason, "verified_evidence");
});

test("actions[] abort without partial events when a later step is rejected", () => {
  const { state, events, nextId } = bootstrap("Bulk plan work");

  const result = applyTaskTrackerInput(
    state,
    events,
    {
      actions: [
        { action: "create_task", title: "Investigate logs", kind: "verification", taskAlias: "lane" },
        { action: "start_task", taskId: "$lane" },
        { action: "commit_done", taskId: "$lane", reason: "verified_evidence" },
      ],
    },
    createContext(nextId),
  );
  const finalState = projectLedger([...events, ...result.events]);

  assert.equal(result.events.length, 0);
  assert.equal(result.ok, false);
  assert.match(result.message, /Batched task_tracker call failed at step 3/i);
  assert.equal(Object.values(finalState.tasks).some((task) => task.title === "Investigate logs"), false);
});

test("awaiting user on one parallel lane keeps runnable sibling work active", () => {
  const { state, events, nextId } = bootstrap("Parallel user wait");
  const createdOne = applyTaskTrackerAction(
    state,
    { action: "create_task", title: "Read the spec", kind: "verification" },
    createContext(nextId),
  );
  const stateOne = projectLedger([...events, ...createdOne.events]);
  const firstTaskId = Object.keys(stateOne.tasks).find((taskId) => !state.tasks[taskId]);
  assert.ok(firstTaskId);

  const createdTwo = applyTaskTrackerAction(
    stateOne,
    { action: "create_task", title: "Audit callers", kind: "verification" },
    createContext(nextId, { now: "2026-04-18T10:06:00.000Z" }),
  );
  const stateTwo = projectLedger([...events, ...createdOne.events, ...createdTwo.events]);
  const secondTaskId = Object.keys(stateTwo.tasks).find((taskId) => !stateOne.tasks[taskId]);
  assert.ok(secondTaskId);

  const firstStarted = applyTaskTrackerAction(
    stateTwo,
    { action: "start_task", taskId: firstTaskId! },
    createContext(nextId, { now: "2026-04-18T10:07:00.000Z" }),
  );
  const firstStartedState = projectLedger([...events, ...createdOne.events, ...createdTwo.events, ...firstStarted.events]);
  const secondStarted = applyTaskTrackerAction(
    firstStartedState,
    { action: "start_task", taskId: secondTaskId! },
    createContext(nextId, { now: "2026-04-18T10:08:00.000Z" }),
  );
  const secondStartedState = projectLedger([...events, ...createdOne.events, ...createdTwo.events, ...firstStarted.events, ...secondStarted.events]);

  const waiting = applyTaskTrackerAction(
    secondStartedState,
    { action: "await_user", taskId: firstTaskId!, reason: "Need product choice" },
    createContext(nextId, { now: "2026-04-18T10:09:00.000Z" }),
  );
  const finalState = projectLedger([...events, ...createdOne.events, ...createdTwo.events, ...firstStarted.events, ...secondStarted.events, ...waiting.events]);

  assert.deepEqual(finalState.execution.activeTaskIds, [secondTaskId!]);
  assert.equal(finalState.execution.waitingFor, "nothing");
  assert.equal(finalState.execution.blocker, null);
  assert.equal(finalState.execution.stage, "investigating");
  assert.equal(finalState.tasks[firstTaskId!]?.status, "awaiting_user");
});
