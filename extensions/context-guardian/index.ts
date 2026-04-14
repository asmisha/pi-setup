import { complete } from "@mariozechner/pi-ai";
import type { ExtensionAPI, ExtensionCommandContext, SessionEntry } from "@mariozechner/pi-coding-agent";
import { convertToLlm, serializeConversation } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

const EXTENSION_ID = "context-guardian";
const TASK_STATE_ENTRY = `${EXTENSION_ID}-state`;
const RESUME_MESSAGE_TYPE = `${EXTENSION_ID}-resume`;
const SOFT_COMPACTION_THRESHOLD_PERCENT = 42;
const MIN_COMPACTION_INTERVAL_MS = 30_000;
const PROMPT_LIST_LIMIT = 8;
const SUMMARY_MAX_TOKENS = 4096;

const HANDOFF_PROMPT_HEADER = `You are continuing work in a fresh Pi session. Treat the durable task state below as the source of truth, then execute the requested handoff goal.`;

const TASK_STATE_SYSTEM_PROMPT_HEADER = `## Durable Task State\nUse this durable task state as the source of truth across compaction and phase changes. Prefer it over narrative history when they conflict.`;

const COMPACTION_SYSTEM_PROMPT = `You are a context compaction assistant for a coding workflow. Produce a structured state packet, not a narrative recap.

Rules:
- Keep the exact headings shown below.
- The durable task state is the source of truth when it conflicts with the conversation slice.
- Distinguish confirmed facts from assumptions.
- Preserve exact next actions, blockers, file paths, command artifacts, IDs, and decisions needed to continue work.
- Be concise but operational.
- Do not continue the conversation.

Output format:
## Objective
## Success Criteria
## Constraints & User Preferences
## Confirmed State
## Done
## In Progress
## Blockers / Risks
## Relevant Files / Artifacts
## Open Questions
## Next Action
## Facts vs Assumptions
### Facts
### Assumptions`;

const NullableString = Type.Union([Type.String(), Type.Null()]);

const ArtifactKindSchema = Type.Union([
	Type.Literal("file"),
	Type.Literal("command"),
	Type.Literal("url"),
	Type.Literal("id"),
	Type.Literal("note"),
]);

