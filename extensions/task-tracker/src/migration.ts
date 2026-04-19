import type { KnownLedgerEvent, TaskItem, UserContract } from "./types.ts";
import { ENTRY_TYPES } from "./types.ts";
import { createDefaultExecutionState, makeEventMeta } from "./utils.ts";

export type LegacyTrackerState = {
  originalObjective?: string | null;
  objective?: string | null;
  successCriteria?: string[];
  constraints?: string[];
  done?: string[];
  inProgress?: string[];
  blocked?: string[];
  nextAction?: string | null;
  relevantFiles?: string[];
  artifacts?: Array<{ kind: string; value: string; note?: string }>;
  openQuestions?: string[];
  facts?: string[];
  assumptions?: string[];
};

export function migrateLegacyStateToEvents(input: LegacyTrackerState, now: string, nextId: (prefix: string) => string): KnownLedgerEvent[] {
  const objective = input.objective?.trim() || input.originalObjective?.trim();
  if (!objective) return [];

  const contract: UserContract = {
    version: 2,
    originalObjective: input.originalObjective?.trim() || objective,
    activeObjective: objective,
    successCriteria: input.successCriteria ?? [],
    constraints: input.constraints ?? [],
    explicitAsks: [],
    contractChangeProposals: [],
    rejectedDirections: [],
    updatedAt: now,
    updatedFrom: "manual",
  };

  const openTasks: TaskItem[] = [
    ...(input.inProgress ?? []).map((title) => ({
      id: nextId("task"),
      title,
      kind: "user_requested" as const,
      source: "manual" as const,
      dependsOn: [],
      status: "in_progress" as const,
      evidence: [],
      notes: [],
      relevantFiles: input.relevantFiles ?? [],
      createdAt: now,
      updatedAt: now,
    })),
    ...(input.blocked ?? []).map((title) => ({
      id: nextId("task"),
      title,
      kind: "followup" as const,
      source: "manual" as const,
      dependsOn: [],
      status: "blocked" as const,
      evidence: [],
      notes: ["Migrated from legacy blocked list."],
      relevantFiles: input.relevantFiles ?? [],
      createdAt: now,
      updatedAt: now,
      blockingReason: "Legacy blocked item.",
    })),
  ];

  const doneTasks: TaskItem[] = (input.done ?? []).map((title) => ({
    id: nextId("task"),
    title,
    kind: "followup" as const,
    source: "manual" as const,
    dependsOn: [],
    status: "done_candidate" as const,
    evidence: [],
    notes: ["Migrated from legacy done list without automatic trust escalation."],
    relevantFiles: input.relevantFiles ?? [],
    createdAt: now,
    updatedAt: now,
  }));

  const execution = {
    ...createDefaultExecutionState(now),
    stage: openTasks.length > 0 ? ("investigating" as const) : ("planning" as const),
    activeTaskIds: openTasks.slice(0, 3).map((task) => task.id),
    nextAction: input.nextAction?.trim() || null,
    lastMeaningfulProgress: "Migrated legacy tracker v1 state.",
  };

  return [
    {
      type: ENTRY_TYPES.contractUpsert,
      ...makeEventMeta("manual", "authoritative", now),
      payload: { contract },
    },
    ...openTasks.map((task) => ({
      type: ENTRY_TYPES.taskCreated,
      ...makeEventMeta("manual", "authoritative", now),
      payload: { task },
    })),
    ...doneTasks.map((task) => ({
      type: ENTRY_TYPES.taskCreated,
      ...makeEventMeta("manual", "authoritative", now),
      payload: { task },
    })),
    {
      type: ENTRY_TYPES.executionUpdated,
      ...makeEventMeta("manual", "authoritative", now),
      payload: { patch: execution },
    },
  ];
}
