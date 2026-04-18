import type {
  AcceptanceRecord,
  ContractChangeProposal,
  DoneReason,
  KnownLedgerEvent,
  ProjectedState,
  TaskItem,
  TaskPatch,
  TaskStatus,
  UserContract,
} from "./types.ts";
import { ENTRY_TYPES } from "./types.ts";
import { createDefaultExecutionState, hasVerifiedEvidence, isOpenTaskStatus, isPromptEligibleTask, normalizeStringList, sortTasksByUpdatedAtDesc } from "./utils.ts";

const ALLOWED_STATUS_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  todo: ["in_progress", "blocked", "dropped"],
  in_progress: ["todo", "blocked", "awaiting_user", "done_candidate", "dropped"],
  blocked: ["in_progress", "todo", "dropped"],
  awaiting_user: ["in_progress", "todo", "dropped"],
  done_candidate: ["in_progress", "done", "todo"],
  done: [],
  dropped: [],
};

export function createEmptyProjectedState(now = new Date(0).toISOString()): ProjectedState {
  return {
    contract: null,
    tasks: {},
    execution: createDefaultExecutionState(now),
    openAskIds: [],
    openTaskIds: [],
    doneCandidateIds: [],
    archivedTaskIds: [],
    contractChangeProposals: [],
    advisory: null,
    acceptances: [],
    warnings: [],
  };
}

export function cloneContract(contract: UserContract): UserContract {
  return {
    ...contract,
    successCriteria: [...contract.successCriteria],
    constraints: [...contract.constraints],
    explicitAsks: contract.explicitAsks.map((ask) => ({ ...ask })),
    contractChangeProposals: contract.contractChangeProposals.map((proposal) => ({ ...proposal })),
    rejectedDirections: [...contract.rejectedDirections],
  };
}

function cloneTask(task: TaskItem): TaskItem {
  return {
    ...task,
    dependsOn: [...task.dependsOn],
    evidence: task.evidence.map((item) => ({ ...item })),
    notes: [...task.notes],
    relevantFiles: [...task.relevantFiles],
  };
}

function getChildTasks(state: ProjectedState, taskId: string): TaskItem[] {
  return Object.values(state.tasks).filter((task) => task.parentId === taskId);
}

function getUnresolvedDependencies(state: ProjectedState, task: TaskItem): TaskItem[] {
  return task.dependsOn
    .map((taskId) => state.tasks[taskId])
    .filter((candidate): candidate is TaskItem => Boolean(candidate) && candidate.status !== "done" && candidate.status !== "dropped");
}

function hasAcceptance(state: ProjectedState, taskId?: string): boolean {
  if (taskId) {
    return state.acceptances.some((item) => item.taskId === taskId);
  }
  return state.acceptances.some((item) => !item.taskId);
}

function pushWarning(state: ProjectedState, message: string) {
  if (!state.warnings.includes(message)) {
    state.warnings.push(message);
  }
}

function canTransition(currentStatus: TaskStatus, nextStatus: TaskStatus): boolean {
  return ALLOWED_STATUS_TRANSITIONS[currentStatus].includes(nextStatus);
}

export function canCommitTaskDone(state: ProjectedState, taskId: string, reason: DoneReason, evidenceIds?: string[]): { ok: true } | { ok: false; reason: string } {
  const task = state.tasks[taskId];
  if (!task) return { ok: false, reason: `Task ${taskId} does not exist.` };
  if (task.archivedAt) return { ok: false, reason: `Task ${taskId} is archived.` };
  if (task.status !== "done_candidate") return { ok: false, reason: `Task ${taskId} is not in done_candidate.` };

  const openChildren = getChildTasks(state, taskId).filter((child) => child.status !== "done" && child.status !== "dropped");
  if (openChildren.length > 0) {
    return { ok: false, reason: `Task ${taskId} still has open child tasks: ${openChildren.map((item) => item.id).join(", ")}.` };
  }

  if (reason === "verified_evidence" && !hasVerifiedEvidence(task, evidenceIds)) {
    return { ok: false, reason: `Task ${taskId} has no verified evidence for done gate.` };
  }

  if (reason === "user_acceptance" && !hasAcceptance(state, taskId) && !hasAcceptance(state)) {
    return { ok: false, reason: `Task ${taskId} has no recorded acceptance.` };
  }

  return { ok: true };
}

