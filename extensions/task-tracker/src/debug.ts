import type { ProjectedState } from "./types.ts";
import { explainWhyTaskDone, explainWhyTaskOpen, latestContractProposals, summarizeLedger } from "./projector.ts";

export function renderProjectedState(state: ProjectedState): string {
  const contract = state.contract;
  const proposals = latestContractProposals(state);
  return [
    `Original objective: ${contract?.originalObjective ?? "none"}`,
    `Active objective: ${contract?.activeObjective ?? "none"}`,
    `Open asks: ${state.openAskIds.join(", ") || "none"}`,
    `Open tasks: ${state.openTaskIds.join(", ") || "none"}`,
    `Done candidates: ${state.doneCandidateIds.join(", ") || "none"}`,
    `Archived tasks: ${state.archivedTaskIds.join(", ") || "none"}`,
    `Contract proposals: ${proposals.length > 0 ? proposals.map((item) => `${item.id}[${item.status}]`).join(", ") : "none"}`,
    `Execution stage: ${state.execution.stage}`,
    `Next action: ${state.execution.nextAction ?? "none"}`,
    `Waiting for: ${state.execution.waitingFor}`,
    `Warnings: ${state.warnings.length > 0 ? state.warnings.join(" | ") : "none"}`,
  ].join("\n");
}

export function renderRecentLedgerEventsText(events: Parameters<typeof summarizeLedger>[0], limit = 12): string {
  return summarizeLedger(events, limit);
}

export function explainTaskOpen(state: ProjectedState, taskId: string): string {
  return explainWhyTaskOpen(state, taskId);
}

export function explainTaskDone(state: ProjectedState, taskId: string): string {
  return explainWhyTaskDone(state, taskId);
}
