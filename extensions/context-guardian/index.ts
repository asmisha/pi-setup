import { complete } from "@mariozechner/pi-ai";
import type { ExtensionAPI, ExtensionCommandContext, SessionEntry } from "@mariozechner/pi-coding-agent";
import { buildSessionContext, convertToLlm, getLatestCompactionEntry, serializeConversation } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

const EXTENSION_ID = "context-guardian";
const TASK_STATE_ENTRY = `${EXTENSION_ID}-state`;
const RESUME_MESSAGE_TYPE = `${EXTENSION_ID}-resume`;
const SOFT_COMPACTION_THRESHOLD_PERCENT = 60;
const MIN_COMPACTION_INTERVAL_MS = 30_000;
const PROMPT_LIST_LIMIT = 8;
const SUMMARY_MAX_TOKENS = 4096;

const HANDOFF_PROMPT_HEADER = `You are continuing work in a fresh Pi session. Treat the durable task state below as the source of truth, then execute the requested handoff goal.`;

const TASK_STATE_SYSTEM_PROMPT_HEADER = `## Durable Task State\nUse this operator-maintained task state as concise working memory when no compaction resume packet is available. Prioritize newer explicit user instructions and the live conversation if anything conflicts.`;

const RESUME_PACKET_SYSTEM_PROMPT_HEADER = `## Compaction Resume Packet\nUse this auto-generated resume packet only as condensed history for compacted older context. Prioritize the live conversation and newer explicit user instructions if anything conflicts.`;

const COMPACTION_SYSTEM_PROMPT = `You are generating a strict resume packet for a coding task after compaction.

Rules:
- Read the whole current context and decide what matters.
- Prefer newer explicit user instructions and corrections over older plans, summaries, or stale state.
- Focus on durable continuation context, not a narrative recap.
- Preserve exact next actions, blockers, file paths, commands, IDs, and decisions needed to continue the work.
- If the user rejected an answer or asked to dig deeper, the status is not completed unless the conversation later shows acceptance.
- Keep the packet concise but operational.
- Return only valid JSON. Do not wrap it in markdown fences or add commentary.

JSON shape:
{
  "objective": string | null,
  "latestUserIntent": string | null,
  "status": "active" | "blocked" | "completed" | "uncertain",
  "completionReason": string | null,
  "whyNotDone": string | null,
  "exactNextAction": string | null,
  "completedWork": string[],
  "inFlightWork": string[],
  "blockers": string[],
  "constraints": string[],
  "relevantFiles": string[],
  "artifacts": [{"kind":"file|command|url|id|note","value":string,"note"?:string}],
  "openQuestions": string[],
  "facts": string[],
  "assumptions": string[],
  "avoidRepeating": string[]
}`;

const NullableString = Type.Union([Type.String(), Type.Null()]);

const ARTIFACT_KINDS = {
	file: "file",
	command: "command",
	url: "url",
	id: "id",
	note: "note",
} as const;
const TASK_STATE_TOOL_ACTIONS = {
	get: "get",
	patch: "patch",
	clear: "clear",
} as const;
const RESUME_PACKET_STATUSES = {
	active: "active",
	blocked: "blocked",
	completed: "completed",
	uncertain: "uncertain",
} as const;

type ArtifactKind = (typeof ARTIFACT_KINDS)[keyof typeof ARTIFACT_KINDS];
type TaskStateToolAction = (typeof TASK_STATE_TOOL_ACTIONS)[keyof typeof TASK_STATE_TOOL_ACTIONS];
type ResumePacketStatus = (typeof RESUME_PACKET_STATUSES)[keyof typeof RESUME_PACKET_STATUSES];

const ARTIFACT_KIND_VALUES = Object.values(ARTIFACT_KINDS) as ArtifactKind[];
const TASK_STATE_TOOL_ACTION_VALUES = Object.values(TASK_STATE_TOOL_ACTIONS) as TaskStateToolAction[];
const RESUME_PACKET_STATUS_VALUES = Object.values(RESUME_PACKET_STATUSES) as ResumePacketStatus[];

const ArtifactKindSchema = Type.Enum(ARTIFACT_KINDS, {
	type: "string",
	enum: ARTIFACT_KIND_VALUES,
});

const TaskActionSchema = Type.Enum(TASK_STATE_TOOL_ACTIONS, {
	type: "string",
	enum: TASK_STATE_TOOL_ACTION_VALUES,
});

