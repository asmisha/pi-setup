import type {
  AcceptanceRecord,
  ContractAsk,
  ContractChangeProposal,
  KnownLedgerEvent,
  ProjectedState,
  TaskEvidence,
  TaskItem,
  TaskKind,
  TaskSource,
  TaskTrackerAction,
  TaskTrackerAtomicAction,
  TrackerActionContext,
  TrackerActionResult,
} from "./types.ts";
import { ENTRY_TYPES } from "./types.ts";
import { canCommitTaskDone, findTask, listArchivedTasks, listOpenTasks, projectLedger } from "./projector.ts";
import { makeEventMeta, normalizeForMatch, normalizeStringList } from "./utils.ts";

function renderTaskLine(task: TaskItem): string {
  return `[${task.id}][${task.status}][${task.kind}] ${task.title}`;
}

function renderTaskList(tasks: TaskItem[]): string {
  if (tasks.length === 0) return "- none";
  return tasks.map((task) => `- ${renderTaskLine(task)}`).join("\n");
}

function renderAskLine(ask: ContractAsk): string {
  return `[${ask.id}][${ask.status}] ${ask.text}`;
}

function renderAskList(asks: ContractAsk[]): string {
  if (asks.length === 0) return "- none";
  return asks.map((ask) => `- ${renderAskLine(ask)}`).join("\n");
}

function resolveTaskSource(kind: TaskKind, actor: TrackerActionContext["actor"]): TaskSource {
  if (kind === "user_requested") return "user";
  if (actor === "manual") return "manual";
  return "assistant";
}

function makeProposalId(context: TrackerActionContext): string {
  return context.nextId("proposal");
}

function makeEvidenceId(context: TrackerActionContext): string {
  return context.nextId("evidence");
}

function makeAcceptanceId(context: TrackerActionContext): string {
  return context.nextId("acceptance");
}

function makeEvent<T extends KnownLedgerEvent>(event: T): T {
  return event;
}

function ensureTask(state: ProjectedState, taskId: string): TaskItem {
  const task = findTask(state, taskId);
  if (!task) {
    throw new Error(`Task ${taskId} not found.`);
  }
  return task;
}

function ensureContract(state: ProjectedState) {
  if (!state.contract) {
    throw new Error("No active contract.");
  }
  return state.contract;
}

function ensureOpenAsk(state: ProjectedState, askId: string): ContractAsk {
  const contract = ensureContract(state);
  const ask = contract.explicitAsks.find((candidate) => candidate.id === askId);
  if (!ask) {
    throw new Error(`Ask ${askId} not found.`);
  }
  if (ask.status !== "open") {
    throw new Error(`Ask ${askId} is ${ask.status}, not open.`);
  }
  return ask;
}

function dedupeTaskTitle(state: ProjectedState, title: string): TaskItem | null {
  const signature = normalizeForMatch(title);
  return Object.values(state.tasks).find((task) => !task.archivedAt && (task.status === "done_candidate" || task.status === "todo" || task.status === "in_progress" || task.status === "blocked" || task.status === "awaiting_user") && normalizeForMatch(task.title) === signature) ?? null;
}

type TaskStatusOverrides = Record<string, TaskItem["status"]>;

function isRootObjectiveTask(state: ProjectedState, taskId: string): boolean {
  const task = state.tasks[taskId];
  const objective = state.contract?.activeObjective?.trim();
  if (!task || !objective) return false;
  return !task.parentId && task.kind === "user_requested" && task.source === "user" && task.title.trim() === objective;
}

function effectiveStatus(task: TaskItem, overrides: TaskStatusOverrides): TaskItem["status"] {
  return overrides[task.id] ?? task.status;
}

function isActiveTaskStatus(status: TaskItem["status"]): boolean {
  return status === "todo" || status === "in_progress" || status === "done_candidate";
}

function isRunnableTaskStatus(status: TaskItem["status"]): boolean {
  return status === "todo" || status === "in_progress";
}

