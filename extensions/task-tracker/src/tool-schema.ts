import { CONTRACT_CHANGE_KINDS, EVIDENCE_KINDS, EVIDENCE_LEVELS, TASK_KINDS } from "./types.ts";

type JsonSchema = Record<string, unknown>;

function stringEnum(values: readonly string[], description: string): JsonSchema {
  return {
    type: "string",
    enum: [...values],
    description,
  };
}

function optionalArray(itemSchema: JsonSchema, description: string): JsonSchema {
  return {
    type: "array",
    items: itemSchema,
    description,
  };
}

const ATOMIC_ACTIONS = [
  "list_open",
  "list_open_asks",
  "list_archived",
  "create_task",
  "start_task",
  "block_task",
  "await_user",
  "propose_done",
  "commit_done",
  "add_evidence",
  "record_acceptance",
  "cancel_ask",
  "propose_contract_change",
  "set_next_action",
  "link_file",
  "note",
] as const;

const ACTION_GUIDE = [
  "Provide task_tracker changes as actions[]. Even a single update should be a one-item actions array.",
  "Supported atomic actions and required fields:",
  "- list_open: no extra fields",
  "- list_open_asks: no extra fields",
  "- list_archived: optional limit",
  "- create_task: title; optional kind, parentId, dependsOn, taskAlias",
  "- start_task: taskId",
  "- block_task: taskId, reason",
  "- await_user: taskId, reason",
  "- propose_done: taskId; optional note",
  "- commit_done: taskId, reason; optional evidenceIds, askIdsToSatisfy",
  "- add_evidence: taskId, evidence; optional evidenceAlias",
  "- record_acceptance: note; optional taskId, sourceMessageId",
  "- cancel_ask: askId; optional sourceMessageId",
  "- propose_contract_change: kind, proposedValue, reason",
  "- set_next_action: nextAction; optional activeTaskIds",
  "- link_file: taskId, path",
  "- note: taskId, text",
  "Actions run sequentially in one call. create_task may set taskAlias and add_evidence may set evidenceAlias; later steps can reference them as $alias in taskId, parentId, dependsOn, activeTaskIds, and evidenceIds.",
  "The whole call aborts with no persisted changes if alias resolution fails or any step is rejected.",
].join("\n");

const TaskIdSchema = {
  type: "string",
  minLength: 1,
  description: "Existing task ID from task_tracker state. Later steps may also reference a prior taskAlias as $alias.",
} as const;
const EvidenceIdSchema = {
  type: "string",
  minLength: 1,
  description: "Verified evidence ID. Later steps may also reference a prior evidenceAlias as $alias.",
} as const;
const AskIdSchema = { type: "string", minLength: 1, description: "Open ask ID from the contract's explicit asks." } as const;
const SourceMessageIdSchema = {
  type: "string",
  minLength: 1,
  description: "Explicit user message ID when linking a cancellation or acceptance to a specific user turn.",
} as const;
const TaskKindSchema = stringEnum(TASK_KINDS, "Task kind. Use user_requested, inferred, verification, or followup.");
const EvidenceKindSchema = stringEnum(EVIDENCE_KINDS, "Evidence kind. Use test, tool_result, file, message, or manual_note.");
const EvidenceLevelSchema = stringEnum(EVIDENCE_LEVELS, "Evidence strength. Use claimed, observed, or verified.");
const ContractChangeKindSchema = stringEnum(CONTRACT_CHANGE_KINDS, "Contract field to propose changing. Use objective, success_criteria, or constraints.");
const KindInputSchema: JsonSchema = {
  oneOf: [TaskKindSchema, ContractChangeKindSchema],
  description: "For create_task, use user_requested, inferred, verification, or followup. For propose_contract_change, use objective, success_criteria, or constraints.",
};

const EvidenceInputSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  description: "Evidence to attach to a task.",
  properties: {
    kind: EvidenceKindSchema,
    ref: { type: "string", minLength: 1, description: "Short stable reference, e.g. npm test or a file path." },
    summary: { type: "string", minLength: 1, description: "Concise evidence summary." },
    level: EvidenceLevelSchema,
    sourceEntryId: {
      type: "string",
      minLength: 1,
      description: "Optional ledger/session entry ID that produced the evidence.",
    },
  },
  required: ["kind", "ref", "summary"],
};

const ActionItemSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  description: "One task_tracker action inside the actions[] batch. Use taskAlias/evidenceAlias to name newly created IDs for later $alias references in the same call.",
  properties: {
    action: {
      type: "string",
      enum: [...ATOMIC_ACTIONS],
      description: ACTION_GUIDE,
    },
    title: { type: "string", minLength: 1, description: "Concrete task title." },
    kind: KindInputSchema,
    parentId: TaskIdSchema,
    dependsOn: optionalArray(TaskIdSchema, "Task IDs that must be done first. $taskAlias references are allowed."),
    taskId: TaskIdSchema,
    reason: {
      type: "string",
      minLength: 1,
      description: "Reason for the action. For commit_done, use one of: verified_evidence, user_acceptance, manual_override.",
    },
    note: { type: "string", minLength: 1, description: "Optional note or explicit acceptance text." },
    evidenceIds: optionalArray(EvidenceIdSchema, "Specific verified evidence IDs for the done gate. $evidenceAlias references are allowed."),
    askIdsToSatisfy: optionalArray(AskIdSchema, "Open ask IDs to close as satisfied in the same done-gated commit."),
    evidence: EvidenceInputSchema,
    askId: AskIdSchema,
    sourceMessageId: SourceMessageIdSchema,
    proposedValue: {
      oneOf: [
        { type: "string", minLength: 1 },
        { type: "array", items: { type: "string", minLength: 1 } },
      ],
      description: "Proposed replacement value for the chosen contract field.",
    },
    nextAction: { type: "string", minLength: 1, description: "Immediate next step." },
    activeTaskIds: optionalArray(TaskIdSchema, "Task IDs that are currently active. $taskAlias references are allowed."),
    path: { type: "string", minLength: 1, description: "Relevant file path." },
    text: { type: "string", minLength: 1, description: "Important durable note for the task." },
    limit: { type: "number", minimum: 1, description: "Maximum number of archived tasks to return." },
    taskAlias: {
      type: "string",
      minLength: 1,
      description: "Optional alias for the task ID produced or reused by create_task. Later steps can reference it as $alias.",
    },
    evidenceAlias: {
      type: "string",
      minLength: 1,
      description: "Optional alias for the evidence ID produced by add_evidence. Later steps can reference it as $alias.",
    },
  },
  required: ["action"],
};

export const TASK_TRACKER_TOOL_PARAMS: JsonSchema = {
  type: "object",
  additionalProperties: false,
  description: `Provide task_tracker changes as actions[]. Even a single update should be a one-item actions array.\n\n${ACTION_GUIDE}`,
  properties: {
    actions: {
      type: "array",
      items: ActionItemSchema,
      minItems: 1,
      description: "Sequential task_tracker actions to apply in one call.",
    },
  },
  required: ["actions"],
};
