/**
 * Worktree Extension — /worktree command + worktree_create tool
 *
 * Accepts a branch name, PR number, or PR URL.
 * Creates (or reuses) a git worktree and can switch pi's working directory into it.
 *
 * If `alto` CLI is available, delegates to `alto worktree new <branch> --print-path`;
 * otherwise falls back to plain `git worktree add`.
 *
 * The status bar shows the branch and PR info (if applicable).
 *
 * To make tools work in the new directory, the extension:
 * - Rewrites relative path arguments for built-in find/grep/ls calls against process.cwd()
 * - Relies on the user's global worktree extension for bash/read/write/edit cwd handling
 * - Patches the system prompt to tell the LLM the correct cwd
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { BorderedLoader } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { Container, type SelectItem, SelectList, Text, truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import { execSync, spawn as nodeSpawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";

type PrChecksStatus = "passing" | "failing" | "pending" | null;
type PrReviewDecision = "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED" | null;
type PrMergeStateStatus = "BLOCKED" | "BEHIND" | "CLEAN" | "DIRTY" | "HAS_HOOKS" | "UNSTABLE" | "UNKNOWN" | null;

interface PrMetadata {
	prNumber: number;
	prUrl: string;
	prState: string | null;
	prChecksStatus: PrChecksStatus;
	prIsDraft: boolean;
	prReviewDecision: PrReviewDecision;
	prMergeStateStatus: PrMergeStateStatus;
}

interface WorktreeState {
	worktreePath: string;
	branch: string;
	prNumber: number | null;
	prUrl: string | null;
	prState: string | null;
	prChecksStatus: PrChecksStatus;
	prIsDraft: boolean;
	prReviewDecision: PrReviewDecision;
	prMergeStateStatus: PrMergeStateStatus;
}

interface PrStatusRollupItem {
	__typename?: string;
	conclusion?: string | null;
	status?: string | null;
	state?: string | null;
}

interface ConductorScripts {
	path: string;
	setup: string | null;
	archive: string | null;
}

interface WorktreeListItem extends WorktreeState {
	isMain: boolean;
	isCurrent: boolean;
	metadataLoading: boolean;
}

interface WorktreeTableLayout {
	branchWidth: number;
	prWidth: number;
	stateWidth: number;
	checksWidth: number;
	urlWidth: number;
}

type WorktreeCreateFlag = "--shared" | "--isolated";
type WorktreeTargetKind = "auto" | "branch";
type ResolvedWorktreeTarget = Omit<WorktreeState, "worktreePath">;
type CommandRunResult = { ok: boolean; output: string; stdout: string; stderr: string; aborted: boolean; timedOut: boolean };

type EnsuredWorktreeResult =
	| { kind: "cancelled" }
	| { kind: "main"; mainRoot: string; mainBranch: string }
	| {
		kind: "worktree";
		created: boolean;
		state: WorktreeState;
	};

/** The cwd when pi started — used to detect drift and patch system prompt. */
const originalCwd = process.cwd();
const PR_METADATA_REFRESH_INTERVAL_MS = 60_000;

let currentState: WorktreeState | null = null;
let prMetadataRefreshTimer: ReturnType<typeof setInterval> | null = null;
let prMetadataRefreshAbortController: AbortController | null = null;
let prMetadataRefreshInFlight = false;

// ── PR helpers ──────────────────────────────────────────────────────────

function parsePrInput(input: string): { prNumber: number; repo: string | null } | null {
	const urlMatch = input.match(/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/);
	if (urlMatch) {
		return { prNumber: parseInt(urlMatch[2], 10), repo: urlMatch[1] };
	}
	if (/^\d+$/.test(input.trim())) {
		return { prNumber: parseInt(input.trim(), 10), repo: null };
	}
	return null;
}

function summarizePrChecksStatus(statusCheckRollup: PrStatusRollupItem[] | null | undefined): PrChecksStatus {
	if (!statusCheckRollup || statusCheckRollup.length === 0) return null;

	let hasPending = false;
	let hasCompleted = false;

	for (const item of statusCheckRollup) {
		if (item.__typename === "StatusContext") {
			const state = item.state?.toUpperCase() ?? "";
			if (state === "FAILURE" || state === "ERROR" || state === "FAILED") return "failing";
			if (state === "PENDING" || state === "EXPECTED") {
				hasPending = true;
				continue;
			}
			if (state === "SUCCESS") hasCompleted = true;
			continue;
		}

		const conclusion = item.conclusion?.toUpperCase() ?? "";
		const status = item.status?.toUpperCase() ?? "";
		if (
			conclusion === "FAILURE"
			|| conclusion === "TIMED_OUT"
			|| conclusion === "CANCELLED"
			|| conclusion === "ACTION_REQUIRED"
			|| conclusion === "STARTUP_FAILURE"
		) {
			return "failing";
		}
		if (status && status !== "COMPLETED") {
			hasPending = true;
			continue;
		}
		if (status === "COMPLETED") hasCompleted = true;
	}

	if (hasPending) return "pending";
	if (hasCompleted) return "passing";
	return null;
}

function parsePrMetadata(data: any): PrMetadata | null {
	if (typeof data?.number !== "number" || typeof data?.url !== "string") return null;
	return {
		prNumber: data.number,
		prUrl: data.url,
		prState: typeof data.state === "string" ? data.state : null,
		prChecksStatus: summarizePrChecksStatus(data.statusCheckRollup),
		prIsDraft: data.isDraft === true,
		prReviewDecision:
			data.reviewDecision === "APPROVED"
			|| data.reviewDecision === "CHANGES_REQUESTED"
			|| data.reviewDecision === "REVIEW_REQUIRED"
				? data.reviewDecision
				: null,
		prMergeStateStatus:
			data.mergeStateStatus === "BLOCKED"
			|| data.mergeStateStatus === "BEHIND"
			|| data.mergeStateStatus === "CLEAN"
			|| data.mergeStateStatus === "DIRTY"
			|| data.mergeStateStatus === "HAS_HOOKS"
			|| data.mergeStateStatus === "UNSTABLE"
			|| data.mergeStateStatus === "UNKNOWN"
				? data.mergeStateStatus
				: null,
	};
}

function getPrStatusLabel(
	state: string | null,
	isDraft: boolean,
	reviewDecision: PrReviewDecision,
	mergeStateStatus: PrMergeStateStatus,
): string {
	if (state === "MERGED") return "merged";
	if (state === "CLOSED") return "closed";
	if (isDraft) return "draft";
	if (state === "OPEN" && reviewDecision === "APPROVED" && (mergeStateStatus === "CLEAN" || mergeStateStatus === "HAS_HOOKS")) {
		return "ready-to-merge";
	}
	if (state === "OPEN") return "open";
	return state ? state.toLowerCase() : "—";
}