function shouldIgnoreRootObjectiveLane(state: ProjectedState, overrides: TaskStatusOverrides = {}): boolean {
  return Object.values(state.tasks).some((task) => {
    if (task.archivedAt || isRootObjectiveTask(state, task.id)) return false;
    const status = effectiveStatus(task, overrides);
    return status !== "done" && status !== "dropped";
  });
}

function normalizeActiveTaskIds(state: ProjectedState, taskIds: string[], overrides: TaskStatusOverrides = {}): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const taskId of taskIds) {
    if (seen.has(taskId)) continue;
    seen.add(taskId);

    const task = state.tasks[taskId];
    if (!task || task.archivedAt) continue;
    if (!isActiveTaskStatus(effectiveStatus(task, overrides))) continue;
    normalized.push(task.id);
  }

  const ignoreRootObjective = shouldIgnoreRootObjectiveLane(state, overrides);
  return ignoreRootObjective ? normalized.filter((taskId) => !isRootObjectiveTask(state, taskId)) : normalized;
}

function hasTaskWithStatus(state: ProjectedState, overrides: TaskStatusOverrides, status: TaskItem["status"]): boolean {
  return Object.values(state.tasks).some((task) => !task.archivedAt && effectiveStatus(task, overrides) === status);
}

function latestReasonForStatus(state: ProjectedState, overrides: TaskStatusOverrides, status: Extract<TaskItem["status"], "blocked" | "awaiting_user">): string | null {
  const matchingTask = Object.values(state.tasks)
    .filter((task) => !task.archivedAt && effectiveStatus(task, overrides) === status)
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))[0];

  if (!matchingTask) return null;
  if (status === "blocked") {
    return matchingTask.blockingReason?.replace(/^blocked:\s*/i, "").trim() || "Blocked without reason.";
  }
  return matchingTask.waitingReason?.replace(/^awaiting user:\s*/i, "").trim() || "Awaiting user input.";
}

function buildExecutionPatch(
  state: ProjectedState,
  input: {
    activeTaskIds: string[];
    lastMeaningfulProgress: string;
    nextAction?: string | null;
    statusOverrides?: TaskStatusOverrides;
    preferredWaitingReason?: string | null;
  },
) {
  const statusOverrides = input.statusOverrides ?? {};
  const ignoreRootObjective = shouldIgnoreRootObjectiveLane(state, statusOverrides);
  const activeTaskIds = normalizeActiveTaskIds(state, input.activeTaskIds, statusOverrides);
  const hasRunnableWork = Object.values(state.tasks).some((task) => {
    if (task.archivedAt) return false;
    if (ignoreRootObjective && isRootObjectiveTask(state, task.id)) return false;
    return isRunnableTaskStatus(effectiveStatus(task, statusOverrides));
  });

  let waitingFor: ProjectedState["execution"]["waitingFor"] = "nothing";
  let blocker: string | null = null;
  let stage: ProjectedState["execution"]["stage"] = "investigating";

  if (activeTaskIds.length === 0 && !hasRunnableWork) {
    if (hasTaskWithStatus(state, statusOverrides, "awaiting_user")) {
      waitingFor = "user";
      blocker = input.preferredWaitingReason ?? latestReasonForStatus(state, statusOverrides, "awaiting_user");
      stage = "awaiting_user";
    } else if (hasTaskWithStatus(state, statusOverrides, "blocked")) {
      waitingFor = "external";
      blocker = input.preferredWaitingReason ?? latestReasonForStatus(state, statusOverrides, "blocked");
    }
  }

  return {
    stage,
    activeTaskIds,
    nextAction: input.nextAction ?? state.execution.nextAction,
    waitingFor,
    blocker,
    lastMeaningfulProgress: input.lastMeaningfulProgress,
  };
}

type BatchAliases = {
  tasks: Map<string, string>;
  evidence: Map<string, string>;
};

function normalizeAliasName(alias: string, kind: string): string {
  const trimmed = alias.trim().replace(/^\$/u, "");
  if (!trimmed) {
    throw new Error(`Invalid ${kind} alias.`);
  }
  return trimmed;
}

