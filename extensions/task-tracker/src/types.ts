export const TASK_KINDS = ["user_requested", "inferred", "verification", "followup"] as const;
export const TASK_SOURCES = ["user", "assistant", "manual"] as const;
export const TASK_STATUSES = ["todo", "in_progress", "blocked", "awaiting_user", "done_candidate", "done", "dropped"] as const;
export const EVIDENCE_KINDS = ["test", "tool_result", "file", "message", "manual_note"] as const;
export const EVIDENCE_LEVELS = ["claimed", "observed", "verified"] as const;
export const EXECUTION_STAGES = ["intake", "planning", "investigating", "implementing", "verifying", "awaiting_user", "handoff"] as const;
export const EXECUTION_WAITING_FOR = ["nothing", "user", "tool", "external"] as const;
export const ACTORS = ["user", "assistant", "system", "manual"] as const;
export const AUTHORITIES = ["authoritative", "proposed", "advisory"] as const;
export const CONTRACT_CHANGE_KINDS = ["objective", "success_criteria", "constraints"] as const;
export const CONTRACT_CHANGE_STATUSES = ["open", "accepted", "rejected"] as const;
export const CONTRACT_ASK_STATUSES = ["open", "satisfied", "cancelled"] as const;
export const ASK_RESOLUTION_STATUSES = ["satisfied", "cancelled"] as const;
export const ARTIFACT_KINDS = ["file", "command", "url", "id", "note"] as const;
export const DONE_REASONS = ["verified_evidence", "user_acceptance", "manual_override"] as const;

export type TaskKind = (typeof TASK_KINDS)[number];
export type TaskSource = (typeof TASK_SOURCES)[number];
export type TaskStatus = (typeof TASK_STATUSES)[number];
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];
export type EvidenceLevel = (typeof EVIDENCE_LEVELS)[number];
export type ExecutionStage = (typeof EXECUTION_STAGES)[number];
export type ExecutionWaitingFor = (typeof EXECUTION_WAITING_FOR)[number];
export type Actor = (typeof ACTORS)[number];
export type Authority = (typeof AUTHORITIES)[number];
export type ContractChangeKind = (typeof CONTRACT_CHANGE_KINDS)[number];
export type ContractChangeStatus = (typeof CONTRACT_CHANGE_STATUSES)[number];
export type ContractAskStatus = (typeof CONTRACT_ASK_STATUSES)[number];
export type AskResolutionStatus = (typeof ASK_RESOLUTION_STATUSES)[number];
export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];
export type DoneReason = (typeof DONE_REASONS)[number];

export type ContractAsk = {
  id: string;
  text: string;
  sourceMessageId?: string;
  status: ContractAskStatus;
  createdAt: string;
  closedAt?: string;
};

export type ContractChangeProposal = {
  id: string;
  kind: ContractChangeKind;
  proposedValue: string | string[];
  reason: string;
  status: ContractChangeStatus;
  proposedBy: "assistant" | "manual";
  sourceMessageId?: string;
  createdAt: string;
  resolvedAt?: string;
};

export type UserContract = {
  version: 2;
  originalObjective: string;
  activeObjective: string;
  successCriteria: string[];
  constraints: string[];
  explicitAsks: ContractAsk[];
  contractChangeProposals: ContractChangeProposal[];
  rejectedDirections: string[];
  updatedAt: string;
  updatedFrom: "user" | "manual";
};

export type TaskEvidence = {
  id: string;
  kind: EvidenceKind;
  ref: string;
  summary: string;
  level: EvidenceLevel;
  actor: "assistant" | "system" | "manual";
  sourceEntryId?: string;
  createdAt: string;
};

export type TaskItem = {
  id: string;
  title: string;
  kind: TaskKind;
  source: TaskSource;
  parentId?: string;
  dependsOn: string[];
  status: TaskStatus;
  evidence: TaskEvidence[];
  notes: string[];
  relevantFiles: string[];
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
  doneAt?: string;
  doneReason?: DoneReason;
  blockingReason?: string | null;
  waitingReason?: string | null;
};

export type ExecutionState = {
  version: 2;
  stage: ExecutionStage;
  activeTaskIds: string[];
  nextAction: string | null;
  waitingFor: ExecutionWaitingFor;
  blocker: string | null;
  lastMeaningfulProgress: string | null;
  updatedAt: string;
};