async function getPrBranchAsync(
	prNumber: number,
	repo: string | null,
	cwd: string,
	signal?: AbortSignal,
): Promise<({ branch: string } & PrMetadata) | null> {
	const repoFlag = repo ? `--repo ${JSON.stringify(repo)}` : "";
	const result = await runCommandAsync(
		`gh pr view ${prNumber} ${repoFlag} --json headRefName,number,url,state,statusCheckRollup,isDraft,reviewDecision,mergeStateStatus`,
		{ cwd, signal, timeoutMs: 15_000 },
	);
	if (result.aborted) return null;
	if (!result.ok) {
		throw new Error(result.stderr.trim() || result.stdout.trim() || (result.timedOut ? "GitHub CLI request timed out" : "GitHub CLI request failed"));
	}

	const data = JSON.parse(result.stdout.trim());
	if (typeof data.headRefName !== "string") {
		throw new Error("GitHub CLI response missing headRefName");
	}
	const metadata = parsePrMetadata(data);
	if (!metadata) {
		throw new Error("GitHub CLI response missing PR metadata");
	}
	return {
		branch: data.headRefName,
		...metadata,
	};
}

function getBranchPrInfo(branch: string): PrMetadata | null {
	try {
		const json = execSync(
			`gh pr view ${JSON.stringify(branch)} --json number,url,state,statusCheckRollup,isDraft,reviewDecision,mergeStateStatus`,
			{
				encoding: "utf-8",
				timeout: 15_000,
				stdio: ["ignore", "pipe", "ignore"],
			},
		).trim();
		return parsePrMetadata(JSON.parse(json));
	} catch {
		return null;
	}
}

function reconstructCurrentWorktreeState(): WorktreeState | null {
	try {
		const worktreePath = execSync("git rev-parse --show-toplevel", {
			encoding: "utf-8",
			timeout: 5_000,
			stdio: ["ignore", "pipe", "ignore"],
		}).trim();
		if (!worktreePath) return null;

		const mainRoot = getMainWorktreeRoot();
		if (worktreePath === mainRoot) return null;

		const branch = execSync("git branch --show-current", {
			encoding: "utf-8",
			timeout: 5_000,
			stdio: ["ignore", "pipe", "ignore"],
		}).trim();
		if (!branch) return null;

		const prInfo = getBranchPrInfo(branch);
		return {
			worktreePath,
			branch,
			prNumber: prInfo?.prNumber ?? null,
			prUrl: prInfo?.prUrl ?? null,
			prState: prInfo?.prState ?? null,
			prChecksStatus: prInfo?.prChecksStatus ?? null,
			prIsDraft: prInfo?.prIsDraft ?? false,
			prReviewDecision: prInfo?.prReviewDecision ?? null,
			prMergeStateStatus: prInfo?.prMergeStateStatus ?? null,
		};
	} catch {
		return null;
	}
}

// ── Git worktree helpers ────────────────────────────────────────────────

function getMainWorktreeRoot(): string {
	return execSync("git worktree list --porcelain | head -1 | sed 's/^worktree //'", {
		encoding: "utf-8",
		timeout: 5_000,
	}).trim();
}

function findExistingWorktree(branch: string): string | null {
	const output = execSync("git worktree list --porcelain", { encoding: "utf-8", timeout: 5_000 });
	const entries = output.split("\n\n").filter(Boolean);
	for (const entry of entries) {
		const lines = entry.split("\n");
		const pathLine = lines.find((l) => l.startsWith("worktree "));
		const branchLine = lines.find((l) => l.startsWith("branch "));
		if (pathLine && branchLine) {
			const wtBranch = branchLine.replace("branch refs/heads/", "");
			if (wtBranch === branch) {
				return pathLine.replace("worktree ", "");
			}
		}
	}
	return null;
}

function getRepoSlug(repoRoot: string): string | null {
	try {
		const remoteUrl = execSync(`git -C ${JSON.stringify(repoRoot)} remote get-url origin`, {
			encoding: "utf-8",
			timeout: 5_000,
			stdio: ["ignore", "pipe", "ignore"],
		}).trim();
		const match = remoteUrl.match(/github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/i);
		return match ? match[1] : null;
	} catch {
		return null;
	}
}

function getWorktreeBranch(worktreePath: string): string | null {
	try {
		const worktreeRoot = execSync(`git -C ${JSON.stringify(worktreePath)} rev-parse --show-toplevel`, {
			encoding: "utf-8",
			timeout: 5_000,
			stdio: ["ignore", "pipe", "ignore"],
		}).trim();
		if (worktreeRoot !== worktreePath) return null;

		const branch = execSync(`git -C ${JSON.stringify(worktreePath)} branch --show-current`, {
			encoding: "utf-8",
			timeout: 5_000,
			stdio: ["ignore", "pipe", "ignore"],
		}).trim();
		return branch || null;
	} catch {
		return null;
	}
}

function isWorktreeForRepo(worktreePath: string, repoRoot: string): boolean {
	try {
		const worktreeCommonDir = execSync(
			`git -C ${JSON.stringify(worktreePath)} rev-parse --path-format=absolute --git-common-dir`,
			{
				encoding: "utf-8",
				timeout: 5_000,
				stdio: ["ignore", "pipe", "ignore"],
			},
		).trim();
		const repoCommonDir = execSync(
			`git -C ${JSON.stringify(repoRoot)} rev-parse --path-format=absolute --git-common-dir`,
			{
				encoding: "utf-8",
				timeout: 5_000,
				stdio: ["ignore", "pipe", "ignore"],
			},
		).trim();
		return Boolean(worktreeCommonDir) && worktreeCommonDir === repoCommonDir;
	} catch {
		return false;
	}
}

