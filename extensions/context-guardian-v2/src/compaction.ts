import type { AdvisoryArtifact, CompactionAdvisory, ProjectedState } from "./types.ts";
import { mergeArtifacts } from "./utils.ts";

export const COMPACTION_SYSTEM_PROMPT = `You are generating a compact advisory packet for the next 1-3 turns of work.

Rules:
- Advisory is not canonical task truth.
- Do not rewrite the user contract.
- Do not declare work complete unless there is explicit evidence in the visible context.
- Prefer exact next actions, blockers, files, IDs, and fragile assumptions.
- Keep lists short and operational.
- Return only valid JSON.

JSON shape:
{
  "latestUserIntent": string | null,
  "recentFocus": string[],
  "suggestedNextAction": string | null,
  "blockers": string[],
  "relevantFiles": string[],
  "artifacts": [{"kind":"file|command|url|id|note","value":string,"note"?:string}],
  "avoidRepeating": string[],
  "unresolvedQuestions": string[]
}`;

export function buildCompactionPrompt(input: {
  projectedState: ProjectedState;
  serializedConversation: string;
  latestUserIntent: string | null;
  turnPrefixText?: string;
  customInstructions?: string;
  isSplitTurn?: boolean;
}): string {
  const sections = [
    `Latest user intent: ${input.latestUserIntent ?? "none"}`,
    `Current execution stage: ${input.projectedState.execution.stage}`,
    `Current next action: ${input.projectedState.execution.nextAction ?? "none"}`,
    input.customInstructions ? `Custom instructions: ${input.customInstructions}` : null,
    input.isSplitTurn ? "Compaction is happening mid-turn. Preserve unresolved partial work." : null,
    input.turnPrefixText ? `Turn prefix messages:\n${input.turnPrefixText}` : null,
    `Conversation to summarize:\n${input.serializedConversation}`,
  ].filter(Boolean);

  return sections.join("\n\n");
}

export function parseJsonObject(text: string): unknown | null {
  const candidates = [text.trim()];
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) candidates.push(fenced[1].trim());
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(text.slice(firstBrace, lastBrace + 1));
  }

  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      return JSON.parse(candidate);
    } catch {
      // keep trying
    }
  }
  return null;
}

function normalizeArtifact(input: unknown): AdvisoryArtifact | null {
  if (!input || typeof input !== "object") return null;
  const record = input as Record<string, unknown>;
  const kind = typeof record.kind === "string" ? record.kind.trim() : "";
  const value = typeof record.value === "string" ? record.value.trim() : "";
  const note = typeof record.note === "string" ? record.note.trim() : undefined;
  if (!kind || !value) return null;
  if (!["file", "command", "url", "id", "note"].includes(kind)) return null;
  return note ? { kind: kind as AdvisoryArtifact["kind"], value, note } : { kind: kind as AdvisoryArtifact["kind"], value };
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean))];
}

export function normalizeAdvisory(input: unknown, now: string): CompactionAdvisory | null {
  if (!input || typeof input !== "object") return null;
  const record = input as Record<string, unknown>;
  const artifacts = Array.isArray(record.artifacts) ? mergeArtifacts(record.artifacts.map(normalizeArtifact).filter((item): item is AdvisoryArtifact => Boolean(item))) : [];
  return {
    version: 2,
    latestUserIntent: typeof record.latestUserIntent === "string" && record.latestUserIntent.trim() ? record.latestUserIntent.trim() : null,
    recentFocus: normalizeStringList(record.recentFocus),
    suggestedNextAction: typeof record.suggestedNextAction === "string" && record.suggestedNextAction.trim() ? record.suggestedNextAction.trim() : null,
    blockers: normalizeStringList(record.blockers),
    relevantFiles: normalizeStringList(record.relevantFiles),
    artifacts,
    avoidRepeating: normalizeStringList(record.avoidRepeating),
    unresolvedQuestions: normalizeStringList(record.unresolvedQuestions),
    updatedAt: now,
  };
}

export function renderAdvisorySummary(advisory: CompactionAdvisory): string {
  const lines = [
    "Context Guardian v2 advisory",
    `Latest user intent: ${advisory.latestUserIntent ?? "none"}`,
    `Suggested next action: ${advisory.suggestedNextAction ?? "none"}`,
  ];
  if (advisory.recentFocus.length > 0) {
    lines.push("Recent focus:", ...advisory.recentFocus.map((item) => `- ${item}`));
  }
  if (advisory.blockers.length > 0) {
    lines.push("Blockers:", ...advisory.blockers.map((item) => `- ${item}`));
  }
  if (advisory.relevantFiles.length > 0) {
    lines.push("Relevant files:", ...advisory.relevantFiles.map((item) => `- ${item}`));
  }
  if (advisory.avoidRepeating.length > 0) {
    lines.push("Avoid repeating:", ...advisory.avoidRepeating.map((item) => `- ${item}`));
  }
  return lines.join("\n");
}
