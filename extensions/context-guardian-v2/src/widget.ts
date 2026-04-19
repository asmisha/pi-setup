import { latestDoneCandidates, latestOpenTasks, latestRecentDone } from "./projector.ts";
import type { ProjectedState, TaskItem, TaskStatus } from "./types.ts";

export type TodoWidgetMode = "planning" | "active" | "blocked" | "waiting";

export type TodoWidgetTaskRow = {
  id: string;
  title: string;
  status: TaskStatus;
  active: boolean;
  detail: string | null;
};

export type TodoWidgetSnapshot = {
  mode: TodoWidgetMode;
  stage: ProjectedState["execution"]["stage"];
  counts: {
    open: number;
    inProgress: number;
    blocked: number;
    awaitingUser: number;
    doneCandidate: number;
    done: number;
    openAsks: number;
  };
  tasks: TodoWidgetTaskRow[];
  latestAsk: string | null;
  nextAction: string | null;
  hiddenTaskCount: number;
  note?: string;
};

const DEFAULT_MAX_TASKS = 4;
const MAX_TITLE_LENGTH = 88;
const MAX_HINT_LENGTH = 104;
const MAX_TASK_LINE_LENGTH = 116;

const STATUS_PRIORITY: Record<TaskStatus, number> = {
  blocked: 0,
  in_progress: 1,
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

function formatStage(stage: ProjectedState["execution"]["stage"]): string {
  return stage.replace(/_/g, " ");
}

function countLabel(count: number, label: string): string {
  return `${count} ${label}`;
}

function askCountLabel(count: number): string {
  return `${count} ${count === 1 ? "ask" : "asks"}`;
}

function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function isRootObjectiveTask(state: ProjectedState, task: TaskItem): boolean {
  const objective = state.contract?.activeObjective?.trim();
  if (!objective) return false;
  return !task.parentId && task.kind === "user_requested" && task.source === "user" && task.title.trim() === objective;
}

function sortTasks(tasks: TaskItem[], activeTaskIds: string[]): TaskItem[] {
  const active = new Set(activeTaskIds);
  return [...tasks].sort((left, right) => {
    const byPriority = STATUS_PRIORITY[left.status] - STATUS_PRIORITY[right.status];
    if (byPriority !== 0) return byPriority;

    const leftActive = active.has(left.id) ? 1 : 0;
    const rightActive = active.has(right.id) ? 1 : 0;
    if (leftActive !== rightActive) return rightActive - leftActive;

    return Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
  });
}

function latestOpenAskText(state: ProjectedState): string | null {
  const openAsks = (state.contract?.explicitAsks ?? []).filter((ask) => ask.status === "open");
  const latest = openAsks.at(-1)?.text;
  return latest ? clip(latest, MAX_HINT_LENGTH) : null;
}

function stripKnownPrefix(value: string | null | undefined, prefix: RegExp): string | null {
  if (!value) return null;
  return value.replace(prefix, "").trim() || null;
}

function taskDetail(task: TaskItem): string | null {
  if (task.status === "blocked") {
    return stripKnownPrefix(task.blockingReason, /^blocked:\s*/i) ?? "blocked";
  }
  if (task.status === "awaiting_user") {
    return stripKnownPrefix(task.waitingReason, /^awaiting user:\s*/i) ?? "needs user input";
  }
  if (task.status === "done_candidate") {
    return "needs evidence or explicit acceptance";
  }
  return null;
}

function summarizeMode(snapshot: TodoWidgetSnapshot): string {
  switch (snapshot.mode) {
    case "planning":
      return snapshot.counts.openAsks > 0 ? `planning · ${askCountLabel(snapshot.counts.openAsks)}` : "planning";
    case "waiting":
      return `waiting on user · ${countLabel(snapshot.counts.open, "open")}`;
    case "blocked":
      return `blocked · ${countLabel(snapshot.counts.open, "open")}`;
    case "active": {
      const parts: string[] = [];
      if (snapshot.counts.inProgress > 0) parts.push(countLabel(snapshot.counts.inProgress, "active"));
      if (snapshot.counts.open > 0) parts.push(countLabel(snapshot.counts.open, "open"));
      if (snapshot.counts.done > 0) parts.push(countLabel(snapshot.counts.done, "done"));
      if (snapshot.counts.doneCandidate > 0) parts.push(countLabel(snapshot.counts.doneCandidate, "ready"));
      if (snapshot.counts.openAsks > 0) parts.push(askCountLabel(snapshot.counts.openAsks));
      return parts.join(" · ") || "active";
    }
  }
}

function buildSummaryBits(snapshot: TodoWidgetSnapshot): string[] {
  const bits: string[] = [];
  if (snapshot.counts.inProgress > 0) bits.push(countLabel(snapshot.counts.inProgress, "active"));
  if (snapshot.counts.awaitingUser > 0) bits.push(countLabel(snapshot.counts.awaitingUser, "waiting"));
  if (snapshot.counts.blocked > 0) bits.push(countLabel(snapshot.counts.blocked, "blocked"));
  if (snapshot.counts.open > 0) bits.push(countLabel(snapshot.counts.open, "open"));
  if (snapshot.counts.done > 0) bits.push(countLabel(snapshot.counts.done, "done"));
  if (snapshot.counts.doneCandidate > 0) bits.push(countLabel(snapshot.counts.doneCandidate, "ready"));
  if (snapshot.counts.openAsks > 0) bits.push(askCountLabel(snapshot.counts.openAsks));
  return bits;
}

function taskPrefix(task: TodoWidgetTaskRow): string {
  if (task.status === "done_candidate") return "◇";
  if (task.status === "done") return "✓";
  if (task.status === "blocked") return "⛔";
  if (task.status === "awaiting_user") return "?";
  if (task.active || task.status === "in_progress") return "→";
  return "•";
}

function renderTaskLine(task: TodoWidgetTaskRow): string {
  const suffix = task.detail ? ` — ${task.detail}` : "";
  return clip(`${taskPrefix(task)} ${task.title}${suffix}`, MAX_TASK_LINE_LENGTH);
}

export function buildTodoWidgetSnapshot(state: ProjectedState, options?: { maxTasks?: number }): TodoWidgetSnapshot | null {
  const maxTasks = options?.maxTasks ?? DEFAULT_MAX_TASKS;
  const openAsks = (state.contract?.explicitAsks ?? []).filter((ask) => ask.status === "open");

  const allOpenTasks = sortTasks(latestOpenTasks(state), state.execution.activeTaskIds);
  const allDoneCandidates = sortTasks(latestDoneCandidates(state), state.execution.activeTaskIds);
  const allRecentDone = sortTasks(latestRecentDone(state), state.execution.activeTaskIds);

  const visibleOpenTasks = allOpenTasks.filter((task) => !isRootObjectiveTask(state, task));
  const visibleDoneCandidates = allDoneCandidates.filter((task) => !isRootObjectiveTask(state, task));
  const visibleRecentDone = allRecentDone.filter((task) => !isRootObjectiveTask(state, task));
  const allVisibleTasks = [...visibleOpenTasks, ...visibleDoneCandidates, ...visibleRecentDone];

  const rootOnly = visibleOpenTasks.length === 0
    && visibleDoneCandidates.length === 0
    && visibleRecentDone.length === 0
    && (allOpenTasks.length > 0 || allDoneCandidates.length > 0 || allRecentDone.length > 0);
  const openCount = visibleOpenTasks.length;
  const inProgressCount = visibleOpenTasks.filter((task) => task.status === "in_progress").length;
  const blockedCount = visibleOpenTasks.filter((task) => task.status === "blocked").length;
  const awaitingUserCount = visibleOpenTasks.filter((task) => task.status === "awaiting_user").length;
  const doneCandidateCount = visibleDoneCandidates.length;
  const doneCount = visibleRecentDone.length;

  if (!rootOnly && openCount === 0 && doneCandidateCount === 0 && doneCount === 0 && openAsks.length === 0) {
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

  const selectedTasks = allVisibleTasks
    .slice(0, maxTasks)
    .map((task) => ({
      id: task.id,
      title: clip(task.title, MAX_TITLE_LENGTH),
      status: task.status,
      active: state.execution.activeTaskIds.includes(task.id),
      detail: taskDetail(task),
    }));

  return {
    mode,
    stage: state.execution.stage,
    counts: {
      open: openCount,
      inProgress: inProgressCount,
      blocked: blockedCount,
      awaitingUser: awaitingUserCount,
      doneCandidate: doneCandidateCount,
      done: doneCount,
      openAsks: openAsks.length,
    },
    tasks: selectedTasks,
    latestAsk: latestOpenAskText(state),
    nextAction: state.execution.nextAction ? clip(state.execution.nextAction, MAX_HINT_LENGTH) : null,
    hiddenTaskCount: Math.max(0, allVisibleTasks.length - selectedTasks.length),
    ...(rootOnly ? { note: "Hint: break this into explicit subtasks." } : {}),
  };
}

export function renderTodoStatusText(snapshot: TodoWidgetSnapshot | null): string | null {
  if (!snapshot) return null;
  return `CG2 · ${summarizeMode(snapshot)}`;
}

export function renderTodoWidgetText(snapshot: TodoWidgetSnapshot | null): string[] {
  if (!snapshot) return [];

  const summaryBits = buildSummaryBits(snapshot);
  const lines: string[] = [
    `CG2 ${formatStage(snapshot.stage)} · ${summaryBits.join(" · ") || (snapshot.mode === "planning" ? "getting started" : snapshot.mode)}`,
  ];

  if (snapshot.latestAsk) {
    lines.push(`Ask: ${snapshot.latestAsk}`);
  }

  if (snapshot.note) lines.push(snapshot.note);

  for (const task of snapshot.tasks) {
    lines.push(renderTaskLine(task));
  }

  if (snapshot.nextAction && snapshot.tasks.length > 0 && lines.length < 7) {
    lines.push(`Next: ${snapshot.nextAction}`);
  }

  if (snapshot.hiddenTaskCount > 0 && lines.length < 8) {
    lines.push(`+${snapshot.hiddenTaskCount} more ${snapshot.hiddenTaskCount === 1 ? "task" : "tasks"}`);
  }

  return lines;
}
