import type { Actor, AdvisoryArtifact, Authority, ExecutionState, TaskEvidence, TaskItem, TaskStatus } from "./types.ts";
import { EXECUTION_STAGES } from "./types.ts";

const LOW_SIGNAL_USER_NUDGES = new Set([
  "continue",
  "proceed",
  "go ahead",
  "keep going",
  "carry on",
  "please continue",
  "please proceed",
  "ok",
  "okay",
  "sounds good",
]);

const WEAK_ACKNOWLEDGEMENTS = new Set([
  "ok",
  "okay",
  "thanks",
  "thank you",
  "got it",
  "понял",
  "понятно",
  "спасибо",
  "ага",
  "ок",
  "окей",
]);

export function asTrimmedString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function normalizeStringList(value: Iterable<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of value) {
    const text = asTrimmedString(item);
    if (!text) continue;
    if (seen.has(text)) continue;
    seen.add(text);
    result.push(text);
  }
  return result;
}

export function uniqueBy<T>(items: T[], makeKey: (item: T) => string): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const item of items) {
    const key = makeKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

export function normalizeForMatch(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

export function isLowSignalUserNudge(text: string): boolean {
  return LOW_SIGNAL_USER_NUDGES.has(normalizeForMatch(text));
}

export function isWeakAcknowledgement(text: string): boolean {
  return WEAK_ACKNOWLEDGEMENTS.has(normalizeForMatch(text));
}

export function extractUserPromptText(content: string | unknown[]): string | null {
  if (typeof content === "string") return asTrimmedString(content);
  if (!Array.isArray(content)) return null;

  const parts = content.flatMap((item) => {
    if (!item || typeof item !== "object") return [] as string[];
    if (!("type" in item) || item.type !== "text") return [] as string[];
    if (!("text" in item) || typeof item.text !== "string") return [] as string[];
    return [item.text];
  });

  return asTrimmedString(parts.join("\n"));
}

export function mergeArtifacts(...lists: Array<AdvisoryArtifact[] | undefined>): AdvisoryArtifact[] {
  const seen = new Set<string>();
  const result: AdvisoryArtifact[] = [];
  for (const list of lists) {
    if (!list) continue;
    for (const item of list) {
      const note = item.note?.trim();
      const key = `${item.kind}:${item.value.trim()}:${note ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(note ? { ...item, note } : { kind: item.kind, value: item.value.trim() });
    }
  }
  return result;
}

export function createDefaultExecutionState(now: string): ExecutionState {
  return {
    version: 2,
    stage: EXECUTION_STAGES[0],
    activeTaskIds: [],
    nextAction: null,
    waitingFor: "nothing",
    blocker: null,
    lastMeaningfulProgress: null,
    updatedAt: now,
  };
}

export function isOpenTaskStatus(status: TaskStatus): boolean {
  return status === "todo" || status === "in_progress" || status === "blocked" || status === "awaiting_user";
}

export function isPromptEligibleTask(task: TaskItem): boolean {
  return !task.archivedAt && task.status !== "dropped";
}

export function hasVerifiedEvidence(task: TaskItem, evidenceIds?: string[]): boolean {
  const allowed = evidenceIds ? new Set(evidenceIds) : null;
  return task.evidence.some((item) => item.level === "verified" && (!allowed || allowed.has(item.id)));
}

export function sortTasksByUpdatedAtDesc<T extends { updatedAt: string }>(items: T[]): T[] {
  return [...items].sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
}

export function sortEvidenceByCreatedAtDesc(items: TaskEvidence[]): TaskEvidence[] {
  return [...items].sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
}

export function makeEventMeta(actor: Actor, authority: Authority, now: string, sourceMessageId?: string, sourceEntryId?: string) {
  return {
    actor,
    authority,
    createdAt: now,
    ...(sourceMessageId ? { sourceMessageId } : {}),
    ...(sourceEntryId ? { sourceEntryId } : {}),
  };
}