function applyContractUpsert(state: ProjectedState, contract: UserContract) {
  state.contract = cloneContract(contract);
}

function applyTaskCreated(state: ProjectedState, task: TaskItem) {
  if (state.tasks[task.id]) {
    pushWarning(state, `Duplicate task id ${task.id} ignored.`);
    return;
  }
  state.tasks[task.id] = cloneTask(task);
}

function applyTaskPatched(state: ProjectedState, taskId: string, patch: TaskPatch, updatedAt: string) {
  const task = state.tasks[taskId];
  if (!task) {
    pushWarning(state, `Patch ignored for missing task ${taskId}.`);
    return;
  }

  if (patch.title) task.title = patch.title;
  if (patch.notesToAppend?.length) task.notes = normalizeStringList([...task.notes, ...patch.notesToAppend]);
  if (patch.relevantFilesToAdd?.length) task.relevantFiles = normalizeStringList([...task.relevantFiles, ...patch.relevantFilesToAdd]);
  if (patch.dependsOnToAdd?.length) task.dependsOn = normalizeStringList([...task.dependsOn, ...patch.dependsOnToAdd]);
  task.updatedAt = updatedAt;
}

function applyTaskStatusCommit(state: ProjectedState, event: Extract<KnownLedgerEvent, { type: typeof ENTRY_TYPES.taskStatusCommitted }>) {
  const task = state.tasks[event.payload.taskId];
  if (!task) {
    pushWarning(state, `Status commit ignored for missing task ${event.payload.taskId}.`);
    return;
  }

  const nextStatus = event.payload.status;
  if (nextStatus === "done") {
    const gate = canCommitTaskDone(state, task.id, event.payload.reason ?? "verified_evidence", event.payload.evidenceIds);
    if (!gate.ok) {
      pushWarning(state, gate.reason);
      return;
    }
    task.status = "done";
    task.doneAt = event.createdAt;
    task.doneReason = event.payload.reason;
    task.blockingReason = null;
    task.waitingReason = null;
    task.updatedAt = event.createdAt;
    if (event.payload.note) task.notes = normalizeStringList([...task.notes, event.payload.note]);
    return;
  }

  if (!canTransition(task.status, nextStatus)) {
    pushWarning(state, `Invalid task transition ${task.id}: ${task.status} -> ${nextStatus}.`);
    return;
  }

  task.status = nextStatus;
  task.updatedAt = event.createdAt;
  task.doneAt = undefined;
  task.doneReason = undefined;

  if (nextStatus === "blocked") {
    task.blockingReason = event.payload.note ?? task.blockingReason ?? "Blocked without reason.";
  }
  if (nextStatus === "awaiting_user") {
    task.waitingReason = event.payload.note ?? task.waitingReason ?? "Awaiting user input.";
  }
  if (nextStatus === "todo" || nextStatus === "in_progress") {
    task.blockingReason = null;
    task.waitingReason = null;
  }
  if (event.payload.note) task.notes = normalizeStringList([...task.notes, event.payload.note]);
}

function applyAskStatusCommit(state: ProjectedState, event: Extract<KnownLedgerEvent, { type: typeof ENTRY_TYPES.askStatusCommitted }>) {
  if (!state.contract) {
    pushWarning(state, `Ask status commit ignored for missing contract (${event.payload.askId}).`);
    return;
  }

  const ask = state.contract.explicitAsks.find((candidate) => candidate.id === event.payload.askId);
  if (!ask) {
    pushWarning(state, `Ask status commit ignored for missing ask ${event.payload.askId}.`);
    return;
  }
  if (ask.status !== "open") {
    pushWarning(state, `Ask ${ask.id} cannot become ${event.payload.status} from ${ask.status}.`);
    return;
  }

  if (event.payload.taskId) {
    const task = state.tasks[event.payload.taskId];
    if (!task) {
      pushWarning(state, `Ask ${ask.id} referenced missing task ${event.payload.taskId}.`);
      return;
    }
    if (event.payload.status === "satisfied" && task.status !== "done") {
      pushWarning(state, `Ask ${ask.id} cannot be satisfied from task ${task.id} because it is ${task.status}.`);
      return;
    }
  }

  if (event.payload.status === "satisfied" && !event.payload.taskId && event.actor !== "manual" && event.actor !== "user") {
    pushWarning(state, `Ask ${ask.id} satisfaction requires a linked done task or user/manual authority.`);
    return;
  }
  if (event.payload.status === "cancelled" && event.actor !== "manual" && event.actor !== "user" && !event.sourceMessageId) {
    pushWarning(state, `Ask ${ask.id} cancellation requires user/manual authority or an explicit sourceMessageId.`);
    return;
  }

  ask.status = event.payload.status;
  ask.closedAt = event.createdAt;
  state.contract.updatedAt = event.createdAt;
}