const TaskArtifactSchema = Type.Object({
	kind: ArtifactKindSchema,
	value: Type.String(),
	note: Type.Optional(Type.String()),
});

const TaskStatePatchSchema = Type.Object({
	objective: Type.Optional(NullableString),
	phase: Type.Optional(NullableString),
	successCriteria: Type.Optional(Type.Array(Type.String())),
	constraints: Type.Optional(Type.Array(Type.String())),
	userPreferences: Type.Optional(Type.Array(Type.String())),
	done: Type.Optional(Type.Array(Type.String())),
	inProgress: Type.Optional(Type.Array(Type.String())),
	blocked: Type.Optional(Type.Array(Type.String())),
	nextAction: Type.Optional(NullableString),
	relevantFiles: Type.Optional(Type.Array(Type.String())),
	artifacts: Type.Optional(Type.Array(TaskArtifactSchema)),
	openQuestions: Type.Optional(Type.Array(Type.String())),
	facts: Type.Optional(Type.Array(Type.String())),
	assumptions: Type.Optional(Type.Array(Type.String())),
});

const TaskStateToolParams = Type.Object({
	action: TaskActionSchema,
	state: Type.Optional(TaskStatePatchSchema),
});

type TaskArtifact = {
	kind: ArtifactKind;
	value: string;
	note?: string;
};

type TaskState = {
	version: 1;
	updatedAt: string;
	objective: string | null;
	phase: string | null;
	successCriteria: string[];
	constraints: string[];
	userPreferences: string[];
	done: string[];
	inProgress: string[];
	blocked: string[];
	nextAction: string | null;
	relevantFiles: string[];
	artifacts: TaskArtifact[];
	openQuestions: string[];
	facts: string[];
	assumptions: string[];
	updatedBy: "bootstrap" | "tool" | "manual" | "handoff";
};

type TaskStatePatch = Partial<Omit<TaskState, "version" | "updatedAt" | "updatedBy">>;

type ResumePacket = {
	version: 1;
	updatedAt: string;
	objective: string | null;
	latestUserIntent: string | null;
	status: ResumePacketStatus;
	completionReason: string | null;
	whyNotDone: string | null;
	exactNextAction: string | null;
	completedWork: string[];
	inFlightWork: string[];
	blockers: string[];
	constraints: string[];
	relevantFiles: string[];
	artifacts: TaskArtifact[];
	openQuestions: string[];
	facts: string[];
	assumptions: string[];
	avoidRepeating: string[];
};

type ResumePacketDetails = {
	version: 1;
	readFiles: string[];
	modifiedFiles: string[];
	resumePacket: ResumePacket;
};

function asTrimmedString(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	return trimmed ? trimmed : null;
}

function normalizeStringList(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	const seen = new Set<string>();
	const result: string[] = [];
	for (const item of value) {
		const text = asTrimmedString(item);
		if (!text || seen.has(text)) continue;
		seen.add(text);
		result.push(text);
	}
	return result;
}

function mergeUniqueStrings(...lists: string[][]): string[] {
	return normalizeStringList(lists.flat());
}

function isArtifactKind(value: unknown): value is ArtifactKind {
	return typeof value === "string" && ARTIFACT_KIND_VALUES.includes(value as ArtifactKind);
}

function normalizeArtifacts(value: unknown): TaskArtifact[] {
	if (!Array.isArray(value)) return [];
	const seen = new Set<string>();
	const result: TaskArtifact[] = [];
	for (const item of value) {
		if (!item || typeof item !== "object") continue;
		const kind = (item as { kind?: unknown }).kind;
		const valueText = asTrimmedString((item as { value?: unknown }).value);
		const note = asTrimmedString((item as { note?: unknown }).note) ?? undefined;
		if (!valueText || !isArtifactKind(kind)) continue;
		const key = `${kind}:${valueText}:${note ?? ""}`;
		if (seen.has(key)) continue;
		seen.add(key);
		result.push({ kind, value: valueText, note });
	}
	return result;
}

function isResumePacketStatus(value: unknown): value is ResumePacketStatus {
	return typeof value === "string" && RESUME_PACKET_STATUS_VALUES.includes(value as ResumePacketStatus);
}