function resolveBatchReference(value: string, aliases: Map<string, string>, kind: string): string {
  if (!value.startsWith("$")) return value;
  const alias = normalizeAliasName(value, kind);
  const resolved = aliases.get(alias);
  if (!resolved) {
    throw new Error(`Unknown ${kind} alias $${alias}.`);
  }
  return resolved;
}

function resolveBatchReferences(values: string[] | undefined, aliases: Map<string, string>, kind: string): string[] | undefined {
  if (!values) return values;
  return values.map((value) => resolveBatchReference(value, aliases, kind));
}

function registerBatchAlias(aliases: Map<string, string>, alias: string, resolvedId: string, kind: string) {
  const normalized = normalizeAliasName(alias, kind);
  if (aliases.has(normalized)) {
    throw new Error(`Duplicate ${kind} alias $${normalized}.`);
  }
  aliases.set(normalized, resolvedId);
}

function resolveBulkAction(input: TaskTrackerAtomicAction, aliases: BatchAliases): TaskTrackerAtomicAction {
  switch (input.action) {
    case "create_task":
      return {
        ...input,
        ...(input.parentId ? { parentId: resolveBatchReference(input.parentId, aliases.tasks, "task") } : {}),
        ...(input.dependsOn ? { dependsOn: resolveBatchReferences(input.dependsOn, aliases.tasks, "task") } : {}),
      };
    case "start_task":
    case "block_task":
    case "await_user":
    case "propose_done":
    case "link_file":
    case "note":
      return { ...input, taskId: resolveBatchReference(input.taskId, aliases.tasks, "task") };
    case "commit_done":
      return {
        ...input,
        taskId: resolveBatchReference(input.taskId, aliases.tasks, "task"),
        ...(input.evidenceIds ? { evidenceIds: resolveBatchReferences(input.evidenceIds, aliases.evidence, "evidence") } : {}),
      };
    case "add_evidence":
      return { ...input, taskId: resolveBatchReference(input.taskId, aliases.tasks, "task") };
    case "record_acceptance":
      return input.taskId ? { ...input, taskId: resolveBatchReference(input.taskId, aliases.tasks, "task") } : input;
    case "set_next_action":
      return input.activeTaskIds ? { ...input, activeTaskIds: resolveBatchReferences(input.activeTaskIds, aliases.tasks, "task") } : input;
    case "list_open":
    case "list_open_asks":
    case "list_archived":
    case "cancel_ask":
    case "propose_contract_change":
      return input;
    default: {
      const neverAction: never = input;
      throw new Error(`Unsupported batched task_tracker action: ${JSON.stringify(neverAction)}`);
    }
  }
}