function branchToDirName(branch: string): string {
	return branch.replace(/\//g, "-");
}

function getMainBranch(mainRoot: string): string {
	return execSync(`git -C ${JSON.stringify(mainRoot)} branch --show-current`, {
		encoding: "utf-8",
		timeout: 5_000,
	}).trim();
}

function getCandidateWorktreePath(mainRoot: string, branch: string): string {
	const repoName = basename(mainRoot);
	const worktreeBase = resolve(mainRoot, "..", `${repoName}-wt`);
	return resolve(worktreeBase, branchToDirName(branch));
}

function hasGitRef(repoRoot: string, ref: string): boolean {
	try {
		execSync(`git -C ${JSON.stringify(repoRoot)} rev-parse --verify ${JSON.stringify(ref)}`, {
			timeout: 5_000,
			stdio: ["ignore", "ignore", "ignore"],
		});
		return true;
	} catch {
		return false;
	}
}

function hasAltoCli(): boolean {
	try {
		execSync("command -v alto", {
			encoding: "utf-8",
			timeout: 3_000,
			stdio: ["ignore", "ignore", "ignore"],
		});
		return true;
	} catch {
		return false;
	}
}

async function resolveWorktreeTarget(
	target: string,
	mainRoot: string,
	signal?: AbortSignal,
	targetKind: WorktreeTargetKind = "auto",
): Promise<ResolvedWorktreeTarget | null> {
	if (signal?.aborted) return null;
	const prInfo = targetKind === "branch" ? null : parsePrInput(target);

	if (prInfo?.repo) {
		const currentRepoSlug = getRepoSlug(mainRoot);
		if (!currentRepoSlug) {
			throw new Error("Couldn't determine the current GitHub repo. Switch to the correct repo before using a PR URL.");
		}
		if (prInfo.repo.toLowerCase() !== currentRepoSlug.toLowerCase()) {
			throw new Error(
				`PR repo ${prInfo.repo} does not match the current repo ${currentRepoSlug}. Switch to the correct repo first.`,
			);
		}
	}

	if (!prInfo) {
		return {
			branch: target,
			prNumber: null,
			prUrl: null,
			prState: null,
			prChecksStatus: null,
			prIsDraft: false,
			prReviewDecision: null,
			prMergeStateStatus: null,
		};
	}

	try {
		const pr = await getPrBranchAsync(prInfo.prNumber, prInfo.repo, mainRoot, signal);
		if (!pr) return null;
		return {
			branch: pr.branch,
			prNumber: pr.prNumber,
			prUrl: pr.prUrl,
			prState: pr.prState,
			prChecksStatus: pr.prChecksStatus,
			prIsDraft: pr.prIsDraft,
			prReviewDecision: pr.prReviewDecision,
			prMergeStateStatus: pr.prMergeStateStatus,
		};
	} catch (e: any) {
		throw new Error(`Failed to resolve PR: ${e.message}`);
	}
}

function buildGitWorktreeCreateCommand(
	mainRoot: string,
	branch: string,
	candidatePath: string,
	prNumber: number | null,
): string {
	const branchExists = hasGitRef(mainRoot, `refs/heads/${branch}`) || hasGitRef(mainRoot, `refs/remotes/origin/${branch}`);
	if (branchExists) {
		return `git -C ${JSON.stringify(mainRoot)} worktree add ${JSON.stringify(candidatePath)} ${JSON.stringify(branch)}`;
	}
	if (prNumber) {
		return `git -C ${JSON.stringify(mainRoot)} fetch origin pull/${prNumber}/head && git -C ${JSON.stringify(mainRoot)} worktree add -b ${JSON.stringify(branch)} ${JSON.stringify(candidatePath)} FETCH_HEAD`;
	}
	return `git -C ${JSON.stringify(mainRoot)} worktree add -b ${JSON.stringify(branch)} ${JSON.stringify(candidatePath)}`;
}

async function ensureWorktree(
	ctx: ExtensionContext,
	target: string,
	flags: WorktreeCreateFlag[] = [],
	signal?: AbortSignal,
	targetKind: WorktreeTargetKind = "auto",
): Promise<EnsuredWorktreeResult> {
	const mainRoot = getMainWorktreeRoot();
	const mainBranch = getMainBranch(mainRoot);
	const resolvedTarget = await resolveWorktreeTarget(target, mainRoot, signal, targetKind);
	if (!resolvedTarget) {
		return { kind: "cancelled" };
	}

	if (resolvedTarget.branch === mainBranch) {
		return {
			kind: "main",
			mainRoot,
			mainBranch,
		};
	}

	const candidatePath = getCandidateWorktreePath(mainRoot, resolvedTarget.branch);
	const existingWorktreePath = findExistingWorktree(resolvedTarget.branch);

	if (existingWorktreePath) {
		return {
			kind: "worktree",
			created: false,
			state: {
				worktreePath: existingWorktreePath,
				...resolvedTarget,
			},
		};
	}

	if (existsSync(candidatePath)) {
		const candidateBranch = getWorktreeBranch(candidatePath);
		if (candidateBranch !== resolvedTarget.branch || !isWorktreeForRepo(candidatePath, mainRoot)) {
			throw new Error(
				`Directory exists at ${candidatePath} but is not a valid worktree for ${resolvedTarget.branch}. Clean it up before retrying.`,
			);
		}
		return {
			kind: "worktree",
			created: false,
			state: {
				worktreePath: candidatePath,
				...resolvedTarget,
			},
		};
	}

	const useAlto = hasAltoCli();
	const createCommand = useAlto
		? `alto worktree new ${JSON.stringify(resolvedTarget.branch)} --print-path${flags.length > 0 ? ` ${flags.join(" ")}` : ""}`
		: buildGitWorktreeCreateCommand(mainRoot, resolvedTarget.branch, candidatePath, resolvedTarget.prNumber);

	const result = await runCommandWithLoader(
		ctx,
		`Creating worktree for ${resolvedTarget.branch}...`,
		createCommand,
		mainRoot,
		signal,
	);

	if (!result) {
		return { kind: "cancelled" };
	}

	if (!result.ok) {
		throw new Error(`Failed to create worktree:\n${result.output}`);
	}

	const worktreePath = useAlto
		? (() => {
			const printedPath = result.output.trim().split("\n").pop()?.trim();
			return printedPath && existsSync(printedPath) ? printedPath : candidatePath;
		})()
		: candidatePath;

	if (!existsSync(worktreePath)) {
		throw new Error(`Worktree created but path not found at ${worktreePath}`);
	}

	return {
		kind: "worktree",
		created: true,
		state: {
			worktreePath,
			...resolvedTarget,
		},
	};
}

function readConductorScripts(worktreePath: string): ConductorScripts | null {
	const conductorPath = resolve(worktreePath, "conductor.json");
	if (!existsSync(conductorPath)) return null;

	let raw: unknown;
	try {
		raw = JSON.parse(readFileSync(conductorPath, "utf-8"));
	} catch (e: any) {
		throw new Error(`Failed to parse ${conductorPath}: ${e.message}`);
	}

	const scripts =
		raw && typeof raw === "object" && "scripts" in raw && raw.scripts && typeof raw.scripts === "object"
			? raw.scripts as Record<string, unknown>
			: {};

	return {
		path: conductorPath,
		setup: typeof scripts.setup === "string" ? scripts.setup : null,
		archive: typeof scripts.archive === "string" ? scripts.archive : null,
	};
}

function listWorktrees(): WorktreeListItem[] {
	const mainRoot = getMainWorktreeRoot();
	const currentWorktreePath = (() => {
		try {
			return execSync("git rev-parse --show-toplevel", {
				encoding: "utf-8",
				timeout: 5_000,
				stdio: ["ignore", "pipe", "ignore"],
			}).trim();
		} catch {
			return process.cwd();
		}
	})();
	const output = execSync("git worktree list --porcelain", { encoding: "utf-8", timeout: 5_000 });
	const entries = output.split("\n\n").filter(Boolean);

	return entries
		.map((entry) => {
			const lines = entry.split("\n");
			const pathLine = lines.find((line) => line.startsWith("worktree "));
			if (!pathLine) return null;

			const branchLine = lines.find((line) => line.startsWith("branch "));
			const branch = branchLine
				? branchLine.replace("branch refs/heads/", "")
				: lines.includes("bare")
					? "(bare)"
					: "(detached)";
			const worktreePath = pathLine.replace("worktree ", "");

			return {
				worktreePath,
				branch,
				prNumber: null,
				prUrl: null,
				prState: null,
				prChecksStatus: null,
				prIsDraft: false,
				prReviewDecision: null,
				prMergeStateStatus: null,
				isMain: worktreePath === mainRoot,
				isCurrent: worktreePath === currentWorktreePath,
				metadataLoading: !branch.startsWith("("),
			};
		})
		.filter((entry): entry is WorktreeListItem => entry !== null);
}

function formatCell(value: string, width: number): string {
	const truncated = truncateToWidth(value || "—", width);
	return truncated + " ".repeat(Math.max(0, width - visibleWidth(truncated)));
}

function getWorktreeTableLayout(totalWidth: number): WorktreeTableLayout {
	const gapWidth = 8;
	const prWidth = 8;
	const stateWidth = 15;
	const checksWidth = 10;
	const flexibleWidth = Math.max(24, totalWidth - gapWidth - prWidth - stateWidth - checksWidth);
	let branchWidth = Math.max(14, Math.min(28, Math.floor(flexibleWidth * 0.4)));
	let urlWidth = flexibleWidth - branchWidth;
	if (urlWidth < 12) {
		branchWidth = Math.max(10, branchWidth - (12 - urlWidth));
		urlWidth = flexibleWidth - branchWidth;
	}
	return { branchWidth, prWidth, stateWidth, checksWidth, urlWidth };
}

function formatWorktreeState(item: Pick<WorktreeState, "prState" | "prIsDraft" | "prReviewDecision" | "prMergeStateStatus">, metadataLoading: boolean): string {
	if (metadataLoading) return "loading";
	return getPrStatusLabel(item.prState, item.prIsDraft, item.prReviewDecision, item.prMergeStateStatus);
}

function formatWorktreeChecks(status: PrChecksStatus, metadataLoading: boolean): string {
	if (metadataLoading) return "loading";
	if (status === "passing") return "passing";
	if (status === "failing") return "failing";
	if (status === "pending") return "pending";
	return "—";
}

function buildWorktreeTableHeader(totalWidth: number): string {
	const layout = getWorktreeTableLayout(totalWidth);
	return [
		formatCell("WORKTREE", layout.branchWidth),
		formatCell("PR", layout.prWidth),
		formatCell("STATE", layout.stateWidth),
		formatCell("CHECKS", layout.checksWidth),
		formatCell("PR URL", layout.urlWidth),
	].join("  ");
}

function buildWorktreeTableRow(item: WorktreeListItem, totalWidth: number): string {
	const layout = getWorktreeTableLayout(totalWidth);
	const branchLabel = `${item.isCurrent ? "*" : item.isMain ? "~" : " "} ${item.branch}`;
	const prLabel = item.metadataLoading ? "loading" : item.prNumber ? `#${item.prNumber}` : "—";
	return [
		formatCell(branchLabel, layout.branchWidth),
		formatCell(prLabel, layout.prWidth),
		formatCell(formatWorktreeState(item, item.metadataLoading), layout.stateWidth),
		formatCell(formatWorktreeChecks(item.prChecksStatus, item.metadataLoading), layout.checksWidth),
		formatCell(item.metadataLoading ? "loading…" : item.prUrl ?? "—", layout.urlWidth),
	].join("  ");
}

function renderBorderedModal(lines: string[], width: number, color: (text: string) => string): string[] {
	const innerWidth = Math.max(1, width - 2);
	const top = color(`┌${"─".repeat(innerWidth)}┐`);
	const bottom = color(`└${"─".repeat(innerWidth)}┘`);
	const middle = lines.map((line) => {
		const truncated = truncateToWidth(line, innerWidth, "");
		const padded = truncated + " ".repeat(Math.max(0, innerWidth - visibleWidth(truncated)));
		return `${color("│")}${padded}${color("│")}`;
	});
	return [top, ...middle, bottom];
}

async function removeWorktree(ctx: ExtensionContext, worktree: WorktreeListItem): Promise<{ ok: boolean; output: string } | null> {
	const mainRoot = getMainWorktreeRoot();
	return runCommandWithLoader(
		ctx,
		`Removing worktree ${worktree.branch}...`,
		`git -C ${JSON.stringify(mainRoot)} worktree remove ${JSON.stringify(worktree.worktreePath)}`,
		mainRoot,
	);
}

// ── Async command runner with abort support ─────────────────────────────

function runCommandAsync(
	command: string,
	options: { cwd?: string; signal?: AbortSignal; timeoutMs?: number },
): Promise<CommandRunResult> {
	return new Promise((resolve) => {
		if (options.signal?.aborted) {
			resolve({ ok: false, output: "", stdout: "", stderr: "", aborted: true, timedOut: false });
			return;
		}

		const useProcessGroup = process.platform !== "win32";
		const child = nodeSpawn(command, {
			cwd: options.cwd,
			stdio: ["ignore", "pipe", "pipe"],
			shell: true,
			detached: useProcessGroup,
		});

		let stdout = "";
		let stderr = "";
		let aborted = false;
		let timedOut = false;
		let settled = false;
		let exited = false;
		child.stdout?.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
		child.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });

		const signalChild = (signal: NodeJS.Signals) => {
			try {
				if (useProcessGroup && child.pid) {
					process.kill(-child.pid, signal);
				} else {
					child.kill(signal);
				}
			} catch (e: any) {
				if (e?.code !== "ESRCH") throw e;
			}
		};
		const killChild = () => {
			signalChild("SIGTERM");
			setTimeout(() => {
				if (!exited && child.exitCode === null) signalChild("SIGKILL");
			}, 3_000);
		};
		const onAbort = () => {
			aborted = true;
			killChild();
		};
		const timeoutId = options.timeoutMs
			? setTimeout(() => {
				timedOut = true;
				stderr ||= `Command timed out after ${options.timeoutMs}ms`;
				killChild();
			}, options.timeoutMs)
			: null;
		const finish = (code: number | null, errorMessage?: string) => {
			if (settled) return;
			settled = true;
			exited = true;
			if (timeoutId) clearTimeout(timeoutId);
			options.signal?.removeEventListener("abort", onAbort);
			if (errorMessage) {
				stderr = stderr ? `${stderr}\n${errorMessage}` : errorMessage;
			}
			const output = `${stdout}${stderr}`;
			resolve({
				ok: code === 0 && !aborted && !timedOut && !errorMessage,
				output,
				stdout,
				stderr,
				aborted,
				timedOut,
			});
		};

		options.signal?.addEventListener("abort", onAbort, { once: true });
		if (options.signal?.aborted) onAbort();

		child.on("close", (code) => finish(code));
		child.on("error", (err) => finish(null, err.message));
	});
}