function normalizeTaskState(input: unknown): TaskState {
	const data = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
	return {
		version: 1,
		updatedAt: asTrimmedString(data.updatedAt) ?? new Date().toISOString(),
		objective: asTrimmedString(data.objective),
		phase: asTrimmedString(data.phase),
		successCriteria: normalizeStringList(data.successCriteria),
		constraints: normalizeStringList(data.constraints),
		userPreferences: normalizeStringList(data.userPreferences),
		done: normalizeStringList(data.done),
		inProgress: normalizeStringList(data.inProgress),
		blocked: normalizeStringList(data.blocked),
		nextAction: asTrimmedString(data.nextAction),
		relevantFiles: normalizeStringList(data.relevantFiles),
		artifacts: normalizeArtifacts(data.artifacts),
		openQuestions: normalizeStringList(data.openQuestions),
		facts: normalizeStringList(data.facts),
		assumptions: normalizeStringList(data.assumptions),
		updatedBy:
			data.updatedBy === "bootstrap"
			|| data.updatedBy === "tool"
			|| data.updatedBy === "manual"
			|| data.updatedBy === "handoff"
				? data.updatedBy
				: "manual",
	};
}

function normalizeResumePacket(input: unknown): ResumePacket {
	const data = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
	return {
		version: 1,
		updatedAt: asTrimmedString(data.updatedAt) ?? new Date().toISOString(),
		objective: asTrimmedString(data.objective),
		latestUserIntent: asTrimmedString(data.latestUserIntent),
		status: isResumePacketStatus(data.status) ? data.status : "uncertain",
		completionReason: asTrimmedString(data.completionReason),
		whyNotDone: asTrimmedString(data.whyNotDone),
		exactNextAction: asTrimmedString(data.exactNextAction),
		completedWork: normalizeStringList(data.completedWork),
		inFlightWork: normalizeStringList(data.inFlightWork),
		blockers: normalizeStringList(data.blockers),
		constraints: normalizeStringList(data.constraints),
		relevantFiles: normalizeStringList(data.relevantFiles),
		artifacts: normalizeArtifacts(data.artifacts),
		openQuestions: normalizeStringList(data.openQuestions),
		facts: normalizeStringList(data.facts),
		assumptions: normalizeStringList(data.assumptions),
		avoidRepeating: normalizeStringList(data.avoidRepeating),
	};
}

function normalizeResumePacketDetails(input: unknown): ResumePacketDetails | null {
	if (!input || typeof input !== "object") return null;
	const data = input as Record<string, unknown>;
	if (data.resumePacket === undefined) return null;
	return {
		version: 1,
		readFiles: normalizeStringList(data.readFiles),
		modifiedFiles: normalizeStringList(data.modifiedFiles),
		resumePacket: normalizeResumePacket(data.resumePacket),
	};
}

function createEmptyTaskState(updatedBy: TaskState["updatedBy"] = "manual"): TaskState {
	return normalizeTaskState({
		updatedBy,
		updatedAt: new Date().toISOString(),
	});
}

function createBootstrapState(prompt: string): TaskState {
	return normalizeTaskState({
		objective: prompt,
		phase: "initial",
		nextAction: "Clarify scope and produce an initial plan.",
		updatedBy: "bootstrap",
	});
}

function comparableStateSignature(state: TaskState | null): string {
	if (!state) return "null";
	const { updatedAt: _, updatedBy: __, ...rest } = state;
	return JSON.stringify(rest);
}

function renderBulletList(items: string[], limit = PROMPT_LIST_LIMIT): string {
	if (items.length === 0) return "- none";
	const lines = items.slice(0, limit).map((item) => `- ${item}`);
	if (items.length > limit) lines.push(`- ... (${items.length - limit} more)`);
	return lines.join("\n");
}

function renderListSection(title: string, items: string[], limit = PROMPT_LIST_LIMIT): string {
	return `${title}:\n${renderBulletList(items, limit)}`;
}

function renderArtifactList(items: TaskArtifact[], limit = PROMPT_LIST_LIMIT): string {
	if (items.length === 0) return "- none";
	const lines = items.slice(0, limit).map((artifact) => {
		const note = artifact.note ? ` — ${artifact.note}` : "";
		return `- [${artifact.kind}] ${artifact.value}${note}`;
	});
	if (items.length > limit) lines.push(`- ... (${items.length - limit} more)`);
	return lines.join("\n");
}

function renderArtifacts(items: TaskArtifact[], limit = PROMPT_LIST_LIMIT): string {
	return `Relevant files / artifacts:\n${renderArtifactList(items, limit)}`;
}