export function applyTaskTrackerInput(
  state: ProjectedState,
  currentEvents: KnownLedgerEvent[],
  input: TaskTrackerAction,
  context: TrackerActionContext,
): TrackerActionResult {
  if (input.actions.length === 0) {
    return {
      events: [],
      message: "No task_tracker actions provided.",
      createdInferredTasksThisTurn: context.createdInferredTasksThisTurn,
      ok: false,
    };
  }

  const aliases: BatchAliases = {
    tasks: new Map<string, string>(),
    evidence: new Map<string, string>(),
  };
  const batchEvents: KnownLedgerEvent[] = [];
  const stepMessages: string[] = [];
  let workingState = state;
  let workingEvents = currentEvents;
  let createdInferredTasksThisTurn = context.createdInferredTasksThisTurn;

  for (const [index, rawAction] of input.actions.entries()) {
    let resolvedAction: TaskTrackerAtomicAction;
    try {
      resolvedAction = resolveBulkAction(rawAction, aliases);
    } catch (error) {
      return {
        events: [],
        message: `Batched task_tracker call failed at step ${index + 1}: ${error instanceof Error ? error.message : "Unknown alias resolution error."} No changes were applied.`,
        createdInferredTasksThisTurn: context.createdInferredTasksThisTurn,
        ok: false,
      };
    }

    let result: TrackerActionResult;
    try {
      result = applyTaskTrackerAction(workingState, resolvedAction, {
        ...context,
        createdInferredTasksThisTurn,
      });
    } catch (error) {
      return {
        events: [],
        message: `Batched task_tracker call failed at step ${index + 1}: ${error instanceof Error ? error.message : "Unknown execution error."} No changes were applied.`,
        createdInferredTasksThisTurn: context.createdInferredTasksThisTurn,
        ok: false,
      };
    }

    if (result.ok === false) {
      return {
        events: [],
        message: `Batched task_tracker call failed at step ${index + 1}: ${result.message} No changes were applied.`,
        createdInferredTasksThisTurn: context.createdInferredTasksThisTurn,
        ok: false,
      };
    }

    try {
      if (rawAction.action === "create_task" && rawAction.taskAlias && result.references?.taskId) {
        registerBatchAlias(aliases.tasks, rawAction.taskAlias, result.references.taskId, "task");
      }
      if (rawAction.action === "add_evidence" && rawAction.evidenceAlias && result.references?.evidenceId) {
        registerBatchAlias(aliases.evidence, rawAction.evidenceAlias, result.references.evidenceId, "evidence");
      }
    } catch (error) {
      return {
        events: [],
        message: `Batched task_tracker call failed at step ${index + 1}: ${error instanceof Error ? error.message : "Unknown alias registration error."} No changes were applied.`,
        createdInferredTasksThisTurn: context.createdInferredTasksThisTurn,
        ok: false,
      };
    }

    stepMessages.push(`${index + 1}. ${result.message}`);
    createdInferredTasksThisTurn = result.createdInferredTasksThisTurn;

    if (result.events.length > 0) {
      batchEvents.push(...result.events);
      workingEvents = [...workingEvents, ...result.events];
      workingState = projectLedger(workingEvents);
    }
  }

  return {
    events: batchEvents,
    message: [`Applied task_tracker actions (${input.actions.length} steps).`, ...stepMessages].join("\n"),
    createdInferredTasksThisTurn,
  };
}