async function runCommandWithLoader(
	ctx: ExtensionContext,
	message: string,
	command: string,
	cwd: string,
	signal?: AbortSignal,
): Promise<{ ok: boolean; output: string } | null> {
	const commandSignal = signal ?? ctx.signal;
	if (!ctx.hasUI) {
		const res = await runCommandAsync(command, {
			cwd,
			signal: commandSignal,
		});
		return res.aborted ? null : { ok: res.ok, output: res.ok ? res.stdout : res.output };
	}

	return ctx.ui.custom<{ ok: boolean; output: string } | null>(
		(tui, theme, _kb, done) => {
			const loader = new BorderedLoader(tui, theme, `${message} (Esc to cancel)`);
			loader.onAbort = () => {};
			const combinedSignal = commandSignal ? AbortSignal.any([loader.signal, commandSignal]) : loader.signal;

			runCommandAsync(command, {
				cwd,
				signal: combinedSignal,
			}).then((res) => done(res.aborted ? null : { ok: res.ok, output: res.ok ? res.stdout : res.output }));

			return loader;
		},
	);
}

async function runSetupIfPresent(ctx: ExtensionContext, worktreePath: string, label: string): Promise<string | null> {
	try {
		const conductorScripts = readConductorScripts(worktreePath);
		if (!conductorScripts?.setup) return null;

		const setupResult = await runCommandWithLoader(
			ctx,
			`Running setup for ${label}...`,
			conductorScripts.setup,
			worktreePath,
		);
		if (!setupResult) return "Setup cancelled";
		if (!setupResult.ok) return `Setup failed:\n${setupResult.output}`;
		return "Setup completed";
	} catch (e: any) {
		return e.message;
	}
}