function renderTaskStateForHumans(state: TaskState | null): string {
	if (!state) return "No durable task state recorded for this branch.";
	return [
		`Task state (updated ${state.updatedAt}, source ${state.updatedBy})`,
		`Objective: ${state.objective ?? "none"}`,
		`Phase: ${state.phase ?? "none"}`,
		renderListSection("Success criteria", state.successCriteria, 20),
		renderListSection("Constraints", state.constraints, 20),
		renderListSection("User preferences", state.userPreferences, 20),
		renderListSection("Done", state.done, 20),
		renderListSection("In progress", state.inProgress, 20),
		renderListSection("Blocked", state.blocked, 20),
		`Next action: ${state.nextAction ?? "none"}`,
		renderListSection("Relevant files", state.relevantFiles, 20),
		renderArtifacts(state.artifacts, 20),
		renderListSection("Open questions", state.openQuestions, 20),
		renderListSection("Facts", state.facts, 20),
		renderListSection("Assumptions", state.assumptions, 20),
	].join("\n\n");
}

function renderTaskStateForPrompt(state: TaskState | null): string {
	if (!state) {
		return [
			TASK_STATE_SYSTEM_PROMPT_HEADER,
			"Objective: none recorded yet",
			"Phase: none",
			"Success criteria:\n- none",
			"Constraints:\n- none",
			"User preferences:\n- none",
			"Done:\n- none",
			"In progress:\n- none",
			"Blocked:\n- none",
			"Next action: none",
			"Relevant files:\n- none",
			"Relevant files / artifacts:\n- none",
			"Open questions:\n- none",
			"Facts:\n- none",
			"Assumptions:\n- none",
		].join("\n\n");
	}
	return [
		TASK_STATE_SYSTEM_PROMPT_HEADER,
		`Objective: ${state.objective ?? "none"}`,
		`Phase: ${state.phase ?? "none"}`,
		renderListSection("Success criteria", state.successCriteria),
		renderListSection("Constraints", state.constraints),
		renderListSection("User preferences", state.userPreferences),
		renderListSection("Done", state.done),
		renderListSection("In progress", state.inProgress),
		renderListSection("Blocked", state.blocked),
		`Next action: ${state.nextAction ?? "none"}`,
		renderListSection("Relevant files", state.relevantFiles),
		renderArtifacts(state.artifacts),
		renderListSection("Open questions", state.openQuestions),
		renderListSection("Facts", state.facts),
		renderListSection("Assumptions", state.assumptions),
	].join("\n\n");
}

function renderResumePacketForPrompt(details: ResumePacketDetails | null): string {
	if (!details) return "";
	const packet = details.resumePacket;
	const relevantFiles = mergeUniqueStrings(packet.relevantFiles, details.modifiedFiles, details.readFiles);
	return [
		RESUME_PACKET_SYSTEM_PROMPT_HEADER,
		`Objective: ${packet.objective ?? "none"}`,
		`Latest user intent: ${packet.latestUserIntent ?? "none"}`,
		`Status: ${packet.status}`,
		`Completion reason: ${packet.completionReason ?? "none"}`,
		`Why not done: ${packet.whyNotDone ?? "none"}`,
		`Exact next action: ${packet.exactNextAction ?? "none"}`,
		renderListSection("Completed work", packet.completedWork),
		renderListSection("In-flight work", packet.inFlightWork),
		renderListSection("Blockers", packet.blockers),
		renderListSection("Constraints", packet.constraints),
		renderListSection("Relevant files", relevantFiles),
		renderListSection("Read-only files from compacted history", details.readFiles),
		renderListSection("Modified files from compacted history", details.modifiedFiles),
		renderArtifacts(packet.artifacts),
		renderListSection("Open questions", packet.openQuestions),
		renderListSection("Facts", packet.facts),
		renderListSection("Assumptions", packet.assumptions),
		renderListSection("Avoid repeating", packet.avoidRepeating),
	].join("\n\n");
}

