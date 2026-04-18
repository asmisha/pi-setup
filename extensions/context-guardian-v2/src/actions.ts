import type {
  AcceptanceRecord,
  ContractChangeProposal,
  KnownLedgerEvent,
  ProjectedState,
  TaskEvidence,
  TaskItem,
  TaskKind,
  TaskSource,
  TaskTrackerAction,
  TrackerActionContext,
  TrackerActionResult,
} from "./types.ts";
import { ENTRY_TYPES } from "./types.ts";
import { canCommitTaskDone, findTask, listArchivedTasks, listOpenTasks } from "./projector.ts";
import { makeEventMeta, normalizeForMatch, normalizeStringList } from "./utils.ts";

function renderTaskLine(task: TaskItem): string {
  return `[${task.id}][${task.status}][${task.kind}] ${task.title}`;
}

function renderTaskList(tasks: TaskItem[]): string {
  if (tasks.length === 0) return "- none";
  return tasks.map((task) => `- ${renderTaskLine(task)}`).join("\n");
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

function dedupeTaskTitle(state: ProjectedState, title: string): TaskItem | null {
  const signature = normalizeForMatch(title);
  return Object.values(state.tasks).find((task) => !task.archivedAt && (task.status === "done_candidate" || task.status === "todo" || task.status === "in_progress" || task.status === "blocked" || task.status === "awaiting_user") && normalizeForMatch(task.title) === signature) ?? null;
}

export function applyTaskTrackerAction(state: ProjectedState, input: TaskTrackerAction, context: TrackerActionContext): TrackerActionResult {
  switch (input.action) {
    case "list_open": {
      return {
        events: [],
        message: renderTaskList(listOpenTasks(state)),
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
        };
      }

      const duplicate = dedupeTaskTitle(state, input.title);
      if (duplicate) {
        return {
          events: [],
          message: `Skipped duplicate task: ${renderTaskLine(duplicate)}`,
          createdInferredTasksThisTurn: context.createdInferredTasksThisTurn,
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
            patch: {
              stage: "investigating",
              activeTaskIds: [task.id],
              waitingFor: "nothing",
              blocker: null,
              lastMeaningfulProgress: `Started task ${task.id}.`,
            },
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
            patch: {
              stage: "investigating",
              activeTaskIds: [task.id],
              waitingFor: "external",
              blocker: input.reason,
              lastMeaningfulProgress: `Blocked task ${task.id}.`,
            },
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
            patch: {
              stage: "awaiting_user",
              activeTaskIds: [task.id],
              waitingFor: "user",
              blocker: input.reason,
              lastMeaningfulProgress: `Waiting for user on task ${task.id}.`,
            },
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
        };
      }

      const events = [
        makeEvent({
          type: ENTRY_TYPES.taskStatusCommitted,
          ...makeEventMeta(input.reason === "manual_override" ? "manual" : context.actor, "authoritative", context.now),
          payload: { taskId: input.taskId, status: "done", reason: input.reason, evidenceIds: input.evidenceIds },
        }),
      ];
      return {
        events,
        message: `Committed done for task ${input.taskId}.`,
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
    case "propose_contract_change": {
      if (!state.contract) {
        return {
          events: [],
          message: "Cannot propose contract change without an active contract.",
          createdInferredTasksThisTurn: context.createdInferredTasksThisTurn,
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
      const events = [
        makeEvent({
          type: ENTRY_TYPES.executionUpdated,
          ...makeEventMeta(context.actor, "authoritative", context.now),
          payload: {
            patch: {
              nextAction: input.nextAction,
              ...(input.activeTaskIds ? { activeTaskIds: input.activeTaskIds } : {}),
              lastMeaningfulProgress: `Set next action: ${input.nextAction}`,
            },
          },
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
