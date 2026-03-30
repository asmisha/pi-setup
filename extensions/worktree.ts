/**
 * Worktree Extension — /worktree command
 *
 * Accepts a branch name, PR number, or PR URL.
 * Creates (or reuses) a git worktree, then switches pi's working directory into it.
 *
 * If the project has scripts/create-worktree.sh it delegates to that script;
 * otherwise it falls back to plain `git worktree add`.
 *
 * Worktrees are placed in ../<repo-dir>-wt/<sanitized-branch>.
 *
 * The status bar shows the branch and PR link (if applicable).
 *
 * To make tools work in the new directory, the extension:
 * - Overrides bash with a spawnHook that uses process.cwd() at call time
 * - Overrides read/write/edit to resolve relative paths against process.cwd()
 * - Patches the system prompt to tell the LLM the correct cwd
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import {
	createBashTool,
	createReadTool,
	createWriteTool,
	createEditTool,
	BorderedLoader,
} from "@mariozechner/pi-coding-agent";
import { execSync, spawn as nodeSpawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve, basename, isAbsolute } from "node:path";

interface WorktreeState {
	worktreePath: string;
	branch: string;
	prNumber: number | null;
	prUrl: string | null;
	repo: string | null;
}

/** The cwd when pi started — used to detect drift and patch system prompt. */
const originalCwd = process.cwd();

let currentState: WorktreeState | null = null;

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