function renderResumePacketSummary(details: ResumePacketDetails): string {
	const packet = details.resumePacket;
	const relevantFiles = mergeUniqueStrings(packet.relevantFiles, details.modifiedFiles, details.readFiles);
	return [
		"## Objective",
		packet.objective ?? "none recorded",
		"",
		"## Latest User Intent",
		packet.latestUserIntent ?? "none recorded",
		"",
		"## Status",
		renderBulletList([
			packet.status,
			...(packet.completionReason ? [`completion reason: ${packet.completionReason}`] : []),
			...(packet.whyNotDone ? [`why not done: ${packet.whyNotDone}`] : []),
		], 20),
		"",
		"## Exact Next Action",
		packet.exactNextAction ?? "none recorded",
		"",
		"## Completed Work",
		renderBulletList(packet.completedWork, 20),
		"",
		"## In-Flight Work",
		renderBulletList(packet.inFlightWork, 20),
		"",
		"## Blockers",
		renderBulletList(packet.blockers, 20),
		"",
		"## Constraints",
		renderBulletList(packet.constraints, 20),
		"",
		"## Relevant Files",
		renderBulletList(relevantFiles, 20),
		"",
		"## Artifacts",
		renderArtifactList(packet.artifacts, 20),
		"",
		"## Open Questions",
		renderBulletList(packet.openQuestions, 20),
		"",
		"## Facts",
		renderBulletList(packet.facts, 20),
		"",
		"## Assumptions",
		renderBulletList(packet.assumptions, 20),
		"",
		"## Avoid Repeating",
		renderBulletList(packet.avoidRepeating, 20),
	].join("\n");
}

function loadLatestTaskState(branchEntries: SessionEntry[]): TaskState | null {
	for (let i = branchEntries.length - 1; i >= 0; i -= 1) {
		const entry = branchEntries[i];
		if (!entry || entry.type !== "custom" || entry.customType !== TASK_STATE_ENTRY) continue;
		if (entry.data === null) return null;
		return normalizeTaskState(entry.data);
	}
	return null;
}

function loadLatestResumePacketDetails(branchEntries: SessionEntry[]): ResumePacketDetails | null {
	const latestCompaction = getLatestCompactionEntry(branchEntries);
	if (!latestCompaction) return null;
	return normalizeResumePacketDetails(latestCompaction.details);
}

function parseJsonObject(text: string): unknown | null {
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
			// continue
		}
	}
	return null;
}

function mergeTaskState(base: TaskState | null, patch: TaskStatePatch, updatedBy: TaskState["updatedBy"]): TaskState {
	const current = base ?? createEmptyTaskState(updatedBy);
	const next = normalizeTaskState({
		...current,
		...patch,
		updatedBy,
		updatedAt: new Date().toISOString(),
	});
	return next;
}

function buildFileLists(fileOps: {
	read: Set<string>;
	written: Set<string>;
	edited: Set<string>;
}): { readFiles: string[]; modifiedFiles: string[] } {
	const modified = new Set<string>([...fileOps.written, ...fileOps.edited]);
	const readFiles = [...fileOps.read].filter((path) => !modified.has(path)).sort();
	const modifiedFiles = [...modified].sort();
	return { readFiles, modifiedFiles };
}

function renderFileTags(readFiles: string[], modifiedFiles: string[]): string {
	const readBlock = readFiles.join("\n");
	const modifiedBlock = modifiedFiles.join("\n");
	return `<read-files>\n${readBlock}\n</read-files>\n\n<modified-files>\n${modifiedBlock}\n</modified-files>`;
}

function buildCompactionPrompt(params: {
	fullContextText: string;
	previousResumePacket: ResumePacket | null;
	turnPrefixText?: string;
	customInstructions?: string;
	isSplitTurn: boolean;
}): string {
	const parts = [
		"Generate a resume packet from the whole current session context below.",
		"The context already includes prior compaction summaries and the latest live conversation.",
		"Use the whole context to decide what matters, but keep only durable continuation state and exact operational details in the packet.",
	];

	if (params.previousResumePacket) {
		parts.push(
			`Previous resume packet (supplemental only; newer context wins if there is any conflict):\n\n${JSON.stringify(params.previousResumePacket, null, 2)}`,
		);
	}
	if (params.customInstructions) {
		parts.push(`Custom instructions:\n\n${params.customInstructions}`);
	}
	if (params.isSplitTurn) {
		parts.push("Note: compaction happened mid-turn. Preserve partial work, unresolved investigations, and the exact next action.");
	}
	parts.push(`Whole current session context:\n\n<conversation>\n${params.fullContextText}\n</conversation>`);
	if (params.turnPrefixText) {
		parts.push(`Split-turn prefix messages not yet persisted as normal branch history:\n\n<turn-prefix>\n${params.turnPrefixText}\n</turn-prefix>`);
	}
	return parts.join("\n\n");
}

