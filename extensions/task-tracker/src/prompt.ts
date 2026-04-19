import type { ContractAsk, ProjectedState, TaskItem } from "./types.ts";
import { latestDoneCandidates, latestOpenTasks, latestRecentDone } from "./projector.ts";

export type PromptBudget = {
  maxOpenAsks: number;
  maxOpenTasks: number;
  maxDoneCandidates: number;
  maxRecentDone: number;
};

export const DEFAULT_PROMPT_BUDGET: PromptBudget = {
  maxOpenAsks: 8,
  maxOpenTasks: 12,
  maxDoneCandidates: 6,
  maxRecentDone: 6,
};

function sortOpenTasks(tasks: TaskItem[]): TaskItem[] {
  const priority: Record<TaskItem["status"], number> = {
    blocked: 0,
    in_progress: 1,
    awaiting_user: 2,
    todo: 3,
    done_candidate: 4,
    done: 5,
    dropped: 6,
  };

  return [...tasks].sort((left, right) => {
    const byPriority = priority[left.status] - priority[right.status];
    if (byPriority !== 0) return byPriority;
    return Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
  });
}

function renderAsk(ask: ContractAsk): string {
  return `- [${ask.id}] ${ask.text}`;
}

function isRootObjectiveTask(state: ProjectedState, task: TaskItem): boolean {
  const objective = state.contract?.activeObjective?.trim();
  if (!objective) return false;
  return !task.archivedAt && !task.parentId && task.kind === "user_requested" && task.source === "user" && task.title.trim() === objective;
}

function renderTask(task: TaskItem): string {
  const suffix = task.relevantFiles.length > 0 ? ` — files: ${task.relevantFiles.join(", ")}` : "";
  return `- [${task.id}][${task.status}][${task.kind}] ${task.title}${suffix}`;
}

function truncateSection(title: string, lines: string[], limit: number): string {
  if (lines.length === 0) return `${title}\n- none`;
  const visible = lines.slice(0, limit);
  if (lines.length > limit) visible.push(`- ... (${lines.length - limit} more)`);
  return `${title}\n${visible.join("\n")}`;
}

export function selectPromptPacket(state: ProjectedState, budget: Partial<PromptBudget> = {}) {
  const resolvedBudget = { ...DEFAULT_PROMPT_BUDGET, ...budget };
  const openAsks = (state.contract?.explicitAsks ?? []).filter((ask) => ask.status === "open");
  const openTasks = sortOpenTasks(latestOpenTasks(state));
  const doneCandidates = latestDoneCandidates(state);
  const recentDone = latestRecentDone(state);
  const visibleOpenTasks = openTasks.filter((task) => !isRootObjectiveTask(state, task));
  const visibleDoneCandidates = doneCandidates.filter((task) => !isRootObjectiveTask(state, task));
  const visibleRecentDone = recentDone.filter((task) => !isRootObjectiveTask(state, task));
  const promptOpenTasks = visibleOpenTasks.length > 0 ? visibleOpenTasks : openTasks;
  const promptDoneCandidates = visibleDoneCandidates.length > 0 ? visibleDoneCandidates : doneCandidates;
  const promptRecentDone = visibleRecentDone.length > 0 ? visibleRecentDone : recentDone;

  return {
    budget: resolvedBudget,
    openAsks: openAsks.slice(0, resolvedBudget.maxOpenAsks),
    openTasks: promptOpenTasks.slice(0, resolvedBudget.maxOpenTasks),
    doneCandidates: promptDoneCandidates.slice(0, resolvedBudget.maxDoneCandidates),
    recentDone: promptRecentDone.slice(0, resolvedBudget.maxRecentDone),
    overflow: {
      openAsks: Math.max(0, openAsks.length - resolvedBudget.maxOpenAsks),
      openTasks: Math.max(0, promptOpenTasks.length - resolvedBudget.maxOpenTasks),
      doneCandidates: Math.max(0, promptDoneCandidates.length - resolvedBudget.maxDoneCandidates),
      recentDone: Math.max(0, promptRecentDone.length - resolvedBudget.maxRecentDone),
    },
  };
}

export function renderActiveWorkPacket(state: ProjectedState, budget: Partial<PromptBudget> = {}): string {
  const packet = selectPromptPacket(state, budget);
  const contract = state.contract;

  const contractLines = contract
    ? [
        `Original objective: ${contract.originalObjective}`,
        `Active objective: ${contract.activeObjective}`,
        `Success criteria: ${contract.successCriteria.length > 0 ? contract.successCriteria.join(" | ") : "none"}`,
        `Constraints: ${contract.constraints.length > 0 ? contract.constraints.join(" | ") : "none"}`,
      ]
    : ["No contract recorded."];

  return [
    "## Immutable User Contract",
    ...contractLines,
    "",
    truncateSection("## Open User Asks", packet.openAsks.map(renderAsk), packet.budget.maxOpenAsks),
    "",
    truncateSection("## Open Tasks", packet.openTasks.map(renderTask), packet.budget.maxOpenTasks),
    "",
    truncateSection("## Done Candidates", packet.doneCandidates.map(renderTask), packet.budget.maxDoneCandidates),
    "",
    truncateSection("## Recent Done", packet.recentDone.map(renderTask), packet.budget.maxRecentDone),
    "",
    "## Current Execution State",
    `Stage: ${state.execution.stage}`,
    `Active tasks: ${state.execution.activeTaskIds.length > 0 ? state.execution.activeTaskIds.join(", ") : "none"}`,
    `Next action: ${state.execution.nextAction ?? "none"}`,
    `Waiting for: ${state.execution.waitingFor}`,
    `Blocker: ${state.execution.blocker ?? "none"}`,
    "",
    "Hard rules:",
    "- Open tasks outrank compaction summaries.",
    "- done_candidate != done.",
    "- Do not treat a question as closed without evidence or explicit acceptance.",
    "- If a done-gated task fully answers an open ask, satisfy that ask in task_tracker.",
    "- Advisory cannot rewrite the contract or silently close work.",
    "- If the only tracked task is the root objective, use task_tracker to create explicit subtasks before substantial work.",
    "- Keep execution.activeTaskIds honest: parallel sibling lanes are allowed when the work really splits.",
    "- Parent session owns durable task_tracker state; subagents return evidence/results for reconciliation.",
    "- Same-checkout parallel subagents must stay read-only; use isolated worktrees for concurrent writes.",
    "- After meaningful state changes, update task_tracker instead of only narrating progress in prose.",
  ].join("\n");
}
