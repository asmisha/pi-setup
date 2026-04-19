export type AdvisoryArtifact = {
  kind: "file" | "command" | "url" | "id" | "note";
  value: string;
  note?: string;
};

export type CompactionAdvisory = {
  latestUserIntent: string | null;
  recentFocus: string[];
  suggestedNextAction: string | null;
  blockers: string[];
  artifacts: AdvisoryArtifact[];
  avoidRepeating: string[];
  unresolvedQuestions: string[];
  updatedAt: string;
};

export const COMPACTION_SYSTEM_PROMPT = `You are generating a compact advisory packet for a Pi session after compaction.

Goal:
- Preserve only the information that would otherwise be lost and is needed for the next 1-3 turns.
- The parent session keeps canonical task-tracker truth elsewhere; this advisory is a short operational handoff.

Rules:
- Advisory is not canonical task truth.
- Do not rewrite the user contract.
- Do not declare work complete unless there is explicit evidence in the visible context.
- Summarize only the discarded material provided below; do not restate current durable state unless it is directly evidenced in that discarded material.
- Preserve exact IDs, task IDs, ask IDs, evidence IDs, run IDs, file paths, commands, URLs, branch/worktree names, and error strings when they matter.
- Use recentFocus only for observed progress or concrete actions already taken.
- Put uncertainty, missing verification, or hypotheses in unresolvedQuestions instead of stating them as facts.
- Keep blockers to currently active blockers only.
- suggestedNextAction must be a single concrete parent-agent step, not a vague goal.
- For split turns, preserve the last completed step and the immediate unfinished step.
- For delegated or async subagent work, preserve only parent-relevant sync points: run IDs, artifact paths, pending follow-up, and verification status.
- Keep lists short and operational. Omit trivia.
- Return only valid JSON.

JSON shape:
{
  "latestUserIntent": string | null,
  "recentFocus": string[],
  "suggestedNextAction": string | null,
  "blockers": string[],
  "artifacts": [{"kind":"file|command|url|id|note","value":string,"note"?:string}],
  "avoidRepeating": string[],
  "unresolvedQuestions": string[]
}`;

function uniqueOrdered(values: Iterable<string>, limit = Number.POSITIVE_INFINITY): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
    if (result.length >= limit) break;
  }
  return result;
}

export function buildCompactionPrompt(input: {
  serializedConversation: string;
  turnPrefixText?: string;
  customInstructions?: string;
  isSplitTurn?: boolean;
}): string {
  const sections = [
    "Pi is compacting away the conversation span inside <conversation-being-compacted>. The recent kept suffix remains in context after compaction, so summarize only what would otherwise be lost from the discarded material.",
    "Do not inject or restate current durable state unless the discarded material itself establishes it.",
    input.customInstructions ? `Custom instructions: ${input.customInstructions}` : null,
    input.isSplitTurn ? "Compaction is happening mid-turn. Preserve unresolved partial work, the last completed step, and the immediate unfinished step needed to resume safely." : null,
    input.turnPrefixText ? `<turn-prefix-being-discarded>\n${input.turnPrefixText}\n</turn-prefix-being-discarded>` : null,
    `<conversation-being-compacted>\n${input.serializedConversation || "(none)"}\n</conversation-being-compacted>`,
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

function mergeArtifacts(items: AdvisoryArtifact[]): AdvisoryArtifact[] {
  const seen = new Set<string>();
  const result: AdvisoryArtifact[] = [];
  for (const item of items) {
    const note = item.note?.trim();
    const key = `${item.kind}:${item.value.trim()}:${note ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(note ? { ...item, note } : { kind: item.kind, value: item.value.trim() });
  }
  return result;
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return uniqueOrdered(value.filter((item): item is string => typeof item === "string"));
}

export function normalizeAdvisory(input: unknown, now: string): CompactionAdvisory | null {
  if (!input || typeof input !== "object") return null;
  const record = input as Record<string, unknown>;
  const artifacts = Array.isArray(record.artifacts) ? mergeArtifacts(record.artifacts.map(normalizeArtifact).filter((item): item is AdvisoryArtifact => Boolean(item))) : [];
  return {
    latestUserIntent: typeof record.latestUserIntent === "string" && record.latestUserIntent.trim() ? record.latestUserIntent.trim() : null,
    recentFocus: normalizeStringList(record.recentFocus),
    suggestedNextAction: typeof record.suggestedNextAction === "string" && record.suggestedNextAction.trim() ? record.suggestedNextAction.trim() : null,
    blockers: normalizeStringList(record.blockers),
    artifacts,
    avoidRepeating: normalizeStringList(record.avoidRepeating),
    unresolvedQuestions: normalizeStringList(record.unresolvedQuestions),
    updatedAt: now,
  };
}

export function renderAdvisorySummary(advisory: CompactionAdvisory): string {
  const lines = [
    "Compaction advisory",
    `Latest user intent: ${advisory.latestUserIntent ?? "none"}`,
    `Suggested next action: ${advisory.suggestedNextAction ?? "none"}`,
  ];
  if (advisory.recentFocus.length > 0) {
    lines.push("Recent focus:", ...advisory.recentFocus.map((item) => `- ${item}`));
  }
  if (advisory.blockers.length > 0) {
    lines.push("Blockers:", ...advisory.blockers.map((item) => `- ${item}`));
  }
  if (advisory.avoidRepeating.length > 0) {
    lines.push("Avoid repeating:", ...advisory.avoidRepeating.map((item) => `- ${item}`));
  }
  return lines.join("\n");
}