function buildHandoffPrompt(taskState: TaskState | null, goal: string): string {
	return [
		HANDOFF_PROMPT_HEADER,
		"",
		"## Objective",
		goal,
		"",
		"## Success Criteria",
		taskState?.successCriteria.length ? taskState.successCriteria.map((item) => `- ${item}`).join("\n") : "- Define or refine success criteria for this new phase.",
		"",
		"## Current State",
		`Previous objective: ${taskState?.objective ?? "none"}`,
		`Phase: ${taskState?.phase ?? "none"}`,
		`Inherited next action: ${taskState?.nextAction ?? "none recorded"}`,
		taskState?.done.length ? `Completed work:\n${taskState.done.map((item) => `- ${item}`).join("\n")}` : "Completed work:\n- none recorded",
		taskState?.inProgress.length
			? `Work in progress:\n${taskState.inProgress.map((item) => `- ${item}`).join("\n")}`
			: "Work in progress:\n- none recorded",
		"",
		"## Relevant Files / Artifacts",
		taskState?.relevantFiles.length ? taskState.relevantFiles.map((item) => `- ${item}`).join("\n") : "- none recorded",
		taskState?.artifacts.length
			? taskState.artifacts.map((artifact) => `- [${artifact.kind}] ${artifact.value}${artifact.note ? ` — ${artifact.note}` : ""}`).join("\n")
			: "- no additional artifacts recorded",
		"",
		"## Non-obvious Decisions",
		taskState?.facts.length ? taskState.facts.map((item) => `- ${item}`).join("\n") : "- none recorded",
		"",
		"## Constraints & Preferences",
		[...(taskState?.constraints ?? []), ...(taskState?.userPreferences ?? [])].length
			? [...(taskState?.constraints ?? []), ...(taskState?.userPreferences ?? [])].map((item) => `- ${item}`).join("\n")
			: "- none recorded",
		"",
		"## Blockers / Risks",
		taskState?.blocked.length ? taskState.blocked.map((item) => `- ${item}`).join("\n") : "- none recorded",
		"",
		"## Exact Next Steps",
		`1. Review the durable task state and inherited files/artifacts above.`,
		`2. Execute this phase goal: ${goal}`,
		`3. Update the durable task state as soon as the plan or progress changes.`,
	].join("\n");
}

function buildHandoffState(taskState: TaskState | null, goal: string): TaskState {
	const inherited = taskState ?? createBootstrapState(goal);
	return normalizeTaskState({
		...inherited,
		objective: goal,
		phase: "handoff",
		done: [],
		inProgress: [],
		nextAction: inherited.nextAction ?? `Review inherited context and begin: ${goal}`,
		facts: [
			...inherited.facts,
			...(inherited.objective ? [`Inherited context from previous objective: ${inherited.objective}`] : []),
			`Handoff goal: ${goal}`,
		],
		updatedBy: "handoff",
		updatedAt: new Date().toISOString(),
	});
}

async function editTaskState(ctx: ExtensionCommandContext, currentState: TaskState | null): Promise<TaskState | undefined> {
	if (!ctx.hasUI) return undefined;
	const initial = JSON.stringify(currentState ?? createEmptyTaskState(), null, 2);
	const edited = await ctx.ui.editor("Edit durable task state", initial);
	if (edited === undefined) return undefined;
	try {
		const parsed = JSON.parse(edited);
		return normalizeTaskState({
			...parsed,
			updatedBy: "manual",
			updatedAt: new Date().toISOString(),
		});
	} catch (error) {
		ctx.ui.notify(`Invalid JSON: ${error instanceof Error ? error.message : String(error)}`, "error");
		return undefined;
	}
}

