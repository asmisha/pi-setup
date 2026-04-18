import { latestDoneCandidates, latestOpenTasks } from "./projector.ts";
import type { ProjectedState, TaskItem, TaskStatus } from "./types.ts";

export type TodoWidgetMode = "planning" | "active" | "blocked" | "waiting";

export type TodoWidgetTaskRow = {
  id: string;
  title: string;
  status: TaskStatus;
  active: boolean;
};

export type TodoWidgetSnapshot = {
  mode: TodoWidgetMode;
  objective: string | null;
  stage: ProjectedState["execution"]["stage"];
  counts: {
    open: number;
    inProgress: number;
    blocked: number;
    awaitingUser: number;
    doneCandidate: number;
    openAsks: number;
  };
  tasks: TodoWidgetTaskRow[];
  latestAsk: string | null;
  nextAction: string | null;
  note?: string;
};

const DEFAULT_MAX_TASKS = 3;
const MAX_TITLE_LENGTH = 88;
const MAX_HINT_LENGTH = 104;

const STATUS_PRIORITY: Record<TaskStatus, number> = {
  in_progress: 0,
  blocked: 1,
  awaiting_user: 2,
  todo: 3,
  done_candidate: 4,
  done: 5,
  dropped: 6,
};

function clip(text: string, maxLength: number): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function isRootObjectiveTask(state: ProjectedState, task: TaskItem): boolean {
  const objective = state.contract?.activeObjective?.trim();
  if (!objective) return false;
  return !task.parentId && task.kind === "user_requested" && task.source === "user" && task.title.trim() === objective;
}

function sortTasks(tasks: TaskItem[], activeTaskIds: string[]): TaskItem[] {
  const active = new Set(activeTaskIds);
  return [...tasks].sort((left, right) => {
    const leftActive = active.has(left.id) ? 1 : 0;
    const rightActive = active.has(right.id) ? 1 : 0;
    if (leftActive !== rightActive) return rightActive - leftActive;
    const byPriority = STATUS_PRIORITY[left.status] - STATUS_PRIORITY[right.status];
    if (byPriority !== 0) return byPriority;
    return Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
  });
}

function latestOpenAskText(state: ProjectedState): string | null {
  const openAsks = (state.contract?.explicitAsks ?? []).filter((ask) => ask.status === "open");
  const latest = openAsks.at(-1)?.text;
  return latest ? clip(latest, MAX_HINT_LENGTH) : null;
}

function summarizeMode(snapshot: TodoWidgetSnapshot): string {
  switch (snapshot.mode) {
    case "planning":
      return "planning";
    case "waiting":
      return `waiting on user · ${snapshot.counts.open} open`;
    case "blocked":
      return `blocked · ${snapshot.counts.open} open`;
    case "active": {
      const parts: string[] = [];
      if (snapshot.counts.inProgress > 0) parts.push(`${snapshot.counts.inProgress} active`);
      if (snapshot.counts.open > 0) parts.push(`${snapshot.counts.open} open`);
      if (snapshot.counts.doneCandidate > 0) parts.push(`${snapshot.counts.doneCandidate} ready`);
      if (snapshot.counts.openAsks > 0) parts.push(`${snapshot.counts.openAsks} asks`);
      return parts.join(" · ") || "active";
    }
  }
}

function taskPrefix(task: TodoWidgetTaskRow): string {
  if (task.status === "done_candidate") return "✓";
  if (task.status === "blocked") return "⛔";
  if (task.status === "awaiting_user") return "?";
  if (task.active || task.status === "in_progress") return "→";
  return "•";
}