export type AdvisoryArtifact = {
  kind: ArtifactKind;
  value: string;
  note?: string;
};

export type CompactionAdvisory = {
  version: 2;
  latestUserIntent: string | null;
  recentFocus: string[];
  suggestedNextAction: string | null;
  blockers: string[];
  relevantFiles: string[];
  artifacts: AdvisoryArtifact[];
  avoidRepeating: string[];
  unresolvedQuestions: string[];
  updatedAt: string;
};

export type AcceptanceRecord = {
  id: string;
  taskId?: string;
  note: string;
  sourceMessageId?: string;
  createdAt: string;
};

export const ENTRY_TYPES = {
  contractUpsert: "task-tracker-contract-upsert",
  contractChangeProposed: "task-tracker-contract-change-proposed",
  taskCreated: "task-tracker-task-created",
  taskPatched: "task-tracker-task-patched",
  evidenceAdded: "task-tracker-evidence-added",
  taskStatusProposed: "task-tracker-task-status-proposed",
  taskStatusCommitted: "task-tracker-task-status-committed",
  askStatusCommitted: "task-tracker-ask-status-committed",
  taskArchived: "task-tracker-task-archived",
  executionUpdated: "task-tracker-execution-updated",
  advisoryStored: "task-tracker-compaction-advisory",
  acceptanceRecorded: "task-tracker-acceptance-recorded",
  stateCleared: "task-tracker-state-cleared",
  projectionSnapshot: "task-tracker-projection-snapshot",
} as const;

export const LEGACY_ENTRY_TYPE_ALIASES: Record<string, LedgerEventType> = {
  "cg2-contract-upsert": ENTRY_TYPES.contractUpsert,
  "cg2-contract-change-proposed": ENTRY_TYPES.contractChangeProposed,
  "cg2-task-created": ENTRY_TYPES.taskCreated,
  "cg2-task-patched": ENTRY_TYPES.taskPatched,
  "cg2-evidence-added": ENTRY_TYPES.evidenceAdded,
  "cg2-task-status-proposed": ENTRY_TYPES.taskStatusProposed,
  "cg2-task-status-committed": ENTRY_TYPES.taskStatusCommitted,
  "cg2-ask-status-committed": ENTRY_TYPES.askStatusCommitted,
  "cg2-task-archived": ENTRY_TYPES.taskArchived,
  "cg2-execution-updated": ENTRY_TYPES.executionUpdated,
  "cg2-compaction-advisory": ENTRY_TYPES.advisoryStored,
  "cg2-acceptance-recorded": ENTRY_TYPES.acceptanceRecorded,
  "cg2-projection-snapshot": ENTRY_TYPES.projectionSnapshot,
};

export type LedgerEventType = (typeof ENTRY_TYPES)[keyof typeof ENTRY_TYPES];

export type ContractUpsertPayload = {
  contract: UserContract;
};

export type ContractChangeProposedPayload = {
  proposal: ContractChangeProposal;
};

export type TaskCreatedPayload = {
  task: TaskItem;
};

export type TaskPatch = {
  title?: string;
  notesToAppend?: string[];
  relevantFilesToAdd?: string[];
  dependsOnToAdd?: string[];
};

export type TaskPatchedPayload = {
  taskId: string;
  patch: TaskPatch;
};

export type EvidenceAddedPayload = {
  taskId: string;
  evidence: TaskEvidence;
};

export type TaskStatusProposedPayload = {
  taskId: string;
  status: Extract<TaskStatus, "done_candidate">;
  note?: string;
};

export type TaskStatusCommittedPayload = {
  taskId: string;
  status: Extract<TaskStatus, "todo" | "in_progress" | "blocked" | "awaiting_user" | "done" | "dropped">;
  reason?: DoneReason;
  note?: string;
  evidenceIds?: string[];
};

export type AskStatusCommittedPayload = {
  askId: string;
  status: AskResolutionStatus;
  taskId?: string;
};

export type TaskArchivedPayload = {
  taskId: string;
  reason?: string;
};

export type ExecutionUpdatedPayload = {
  patch: Partial<Omit<ExecutionState, "version">>;
};

export type AdvisoryStoredPayload = {
  advisory: CompactionAdvisory;
};

export type AcceptanceRecordedPayload = {
  acceptance: AcceptanceRecord;
};