export default function contextGuardian(pi: ExtensionAPI) {
	let currentTaskState: TaskState | null = null;
	let currentResumePacketDetails: ResumePacketDetails | null = null;
	let lastPersistedSignature: string | null = null;
	let previousContextPercent: number | null = null;
	let compactionInFlight = false;
	let lastCompactionAt = 0;

	const persistTaskState = (state: TaskState, updatedBy: TaskState["updatedBy"]) => {
		const normalized = normalizeTaskState({
			...state,
			updatedBy,
			updatedAt: new Date().toISOString(),
		});
		const signature = comparableStateSignature(normalized);
		currentTaskState = normalized;
		if (signature === lastPersistedSignature) return normalized;
		pi.appendEntry(TASK_STATE_ENTRY, normalized);
		lastPersistedSignature = signature;
		return normalized;
	};

	const clearTaskState = () => {
		currentTaskState = null;
		lastPersistedSignature = null;
		pi.appendEntry(TASK_STATE_ENTRY, null);
	};

	const refreshBranchState = (branchEntries: SessionEntry[]) => {
		currentTaskState = loadLatestTaskState(branchEntries);
		currentResumePacketDetails = loadLatestResumePacketDetails(branchEntries);
		lastPersistedSignature = comparableStateSignature(currentTaskState);
	};

	pi.on("session_start", async (_event, ctx) => {
		refreshBranchState(ctx.sessionManager.getBranch());
		previousContextPercent = null;
		compactionInFlight = false;
	});

	pi.on("session_tree", async (_event, ctx) => {
		refreshBranchState(ctx.sessionManager.getBranch());
		previousContextPercent = null;
	});

	pi.on("session_compact", async (_event, ctx) => {
		refreshBranchState(ctx.sessionManager.getBranch());
		previousContextPercent = null;
		compactionInFlight = false;
		lastCompactionAt = Date.now();
	});

	pi.on("before_agent_start", async (event, ctx) => {
		refreshBranchState(ctx.sessionManager.getBranch());
		if (!currentTaskState) {
			persistTaskState(createBootstrapState(event.prompt), "bootstrap");
		}
		const injectedContext = renderResumePacketForPrompt(currentResumePacketDetails) || renderTaskStateForPrompt(currentTaskState);
		return {
			systemPrompt: `${event.systemPrompt}\n\n${injectedContext}`,
		};
	});

	pi.on("turn_end", async (_event, ctx) => {
		const usage = ctx.getContextUsage();
		const currentPercent = usage?.percent ?? null;
		if (currentPercent === null) {
			previousContextPercent = null;
			return;
		}

		const crossedThreshold = previousContextPercent === null
			? currentPercent >= SOFT_COMPACTION_THRESHOLD_PERCENT
			: previousContextPercent < SOFT_COMPACTION_THRESHOLD_PERCENT && currentPercent >= SOFT_COMPACTION_THRESHOLD_PERCENT;
		previousContextPercent = currentPercent;
		if (!crossedThreshold) return;
		if (compactionInFlight) return;
		if (Date.now() - lastCompactionAt < MIN_COMPACTION_INTERVAL_MS) return;

		compactionInFlight = true;
		ctx.compact({
			customInstructions:
				"Generate a resume packet from the whole current context. Preserve the exact next action, blockers, relevant files/artifacts, and newer user corrections.",
			onComplete: () => {
				compactionInFlight = false;
				lastCompactionAt = Date.now();
				previousContextPercent = null;
				pi.sendMessage(
					{
						customType: RESUME_MESSAGE_TYPE,
						content:
							"Auto-compaction completed. Continue from the generated compaction resume packet and the latest live conversation. Prioritize newer explicit user instructions if anything conflicts. Do not restart from scratch.",
						display: false,
					},
					{ triggerTurn: true },
				);
			},
			onError: () => {
				compactionInFlight = false;
				previousContextPercent = null;
			},
		});
	});

	pi.on("session_before_compact", async (event, ctx) => {
		refreshBranchState(event.branchEntries);
		if (!ctx.model) return;
		const auth = await ctx.modelRegistry.getApiKeyAndHeaders(ctx.model);
		if (!auth.ok || !auth.apiKey) return;

		const fullContextText = serializeConversation(convertToLlm(buildSessionContext(event.branchEntries).messages));
		const turnPrefixText = event.preparation.turnPrefixMessages.length
			? serializeConversation(convertToLlm(event.preparation.turnPrefixMessages))
			: undefined;
		const prompt = buildCompactionPrompt({
			fullContextText,
			previousResumePacket: currentResumePacketDetails?.resumePacket ?? null,
			turnPrefixText,
			customInstructions: event.customInstructions,
			isSplitTurn: event.preparation.isSplitTurn,
		});
		const { readFiles, modifiedFiles } = buildFileLists(event.preparation.fileOps);

		try {
			const response = await complete(
				ctx.model,
				{
					systemPrompt: COMPACTION_SYSTEM_PROMPT,
					messages: [
						{
							role: "user",
							content: [{ type: "text", text: prompt }],
							timestamp: Date.now(),
						},
					],
				},
				{
					apiKey: auth.apiKey,
					headers: auth.headers,
					maxTokens: SUMMARY_MAX_TOKENS,
					signal: event.signal,
				},
			);
			const responseText = response.content
				.filter((item): item is { type: "text"; text: string } => item.type === "text")
				.map((item) => item.text)
				.join("\n")
				.trim();
			if (!responseText) return;

			const parsed = parseJsonObject(responseText);
			if (!parsed) return;
			const details: ResumePacketDetails = {
				version: 1,
				readFiles,
				modifiedFiles,
				resumePacket: normalizeResumePacket(parsed),
			};

			return {
				compaction: {
					summary: `${renderResumePacketSummary(details)}\n\n${renderFileTags(readFiles, modifiedFiles)}`,
					firstKeptEntryId: event.preparation.firstKeptEntryId,
					tokensBefore: event.preparation.tokensBefore,
					details,
				},
			};
		} catch {
			return;
		}
	});

	pi.registerTool({
		name: "task_state",
		label: "Task State",
		description: "Read, patch, or clear the durable task state stored outside normal LLM context.",
		promptSnippet: "Persist or inspect durable task state for the current branch/session.",
		promptGuidelines: [
			"Use this tool after planning, after meaningful milestones, when blockers change, and before handoff-heavy work.",
			"Prefer concise operational state: objective, done/in-progress/blocked, next action, files/artifacts, facts, and assumptions.",
		],
		parameters: TaskStateToolParams as any,
		async execute(_toolCallId: string, params: { action?: TaskStateToolAction; state?: TaskStatePatch }) {
			const action = params.action ?? "get";
			if (action === "get") {
				return {
					content: [{ type: "text", text: renderTaskStateForHumans(currentTaskState) }],
					details: { state: currentTaskState },
				};
			}

			if (action === "clear") {
				clearTaskState();
				return {
					content: [{ type: "text", text: "Cleared durable task state." }],
					details: { state: null },
				};
			}

			if (!params.state) {
				return {
					content: [{ type: "text", text: "task_state patch requires a state patch." }],
					details: { state: currentTaskState },
				};
			}

			const nextState = persistTaskState(mergeTaskState(currentTaskState, params.state as TaskStatePatch, "tool"), "tool");
			return {
				content: [{ type: "text", text: `Updated durable task state.\n\n${renderTaskStateForHumans(nextState)}` }],
				details: { state: nextState },
			};
		},
	});

	pi.registerCommand("task-state", {
		description: "Inspect or edit the durable task state",
		handler: async (args, ctx) => {
			const action = args.trim();
			if (!action) {
				ctx.ui.notify(renderTaskStateForHumans(currentTaskState), "info");
				return;
			}
			if (action === "clear") {
				clearTaskState();
				ctx.ui.notify("Cleared durable task state.", "info");
				return;
			}
			if (action === "edit") {
				const edited = await editTaskState(ctx, currentTaskState);
				if (edited === undefined) return;
				persistTaskState(edited, "manual");
				ctx.ui.notify("Updated durable task state.", "info");
				return;
			}
			ctx.ui.notify("Usage: /task-state [edit|clear]", "error");
		},
	});

	pi.registerCommand("handoff", {
		description: "Create a new session seeded from durable task state for a new phase",
		handler: async (args, ctx) => {
			if (!ctx.hasUI) {
				ctx.ui.notify("handoff requires interactive mode", "error");
				return;
			}

			const goal = args.trim();
			if (!goal) {
				ctx.ui.notify("Usage: /handoff <goal for the new session>", "error");
				return;
			}

			const prompt = buildHandoffPrompt(currentTaskState, goal);
			const handoffState = buildHandoffState(currentTaskState, goal);
			const currentSessionFile = ctx.sessionManager.getSessionFile();
			const result = await ctx.newSession({
				parentSession: currentSessionFile,
				setup: async (sessionManager) => {
					sessionManager.appendCustomEntry(TASK_STATE_ENTRY, handoffState);
				},
			});
			if (result.cancelled) {
				ctx.ui.notify("New session cancelled.", "info");
				return;
			}

			ctx.ui.setEditorText(prompt);
			ctx.ui.notify("Handoff ready. Submit when ready.", "info");
		},
	});
}
