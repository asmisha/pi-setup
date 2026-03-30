import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { StringEnum } from "@mariozechner/pi-ai";
import { Type } from "@sinclair/typebox";
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

const FOUNDATION_PROMPT = `
IMPORTANT: Operate with an evidence-first, low-hallucination workflow.

VERIFY BEFORE WRITING
- Before modifying code, read the target files and discover related code, tests, configs, migrations, and callers with search tools.
- Verify that dependencies, imports, APIs, schemas, feature flags, and configuration keys actually exist before using them.
- Never infer runtime behavior, database schema, or API shape from names alone.
- If something cannot be verified, say so explicitly instead of guessing.

PROGRESSIVE DISCOVERY
- Load only the context you need, when you need it.
- Re-read the original task and project instructions when a task grows or starts drifting.
- Prefer a focused search plan over broad context loading.

CHANGE PROTOCOL
- Prefer the simplest correct solution. Avoid speculative abstractions, framework gymnastics, and future-proofing layers that are not needed now.
- Keep diffs minimal and in scope. If you notice unrelated code issues, call them out separately instead of mixing them into the current change. Verification failures are never "unrelated" — always diagnose them.
- Choose the verification strategy that matches the task instead of following one ritual for every workflow.
- Keep implementation-specific workflows, such as red/green TDD, inside implementation-specific skills and plans rather than treating them as universal defaults.

EVIDENCE OVER CLAIMS
- Do not claim something works until you run the relevant verification and inspect the result.
- After code changes, run the applicable tests, type checks, linters, builds, or syntax checks.
- Use these confidence labels for technical conclusions:
  - VERIFIED: backed by executed commands or directly observed code/data
  - LIKELY: strong inference from verified facts, but not independently executed
  - UNCERTAIN: not verified; say exactly what is missing
- Cite file paths, line numbers, commands, error messages, and outputs when they matter.

REVIEW MINDSET
- Prioritize issues in this order: correctness, security, edge cases, error handling, performance, maintainability, then style.
- Read the whole review surface: code, tests, docs, configs, migrations, scripts, and interfaces touched by the change.
- Do not rubber-stamp. Investigate suspicious code until it is explained or flagged.
- Do not suggest rewrites without a concrete problem.

ANALYSIS RIGOR
- Trace real code paths step by step; distinguish actual behavior from intended behavior.
- For logs or data analysis, separate OBSERVED facts from CORRELATED patterns and HYPOTHESIZED causes.
- For database advice, verify real schemas, indexes, and query shapes before recommending changes.

SELF-CORRECTION
- If verification passes, do not rewrite working code "just to be safe".
- If verification fails, read the error carefully, find the root cause, make the smallest safe fix, and re-run verification. This applies even when errors appear in files you did not modify — diagnose them (e.g., stale generated code, missing codegen step) instead of dismissing them as unrelated.
- If two focused attempts fail, stop, simplify, re-read requirements, and change strategy instead of thrashing.

ANTI-PATTERNS
- Do not build on unverified assumptions; verify them or label them explicitly.
- Do not agree with unsafe, incorrect, or clearly over-engineered requests when a simpler or safer path exists; explain the issue and propose the better option.
- Do not expand scope beyond what was asked.
- Do not add abstraction layers unless the current task truly needs them.

CLEAN CHANGES
- Remove dead code, unused imports, and stale comments in files you touch when it is safe and in scope.
- Do not leave TODOs unless explicitly asked.
- Review your diff before presenting it and remove accidental changes.

LONG TASKS
- For multi-step implementation, review, or analysis work, use the task_checkpoint tool to persist concise progress after planning, after each meaningful milestone, and before compaction.
- When resuming after interruption or compaction, load the latest checkpoint before proceeding.
`;

const TaskCheckpointParams = Type.Object({
	action: StringEnum(["save", "load", "list", "clear"] as const, {
		description: "Whether to save, load, list, or clear a persisted checkpoint.",
	}),
	task: Type.Optional(
		Type.String({
			description:
				"Stable short identifier for the task, e.g. 'oauth-rollout' or 'spec-review-search'. Optional for load/list; load defaults to the latest checkpoint for the current branch/workspace.",
		}),
	),
	content: Type.Optional(
		Type.String({
			description:
				"Checkpoint text for save. Keep it concise and factual: goal, verified state, files changed, checks run, remaining work, and next concrete step.",
		}),
	),
});

type CheckpointAction = "save" | "load" | "list" | "clear";

type CheckpointRecord = {
	task: string;
	content: string;
	updatedAt: string;
	cwd: string;
	repoRoot: string;
	branch?: string;
};

function slugify(value: string, maxLength = 80): string {
	const slug = value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.replace(/-{2,}/g, "-");
	return (slug || "task").slice(0, maxLength);
}

function getGitInfo(cwd: string): { repoRoot: string; branch?: string } {
	try {
		const repoRoot = execSync("git rev-parse --show-toplevel", {
			cwd,
			stdio: ["ignore", "pipe", "ignore"],
		})
			.toString()
			.trim();
		let branch: string | undefined;
		try {
			branch = execSync("git rev-parse --abbrev-ref HEAD", {
				cwd,
				stdio: ["ignore", "pipe", "ignore"],
			})
				.toString()
				.trim();
			if (!branch || branch === "HEAD") branch = undefined;
		} catch {
			branch = undefined;
		}
		return { repoRoot, branch };
	} catch {
		return { repoRoot: cwd };
	}
}

