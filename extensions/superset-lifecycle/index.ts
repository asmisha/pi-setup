import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const EXTENSION_ID = "superset-lifecycle";
type HookEvent = "Start" | "Stop" | "PermissionRequest";

function isTruthyEnv(value: string | undefined): boolean {
	return value !== undefined && !/^(0|false)$/i.test(value.trim());
}

function getSupersetEnv() {
	return {
		paneId: process.env.SUPERSET_PANE_ID,
		tabId: process.env.SUPERSET_TAB_ID,
		workspaceId: process.env.SUPERSET_WORKSPACE_ID,
		port: process.env.SUPERSET_PORT,
		env: process.env.SUPERSET_ENV,
		version: process.env.SUPERSET_HOOK_VERSION,
		debug: isTruthyEnv(process.env.SUPERSET_DEBUG_HOOKS),
	};
}

function isSupersetTerminal() {
	const superset = getSupersetEnv();
	return Boolean(superset.paneId || superset.tabId || superset.workspaceId);
}

async function sendSupersetHook(eventType: HookEvent): Promise<void> {
	const superset = getSupersetEnv();
	if (!isSupersetTerminal()) return;
	if (!superset.port) return;

	const url = new URL(`http://127.0.0.1:${superset.port}/hook/complete`);
	const params: Record<string, string | undefined> = {
		paneId: superset.paneId,
		tabId: superset.tabId,
		workspaceId: superset.workspaceId,
		eventType,
		env: superset.env,
		version: superset.version,
	};

	for (const [key, value] of Object.entries(params)) {
		if (typeof value === "string" && value.length > 0) {
			url.searchParams.set(key, value);
		}
	}

	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), 1500);

	try {
		const response = await fetch(url.toString(), {
			method: "GET",
			signal: controller.signal,
		});

		if (superset.debug && !response.ok) {
			console.warn(
				`[${EXTENSION_ID}] hook ${eventType} failed with status ${response.status}`,
			);
		}
	} catch (error) {
		if (superset.debug) {
			console.warn(`[${EXTENSION_ID}] hook ${eventType} failed`, error);
		}
	} finally {
		clearTimeout(timeout);
	}
}

export default function supersetLifecycle(pi: ExtensionAPI) {
	if (process.argv.includes("--no-session")) {
		return;
	}

	let activeAgents = 0;

	const start = async () => {
		activeAgents += 1;
		if (activeAgents === 1) {
			await sendSupersetHook("Start");
		}
	};

	const stop = async () => {
		activeAgents = Math.max(0, activeAgents - 1);
		if (activeAgents === 0) {
			await sendSupersetHook("Stop");
		}
	};

	pi.on("agent_start", async () => {
		await start();
	});

	pi.on("agent_end", async () => {
		await stop();
	});

	pi.on("session_shutdown", async () => {
		const wasActive = activeAgents > 0;
		activeAgents = 0;
		if (wasActive) {
			await sendSupersetHook("Stop");
		}
	});

	pi.registerCommand("superset-hook-test", {
		description: "Send a test Start/Stop lifecycle hook to Superset",
		handler: async (_args, ctx) => {
			if (!isSupersetTerminal()) {
				ctx.ui.notify(
					"Not running inside a Superset terminal; no hook sent.",
					"warning",
				);
				return;
			}

			const { port, paneId, tabId, workspaceId } = getSupersetEnv();
			if (!port) {
				ctx.ui.notify(
					"SUPERSET_PORT is missing; cannot send lifecycle hook.",
					"error",
				);
				return;
			}

			await sendSupersetHook("Start");
			await new Promise((resolve) => setTimeout(resolve, 250));
			await sendSupersetHook("Stop");

			ctx.ui.notify(
				`Sent Superset lifecycle test (${workspaceId ?? "no workspace"} · ${tabId ?? "no tab"} · ${paneId ?? "no pane"})`,
				"info",
			);
		},
	});
}