async function getBranchPrInfoAsync(
	branch: string,
	cwd: string,
	signal?: AbortSignal,
): Promise<PrMetadata | null> {
	try {
		const result = await runCommandAsync(
			`gh pr view ${JSON.stringify(branch)} --json number,url,state,statusCheckRollup,isDraft,reviewDecision,mergeStateStatus`,
			{ cwd, signal, timeoutMs: 15_000 },
		);
		if (!result.ok || result.aborted) return null;
		return parsePrMetadata(JSON.parse(result.stdout.trim()));
	} catch {
		return null;
	}
}

function stopPrMetadataRefresh() {
	if (prMetadataRefreshTimer) {
		clearInterval(prMetadataRefreshTimer);
		prMetadataRefreshTimer = null;
	}
	prMetadataRefreshAbortController?.abort();
	prMetadataRefreshAbortController = null;
	prMetadataRefreshInFlight = false;
}

async function refreshCurrentPrMetadata(ctx: ExtensionContext): Promise<void> {
	if (prMetadataRefreshInFlight) return;
	const state = currentState;
	if (!state?.prNumber && !state?.prUrl) return;

	prMetadataRefreshInFlight = true;
	const abortController = new AbortController();
	prMetadataRefreshAbortController?.abort();
	prMetadataRefreshAbortController = abortController;

	try {
		const prInfo = await getBranchPrInfoAsync(state.branch, state.worktreePath, abortController.signal);
		if (!prInfo || abortController.signal.aborted) return;
		if (!currentState || currentState.worktreePath !== state.worktreePath || currentState.branch !== state.branch) return;

		currentState = {
			...currentState,
			...prInfo,
		};
		updateStatus(ctx);
	} finally {
		if (prMetadataRefreshAbortController === abortController) {
			prMetadataRefreshAbortController = null;
		}
		prMetadataRefreshInFlight = false;
	}
}

function syncPrMetadataRefresh(ctx: ExtensionContext) {
	stopPrMetadataRefresh();
	if (!currentState?.prNumber && !currentState?.prUrl) return;
	prMetadataRefreshTimer = setInterval(() => {
		void refreshCurrentPrMetadata(ctx);
	}, PR_METADATA_REFRESH_INTERVAL_MS);
}

function restoreSessionWorktreeState(ctx: ExtensionContext) {
	stopPrMetadataRefresh();
	currentState = reconstructCurrentWorktreeState();
	syncPrMetadataRefresh(ctx);
	updateStatus(ctx);
}

async function switchToMainWorktree(ctx: ExtensionContext, mainRoot: string, mainBranch: string): Promise<void> {
	try {
		process.chdir(mainRoot);
	} catch (e: any) {
		ctx.ui.notify(`Failed to chdir: ${e.message}`, "error");
		return;
	}

	currentState = null;
	syncPrMetadataRefresh(ctx);
	updateStatus(ctx);
	const setupNote = await runSetupIfPresent(ctx, mainRoot, mainBranch);
	const parts = [`Switched to main worktree: ${mainRoot}`];
	if (setupNote) parts.push(setupNote);
	ctx.ui.notify(parts.join("\n"), setupNote === "Setup cancelled" ? "info" : setupNote && setupNote !== "Setup completed" ? "warning" : "success");
}