function recomputeDerivedState(state: ProjectedState): ProjectedState {
  state.openAskIds = state.contract
    ? state.contract.explicitAsks.filter((ask) => ask.status === "open").map((ask) => ask.id)
    : [];
  state.contractChangeProposals = state.contract ? [...state.contract.contractChangeProposals] : [];

  const tasks = Object.values(state.tasks);
  state.archivedTaskIds = tasks.filter((task) => Boolean(task.archivedAt)).map((task) => task.id);
  state.openTaskIds = sortTasksByUpdatedAtDesc(tasks.filter((task) => !task.archivedAt && isOpenTaskStatus(task.status))).map((task) => task.id);
  state.doneCandidateIds = sortTasksByUpdatedAtDesc(tasks.filter((task) => !task.archivedAt && task.status === "done_candidate")).map((task) => task.id);

  for (const task of tasks) {
    const missingDependencies = task.dependsOn.filter((dependencyId) => !state.tasks[dependencyId]);
    if (missingDependencies.length > 0) {
      pushWarning(state, `Task ${task.id} depends on missing tasks: ${missingDependencies.join(", ")}.`);
    }
    const unresolvedDependencies = getUnresolvedDependencies(state, task);
    if (task.status === "blocked" && task.dependsOn.length > 0 && unresolvedDependencies.length === 0 && !task.blockingReason) {
      pushWarning(state, `Task ${task.id} is blocked, but all dependencies are already resolved.`);
    }
  }

  const allowedActive = new Set(tasks.filter((task) => !task.archivedAt && (isOpenTaskStatus(task.status) || task.status === "done_candidate")).map((task) => task.id));
  const nextActive = state.execution.activeTaskIds.filter((taskId) => allowedActive.has(taskId));
  if (nextActive.length !== state.execution.activeTaskIds.length) {
    pushWarning(state, "execution.activeTaskIds referenced missing or archived tasks and were pruned.");
    state.execution.activeTaskIds = nextActive;
  }

  const hasAwaitingUserTask = tasks.some((task) => !task.archivedAt && task.status === "awaiting_user");
  if (state.execution.waitingFor === "user" && state.openAskIds.length === 0 && !hasAwaitingUserTask) {
    pushWarning(state, "execution.waitingFor=user without open asks or awaiting_user tasks; normalizing to nothing.");
    state.execution.waitingFor = "nothing";
  }

  const acceptedProposals = state.contractChangeProposals.filter((proposal) => proposal.status === "accepted");
  if (acceptedProposals.length > 0) {
    pushWarning(state, `Accepted contract proposals still present without materialized contract upsert: ${acceptedProposals.map((item) => item.id).join(", ")}.`);
  }

  const rootTask = state.contract
    ? tasks.find((task) => !task.archivedAt && !task.parentId && task.source === "user" && task.title === state.contract?.activeObjective)
    : null;
  if (rootTask?.status === "done") {
    const closable = isRootObjectiveClosable(state);
    if (!closable.ok) {
      pushWarning(state, `Root task ${rootTask.id} is done while the root objective remains open: ${closable.reasons.join("; ")}.`);
    }
  }

  return state;
}

