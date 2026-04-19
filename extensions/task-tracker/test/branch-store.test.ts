import test from "node:test";
import assert from "node:assert/strict";
import { loadLedgerEvents } from "../src/branch-store.ts";
import { ENTRY_TYPES } from "../src/types.ts";

test("loadLedgerEvents maps legacy cg2 custom types to task-tracker event types", () => {
  const events = loadLedgerEvents([
    {
      type: "custom",
      customType: "cg2-task-created",
      data: {
        actor: "assistant",
        authority: "authoritative",
        createdAt: "2026-04-19T12:00:00.000Z",
        payload: {
          task: {
            id: "task_001",
            title: "Keep old sessions readable",
            kind: "followup",
            source: "assistant",
            dependsOn: [],
            status: "todo",
            evidence: [],
            notes: [],
            relevantFiles: [],
            createdAt: "2026-04-19T12:00:00.000Z",
            updatedAt: "2026-04-19T12:00:00.000Z",
          },
        },
      },
    },
  ]);

  assert.equal(events.length, 1);
  assert.equal(events[0]?.type, ENTRY_TYPES.taskCreated);
});