export function applyTaskTrackerAction(state: ProjectedState, input: TaskTrackerAtomicAction, context: TrackerActionContext): TrackerActionResult {
  switch (input.action) {
    case "list_open": {
      return {
        events: [],
        message: renderTaskList(listOpenTasks(state)),
        createdInferredTasksThisTurn: context.createdInferredTasksThisTurn,
      };
    }
    case "list_open_asks": {
      return {
        events: [],
        message: renderAskList((state.contract?.explicitAsks ?? []).filter((ask) => ask.status === "open")),
        createdInferredTasksThisTurn: context.createdInferredTasksThisTurn,
      };
    }
    case "list_archived": {
      const tasks = listArchivedTasks(state).slice(0, input.limit ?? 20);
      return {
        events: [],
        message: renderTaskList(tasks),
        createdInferredTasksThisTurn: context.createdInferredTasksThisTurn,
      };
    }
    case "create_task": {
      const kind = input.kind ?? "inferred";
      if (kind === "inferred" && context.createdInferredTasksThisTurn >= context.maxInferredTasksPerTurn) {
        return {
          events: [],
          message: `Rejected inferred task creation: per-turn cap ${context.maxInferredTasksPerTurn} reached.`,
          createdInferredTasksThisTurn: context.createdInferredTasksThisTurn,
          ok: false,
        };
      }

      const duplicate = dedupeTaskTitle(state, input.title);
      if (duplicate) {
        return {
          events: [],
          message: `Skipped duplicate task: ${renderTaskLine(duplicate)}`,
          createdInferredTasksThisTurn: context.createdInferredTasksThisTurn,
          references: { taskId: duplicate.id },
        };
      }

      const task: TaskItem = {
        id: context.nextId("task"),
        title: input.title.trim(),
        kind,
        source: resolveTaskSource(kind, context.actor),
        ...(input.parentId ? { parentId: input.parentId } : {}),
        dependsOn: normalizeStringList(input.dependsOn ?? []),
        status: "todo",
        evidence: [],
        notes: [],
        relevantFiles: [],
        createdAt: context.now,
        updatedAt: context.now,
      };

      const events = [
        makeEvent({
          type: ENTRY_TYPES.taskCreated,
          ...makeEventMeta(context.actor, context.authority, context.now),
          payload: { task },
        }),
      ];

      return {
        events,
        message: `Created task ${renderTaskLine(task)}`,
        createdInferredTasksThisTurn: kind === "inferred" ? context.createdInferredTasksThisTurn + 1 : context.createdInferredTasksThisTurn,
        references: { taskId: task.id },
      };
    }
    case "start_task": {
      const task = ensureTask(state, input.taskId);
      const events = [
        makeEvent({
          type: ENTRY_TYPES.taskStatusCommitted,
          ...makeEventMeta(context.actor, "authoritative", context.now),
          payload: { taskId: task.id, status: "in_progress" },
        }),
        makeEvent({
          type: ENTRY_TYPES.executionUpdated,
          ...makeEventMeta(context.actor, "authoritative", context.now),
          payload: {
            patch: buildExecutionPatch(state, {
              activeTaskIds: [...state.execution.activeTaskIds, task.id],
              statusOverrides: { [task.id]: "in_progress" },
              lastMeaningfulProgress: `Started task ${task.id}.`,
            }),
          },
        }),
      ];
      return {
        events,
        message: `Started task ${renderTaskLine(task)}`,
        createdInferredTasksThisTurn: context.createdInferredTasksThisTurn,
      };
    }
    case "block_task": {
      const task = ensureTask(state, input.taskId);
      const note = `Blocked: ${input.reason}`;
      const events = [
        makeEvent({
          type: ENTRY_TYPES.taskStatusCommitted,
          ...makeEventMeta(context.actor, "authoritative", context.now),
          payload: { taskId: task.id, status: "blocked", note },
        }),
        makeEvent({
          type: ENTRY_TYPES.executionUpdated,
          ...makeEventMeta(context.actor, "authoritative", context.now),
          payload: {
            patch: buildExecutionPatch(state, {
              activeTaskIds: state.execution.activeTaskIds.filter((taskId) => taskId !== task.id),
              statusOverrides: { [task.id]: "blocked" },
              preferredWaitingReason: input.reason,
              lastMeaningfulProgress: `Blocked task ${task.id}.`,
            }),
          },
        }),
      ];
      return {
        events,
        message: `Blocked task ${renderTaskLine(task)} — ${input.reason}`,
        createdInferredTasksThisTurn: context.createdInferredTasksThisTurn,
      };
    }
    case "await_user": {
      const task = ensureTask(state, input.taskId);
      const note = `Awaiting user: ${input.reason}`;
      const events = [
        makeEvent({
          type: ENTRY_TYPES.taskStatusCommitted,
          ...makeEventMeta(context.actor, "authoritative", context.now),
          payload: { taskId: task.id, status: "awaiting_user", note },
        }),
        makeEvent({
          type: ENTRY_TYPES.executionUpdated,
          ...makeEventMeta(context.actor, "authoritative", context.now),
          payload: {
            patch: buildExecutionPatch(state, {
              activeTaskIds: state.execution.activeTaskIds.filter((taskId) => taskId !== task.id),
              statusOverrides: { [task.id]: "awaiting_user" },
              preferredWaitingReason: input.reason,
              lastMeaningfulProgress: `Waiting for user on task ${task.id}.`,
            }),
          },
        }),
      ];
      return {
        events,
        message: `Task ${renderTaskLine(task)} is now awaiting user input.`,
        createdInferredTasksThisTurn: context.createdInferredTasksThisTurn,
      };
    }
    case "propose_done": {
      const task = ensureTask(state, input.taskId);
      const events = [
        makeEvent({
          type: ENTRY_TYPES.taskStatusProposed,
          ...makeEventMeta(context.actor, "proposed", context.now),
          payload: { taskId: task.id, status: "done_candidate", ...(input.note ? { note: input.note } : {}) },
        }),
      ];
      return {
        events,
        message: `Proposed done_candidate for ${renderTaskLine(task)}`,
        createdInferredTasksThisTurn: context.createdInferredTasksThisTurn,
      };
    }
    case "commit_done": {
      ensureTask(state, input.taskId);
      const gate = canCommitTaskDone(state, input.taskId, input.reason, input.evidenceIds);
      if (!gate.ok) {
        return {
          events: [],
          message: `Cannot mark ${input.taskId} done: ${gate.reason}`,
          createdInferredTasksThisTurn: context.createdInferredTasksThisTurn,
          ok: false,
        };
      }

      const askIdsToSatisfy = normalizeStringList(input.askIdsToSatisfy ?? []);
      if (askIdsToSatisfy.length > 0) {
        try {
          for (const askId of askIdsToSatisfy) {
            ensureOpenAsk(state, askId);
          }
        } catch (error) {
          return {
            events: [],
            message: error instanceof Error ? error.message : "Cannot satisfy the requested ask IDs.",
            createdInferredTasksThisTurn: context.createdInferredTasksThisTurn,
            ok: false,
          };
        }
      }

      const eventActor = input.reason === "manual_override" ? "manual" : context.actor;
      const events = [
        makeEvent({
          type: ENTRY_TYPES.taskStatusCommitted,
          ...makeEventMeta(eventActor, "authoritative", context.now),
          payload: { taskId: input.taskId, status: "done", reason: input.reason, evidenceIds: input.evidenceIds },
        }),
        ...askIdsToSatisfy.map((askId) => makeEvent({
          type: ENTRY_TYPES.askStatusCommitted,
          ...makeEventMeta(eventActor, "authoritative", context.now),
          payload: { askId, status: "satisfied", taskId: input.taskId },
        })),
      ];
      return {
        events,
        message: askIdsToSatisfy.length > 0
          ? `Committed done for task ${input.taskId} and satisfied asks ${askIdsToSatisfy.join(", ")}.`
          : `Committed done for task ${input.taskId}.`,
        createdInferredTasksThisTurn: context.createdInferredTasksThisTurn,
      };
    }
    case "add_evidence": {
      const task = ensureTask(state, input.taskId);
      const evidence: TaskEvidence = {
        id: makeEvidenceId(context),
        kind: input.evidence.kind,
        ref: input.evidence.ref,
        summary: input.evidence.summary,
        level: input.evidence.level ?? "observed",
        actor: context.actor === "manual" ? "manual" : context.actor === "system" ? "system" : "assistant",
        ...(input.evidence.sourceEntryId ? { sourceEntryId: input.evidence.sourceEntryId } : {}),
        createdAt: context.now,
      };
      const events = [
        makeEvent({
          type: ENTRY_TYPES.evidenceAdded,
          ...makeEventMeta(context.actor, "authoritative", context.now),
          payload: { taskId: task.id, evidence },
        }),
      ];
      return {
        events,
        message: `Added evidence ${evidence.id} to ${renderTaskLine(task)}`,
        createdInferredTasksThisTurn: context.createdInferredTasksThisTurn,
        references: { evidenceId: evidence.id },
      };
    }
    case "record_acceptance": {
      const acceptance: AcceptanceRecord = {
        id: makeAcceptanceId(context),
        ...(input.taskId ? { taskId: input.taskId } : {}),
        note: input.note,
        ...(input.sourceMessageId ? { sourceMessageId: input.sourceMessageId } : {}),
        createdAt: context.now,
      };
      const events = [
        makeEvent({
          type: ENTRY_TYPES.acceptanceRecorded,
          ...makeEventMeta(context.actor, "authoritative", context.now, input.sourceMessageId),
          payload: { acceptance },
        }),
      ];
      return {
        events,
        message: `Recorded acceptance ${acceptance.id}${input.taskId ? ` for ${input.taskId}` : " for root objective"}.`,
        createdInferredTasksThisTurn: context.createdInferredTasksThisTurn,
      };
    }
    case "cancel_ask": {
      let ask: ContractAsk;
      try {
        ask = ensureOpenAsk(state, input.askId);
      } catch (error) {
        return {
          events: [],
          message: error instanceof Error ? error.message : "Cannot cancel ask.",
          createdInferredTasksThisTurn: context.createdInferredTasksThisTurn,
          ok: false,
        };
      }
      if (context.actor !== "manual" && !input.sourceMessageId) {
        return {
          events: [],
          message: `Cannot cancel ${ask.id} without manual authority or an explicit sourceMessageId.`,
          createdInferredTasksThisTurn: context.createdInferredTasksThisTurn,
          ok: false,
        };
      }
      return {
        events: [
          makeEvent({
            type: ENTRY_TYPES.askStatusCommitted,
            ...makeEventMeta(context.actor, "authoritative", context.now, input.sourceMessageId),
            payload: { askId: ask.id, status: "cancelled" },
          }),
        ],
        message: `Cancelled ask ${renderAskLine(ask)}.`,
        createdInferredTasksThisTurn: context.createdInferredTasksThisTurn,
      };
    }
    case "propose_contract_change": {
      if (!state.contract) {
        return {
          events: [],
          message: "Cannot propose contract change without an active contract.",
          createdInferredTasksThisTurn: context.createdInferredTasksThisTurn,
          ok: false,
        };
      }
      const proposal: ContractChangeProposal = {
        id: makeProposalId(context),
        kind: input.kind,
        proposedValue: input.proposedValue,
        reason: input.reason,
        status: "open",
        proposedBy: context.actor === "manual" ? "manual" : "assistant",
        createdAt: context.now,
      };
      const events = [
        makeEvent({
          type: ENTRY_TYPES.contractChangeProposed,
          ...makeEventMeta(context.actor, "proposed", context.now),
          payload: { proposal },
        }),
      ];
      return {
        events,
        message: `Recorded contract change proposal ${proposal.id}.`,
        createdInferredTasksThisTurn: context.createdInferredTasksThisTurn,
      };
    }
    case "set_next_action": {
      const patch = input.activeTaskIds
        ? buildExecutionPatch(state, {
            activeTaskIds: input.activeTaskIds,
            nextAction: input.nextAction,
            lastMeaningfulProgress: `Set next action: ${input.nextAction}`,
          })
        : {
            nextAction: input.nextAction,
            lastMeaningfulProgress: `Set next action: ${input.nextAction}`,
          };

      const events = [
        makeEvent({
          type: ENTRY_TYPES.executionUpdated,
          ...makeEventMeta(context.actor, "authoritative", context.now),
          payload: { patch },
        }),
      ];
      return {
        events,
        message: `Updated next action to: ${input.nextAction}`,
        createdInferredTasksThisTurn: context.createdInferredTasksThisTurn,
      };
    }
    case "link_file": {
      const task = ensureTask(state, input.taskId);
      const events = [
        makeEvent({
          type: ENTRY_TYPES.taskPatched,
          ...makeEventMeta(context.actor, "authoritative", context.now),
          payload: { taskId: task.id, patch: { relevantFilesToAdd: [input.path] } },
        }),
      ];
      return {
        events,
        message: `Linked file ${input.path} to ${renderTaskLine(task)}`,
        createdInferredTasksThisTurn: context.createdInferredTasksThisTurn,
      };
    }
    case "note": {
      const task = ensureTask(state, input.taskId);
      const events = [
        makeEvent({
          type: ENTRY_TYPES.taskPatched,
          ...makeEventMeta(context.actor, "authoritative", context.now),
          payload: { taskId: task.id, patch: { notesToAppend: [input.text] } },
        }),
      ];
      return {
        events,
        message: `Added note to ${renderTaskLine(task)}`,
        createdInferredTasksThisTurn: context.createdInferredTasksThisTurn,
      };
    }
    default: {
      const neverAction: never = input;
      throw new Error(`Unsupported task_tracker action: ${JSON.stringify(neverAction)}`);
    }
  }
}
