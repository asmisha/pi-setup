import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import {
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
	formatSize,
	truncateHead,
} from "@mariozechner/pi-coding-agent";

const MAX_BASH_OUTPUT_LINES = Math.min(DEFAULT_MAX_LINES, 160);
const MAX_BASH_OUTPUT_BYTES = Math.min(DEFAULT_MAX_BYTES, 12_000);

function truncateBashText(text: string): string {
	const truncated = truncateHead(text, {
		maxLines: MAX_BASH_OUTPUT_LINES,
		maxBytes: MAX_BASH_OUTPUT_BYTES,
	});
	if (!truncated.truncated) return text;
	return `${truncated.content}\n\n[Bash output guard: truncated to ${truncated.outputLines}/${truncated.totalLines} lines, ${formatSize(truncated.outputBytes)}/${formatSize(truncated.totalBytes)}. If more output is needed, rerun the command with explicit filters or redirect it to a temp file and inspect that file with read.]`;
}

export default function bashOutputGuard(pi: ExtensionAPI) {
	pi.on("tool_result", async (event) => {
		if (event.toolName !== "bash") return;

		let changed = false;
		const content = event.content.map((item) => {
			if (item.type !== "text") return item;
			const nextText = truncateBashText(item.text);
			if (nextText === item.text) return item;
			changed = true;
			return { ...item, text: nextText };
		});

		if (!changed) return;
		return { content };
	});
}
