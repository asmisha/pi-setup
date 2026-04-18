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
  assert.equal(renderTodoStatusText(snapshot), "CG2 · planning");

  const lines = renderTodoWidgetText(snapshot);
  assert.equal(lines[0], "CG2 planning — 1 asks");
  assert.ok(lines.includes("No explicit subtasks yet."));
  assert.ok(lines.some((line) => line.startsWith("Next: Clarify scope and produce an initial plan.")));
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
  assert.equal(lines.some((line) => line.includes("Ship CG2 widget")), false);
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
