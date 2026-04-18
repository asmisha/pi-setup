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

function actionSchema(action: string, required: string[], description: string): JsonSchema {
  return {
    properties: {
      action: {
        const: action,
        type: "string",
        description: `Action: ${action}`,
      },
    },
    required: ["action", ...required],
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
  description: "Use one supported task_tracker action. Pick the exact action name and required fields for that action.",
  properties: {
    action: {
      type: "string",
      enum: [...ACTIONS],
      description: "Supported task_tracker action.",
    },
    title: { type: "string", minLength: 1, description: "Concrete task title." },
    kind: TaskKindSchema,
    parentId: TaskIdSchema,
    dependsOn: optionalArray(TaskIdSchema, "Task IDs that must be done first."),
    taskId: TaskIdSchema,
    reason: { type: "string", minLength: 1, description: "Reason for the action." },
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
  oneOf: [
    actionSchema("list_open", [], "List open tasks in the durable tracker."),
    actionSchema("list_open_asks", [], "List open explicit user asks that still keep the objective open."),
    actionSchema("list_archived", [], "List archived tasks."),
    actionSchema("create_task", ["title"], "Create a durable subtask. Prefer a small number of concrete deliverables."),
    actionSchema("start_task", ["taskId"], "Mark a task in progress and focus execution on it."),
    actionSchema("block_task", ["taskId", "reason"], "Mark a task blocked."),
    actionSchema("await_user", ["taskId", "reason"], "Mark a task awaiting user input."),
    actionSchema("propose_done", ["taskId"], "Move a task to done_candidate before the done gate is closed."),
    actionSchema("commit_done", ["taskId", "reason"], "Commit a done_candidate task to done after the gate passes. Optionally satisfy matching open asks in the same commit."),
    actionSchema("add_evidence", ["taskId", "evidence"], "Attach evidence to a task."),
    actionSchema("record_acceptance", ["note"], "Record explicit user acceptance for a task or the root objective."),
    actionSchema("cancel_ask", ["askId"], "Cancel an open ask after an explicit user directive or manual intervention."),
    actionSchema("propose_contract_change", ["kind", "proposedValue", "reason"], "Propose a contract change without mutating the active contract."),
    actionSchema("set_next_action", ["nextAction"], "Update the current execution next action."),
    actionSchema("link_file", ["taskId", "path"], "Attach a relevant file path to a task."),
    actionSchema("note", ["taskId", "text"], "Attach a durable note to a task."),
  ],
};