export function buildTodoWidgetSnapshot(state: ProjectedState, options?: { maxTasks?: number }): TodoWidgetSnapshot | null {
  const maxTasks = options?.maxTasks ?? DEFAULT_MAX_TASKS;
  const openAsks = (state.contract?.explicitAsks ?? []).filter((ask) => ask.status === "open");

  const allOpenTasks = sortTasks(latestOpenTasks(state), state.execution.activeTaskIds);
  const allDoneCandidates = sortTasks(latestDoneCandidates(state), state.execution.activeTaskIds);

  const visibleOpenTasks = allOpenTasks.filter((task) => !isRootObjectiveTask(state, task));
  const visibleDoneCandidates = allDoneCandidates.filter((task) => !isRootObjectiveTask(state, task));

  const rootOnly = visibleOpenTasks.length === 0 && visibleDoneCandidates.length === 0 && (allOpenTasks.length > 0 || allDoneCandidates.length > 0);
  const openCount = visibleOpenTasks.length;
  const inProgressCount = visibleOpenTasks.filter((task) => task.status === "in_progress").length;
  const blockedCount = visibleOpenTasks.filter((task) => task.status === "blocked").length;
  const awaitingUserCount = visibleOpenTasks.filter((task) => task.status === "awaiting_user").length;
  const doneCandidateCount = visibleDoneCandidates.length;

  if (!rootOnly && openCount === 0 && doneCandidateCount === 0 && openAsks.length === 0) {
    return null;
  }

  let mode: TodoWidgetMode;
  if (rootOnly) {
    mode = "planning";
  } else if (state.execution.waitingFor === "user" || awaitingUserCount > 0) {
    mode = "waiting";
  } else if (blockedCount > 0 && inProgressCount === 0) {
    mode = "blocked";
  } else {
    mode = "active";
  }

  const selectedTasks = [
    ...visibleOpenTasks.slice(0, maxTasks),
    ...visibleDoneCandidates.slice(0, Math.max(0, maxTasks - Math.min(maxTasks, visibleOpenTasks.length))),
  ]
    .slice(0, maxTasks)
    .map((task) => ({
      id: task.id,
      title: clip(task.title, MAX_TITLE_LENGTH),
      status: task.status,
      active: state.execution.activeTaskIds.includes(task.id),
    }));

  return {
    mode,
    objective: state.contract?.activeObjective ?? null,
    stage: state.execution.stage,
    counts: {
      open: openCount,
      inProgress: inProgressCount,
      blocked: blockedCount,
      awaitingUser: awaitingUserCount,
      doneCandidate: doneCandidateCount,
      openAsks: openAsks.length,
    },
    tasks: selectedTasks,
    latestAsk: latestOpenAskText(state),
    nextAction: state.execution.nextAction ? clip(state.execution.nextAction, MAX_HINT_LENGTH) : null,
    ...(rootOnly ? { note: "No explicit subtasks yet." } : {}),
  };
}

export function renderTodoStatusText(snapshot: TodoWidgetSnapshot | null): string | null {
  if (!snapshot) return null;
  return `CG2 · ${summarizeMode(snapshot)}`;
}

export function renderTodoWidgetText(snapshot: TodoWidgetSnapshot | null): string[] {
  if (!snapshot) return [];

  const summaryBits: string[] = [];
  if (snapshot.counts.open > 0) summaryBits.push(`${snapshot.counts.open} open`);
  if (snapshot.counts.doneCandidate > 0) summaryBits.push(`${snapshot.counts.doneCandidate} ready`);
  if (snapshot.counts.openAsks > 0) summaryBits.push(`${snapshot.counts.openAsks} asks`);
  if (summaryBits.length === 0) summaryBits.push(snapshot.mode === "planning" ? "getting started" : snapshot.mode);

  const lines: string[] = [`CG2 ${snapshot.stage} — ${summaryBits.join(" · ")}`];
  if (snapshot.note) lines.push(snapshot.note);

  for (const task of snapshot.tasks) {
    lines.push(`${taskPrefix(task)} ${task.title}`);
  }

  if (snapshot.nextAction && lines.length < 5) {
    lines.push(`Next: ${snapshot.nextAction}`);
  }

  if (snapshot.latestAsk && lines.length < 6 && (snapshot.mode === "planning" || snapshot.mode === "waiting")) {
    lines.push(`Ask: ${snapshot.latestAsk}`);
  }

  return lines;
}