export type StateClearedPayload = {
  reason?: string;
};

export type ProjectionSnapshotPayload = {
  state: ProjectedStateSnapshot;
};

export type LedgerPayloadMap = {
  [ENTRY_TYPES.contractUpsert]: ContractUpsertPayload;
  [ENTRY_TYPES.contractChangeProposed]: ContractChangeProposedPayload;
  [ENTRY_TYPES.taskCreated]: TaskCreatedPayload;
  [ENTRY_TYPES.taskPatched]: TaskPatchedPayload;
  [ENTRY_TYPES.evidenceAdded]: EvidenceAddedPayload;
  [ENTRY_TYPES.taskStatusProposed]: TaskStatusProposedPayload;
  [ENTRY_TYPES.taskStatusCommitted]: TaskStatusCommittedPayload;
  [ENTRY_TYPES.askStatusCommitted]: AskStatusCommittedPayload;
  [ENTRY_TYPES.taskArchived]: TaskArchivedPayload;
  [ENTRY_TYPES.executionUpdated]: ExecutionUpdatedPayload;
  [ENTRY_TYPES.advisoryStored]: AdvisoryStoredPayload;
  [ENTRY_TYPES.acceptanceRecorded]: AcceptanceRecordedPayload;
  [ENTRY_TYPES.stateCleared]: StateClearedPayload;
  [ENTRY_TYPES.projectionSnapshot]: ProjectionSnapshotPayload;
};

export type LedgerEvent<T = unknown> = {
  type: LedgerEventType;
  actor: Actor;
  authority: Authority;
  sourceMessageId?: string;
  sourceEntryId?: string;
  createdAt: string;
  payload: T;
};

export type KnownLedgerEvent = {
  [K in LedgerEventType]: LedgerEvent<LedgerPayloadMap[K]> & { type: K };
}[LedgerEventType];

export type PersistedLedgerEventData<T = unknown> = Omit<LedgerEvent<T>, "type">;

export type ProjectedState = {
  contract: UserContract | null;
  tasks: Record<string, TaskItem>;
  execution: ExecutionState;
  openAskIds: string[];
  openTaskIds: string[];
  doneCandidateIds: string[];
  archivedTaskIds: string[];
  contractChangeProposals: ContractChangeProposal[];
  advisory: CompactionAdvisory | null;
  acceptances: AcceptanceRecord[];
  warnings: string[];
};

export type ProjectedStateSnapshot = {
  contract: UserContract | null;
  tasks: Record<string, TaskItem>;
  execution: ExecutionState;
  advisory: CompactionAdvisory | null;
  acceptances: AcceptanceRecord[];
};

export type TaskTrackerAction =
  | { action: "list_open" }
  | { action: "list_open_asks" }
  | { action: "list_archived"; limit?: number }
  | { action: "create_task"; title: string; kind?: TaskKind; parentId?: string; dependsOn?: string[] }
  | { action: "start_task"; taskId: string }
  | { action: "block_task"; taskId: string; reason: string }
  | { action: "await_user"; taskId: string; reason: string }
  | { action: "propose_done"; taskId: string; note?: string }
  | { action: "commit_done"; taskId: string; reason: DoneReason; evidenceIds?: string[]; askIdsToSatisfy?: string[] }
  | { action: "add_evidence"; taskId: string; evidence: TaskEvidenceInput }
  | { action: "record_acceptance"; taskId?: string; note: string; sourceMessageId?: string }
  | { action: "cancel_ask"; askId: string; sourceMessageId?: string }
  | { action: "propose_contract_change"; kind: ContractChangeKind; proposedValue: string | string[]; reason: string }
  | { action: "set_next_action"; nextAction: string; activeTaskIds?: string[] }
  | { action: "link_file"; taskId: string; path: string }
  | { action: "note"; taskId: string; text: string };

export type TaskEvidenceInput = {
  kind: EvidenceKind;
  ref: string;
  summary: string;
  level?: EvidenceLevel;
  sourceEntryId?: string;
};

export type TrackerActionContext = {
  now: string;
  actor: Actor;
  authority: Authority;
  maxInferredTasksPerTurn: number;
  createdInferredTasksThisTurn: number;
  nextId(prefix: string): string;
};

export type TrackerActionResult = {
  events: KnownLedgerEvent[];
  message: string;
  createdInferredTasksThisTurn: number;
};