function getStoragePaths(cwd: string) {
	const { repoRoot, branch } = getGitInfo(cwd);
	const rootName = slugify(basename(repoRoot) || "workspace", 32);
	const repoHash = createHash("sha1").update(repoRoot).digest("hex").slice(0, 12);
	const branchName = slugify(branch || "no-branch", 48);
	const repoDir = join(process.env.HOME || cwd, ".pi", "agent", "task-checkpoints", `${rootName}-${repoHash}`);
	const branchDir = join(repoDir, branchName);
	const latestFile = join(branchDir, "_latest.json");
	return { repoRoot, branch, branchDir, latestFile };
}

function getCheckpointFile(branchDir: string, task: string): string {
	return join(branchDir, `${slugify(task, 80)}.json`);
}

async function readJson<T>(path: string): Promise<T | undefined> {
	try {
		return JSON.parse(await readFile(path, "utf8")) as T;
	} catch {
		return undefined;
	}
}

function renderCheckpoint(record: CheckpointRecord): string {
	const branchLine = record.branch ? `Branch: ${record.branch}\n` : "";
	return `Task: ${record.task}\nUpdated: ${record.updatedAt}\nRepo: ${record.repoRoot}\n${branchLine}\n${record.content}`;
}

export default function workflowFoundation(pi: ExtensionAPI) {
	pi.on("before_agent_start", async (event) => ({
		systemPrompt: `${event.systemPrompt}\n\n${FOUNDATION_PROMPT}`,
	}));

	pi.registerTool({
		name: "task_checkpoint",
		label: "Task Checkpoint",
		description:
			"Persist or restore concise task checkpoints outside the conversation so long-running implementation, review, and analysis work survives interruption or compaction.",
		promptSnippet:
			"Persist or restore concise progress checkpoints for long-running implementation, review, and analysis tasks.",
		promptGuidelines: [
			"Use this tool for multi-step tasks after planning, after each meaningful milestone, and before compaction.",
			"When resuming a long-running task, load the latest checkpoint before proceeding.",
			"Checkpoint content should be concise and factual: goal, verified state, files changed, checks run, remaining work, and next step.",
		],
		parameters: TaskCheckpointParams,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const action = params.action as CheckpointAction;
			const { repoRoot, branch, branchDir, latestFile } = getStoragePaths(ctx.cwd);

			if (action === "save") {
				const task = slugify(params.task || "current-task", 80);
				const content = params.content?.trim();
				if (!content) {
					return {
						content: [{ type: "text", text: "task_checkpoint save requires non-empty content." }],
						details: { action, repoRoot, branch, task },
					};
				}
				await mkdir(branchDir, { recursive: true });
				const record: CheckpointRecord = {
					task,
					content,
					updatedAt: new Date().toISOString(),
					cwd: ctx.cwd,
					repoRoot,
					branch,
				};
				const file = getCheckpointFile(branchDir, task);
				await writeFile(file, JSON.stringify(record, null, 2));
				await writeFile(latestFile, JSON.stringify({ task, file }, null, 2));
				return {
					content: [{ type: "text", text: `Saved checkpoint '${task}'.\n\n${renderCheckpoint(record)}` }],
					details: { action, repoRoot, branch, task, file },
				};
			}

			if (action === "load") {
				let task = params.task ? slugify(params.task, 80) : undefined;
				let file = task ? getCheckpointFile(branchDir, task) : undefined;
				if (!file) {
					const latest = await readJson<{ task?: string; file?: string }>(latestFile);
					task = latest?.task;
					file = latest?.file;
				}
				if (!file || !task) {
					return {
						content: [{ type: "text", text: "No checkpoint found for the current branch/workspace." }],
						details: { action, repoRoot, branch },
					};
				}
				const record = await readJson<CheckpointRecord>(file);
				if (!record) {
					return {
						content: [{ type: "text", text: `Checkpoint '${task}' was not found.` }],
						details: { action, repoRoot, branch, task, file },
					};
				}
				return {
					content: [{ type: "text", text: `Loaded checkpoint '${record.task}'.\n\n${renderCheckpoint(record)}` }],
					details: { action, repoRoot, branch, task: record.task, file },
				};
			}

			if (action === "list") {
				try {
					const entries = (await readdir(branchDir)).filter((name) => name.endsWith(".json") && name !== "_latest.json");
					if (entries.length === 0) {
						return {
							content: [{ type: "text", text: "No checkpoints saved for the current branch/workspace." }],
							details: { action, repoRoot, branch, tasks: [] },
						};
					}
					const withTimes = await Promise.all(
						entries.map(async (name) => ({
							name: name.replace(/\.json$/, ""),
							mtimeMs: (await stat(join(branchDir, name))).mtimeMs,
						})),
					);
					withTimes.sort((a, b) => b.mtimeMs - a.mtimeMs);
					const lines = withTimes.map((entry, index) => `${index + 1}. ${entry.name}`);
					return {
						content: [{ type: "text", text: `Saved checkpoints:\n${lines.join("\n")}` }],
						details: { action, repoRoot, branch, tasks: withTimes.map((entry) => entry.name) },
					};
				} catch {
					return {
						content: [{ type: "text", text: "No checkpoints saved for the current branch/workspace." }],
						details: { action, repoRoot, branch, tasks: [] },
					};
				}
			}

			const task = params.task ? slugify(params.task, 80) : undefined;
			if (!task) {
				return {
					content: [{ type: "text", text: "task_checkpoint clear requires a task name." }],
					details: { action, repoRoot, branch },
				};
			}

			const file = getCheckpointFile(branchDir, task);
			await rm(file, { force: true });
			const latest = await readJson<{ task?: string; file?: string }>(latestFile);
			if (latest?.task === task) {
				await rm(latestFile, { force: true });
			}
			return {
				content: [{ type: "text", text: `Cleared checkpoint '${task}'.` }],
				details: { action, repoRoot, branch, task, file },
			};
		},
	});
}