async function switchToExistingWorktree(ctx: ExtensionContext, nextState: WorktreeState, signal?: AbortSignal): Promise<void> {
	try {
		process.chdir(nextState.worktreePath);
	} catch (e: any) {
		ctx.ui.notify(`Failed to chdir: ${e.message}`, "error");
		return;
	}

	let { prNumber, prUrl, prState, prChecksStatus, prIsDraft, prReviewDecision, prMergeStateStatus } = nextState;
	if (!signal?.aborted && !prNumber && !nextState.branch.startsWith("(")) {
		const branchPrInfo = await getBranchPrInfoAsync(nextState.branch, nextState.worktreePath, signal);
		if (branchPrInfo) {
			prNumber = branchPrInfo.prNumber;
			prUrl = branchPrInfo.prUrl;
			prState = branchPrInfo.prState;
			prChecksStatus = branchPrInfo.prChecksStatus;
			prIsDraft = branchPrInfo.prIsDraft;
			prReviewDecision = branchPrInfo.prReviewDecision;
			prMergeStateStatus = branchPrInfo.prMergeStateStatus;
		}
	}

	currentState = {
		worktreePath: nextState.worktreePath,
		branch: nextState.branch,
		prNumber,
		prUrl,
		prState,
		prChecksStatus,
		prIsDraft,
		prReviewDecision,
		prMergeStateStatus,
	};

	syncPrMetadataRefresh(ctx);
	updateStatus(ctx);

	const setupNote = await runSetupIfPresent(ctx, nextState.worktreePath, nextState.branch);

	const parts = [`Switched to worktree: ${nextState.worktreePath}`, `Branch: ${nextState.branch}`];
	if (prUrl) parts.push(`PR: ${prUrl}`);
	if (setupNote) parts.push(setupNote);
	ctx.ui.notify(parts.join("\n"), setupNote === "Setup cancelled" ? "info" : setupNote && setupNote !== "Setup completed" ? "warning" : "success");
}

async function showWorktreeSelector(ctx: ExtensionContext): Promise<WorktreeListItem | null> {
	const items = listWorktrees();
	if (items.length === 0) return null;

	return ctx.ui.custom<WorktreeListItem | null>((tui, theme, _kb, done) => {
		const container = new Container();
		const title = new Text(theme.fg("accent", "Switch Worktree"), 1, 0);
		const columns = new Text("", 1, 0);
		const details = new Text("", 1, 0);
		const hint = new Text(theme.fg("dim", "* current • ~ main • metadata loads in background • Enter switch • d remove • Esc cancel"), 1, 0);
		const selectItems: SelectItem[] = items.map((item) => ({
			value: item.worktreePath,
			label: "",
		}));
		const selectList = new SelectList(selectItems, Math.min(items.length, 12), {
			selectedPrefix: (text) => theme.fg("accent", text),
			selectedText: (text) => theme.fg("accent", text),
			description: (text) => theme.fg("muted", text),
			scrollInfo: (text) => theme.fg("dim", text),
			noMatch: (text) => theme.fg("warning", text),
		});
		const abortController = new AbortController();
		const borderColor = (text: string) => theme.fg("accent", text);
		let busy = false;

		const getSelectedWorktree = () => {
			const selected = selectList.getSelectedItem();
			if (!selected) return null;
			return items.find((worktree) => worktree.worktreePath === selected.value) ?? null;
		};

		const syncDetails = (width: number) => {
			const selected = getSelectedWorktree();
			const detailWidth = Math.max(24, width - 6);
			const pathPrefix = "Path: ";
			const prPrefix = "PR: ";
			const pathValue = truncateToWidth(selected?.worktreePath ?? "—", Math.max(1, detailWidth - visibleWidth(pathPrefix)), "");
			const prValue = truncateToWidth(
				selected
					? selected.metadataLoading
						? "loading…"
						: selected.prUrl ?? "—"
					: "—",
				Math.max(1, detailWidth - visibleWidth(prPrefix)),
				"",
			);
			details.setText([
				`${theme.fg("dim", pathPrefix)}${pathValue}`,
				`${theme.fg("dim", prPrefix)}${prValue}`,
			].join("\n"));
		};

		container.addChild(title);
		container.addChild(columns);
		container.addChild(selectList);
		container.addChild(details);
		container.addChild(hint);

		let lastTableWidth = 0;
		const syncPresentation = (width: number) => {
			const tableWidth = Math.max(72, width - 6);
			if (tableWidth !== lastTableWidth) {
				lastTableWidth = tableWidth;
				columns.setText(theme.fg("dim", buildWorktreeTableHeader(tableWidth)));
				items.forEach((item, index) => {
					selectItems[index]!.label = buildWorktreeTableRow(item, tableWidth);
				});
				selectList.invalidate();
			}
			syncDetails(width);
		};

		const refresh = () => {
			lastTableWidth = 0;
			selectList.invalidate();
			container.invalidate();
			tui.requestRender();
		};

		const removeSelectedWorktree = async () => {
			if (busy) return;
			const selected = getSelectedWorktree();
			if (!selected) return;
			if (selected.isMain) {
				ctx.ui.notify("Cannot remove the main worktree.", "warning");
				return;
			}
			if (selected.isCurrent) {
				ctx.ui.notify("Cannot remove the currently active worktree.", "warning");
				return;
			}

			busy = true;
			try {
				const confirmed = await ctx.ui.confirm(
					"Remove worktree?",
					`Remove ${selected.branch} at ${selected.worktreePath}?\n\nThis uses git worktree remove without --force.`,
				);
				if (!confirmed) return;

				const result = await removeWorktree(ctx, selected);
				if (!result) {
					ctx.ui.notify("Worktree removal cancelled.", "info");
					return;
				}
				if (!result.ok) {
					ctx.ui.notify(`Failed to remove worktree:\n${result.output}`, "error");
					return;
				}

				const itemIndex = items.findIndex((worktree) => worktree.worktreePath === selected.worktreePath);
				if (itemIndex !== -1) {
					items.splice(itemIndex, 1);
					selectItems.splice(itemIndex, 1);
					if (items.length === 0) {
						abortController.abort();
						done(null);
						return;
					}
					selectList.setSelectedIndex(Math.min(itemIndex, items.length - 1));
					refresh();
				}

				ctx.ui.notify(`Removed worktree ${selected.branch}.`, "success");
			} finally {
				busy = false;
				tui.requestRender();
			}
		};

		selectList.onSelect = (item) => {
			abortController.abort();
			done(items.find((worktree) => worktree.worktreePath === item.value) ?? null);
		};
		selectList.onCancel = () => {
			abortController.abort();
			done(null);
		};

		for (const item of items) {
			if (item.isMain || item.branch.startsWith("(")) {
				item.metadataLoading = false;
				continue;
			}
			void getBranchPrInfoAsync(item.branch, item.worktreePath, abortController.signal).then((prInfo) => {
				if (abortController.signal.aborted) return;
				item.metadataLoading = false;
				if (prInfo) {
					item.prNumber = prInfo.prNumber;
					item.prUrl = prInfo.prUrl;
					item.prState = prInfo.prState;
					item.prChecksStatus = prInfo.prChecksStatus;
					item.prIsDraft = prInfo.prIsDraft;
					item.prReviewDecision = prInfo.prReviewDecision;
					item.prMergeStateStatus = prInfo.prMergeStateStatus;
				}
				refresh();
			});
		}

		return {
			render(width: number) {
				syncPresentation(width);
				return renderBorderedModal(container.render(Math.max(1, width - 2)), width, borderColor);
			},
			invalidate() {
				container.invalidate();
			},
			handleInput(data: string) {
				if (busy) return;
				if (data === "d") {
					void removeSelectedWorktree();
					return;
				}
				selectList.handleInput(data);
				tui.requestRender();
			},
		};
	}, {
		overlay: true,
		overlayOptions: {
			anchor: "center",
			width: "90%",
			minWidth: 90,
			maxHeight: "80%",
			margin: 1,
		},
	});
}

