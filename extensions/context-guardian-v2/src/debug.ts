import type { ProjectedState } from "./types.ts";
import { explainWhyTaskDone, explainWhyTaskOpen, latestContractProposals, summarizeLedger } from "./projector.ts";

export function renderProjectedState(state: ProjectedState): string {
  const contract = state.contract;
  return [
    `Contract: ${contract ? contract.activeObjective : "none"}`,
    `Open asks: ${state.openAskIds.join(", ") || "none"}`,
    `Open tasks: ${state.openTaskIds.join(", ") || "none"}`,
    `Done candidates: ${state.doneCandidateIds.join(", ") || "none"}`,
    `Archived tasks: ${state.archivedTaskIds.join(", ") || "none"}`,
    `Execution stage: ${state.execution.stage}`,
    `Next action: ${state.execution.nextAction ?? "none"}`,
    `Waiting for: ${state.execution.waitingFor}`,
    `Warnings: ${state.warnings.length > 0 ? state.warnings.join(" | ") : "none"}`,
  ].join("\n");
}

export function renderRecentLedgerEventsText(events: Parameters<typeof summarizeLedger>[0], limit = 12): string {
  return summarizeLedger(events, limit);
}

export function renderContractProposals(state: ProjectedState): string {
  const proposals = latestContractProposals(state);
  if (proposals.length === 0) return "No contract change proposals.";
  return proposals
    .map((proposal) => `- [${proposal.id}][${proposal.status}] ${proposal.kind}: ${Array.isArray(proposal.proposedValue) ? proposal.proposedValue.join(" | ") : proposal.proposedValue}`)
    .join("\n");
}

export function explainTaskOpen(state: ProjectedState, taskId: string): string {
  return explainWhyTaskOpen(state, taskId);
}

export function explainTaskDone(state: ProjectedState, taskId: string): string {
  return explainWhyTaskDone(state, taskId);
}