export function projectLedger(events: KnownLedgerEvent[], now = new Date(0).toISOString()): ProjectedState {
  const state = createEmptyProjectedState(now);

  for (const event of events) {
    switch (event.type) {
      case ENTRY_TYPES.contractUpsert: {
        if (event.authority !== "authoritative") {
          pushWarning(state, "Ignoring non-authoritative contractUpsert event.");
          break;
        }
        applyContractUpsert(state, event.payload.contract);
        break;
      }
      case ENTRY_TYPES.contractChangeProposed: {
        if (!state.contract) {
          pushWarning(state, "Ignoring contractChangeProposed without a contract.");
          break;
        }
        const proposal = { ...event.payload.proposal };
        const nextProposals = state.contract.contractChangeProposals.filter((item) => item.id !== proposal.id);
        state.contract.contractChangeProposals = [...nextProposals, proposal];
        state.contract.updatedAt = event.createdAt;
        break;
      }
      case ENTRY_TYPES.taskCreated: {
        if (event.authority !== "authoritative") {
          pushWarning(state, `Ignoring non-authoritative taskCreated for ${event.payload.task.id}.`);
          break;
        }
        applyTaskCreated(state, event.payload.task);
        break;
      }
      case ENTRY_TYPES.taskPatched: {
        if (event.authority !== "authoritative") {
          pushWarning(state, `Ignoring non-authoritative taskPatched for ${event.payload.taskId}.`);
          break;
        }
        applyTaskPatched(state, event.payload.taskId, event.payload.patch, event.createdAt);
        break;
      }
      case ENTRY_TYPES.evidenceAdded: {
        const task = state.tasks[event.payload.taskId];
        if (!task) {
          pushWarning(state, `Evidence ignored for missing task ${event.payload.taskId}.`);
          break;
        }
        if (!task.evidence.some((item) => item.id === event.payload.evidence.id)) {
          task.evidence.push({ ...event.payload.evidence });
          task.updatedAt = event.createdAt;
        }
        break;
      }
      case ENTRY_TYPES.taskStatusProposed: {
        const task = state.tasks[event.payload.taskId];
        if (!task) {
          pushWarning(state, `Status proposal ignored for missing task ${event.payload.taskId}.`);
          break;
        }
        if (!(task.status === "in_progress" || task.status === "todo" || task.status === "blocked" || task.status === "awaiting_user")) {
          pushWarning(state, `Task ${task.id} cannot become done_candidate from ${task.status}.`);
          break;
        }
        task.status = "done_candidate";
        task.updatedAt = event.createdAt;
        if (event.payload.note) task.notes = normalizeStringList([...task.notes, event.payload.note]);
        break;
      }
      case ENTRY_TYPES.taskStatusCommitted: {
        if (event.authority !== "authoritative") {
          pushWarning(state, `Ignoring non-authoritative taskStatusCommitted for ${event.payload.taskId}.`);
          break;
        }
        applyTaskStatusCommit(state, event);
        break;
      }
      case ENTRY_TYPES.askStatusCommitted: {
        if (event.authority !== "authoritative") {
          pushWarning(state, `Ignoring non-authoritative askStatusCommitted for ${event.payload.askId}.`);
          break;
        }
        applyAskStatusCommit(state, event);
        break;
      }
      case ENTRY_TYPES.taskArchived: {
        const task = state.tasks[event.payload.taskId];
        if (!task) {
          pushWarning(state, `Archive ignored for missing task ${event.payload.taskId}.`);
          break;
        }
        task.archivedAt = event.createdAt;
        task.updatedAt = event.createdAt;
        if (event.payload.reason) task.notes = normalizeStringList([...task.notes, `Archived: ${event.payload.reason}`]);
        break;
      }
      case ENTRY_TYPES.executionUpdated: {
        if (event.authority !== "authoritative") {
          pushWarning(state, "Ignoring non-authoritative executionUpdated event.");
          break;
        }
        state.execution = {
          ...state.execution,
          ...event.payload.patch,
          version: 2,
          activeTaskIds: [...(event.payload.patch.activeTaskIds ?? state.execution.activeTaskIds)],
          updatedAt: event.createdAt,
        };
        break;
      }
      case ENTRY_TYPES.advisoryStored: {
        state.advisory = { ...event.payload.advisory };
        break;
      }
      case ENTRY_TYPES.acceptanceRecorded: {
        const acceptance = { ...event.payload.acceptance };
        if (!state.acceptances.some((item) => item.id === acceptance.id)) {
          state.acceptances.push(acceptance);
        }
        break;
      }
      case ENTRY_TYPES.projectionSnapshot: {
        break;
      }
      default: {
        const neverEvent: never = event;
        throw new Error(`Unsupported event type: ${JSON.stringify(neverEvent)}`);
      }
    }
  }

  return recomputeDerivedState(state);
}

export function listOpenTasks(state: ProjectedState): TaskItem[] {
  return state.openTaskIds.map((taskId) => state.tasks[taskId]).filter((task): task is TaskItem => Boolean(task));
}

