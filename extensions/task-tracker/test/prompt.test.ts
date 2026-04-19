import test from "node:test";
import assert from "node:assert/strict";
import { bootstrap } from "./helpers.ts";
import { projectLedger } from "../src/projector.ts";
import { ENTRY_TYPES } from "../src/types.ts";
import { makeEventMeta } from "../src/utils.ts";
import { renderActiveWorkPacket, selectPromptPacket } from "../src/prompt.ts";

test("prompt selection prioritizes blocked and in-progress work over todo items", () => {
  const { events } = bootstrap("Sort prompt tasks");
  const now = "2026-04-18T10:30:00.000Z";
  const nextState = projectLedger([
    ...events,
    {
      type: ENTRY_TYPES.taskCreated,
      ...makeEventMeta("assistant", "authoritative", now),
      payload: {
        task: {
          id: "task_blocked",
          title: "Blocked task",
          kind: "verification",
          source: "assistant",
          dependsOn: [],
          status: "blocked",
          evidence: [],
          notes: [],
          relevantFiles: [],
          createdAt: now,
          updatedAt: now,
          blockingReason: "Needs credentials",
        },
      },
    },
    {
      type: ENTRY_TYPES.taskCreated,
      ...makeEventMeta("assistant", "authoritative", now),
      payload: {
        task: {
          id: "task_todo",
          title: "Todo task",
          kind: "followup",
          source: "assistant",
          dependsOn: [],
          status: "todo",
          evidence: [],
          notes: [],
          relevantFiles: [],
          createdAt: now,
          updatedAt: "2026-04-18T10:29:00.000Z",
        },
      },
    },
    {
      type: ENTRY_TYPES.taskCreated,
      ...makeEventMeta("assistant", "authoritative", now),
      payload: {
        task: {
          id: "task_progress",
          title: "In progress task",
          kind: "verification",
          source: "assistant",
          dependsOn: [],
          status: "in_progress",
          evidence: [],
          notes: [],
          relevantFiles: [],
          createdAt: now,
          updatedAt: "2026-04-18T10:28:00.000Z",
        },
      },
    },
  ]);

  const packet = selectPromptPacket(nextState, { maxOpenTasks: 4 });
  const orderedIds = packet.openTasks.map((task) => task.id);
  assert.equal(orderedIds[0], "task_blocked");
  assert.ok(orderedIds.indexOf("task_progress") < orderedIds.indexOf("task_todo"));
  assert.ok(orderedIds.includes("task_todo"));
});

test("prompt packet hides the root objective once explicit subtasks exist", () => {
  const { state, events } = bootstrap("Hide root objective");
  const nextState = projectLedger([
    ...events,
    {
      type: ENTRY_TYPES.taskCreated,
      ...makeEventMeta("assistant", "authoritative", "2026-04-18T10:30:00.000Z"),
      payload: {
        task: {
          id: "task_followup",
          title: "Inspect execution semantics",
          kind: "verification",
          source: "assistant",
          dependsOn: [],
          status: "todo",
          evidence: [],
          notes: [],
          relevantFiles: [],
          createdAt: "2026-04-18T10:30:00.000Z",
          updatedAt: "2026-04-18T10:30:00.000Z",
        },
      },
    },
  ]);

  const packet = selectPromptPacket(nextState);
  assert.equal(packet.openTasks.some((task) => task.id === state.openTaskIds[0]), false);
  assert.equal(packet.openTasks.some((task) => task.id === "task_followup"), true);
});

test("archived tasks stay out of prompt packets", () => {
  const { state, events } = bootstrap("Archive task");
  const rootTaskId = state.openTaskIds[0];
  const nextState = projectLedger([
    ...events,
    {
      type: ENTRY_TYPES.taskArchived,
      ...makeEventMeta("manual", "authoritative", "2026-04-18T11:00:00.000Z"),
      payload: { taskId: rootTaskId, reason: "done and archived" },
    },
  ]);

  const packet = selectPromptPacket(nextState);
  assert.equal(packet.openTasks.some((task) => task.id === rootTaskId), false);
  assert.equal(nextState.archivedTaskIds.includes(rootTaskId), true);
});

test("rendered work packet includes hard rules and excludes archived task text", () => {
  const { state, events } = bootstrap("Render packet");
  const rootTaskId = state.openTaskIds[0];
  const nextState = projectLedger([
    ...events,
    {
      type: ENTRY_TYPES.taskArchived,
      ...makeEventMeta("manual", "authoritative", "2026-04-18T11:00:00.000Z"),
      payload: { taskId: rootTaskId, reason: "archived" },
    },
  ]);

  const rendered = renderActiveWorkPacket(nextState);
  assert.match(rendered, /done_candidate != done/i);
  assert.match(rendered, /satisfy that ask in task_tracker/i);
  assert.match(rendered, /use task_tracker to create explicit subtasks/i);
  assert.match(rendered, /parallel sibling lanes are allowed/i);
  assert.match(rendered, /Parent session owns durable task_tracker state/i);
  assert.match(rendered, /use isolated worktrees for concurrent writes/i);
  assert.match(rendered, /update task_tracker instead of only narrating progress/i);
  assert.match(rendered, /Open tasks outrank compaction summaries/i);
  assert.doesNotMatch(rendered, /Recent Advisory Context/i);
  assert.doesNotMatch(rendered, /Relevant files/i);
  assert.doesNotMatch(rendered, new RegExp(rootTaskId));
});
