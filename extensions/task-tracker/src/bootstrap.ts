import type { ContractAsk, KnownLedgerEvent, TaskItem, UserContract } from "./types.ts";
import { ENTRY_TYPES } from "./types.ts";
import { createDefaultExecutionState, isLowSignalUserNudge, makeEventMeta } from "./utils.ts";

export function createBootstrapContract(objective: string, now: string, askId: string, sourceMessageId?: string): UserContract {
  const ask: ContractAsk = {
    id: askId,
    text: objective,
    status: "open",
    createdAt: now,
    ...(sourceMessageId ? { sourceMessageId } : {}),
  };

  return {
    version: 2,
    originalObjective: objective,
    activeObjective: objective,
    successCriteria: [],
    constraints: [],
    explicitAsks: [ask],
    contractChangeProposals: [],
    rejectedDirections: [],
    updatedAt: now,
    updatedFrom: "user",
  };
}

export function createRootTask(taskId: string, objective: string, now: string): TaskItem {
  return {
    id: taskId,
    title: objective,
    kind: "user_requested",
    source: "user",
    dependsOn: [],
    status: "in_progress",
    evidence: [],
    notes: [],
    relevantFiles: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function buildBootstrapEvents(input: {
  objective: string;
  now: string;
  nextId(prefix: string): string;
  sourceMessageId?: string;
}): KnownLedgerEvent[] {
  const { objective, now, nextId, sourceMessageId } = input;
  const contract = createBootstrapContract(objective, now, nextId("ask"), sourceMessageId);
  const rootTask = createRootTask(nextId("task"), objective, now);
  const execution = {
    ...createDefaultExecutionState(now),
    stage: "planning" as const,
    activeTaskIds: [rootTask.id],
    nextAction: "Clarify scope and produce an initial plan.",
    lastMeaningfulProgress: "Bootstrap contract and root task.",
  };

  return [
    {
      type: ENTRY_TYPES.contractUpsert,
      ...makeEventMeta("user", "authoritative", now, sourceMessageId),
      payload: { contract },
    },
    {
      type: ENTRY_TYPES.taskCreated,
      ...makeEventMeta("system", "authoritative", now, sourceMessageId),
      payload: { task: rootTask },
    },
    {
      type: ENTRY_TYPES.executionUpdated,
      ...makeEventMeta("system", "authoritative", now, sourceMessageId),
      payload: { patch: execution },
    },
  ];
}

export function buildExplicitAskCaptureContract(currentContract: UserContract, prompt: string, now: string, askId: string, sourceMessageId?: string): UserContract | null {
  if (isLowSignalUserNudge(prompt)) return null;
  const duplicate = currentContract.explicitAsks.some((ask) => ask.status === "open" && ask.text.trim() === prompt.trim());
  if (duplicate) return null;

  const nextAsk: ContractAsk = {
    id: askId,
    text: prompt,
    status: "open",
    createdAt: now,
    ...(sourceMessageId ? { sourceMessageId } : {}),
  };

  return {
    ...currentContract,
    explicitAsks: [...currentContract.explicitAsks, nextAsk],
    updatedAt: now,
    updatedFrom: "user",
  };
}
