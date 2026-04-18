import test from "node:test";
import assert from "node:assert/strict";
import { ENTRY_TYPES } from "../src/types.ts";
import { makeEventMeta } from "../src/utils.ts";
import { projectLedger } from "../src/projector.ts";
import { buildTodoWidgetSnapshot, renderTodoStatusText, renderTodoWidgetText } from "../src/widget.ts";
import { applyAction, bootstrap } from "./helpers.ts";

test("widget shows planning state before explicit subtasks exist", () => {
  const { state } = bootstrap("Ship CG2 widget");
  const snapshot = buildTodoWidgetSnapshot(state);
  assert(snapshot);
  assert.equal(snapshot.mode, "planning");
  assert.equal(renderTodoStatusText(snapshot), "CG2 · planning · 1 ask");

  const lines = renderTodoWidgetText(snapshot);
  assert.equal(lines[0], "CG2 planning · 1 ask");
  assert.equal(lines.some((line) => line.startsWith("Goal:")), false);
  assert.equal(lines[1], "Ask: Ship CG2 widget");
  assert.ok(lines.includes("Hint: break this into explicit subtasks."));
  assert.equal(lines.some((line) => line.startsWith("Next:")), false);
});

test("widget hides the bootstrap root task once explicit subtasks exist", () => {
  const boot = bootstrap("Ship CG2 widget");
  const created = applyAction(
    boot.state,
    { action: "create_task", title: "Implement todo widget", kind: "followup" },
    { priorEvents: boot.events, nextId: boot.nextId },
  );
  const subtaskId = created.nextState.openTaskIds.find((taskId) => taskId !== boot.state.openTaskIds[0]);
  assert.ok(subtaskId);

  const started = applyAction(
    created.nextState,
    { action: "start_task", taskId: subtaskId },
    { priorEvents: created.nextEvents, nextId: boot.nextId, now: "2026-04-18T10:10:00.000Z" },
  );

  const snapshot = buildTodoWidgetSnapshot(started.nextState);
  assert(snapshot);
  assert.equal(snapshot.mode, "active");
  assert.equal(snapshot.tasks[0]?.title, "Implement todo widget");
  assert.equal(snapshot.tasks[0]?.status, "in_progress");

  const lines = renderTodoWidgetText(snapshot);
  assert.ok(lines.some((line) => line.includes("Implement todo widget")));
  assert.equal(lines.some((line) => /^(?:→|•|⛔|\?|✓) Ship CG2 widget$/.test(line)), false);
});

test("widget only shows next action once explicit subtasks exist", () => {
  const boot = bootstrap("Ship CG2 widget");
  const created = applyAction(
    boot.state,
    { action: "create_task", title: "Implement todo widget", kind: "followup" },
    { priorEvents: boot.events, nextId: boot.nextId },
  );

  const lines = renderTodoWidgetText(buildTodoWidgetSnapshot(created.nextState));
  assert.ok(lines.some((line) => line.startsWith("Ask:")));
  assert.ok(lines.some((line) => line.startsWith("Next:")));
});

test("widget prioritizes blocked tasks and surfaces reasons", () => {
  const boot = bootstrap("Ship CG2 widget");
  const firstCreated = applyAction(
    boot.state,
    { action: "create_task", title: "Implement todo widget", kind: "followup" },
    { priorEvents: boot.events, nextId: boot.nextId },
  );
  const secondCreated = applyAction(
    firstCreated.nextState,
    { action: "create_task", title: "Verify search ownership", kind: "verification" },
    { priorEvents: firstCreated.nextEvents, nextId: boot.nextId, now: "2026-04-18T10:06:00.000Z" },
  );

  const implementTaskId = secondCreated.nextState.openTaskIds.find((taskId) => secondCreated.nextState.tasks[taskId]?.title === "Implement todo widget");
  const verifyTaskId = secondCreated.nextState.openTaskIds.find((taskId) => secondCreated.nextState.tasks[taskId]?.title === "Verify search ownership");
  assert.ok(implementTaskId);
  assert.ok(verifyTaskId);

  const started = applyAction(
    secondCreated.nextState,
    { action: "start_task", taskId: implementTaskId! },
    { priorEvents: secondCreated.nextEvents, nextId: boot.nextId, now: "2026-04-18T10:07:00.000Z" },
  );
  const blocked = applyAction(
    started.nextState,
    { action: "block_task", taskId: verifyTaskId!, reason: "Need service ownership decision" },
    { priorEvents: started.nextEvents, nextId: boot.nextId, now: "2026-04-18T10:08:00.000Z" },
  );

  const lines = renderTodoWidgetText(buildTodoWidgetSnapshot(blocked.nextState));
  const blockedIndex = lines.findIndex((line) => line.startsWith("⛔ Verify search ownership"));
  const activeIndex = lines.findIndex((line) => line.startsWith("→ Implement todo widget"));
  assert.ok(blockedIndex >= 0);
  assert.ok(activeIndex >= 0);
  assert.ok(blockedIndex < activeIndex);
  assert.ok(lines.some((line) => line.includes("Need service ownership decision")));
});

test("done candidates stay visually distinct from done", () => {
  const boot = bootstrap("Ship CG2 widget");
  const created = applyAction(
    boot.state,
    { action: "create_task", title: "Summarize result", kind: "followup" },
    { priorEvents: boot.events, nextId: boot.nextId },
  );
  const taskId = created.nextState.openTaskIds.find((candidateId) => created.nextState.tasks[candidateId]?.title === "Summarize result");
  assert.ok(taskId);

  const proposed = applyAction(
    created.nextState,
    { action: "propose_done", taskId: taskId! },
    { priorEvents: created.nextEvents, nextId: boot.nextId, now: "2026-04-18T10:06:00.000Z" },
  );

  const lines = renderTodoWidgetText(buildTodoWidgetSnapshot(proposed.nextState));
  assert.ok(lines.some((line) => line.startsWith("◇ Summarize result")));
  assert.ok(lines.some((line) => line.includes("needs evidence or explicit acceptance")));
});

test("todo widget output is stable across advisory compaction events", () => {
  const boot = bootstrap("Ship CG2 widget");
  const created = applyAction(
    boot.state,
    { action: "create_task", title: "Implement todo widget", kind: "followup" },
    { priorEvents: boot.events, nextId: boot.nextId },
  );

  const beforeLines = renderTodoWidgetText(buildTodoWidgetSnapshot(created.nextState));

  const afterState = projectLedger([
    ...created.nextEvents,
    {
      type: ENTRY_TYPES.advisoryStored,
      ...makeEventMeta("system", "advisory", "2026-04-18T10:15:00.000Z"),
      payload: {
        advisory: {
          version: 2,
          latestUserIntent: "Ship CG2 widget",
          recentFocus: ["Investigated widget rendering"],
          suggestedNextAction: "Wire the widget into session lifecycle hooks",
          blockers: [],
          relevantFiles: ["extensions/context-guardian-v2/index.ts"],
          artifacts: [],
          avoidRepeating: [],
          unresolvedQuestions: [],
          updatedAt: "2026-04-18T10:15:00.000Z",
        },
      },
    },
  ]);

  const afterLines = renderTodoWidgetText(buildTodoWidgetSnapshot(afterState));
  assert.deepEqual(afterLines, beforeLines);
});