function getPrBranch(prNumber: number, repo: string | null): { branch: string; url: string; repoSlug: string } {
	const repoFlag = repo ? `--repo ${repo}` : "";
	const json = execSync(`gh pr view ${prNumber} ${repoFlag} --json headRefName,url,headRepositoryOwner`, {
		encoding: "utf-8",
		timeout: 15_000,
	}).trim();
	const data = JSON.parse(json);
	const urlMatch = data.url?.match(/github\.com\/([^/]+\/[^/]+)\//);
	return {
		branch: data.headRefName,
		url: data.url,
		repoSlug: repo || (urlMatch ? urlMatch[1] : ""),
	};
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

function branchToDirName(branch: string): string {
	return branch.replace(/\//g, "-");
}

// ── Async command runner with abort support ─────────────────────────────

function runCommandAsync(
	command: string,
	options: { cwd?: string; signal?: AbortSignal },
): Promise<{ ok: boolean; output: string }> {
	return new Promise((resolve) => {
		const child = nodeSpawn(command, {
			cwd: options.cwd,
			stdio: ["ignore", "pipe", "pipe"],
			shell: true,
		});

		let output = "";
		child.stdout?.on("data", (chunk: Buffer) => { output += chunk.toString(); });
		child.stderr?.on("data", (chunk: Buffer) => { output += chunk.toString(); });

		const onAbort = () => {
			child.kill("SIGTERM");
			// Give it a moment then force-kill
			setTimeout(() => { if (!child.killed) child.kill("SIGKILL"); }, 3_000);
		};
		options.signal?.addEventListener("abort", onAbort, { once: true });

		child.on("close", (code) => {
			options.signal?.removeEventListener("abort", onAbort);
			resolve({ ok: code === 0, output });
		});
		child.on("error", (err) => {
			options.signal?.removeEventListener("abort", onAbort);
			resolve({ ok: false, output: err.message });
		});
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
	if (currentState.prUrl) {
		parts.push(theme.fg("muted", `PR #${currentState.prNumber}`));
	}
	ctx.ui.setStatus("worktree", parts.join(theme.fg("dim", " • ")));
}

// ── Extension entry point ───────────────────────────────────────────────

export default function (pi: ExtensionAPI) {

	// ── Tool overrides ────────────────────────────────────────────────

	const bashOverride = createBashTool(originalCwd, {
		spawnHook: ({ command, cwd: _capturedCwd, env }) => ({
			command,
			cwd: process.cwd(),
			env,
		}),
	});
	pi.registerTool({
		name: "bash",
		description: bashOverride.description,
		parameters: bashOverride.parameters,
		execute: (id, params, signal, onUpdate, ctx) =>
			bashOverride.execute(id, params, signal, onUpdate),
	});

	function resolvePath(path: string): string {
		if (!path || isAbsolute(path) || path.startsWith("~")) return path;
		return resolve(process.cwd(), path);
	}

	const readBuiltin = createReadTool(originalCwd);
	pi.registerTool({
		name: "read",
		description: readBuiltin.description,
		parameters: readBuiltin.parameters,
		execute: (id, params, signal, onUpdate, ctx) =>
			readBuiltin.execute(id, { ...params, path: resolvePath(params.path) }, signal, onUpdate),
	});

	const writeBuiltin = createWriteTool(originalCwd);
	pi.registerTool({
		name: "write",
		description: writeBuiltin.description,
		parameters: writeBuiltin.parameters,
		execute: (id, params, signal, onUpdate, ctx) =>
			writeBuiltin.execute(id, { ...params, path: resolvePath(params.path) }, signal, onUpdate),
	});

	const editBuiltin = createEditTool(originalCwd);
	pi.registerTool({
		name: "edit",
		description: editBuiltin.description,
		parameters: editBuiltin.parameters,
		execute: (id, params, signal, onUpdate, ctx) =>
			editBuiltin.execute(id, { ...params, path: resolvePath(params.path) }, signal, onUpdate),
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

	// ── /worktree command ─────────────────────────────────────────────

	pi.registerCommand("worktree", {
		description: "Switch to a git worktree. Usage: /worktree <branch|PR#|PR-URL> [--no-db] [--no-seed] [--no-docker] [--no-install]",
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
						"  /worktree --list                  (list worktrees)",
						"",
						"Flags (passed to create-worktree.sh):",
						"  --no-db  --no-seed  --no-docker  --no-install",
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

			// Parse arguments
			const tokens = input.split(/\s+/);
			const flags: string[] = [];
			let target = "";
			for (const tok of tokens) {
				if (tok.startsWith("--")) {
					flags.push(tok);
				} else if (!target) {
					target = tok;
				}
			}

			if (!target) {
				ctx.ui.notify("Please provide a branch name, PR number, or PR URL.", "error");
				return;
			}

			let branch: string;
			let prNumber: number | null = null;
			let prUrl: string | null = null;
			let repoSlug: string | null = null;

			const prInfo = parsePrInput(target);
			if (prInfo) {
				ctx.ui.notify(`Resolving PR #${prInfo.prNumber}...`, "info");
				try {
					const pr = getPrBranch(prInfo.prNumber, prInfo.repo);
					branch = pr.branch;
					prNumber = prInfo.prNumber;
					prUrl = pr.url;
					repoSlug = pr.repoSlug;
					ctx.ui.notify(`PR #${prNumber} → branch: ${branch}`, "info");
				} catch (e: any) {
					ctx.ui.notify(`Failed to resolve PR: ${e.message}`, "error");
					return;
				}
			} else {
				branch = target;
			}

			// Check if switching to main worktree
			const mainRoot = getMainWorktreeRoot();
			const mainBranch = execSync("git -C " + JSON.stringify(mainRoot) + " branch --show-current", {
				encoding: "utf-8",
				timeout: 5_000,
			}).trim();

			if (branch === mainBranch) {
				process.chdir(mainRoot);
				currentState = null;
				updateStatus(ctx);
				ctx.ui.notify(`Switched to main worktree: ${mainRoot}`, "success");
				return;
			}

			// Check if worktree already exists
			let worktreePath = findExistingWorktree(branch);

			// Resolve worktree path: git-registered → dir-on-disk → create new
			const dirName = branchToDirName(branch);
			const repoName = basename(mainRoot);
			const worktreeBase = resolve(mainRoot, "..", `${repoName}-wt`);
			const candidatePath = resolve(worktreeBase, dirName);

			if (worktreePath) {
				ctx.ui.notify(`Worktree found for ${branch}, switching...`, "info");
			} else if (existsSync(candidatePath)) {
				worktreePath = candidatePath;
				ctx.ui.notify(`Worktree directory exists at ${candidatePath}, switching...`, "info");
			} else {
				// Nothing exists — create with a spinner (cancellable with Escape)
				const projectScript = resolve(mainRoot, "scripts/create-worktree.sh");
				const useProjectScript = existsSync(projectScript);

				const createCmd = useProjectScript
					? `bash ${JSON.stringify(projectScript)} ${JSON.stringify(branch)} ${flags.join(" ")}`
					: (() => {
						const branchExists =
							execSync(`git -C ${JSON.stringify(mainRoot)} branch --list ${JSON.stringify(branch)}`, {
								encoding: "utf-8",
							}).trim() ||
							execSync(`git -C ${JSON.stringify(mainRoot)} branch -r --list origin/${JSON.stringify(branch)}`, {
								encoding: "utf-8",
							}).trim();
						return branchExists
							? `git worktree add ${JSON.stringify(candidatePath)} ${JSON.stringify(branch)}`
							: `git worktree add -b ${JSON.stringify(branch)} ${JSON.stringify(candidatePath)}`;
					})();

				const result = await ctx.ui.custom<{ ok: boolean; output: string } | null>(
					(tui, theme, _kb, done) => {
						const loader = new BorderedLoader(
							tui,
							theme,
							`Creating worktree for ${branch}... (Esc to cancel)`,
						);
						loader.onAbort = () => done(null);

						runCommandAsync(createCmd, {
							cwd: mainRoot,
							signal: loader.signal,
						}).then((res) => done(res));

						return loader;
					},
				);

				if (!result) {
					ctx.ui.notify("Worktree creation cancelled.", "info");
					return;
				}

				if (!result.ok) {
					ctx.ui.notify(`Failed to create worktree:\n${result.output}`, "error");
					return;
				}

				worktreePath = candidatePath;
				if (!existsSync(worktreePath)) {
					ctx.ui.notify(`Worktree created but path not found at ${worktreePath}`, "error");
					return;
				}
			}

			try {
				process.chdir(worktreePath);
			} catch (e: any) {
				ctx.ui.notify(`Failed to chdir: ${e.message}`, "error");
				return;
			}

			currentState = {
				worktreePath,
				branch,
				prNumber,
				prUrl,
				repo: repoSlug,
			};

			updateStatus(ctx);

			const parts = [`Switched to worktree: ${worktreePath}`, `Branch: ${branch}`];
			if (prUrl) parts.push(`PR: ${prUrl}`);
			ctx.ui.notify(parts.join("\n"), "success");
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		if (currentState) {
			updateStatus(ctx);
		}
	});
}