// ── Status bar ──────────────────────────────────────────────────────────

function updateStatus(ctx: ExtensionContext) {
	if (!currentState) {
		ctx.ui.setStatus("worktree", undefined);
		return;
	}
	const theme = ctx.ui.theme;
	const parts: string[] = [];
	parts.push(theme.fg("accent", `⎇ ${currentState.branch}`));
	if (currentState.prNumber) {
		parts.push(theme.fg("muted", `PR #${currentState.prNumber}`));
	}
	if (currentState.prUrl) {
		parts.push(theme.fg("dim", currentState.prUrl));
	}
	if (currentState.prState) {
		const prStatusLabel = getPrStatusLabel(
			currentState.prState,
			currentState.prIsDraft,
			currentState.prReviewDecision,
			currentState.prMergeStateStatus,
		);
		const prStateColor = prStatusLabel === "merged" || prStatusLabel === "ready-to-merge"
			? "success"
			: prStatusLabel === "open"
				? "warning"
				: "muted";
		parts.push(theme.fg(prStateColor, prStatusLabel));
	}
	if (currentState.prChecksStatus) {
		const checksLabel = currentState.prChecksStatus === "passing"
			? theme.fg("success", "checks ✓")
			: currentState.prChecksStatus === "failing"
				? theme.fg("error", "checks ✗")
				: theme.fg("warning", "checks …");
		parts.push(checksLabel);
	}
	ctx.ui.setStatus("worktree", parts.join(theme.fg("dim", " • ")));
}

