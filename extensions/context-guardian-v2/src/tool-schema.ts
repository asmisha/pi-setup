import { CONTRACT_CHANGE_KINDS, DONE_REASONS, EVIDENCE_KINDS, EVIDENCE_LEVELS, TASK_KINDS } from "./types.ts";

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

const ACTIONS = [
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
  "Supported actions and required fields:",
  "- list_open: no extra fields",
  "- list_open_asks: no extra fields",
  "- list_archived: optional limit",
  "- create_task: title; optional kind, parentId, dependsOn",
  "- start_task: taskId",
  "- block_task: taskId, reason",
  "- await_user: taskId, reason",
  "- propose_done: taskId; optional note",
  "- commit_done: taskId, reason; optional evidenceIds, askIdsToSatisfy",
  "- add_evidence: taskId, evidence",
  "- record_acceptance: note; optional taskId, sourceMessageId",
  "- cancel_ask: askId; optional sourceMessageId",
  "- propose_contract_change: kind, proposedValue, reason",
  "- set_next_action: nextAction; optional activeTaskIds",
  "- link_file: taskId, path",
  "- note: taskId, text",
].join("\n");

const TaskIdSchema = { type: "string", minLength: 1, description: "Existing task ID from task_tracker state." } as const;
const AskIdSchema = { type: "string", minLength: 1, description: "Open ask ID from the contract's explicit asks." } as const;
const SourceMessageIdSchema = {
  type: "string",
  minLength: 1,
  description: "Explicit user message ID when linking a cancellation or acceptance to a specific user turn.",
} as const;
const TaskKindSchema = stringEnum(TASK_KINDS, "Task kind. Use user_requested, inferred, verification, or followup.");
const EvidenceKindSchema = stringEnum(EVIDENCE_KINDS, "Evidence kind. Use test, tool_result, file, message, or manual_note.");
const EvidenceLevelSchema = stringEnum(EVIDENCE_LEVELS, "Evidence strength. Use claimed, observed, or verified.");
const DoneReasonSchema = stringEnum(DONE_REASONS, "Done-gate path. Use verified_evidence, user_acceptance, or manual_override.");
const ContractChangeKindSchema = stringEnum(CONTRACT_CHANGE_KINDS, "Contract field to propose changing.");

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

export const TASK_TRACKER_TOOL_PARAMS: JsonSchema = {
  type: "object",
  additionalProperties: false,
  description: `Use one supported task_tracker action. Pick the exact action name and required fields for that action.\n\n${ACTION_GUIDE}`,
  properties: {
    action: {
      type: "string",
      enum: [...ACTIONS],
      description: ACTION_GUIDE,
    },
    title: { type: "string", minLength: 1, description: "Concrete task title." },
    kind: TaskKindSchema,
    parentId: TaskIdSchema,
    dependsOn: optionalArray(TaskIdSchema, "Task IDs that must be done first."),
    taskId: TaskIdSchema,
    reason: {
      type: "string",
      minLength: 1,
      description: "Reason for the action. For commit_done, use one of: verified_evidence, user_acceptance, manual_override.",
    },
    note: { type: "string", minLength: 1, description: "Optional note or explicit acceptance text." },
    evidenceIds: optionalArray({ type: "string", minLength: 1, description: "Verified evidence ID." }, "Specific verified evidence IDs for the done gate."),
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
    activeTaskIds: optionalArray(TaskIdSchema, "Task IDs that are currently active."),
    path: { type: "string", minLength: 1, description: "Relevant file path." },
    text: { type: "string", minLength: 1, description: "Important durable note for the task." },
    limit: { type: "number", minimum: 1, description: "Maximum number of archived tasks to return." },
  },
  required: ["action"],
};