const TaskActionSchema = Type.Unsafe<TaskStateToolAction>({
	type: "string",
	enum: ["get", "patch", "clear"],
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

type ArtifactKind = "file" | "command" | "url" | "id" | "note";

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

type TaskStateToolAction = "get" | "patch" | "clear";

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

function normalizeArtifacts(value: unknown): TaskArtifact[] {
	if (!Array.isArray(value)) return [];
	const seen = new Set<string>();
	const result: TaskArtifact[] = [];
	for (const item of value) {
		if (!item || typeof item !== "object") continue;
		const kind = (item as { kind?: unknown }).kind;
		const valueText = asTrimmedString((item as { value?: unknown }).value);
		const note = asTrimmedString((item as { note?: unknown }).note) ?? undefined;
		if (!valueText) continue;
		if (kind !== "file" && kind !== "command" && kind !== "url" && kind !== "id" && kind !== "note") continue;
		const key = `${kind}:${valueText}:${note ?? ""}`;
		if (seen.has(key)) continue;
		seen.add(key);
		result.push({ kind, value: valueText, note });
	}
	return result;
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

function renderListSection(title: string, items: string[], limit = PROMPT_LIST_LIMIT): string {
	if (items.length === 0) return `${title}:\n- none`;
	const lines = items.slice(0, limit).map((item) => `- ${item}`);
	if (items.length > limit) lines.push(`- ... (${items.length - limit} more)`);
	return `${title}:\n${lines.join("\n")}`;
}

function renderArtifacts(items: TaskArtifact[], limit = PROMPT_LIST_LIMIT): string {
	if (items.length === 0) return "Relevant files / artifacts:\n- none";
	const lines = items.slice(0, limit).map((artifact) => {
		const note = artifact.note ? ` — ${artifact.note}` : "";
		return `- [${artifact.kind}] ${artifact.value}${note}`;
	});
	if (items.length > limit) lines.push(`- ... (${items.length - limit} more)`);
	return `Relevant files / artifacts:\n${lines.join("\n")}`;
}

function renderTaskStateForPrompt(state: TaskState | null): string {
	if (!state) {
		return [
			TASK_STATE_SYSTEM_PROMPT_HEADER,
			"Objective: none recorded yet",
			"Success criteria:\n- none",
			"Constraints & user preferences:\n- none",
			"Done:\n- none",
			"In progress:\n- none",
			"Blocked:\n- none",
			"Next action: none",
			"Facts:\n- none",
			"Assumptions:\n- none",
		].join("\n\n");
	}

	return [
		TASK_STATE_SYSTEM_PROMPT_HEADER,
		`Objective: ${state.objective ?? "none"}`,
		`Phase: ${state.phase ?? "none"}`,
		renderListSection("Success criteria", state.successCriteria),
		renderListSection("Constraints & user preferences", [...state.constraints, ...state.userPreferences]),
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

function loadLatestTaskState(branchEntries: SessionEntry[]): TaskState | null {
	for (let i = branchEntries.length - 1; i >= 0; i -= 1) {
		const entry = branchEntries[i];
		if (!entry || entry.type !== "custom" || entry.customType !== TASK_STATE_ENTRY) continue;
		if (entry.data === null) return null;
		return normalizeTaskState(entry.data);
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
	taskState: TaskState | null;
	conversationText: string;
	previousSummary?: string;
	customInstructions?: string;
	isSplitTurn: boolean;
}): string {
	const parts = [
		"Durable task state:\n",
		renderTaskStateForHumans(params.taskState),
	];

	if (params.previousSummary) {
		parts.push(`Previous compaction summary:\n\n${params.previousSummary}`);
	}
	if (params.customInstructions) {
		parts.push(`Custom instructions:\n\n${params.customInstructions}`);
	}
	if (params.isSplitTurn) {
		parts.push("Note: this compaction includes a split-turn prefix. Preserve any partial progress and exact next action.");
	}
	parts.push(`Conversation slice to summarize:\n\n<conversation>\n${params.conversationText}\n</conversation>`);
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

	const refreshTaskStateFromBranch = (branchEntries: SessionEntry[]) => {
		currentTaskState = loadLatestTaskState(branchEntries);
		lastPersistedSignature = comparableStateSignature(currentTaskState);
	};

	pi.on("session_start", async (_event, ctx) => {
		refreshTaskStateFromBranch(ctx.sessionManager.getBranch());
		previousContextPercent = null;
		compactionInFlight = false;
	});

	pi.on("session_tree", async (_event, ctx) => {
		refreshTaskStateFromBranch(ctx.sessionManager.getBranch());
		previousContextPercent = null;
	});

	pi.on("session_compact", async () => {
		previousContextPercent = null;
		compactionInFlight = false;
		lastCompactionAt = Date.now();
	});

	pi.on("before_agent_start", async (event, ctx) => {
		refreshTaskStateFromBranch(ctx.sessionManager.getBranch());
		if (!currentTaskState) {
			persistTaskState(createBootstrapState(event.prompt), "bootstrap");
		}
		return {
			systemPrompt: `${event.systemPrompt}\n\n${renderTaskStateForPrompt(currentTaskState)}`,
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
				"Use the durable task state as the source of truth. Preserve the exact next action, blockers, and relevant files/artifacts.",
			onComplete: () => {
				compactionInFlight = false;
				lastCompactionAt = Date.now();
				previousContextPercent = null;
				pi.sendMessage(
					{
						customType: RESUME_MESSAGE_TYPE,
						content:
							"Auto-compaction completed. Continue the interrupted task from the durable task state and the latest branch context. Do not restart from scratch.",
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
		if (!ctx.model) return;
		const auth = await ctx.modelRegistry.getApiKeyAndHeaders(ctx.model);
		if (!auth.ok || !auth.apiKey) return;

		const allMessages = [...event.preparation.messagesToSummarize, ...event.preparation.turnPrefixMessages];
		const conversationText = serializeConversation(convertToLlm(allMessages));
		const prompt = buildCompactionPrompt({
			taskState: currentTaskState,
			conversationText,
			previousSummary: event.preparation.previousSummary,
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
			const summaryBody = response.content
				.filter((item): item is { type: "text"; text: string } => item.type === "text")
				.map((item) => item.text)
				.join("\n")
				.trim();
			if (!summaryBody) return;

			return {
				compaction: {
					summary: `${summaryBody}\n\n${renderFileTags(readFiles, modifiedFiles)}`,
					firstKeptEntryId: event.preparation.firstKeptEntryId,
					tokensBefore: event.preparation.tokensBefore,
					details: { readFiles, modifiedFiles },
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