// ── Extension entry point ───────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
	stopPrMetadataRefresh();

	// ── Tool path rewriting ───────────────────────────────────────────
	// bash/read/write/edit are already handled by the user's global worktree
	// extension at ~/.pi/agent/extensions/worktree.ts. For find/grep/ls, avoid
	// re-registering the tools here so custom overrides like pi-fff can win
	// without conflicts. Instead, rewrite relative path arguments for the
	// built-in implementations at call time against the current process.cwd().

	function resolvePathForCurrentWorktree(path: string): string {
		const normalizedPath = path.startsWith("@") ? path.slice(1) : path;
		if (!normalizedPath || normalizedPath.startsWith("/") || normalizedPath.startsWith("~")) return normalizedPath;
		return resolve(process.cwd(), normalizedPath);
	}

	function getActiveToolSource(toolName: string): string | null {
		const matchingTools = pi.getAllTools().filter((tool) => tool.name === toolName);
		return matchingTools.length > 0 ? matchingTools[matchingTools.length - 1]!.sourceInfo.source : null;
	}

	pi.on("tool_call", async (event) => {
		if (event.toolName !== "find" && event.toolName !== "grep" && event.toolName !== "ls") return;
		if (getActiveToolSource(event.toolName) !== "builtin") return;

		const input = event.input as { path?: unknown };
		if (typeof input.path !== "string") return;

		const rewrittenPath = resolvePathForCurrentWorktree(input.path);
		if (rewrittenPath !== input.path) input.path = rewrittenPath;
	});

	// ── System prompt patch ───────────────────────────────────────────

	pi.on("before_agent_start", async (event, _ctx) => {
		const currentCwd = process.cwd();
		if (currentCwd !== originalCwd) {
			return {
				systemPrompt: event.systemPrompt.replaceAll(originalCwd, currentCwd),
			};
		}
	});

	pi.registerTool({
		name: "worktree_create",
		label: "Worktree Create",
		description: "Create or reuse a git worktree from a branch name, PR number, or GitHub PR URL.",
		promptSnippet: "Create or reuse a git worktree for a branch, PR number, or PR URL and return its path.",
		promptGuidelines: [
			"Use this instead of shelling out to git worktree when you want the worktree extension's PR resolution and reuse behavior.",
			"Use the returned worktreePath for follow-up work; this tool does not switch the active Pi session.",
			"Set targetKind to branch when target should be interpreted literally as a branch name instead of a PR reference or the main-worktree alias.",
		],
		parameters: Type.Object({
			target: Type.String({ description: "Branch name, PR number, or GitHub PR URL." }),
			targetKind: Type.Optional(
				Type.Union([
					Type.Literal("auto"),
					Type.Literal("branch"),
				], { description: "How to interpret target. Use branch to force target to be treated as a branch name. Defaults to auto." }),
			),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const target = params.target.trim();
			if (!target) {
				throw new Error("target must not be empty");
			}

			const targetKind = params.targetKind === "branch" ? "branch" : "auto";
			const details = { target, targetKind };
			if (target === "main" && targetKind !== "branch") {
				if (signal?.aborted) {
					return {
						content: [{ type: "text", text: "Worktree creation cancelled." }],
						details: { ...details, cancelled: true },
					};
				}
				const mainRoot = getMainWorktreeRoot();
				const mainBranch = getMainBranch(mainRoot);
				return {
					content: [{ type: "text", text: `Main worktree: ${mainRoot}` }],
					details: {
						...details,
						branch: mainBranch,
						worktreePath: mainRoot,
					},
				};
			}
			const result = await ensureWorktree(ctx, target, [], signal, targetKind);
			if (result.kind === "cancelled") {
				return {
					content: [{ type: "text", text: "Worktree creation cancelled." }],
					details: { ...details, cancelled: true },
				};
			}

			if (result.kind === "main") {
				return {
					content: [{ type: "text", text: `Main worktree: ${result.mainRoot}` }],
					details: {
						...details,
						branch: result.mainBranch,
						worktreePath: result.mainRoot,
					},
				};
			}

			const lines = [
				`${result.created ? "Created" : "Reused"} worktree: ${result.state.worktreePath}`,
				`Branch: ${result.state.branch}`,
			];
			if (result.state.prUrl) lines.push(`PR: ${result.state.prUrl}`);

			return {
				content: [{ type: "text", text: lines.join("\n") }],
				details: {
					...details,
					branch: result.state.branch,
					worktreePath: result.state.worktreePath,
					prNumber: result.state.prNumber,
					prUrl: result.state.prUrl,
					created: result.created,
				},
			};
		},
	});

	// ── /wt command ───────────────────────────────────────────────────

	pi.registerCommand("wt", {
		description: "Interactively switch to an existing git worktree",
		handler: async (args, ctx) => {
			const input = args.trim();
			if (input === "--help") {
				ctx.ui.notify(
					[
						"Usage: /wt",
						"",
						"Opens a popup overlay listing git worktrees with PR metadata.",
						"Select one and press Enter to switch into it.",
					].join("\n"),
					"info",
				);
				return;
			}
			if (input) {
				ctx.ui.notify("Usage: /wt", "error");
				return;
			}

			let selected: WorktreeListItem | null;
			try {
				selected = await showWorktreeSelector(ctx);
			} catch (e: any) {
				ctx.ui.notify(`Failed to open worktree selector: ${e.message}`, "error");
				return;
			}
			if (!selected) return;

			if (selected.isMain) {
				await switchToMainWorktree(ctx, selected.worktreePath, selected.branch);
				return;
			}

			await switchToExistingWorktree(ctx, {
				worktreePath: selected.worktreePath,
				branch: selected.branch,
				prNumber: selected.prNumber,
				prUrl: selected.prUrl,
				prState: selected.prState,
				prChecksStatus: selected.prChecksStatus,
				prIsDraft: selected.prIsDraft,
				prReviewDecision: selected.prReviewDecision,
				prMergeStateStatus: selected.prMergeStateStatus,
			}, ctx.signal);
		},
	});

	// ── /worktree command ─────────────────────────────────────────────

	pi.registerCommand("worktree", {
		description: "Switch to a git worktree. Usage: /worktree <branch|PR#|PR-URL> [--shared|--isolated]",
		handler: async (args, ctx) => {
			const input = args.trim();

			if (!input || input === "--help") {
				ctx.ui.notify(
					[
						"Usage: /worktree <branch|PR#|PR-URL> [flags]",
						"",
						"  /worktree feat/my-feature",
						"  /worktree 425",
						"  /worktree https://github.com/owner/repo/pull/425",
						"  /worktree main                    (switch back to main worktree)",
						"  /worktree archive                 (run local conductor archive script)",
						"  /worktree --list                  (list worktrees)",
						"",
						"Flags (passed to alto worktree new only):",
						"  --shared     request shared setup during creation",
						"  --isolated   request isolated setup during creation",
						"",
						"After switching, local conductor.json scripts.setup is used if present.",
					].join("\n"),
					"info",
				);
				return;
			}

			if (input === "--list") {
				try {
					const output = execSync("git worktree list", { encoding: "utf-8", timeout: 5_000 });
					ctx.ui.notify(output.trim(), "info");
				} catch (e: any) {
					ctx.ui.notify(`Failed to list worktrees: ${e.message}`, "error");
				}
				return;
			}

			if (input === "archive" || input === "--archive") {
				if (!currentState) {
					ctx.ui.notify("No active worktree to archive.", "error");
					return;
				}

				const activeState = currentState;
				const mainRoot = getMainWorktreeRoot();

				let conductorScripts: ConductorScripts | null;
				try {
					conductorScripts = readConductorScripts(activeState.worktreePath);
				} catch (e: any) {
					ctx.ui.notify(e.message, "error");
					return;
				}

				if (!conductorScripts?.archive) {
					ctx.ui.notify(
						`No scripts.archive found in ${conductorScripts?.path ?? resolve(activeState.worktreePath, "conductor.json")}`,
						"error",
					);
					return;
				}

				const result = await runCommandWithLoader(
					ctx,
					`Archiving worktree ${activeState.branch}...`,
					conductorScripts.archive,
					activeState.worktreePath,
				);

				if (!result) {
					ctx.ui.notify("Worktree archive cancelled.", "info");
					return;
				}

				if (!result.ok) {
					ctx.ui.notify(`Failed to archive worktree:\n${result.output}`, "error");
					return;
				}

				try {
					process.chdir(mainRoot);
				} catch (e: any) {
					currentState = null;
					syncPrMetadataRefresh(ctx);
					updateStatus(ctx);
					ctx.ui.notify(`Archived worktree, but failed to switch back to main worktree: ${e.message}`, "warning");
					return;
				}

				currentState = null;
				syncPrMetadataRefresh(ctx);
				updateStatus(ctx);
				ctx.ui.notify(`Archived worktree ${activeState.branch} and switched to main worktree: ${mainRoot}`, "success");
				return;
			}

			// Parse arguments
			const tokens = input.split(/\s+/);
			const flags: WorktreeCreateFlag[] = [];
			let target = "";
			for (const tok of tokens) {
				if (tok.startsWith("--")) {
					if (tok === "--shared" || tok === "--isolated") {
						flags.push(tok);
					} else {
						ctx.ui.notify(`Unsupported flag: ${tok}`, "error");
						return;
					}
				} else if (!target) {
					target = tok;
				}
			}

			if (!target) {
				ctx.ui.notify("Please provide a branch name, PR number, or PR URL.", "error");
				return;
			}

			let worktreeResult: EnsuredWorktreeResult;
			try {
				worktreeResult = await ensureWorktree(ctx, target, flags, ctx.signal);
			} catch (e: any) {
				ctx.ui.notify(e.message, "error");
				return;
			}

			if (worktreeResult.kind === "cancelled") {
				ctx.ui.notify("Worktree creation cancelled.", "info");
				return;
			}

			if (worktreeResult.kind === "main") {
				await switchToMainWorktree(ctx, worktreeResult.mainRoot, worktreeResult.mainBranch);
				return;
			}

			await switchToExistingWorktree(ctx, worktreeResult.state, ctx.signal);
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		restoreSessionWorktreeState(ctx);
	});

	pi.on("session_switch", async (_event, ctx) => {
		stopPrMetadataRefresh();
		currentState = null;
		updateStatus(ctx);
	});

	pi.on("session_fork", async (_event, ctx) => {
		stopPrMetadataRefresh();
		currentState = null;
		updateStatus(ctx);
	});

	pi.on("session_shutdown", async () => {
		stopPrMetadataRefresh();
	});
}