export function listArchivedTasks(state: ProjectedState): TaskItem[] {
  return sortTasksByUpdatedAtDesc(state.archivedTaskIds.map((taskId) => state.tasks[taskId]).filter((task): task is TaskItem => Boolean(task)));
}

export function findTask(state: ProjectedState, taskId: string): TaskItem | null {
  return state.tasks[taskId] ?? null;
}

export function isRootObjectiveClosable(state: ProjectedState): { ok: true } | { ok: false; reasons: string[] } {
  const reasons: string[] = [];
  if (state.openAskIds.length > 0) reasons.push(`open asks remain (${state.openAskIds.join(", ")})`);
  if (state.openTaskIds.length > 0) reasons.push(`open tasks remain (${state.openTaskIds.join(", ")})`);
  if (state.doneCandidateIds.length > 0) reasons.push(`done_candidate tasks remain (${state.doneCandidateIds.join(", ")})`);
  const activeProposals = state.contractChangeProposals.filter((proposal) => proposal.status === "open");
  if (activeProposals.length > 0) reasons.push(`open contract proposals remain (${activeProposals.map((item) => item.id).join(", ")})`);
  return reasons.length === 0 ? { ok: true } : { ok: false, reasons };
}

export function explainWhyTaskOpen(state: ProjectedState, taskId: string): string {
  const task = state.tasks[taskId];
  if (!task) return `Task ${taskId} does not exist.`;
  if (task.archivedAt) return `Task ${taskId} is archived.`;
  if (task.status === "done") return `Task ${taskId} is done.`;
  if (task.status === "done_candidate") {
    const gate = canCommitTaskDone(state, taskId, "verified_evidence");
    if (gate.ok) return `Task ${taskId} is waiting for explicit done commit.`;
    return `Task ${taskId} is done_candidate but cannot close yet: ${gate.reason}`;
  }

  const reasons: string[] = [`status=${task.status}`];
  if (task.status === "blocked" && task.blockingReason) reasons.push(`blockingReason=${task.blockingReason}`);
  if (task.status === "awaiting_user" && task.waitingReason) reasons.push(`waitingReason=${task.waitingReason}`);
  const unresolvedDependencies = getUnresolvedDependencies(state, task);
  if (unresolvedDependencies.length > 0) {
    reasons.push(`unresolvedDependencies=${unresolvedDependencies.map((item) => item.id).join(", ")}`);
  }
  return reasons.join("; ");
}

export function explainWhyTaskDone(state: ProjectedState, taskId: string): string {
  const task = state.tasks[taskId];
  if (!task) return `Task ${taskId} does not exist.`;
  if (task.status !== "done") return `Task ${taskId} is not done.`;
  const details: string[] = [`doneAt=${task.doneAt ?? "unknown"}`];
  if (task.doneReason) details.push(`reason=${task.doneReason}`);
  const verifiedEvidence = task.evidence.filter((item) => item.level === "verified").map((item) => item.id);
  if (verifiedEvidence.length > 0) details.push(`verifiedEvidence=${verifiedEvidence.join(", ")}`);
  const relatedAcceptance = state.acceptances.filter((item) => item.taskId === taskId || item.taskId === undefined).map((item) => item.id);
  if (relatedAcceptance.length > 0) details.push(`acceptance=${relatedAcceptance.join(", ")}`);
  return details.join("; ");
}

export function summarizeLedger(events: KnownLedgerEvent[], limit = 12): string {
  const selected = events.slice(-limit);
  if (selected.length === 0) return "No ledger events recorded.";
  return selected
    .map((event) => `${event.createdAt} ${event.type} [${event.actor}/${event.authority}]`)
    .join("\n");
}

export function latestOpenTasks(state: ProjectedState): TaskItem[] {
  return listOpenTasks(state).filter(isPromptEligibleTask);
}

export function latestDoneCandidates(state: ProjectedState): TaskItem[] {
  return state.doneCandidateIds.map((taskId) => state.tasks[taskId]).filter((task): task is TaskItem => Boolean(task));
}

export function latestRecentDone(state: ProjectedState): TaskItem[] {
  return sortTasksByUpdatedAtDesc(Object.values(state.tasks).filter((task) => task.status === "done" && !task.archivedAt));
}

export function latestContractProposals(state: ProjectedState): ContractChangeProposal[] {
  return [...state.contractChangeProposals].sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
}

export function latestAcceptances(state: ProjectedState): AcceptanceRecord[] {
  return [...state.acceptances].sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
}
