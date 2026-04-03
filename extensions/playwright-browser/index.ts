import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import {
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
	formatSize,
	truncateHead,
} from "@mariozechner/pi-coding-agent";
import { StringEnum } from "@mariozechner/pi-ai";
import { Type } from "@sinclair/typebox";
import {
	chromium,
	type Browser,
	type BrowserContext,
	type Page,
} from "playwright";

type WaitUntil = "commit" | "domcontentloaded" | "load" | "networkidle";
type WaitForSelectorState = "attached" | "detached" | "visible" | "hidden";

interface BrowserRuntime {
	browser: Browser;
	context: BrowserContext;
	page: Page;
}

interface PageMetadata {
	url: string;
	title: string;
}

interface PageSnapshot extends PageMetadata {
	readyState: string;
	viewport: { width: number; height: number };
	buttonCount: number;
	buttons: Array<{ text: string; selectorHint: string; disabled: boolean }>;
	inputCount: number;
	inputs: Array<{ label: string; selectorHint: string; type: string; hasValue: boolean }>;
	linkCount: number;
	links: Array<{ text: string; href: string; selectorHint: string }>;
	textExcerpt: string;
}

const DEFAULT_VIEWPORT = { width: 1440, height: 900 };
let runtime: BrowserRuntime | null = null;

function truncateText(text: string): string {
	const truncated = truncateHead(text, {
		maxLines: Math.min(DEFAULT_MAX_LINES, 400),
		maxBytes: Math.min(DEFAULT_MAX_BYTES, 20_000),
	});
	if (!truncated.truncated) return truncated.content;
	return `${truncated.content}\n\n[Output truncated: ${truncated.outputLines}/${truncated.totalLines} lines, ${formatSize(truncated.outputBytes)}/${formatSize(truncated.totalBytes)}]`;
}

function requirePage(): Page {
	if (!runtime || runtime.page.isClosed()) {
		throw new Error("No browser page is open. Call browser_open first.");
	}
	return runtime.page;
}

async function closeRuntime(): Promise<void> {
	const current = runtime;
	runtime = null;
	if (!current) return;
	try {
		await current.browser.close();
	} catch {
		// Ignore cleanup errors.
	}
}

async function readPageMetadata(page: Page): Promise<PageMetadata> {
	return {
		url: page.url(),
		title: await page.title(),
	};
}

async function readPageSnapshot(page: Page): Promise<PageSnapshot> {
	const metadata = await readPageMetadata(page);
	const snapshot = await page.evaluate(() => {
		const collapse = (value: string | null | undefined) => (value ?? "").replace(/\s+/g, " ").trim();
		const clip = (value: string | null | undefined, max: number) => collapse(value).slice(0, max);
		const escapeCssIdentifier = (value: string) => {
			if (window.CSS && typeof window.CSS.escape === "function") return window.CSS.escape(value);
			return value.replace(/[^a-zA-Z0-9_-]/g, (char) => `\\${char}`);
		};
		const escapeCssAttribute = (value: string) => value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
		const nthOfType = (element: Element) => {
			let index = 1;
			let sibling = element.previousElementSibling;
			while (sibling) {
				if (sibling.tagName === element.tagName) index += 1;
				sibling = sibling.previousElementSibling;
			}
			return index;
		};
		const buildCssPath = (element: Element) => {
			const segments: string[] = [];
			let current: Element | null = element;
			while (current && current.tagName.toLowerCase() !== "html") {
				const html = current as HTMLElement;
				if (html.id) {
					segments.unshift(`#${escapeCssIdentifier(html.id)}`);
					break;
				}
				segments.unshift(`${html.tagName.toLowerCase()}:nth-of-type(${nthOfType(html)})`);
				current = html.parentElement;
				if (current?.tagName.toLowerCase() === "body") {
					segments.unshift("body");
					break;
				}
			}
			return segments.join(" > ");
		};
		const isVisible = (element: Element) => {
			const html = element as HTMLElement;
			const style = window.getComputedStyle(html);
			const rect = html.getBoundingClientRect();
			return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
		};
		const selectorHint = (element: Element) => {
			const html = element as HTMLElement;
			if (html.id) return `#${escapeCssIdentifier(html.id)}`;
			const testId = html.getAttribute("data-testid");
			if (testId) return `[data-testid=\"${escapeCssAttribute(testId)}\"]`;
			const name = html.getAttribute("name");
			if (name) return `[name=\"${escapeCssAttribute(name)}\"]`;
			const ariaLabel = html.getAttribute("aria-label");
			if (ariaLabel) return `[aria-label=\"${escapeCssAttribute(ariaLabel)}\"]`;
			return buildCssPath(html);
		};
		const labelForInput = (element: Element) => {
			const html = element as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
			const ariaLabel = clip(html.getAttribute("aria-label"), 80);
			if (ariaLabel) return ariaLabel;
			if (html.id) {
				const label = document.querySelector(`label[for=\"${escapeCssAttribute(html.id)}\"]`);
				const text = clip(label?.textContent, 80);
				if (text) return text;
			}
			const placeholder = clip(html.getAttribute("placeholder"), 80);
			if (placeholder) return placeholder;
			const name = clip(html.getAttribute("name"), 80);
			if (name) return name;
			return selectorHint(html);
		};

		const visibleButtons = Array.from(document.querySelectorAll("button, [role='button'], input[type='button'], input[type='submit']"))
			.filter(isVisible);
		const buttons = visibleButtons
			.slice(0, 10)
			.map((element) => {
				const html = element as HTMLButtonElement | HTMLInputElement;
				return {
					text: clip(html.innerText || html.value || html.getAttribute("aria-label"), 120),
					selectorHint: selectorHint(html),
					disabled: html.hasAttribute("disabled") || html.getAttribute("aria-disabled") === "true",
				};
			});

		const visibleInputs = Array.from(document.querySelectorAll("input, textarea, select"))
			.filter(isVisible);
		const inputs = visibleInputs
			.slice(0, 10)
			.map((element) => {
				const html = element as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
				return {
					label: labelForInput(html),
					selectorHint: selectorHint(html),
					type: html instanceof HTMLInputElement ? html.type : html.tagName.toLowerCase(),
					hasValue: "value" in html && String(html.value ?? "").length > 0,
				};
			});

		const visibleLinks = Array.from(document.querySelectorAll("a[href]"))
			.filter(isVisible);
		const links = visibleLinks
			.slice(0, 10)
			.map((element) => {
				const html = element as HTMLAnchorElement;
				return {
					text: clip(html.innerText || html.getAttribute("aria-label") || html.href, 120),
					href: html.href,
					selectorHint: selectorHint(html),
				};
			});

		return {
			readyState: document.readyState,
			viewport: { width: window.innerWidth, height: window.innerHeight },
			buttonCount: visibleButtons.length,
			buttons,
			inputCount: visibleInputs.length,
			inputs,
			linkCount: visibleLinks.length,
			links,
			textExcerpt: clip(document.body?.innerText, 1_500),
		};
	});

	return {
		...metadata,
		...snapshot,
	};
}

function formatSnapshot(snapshot: PageSnapshot): string {
	const lines = [
		`URL: ${snapshot.url}`,
		`Title: ${snapshot.title || "(untitled)"}`,
		`Ready state: ${snapshot.readyState}`,
		`Viewport: ${snapshot.viewport.width}x${snapshot.viewport.height}`,
	];

	if (snapshot.buttons.length > 0) {
		lines.push("", `Buttons (${snapshot.buttonCount}):`);
		for (const button of snapshot.buttons) {
			const suffix = button.disabled ? " [disabled]" : "";
			lines.push(`- ${button.selectorHint}: ${button.text || "(no text)"}${suffix}`);
		}
		if (snapshot.buttonCount > snapshot.buttons.length) {
			lines.push(`- ... ${snapshot.buttonCount - snapshot.buttons.length} more not shown`);
		}
	}

	if (snapshot.inputs.length > 0) {
		lines.push("", `Inputs (${snapshot.inputCount}):`);
		for (const input of snapshot.inputs) {
			const suffix = input.hasValue ? " [filled]" : "";
			lines.push(`- ${input.selectorHint} (${input.type}): ${input.label}${suffix}`);
		}
		if (snapshot.inputCount > snapshot.inputs.length) {
			lines.push(`- ... ${snapshot.inputCount - snapshot.inputs.length} more not shown`);
		}
	}

	if (snapshot.links.length > 0) {
		lines.push("", `Links (${snapshot.linkCount}):`);
		for (const link of snapshot.links) {
			lines.push(`- ${link.selectorHint}: ${link.text || "(no text)"} -> ${link.href}`);
		}
		if (snapshot.linkCount > snapshot.links.length) {
			lines.push(`- ... ${snapshot.linkCount - snapshot.links.length} more not shown`);
		}
	}

	if (snapshot.textExcerpt) {
		lines.push("", "Visible text excerpt:", snapshot.textExcerpt);
	}

	return truncateText(lines.join("\n"));
}

export default function playwrightBrowser(pi: ExtensionAPI) {
	const closeForSessionBoundary = async () => {
		await closeRuntime();
	};

	pi.on("session_switch", closeForSessionBoundary);
	pi.on("session_fork", closeForSessionBoundary);
	pi.on("session_shutdown", closeForSessionBoundary);

	pi.registerTool({
		name: "browser_open",
		label: "Browser Open",
		description: "Open a fresh Playwright browser session and navigate to a URL.",
		promptSnippet: "Open a fresh Playwright browser page at a URL for UI debugging.",
		promptGuidelines: ["Call browser_open before browser_snapshot, browser_click, browser_type, browser_wait, browser_eval, or browser_screenshot if no browser page is active."],
		parameters: Type.Object({
			url: Type.String({ description: "URL to open." }),
			headless: Type.Optional(Type.Boolean({ description: "Whether to run Chromium headless. Defaults to true." })),
			viewportWidth: Type.Optional(Type.Number({ description: "Viewport width in CSS pixels. Defaults to 1440." })),
			viewportHeight: Type.Optional(Type.Number({ description: "Viewport height in CSS pixels. Defaults to 900." })),
			waitUntil: Type.Optional(StringEnum(["commit", "domcontentloaded", "load", "networkidle"] as const)),
		}),
		async execute(_toolCallId, params) {
			await closeRuntime();

			const browser = await chromium.launch({ headless: params.headless ?? true });
			try {
				const context = await browser.newContext({
					viewport: {
						width: Math.max(1, Math.round(params.viewportWidth ?? DEFAULT_VIEWPORT.width)),
						height: Math.max(1, Math.round(params.viewportHeight ?? DEFAULT_VIEWPORT.height)),
					},
				});
				const page = await context.newPage();
				await page.goto(params.url, { waitUntil: (params.waitUntil ?? "load") as WaitUntil });
				runtime = { browser, context, page };
				const metadata = await readPageMetadata(page);
				return {
					content: [{ type: "text", text: `Opened a fresh browser session at ${metadata.title || "(untitled)"} (${metadata.url}).` }],
					details: { action: "open", headless: params.headless ?? true, waitUntil: params.waitUntil ?? "load", ...metadata },
				};
			} catch (error) {
				await browser.close().catch(() => undefined);
				throw error;
			}
		},
	});

	pi.registerTool({
		name: "browser_snapshot",
		label: "Browser Snapshot",
		description: "Return a readable summary of the current page state for UI debugging.",
		promptSnippet: "Inspect the current page state, including visible controls, links, and a text excerpt.",
		parameters: Type.Object({}),
		async execute() {
			const page = requirePage();
			const snapshot = await readPageSnapshot(page);
			return {
				content: [{ type: "text", text: formatSnapshot(snapshot) }],
				details: { action: "snapshot", ...snapshot },
			};
		},
	});

	pi.registerTool({
		name: "browser_click",
		label: "Browser Click",
		description: "Click an element in the current Playwright page.",
		promptSnippet: "Click a page element by selector in the active browser session.",
		parameters: Type.Object({
			selector: Type.String({ description: "Playwright-compatible selector to click." }),
		}),
		async execute(_toolCallId, params) {
			const page = requirePage();
			const context = runtime?.context;
			const popupPromise = context
				? context.waitForEvent("page", { timeout: 500 }).catch(() => undefined)
				: Promise.resolve(undefined);
			await page.locator(params.selector).click();
			const popupPage = await popupPromise;
			if (popupPage && runtime && context) {
				runtime = { ...runtime, context, page: popupPage };
			}
			const metadata = await readPageMetadata(requirePage());
			return {
				content: [{ type: "text", text: `Clicked ${params.selector}. Now at ${metadata.title || "(untitled)"} (${metadata.url}).` }],
				details: { action: "click", selector: params.selector, ...metadata },
			};
		},
	});

	pi.registerTool({
		name: "browser_type",
		label: "Browser Type",
		description: "Type or fill text into an element in the current Playwright page.",
		promptSnippet: "Fill or type text into a page element by selector in the active browser session.",
		parameters: Type.Object({
			selector: Type.String({ description: "Playwright-compatible selector to type into." }),
			text: Type.String({ description: "Text to enter." }),
			clear: Type.Optional(Type.Boolean({ description: "Clear the field before entering text. Defaults to true." })),
		}),
		async execute(_toolCallId, params) {
			const page = requirePage();
			const locator = page.locator(params.selector);
			if (params.clear === false) {
				await locator.focus();
				await page.keyboard.type(params.text);
			} else {
				await locator.fill(params.text);
			}
			const metadata = await readPageMetadata(page);
			return {
				content: [{ type: "text", text: `Entered text into ${params.selector}. Current page: ${metadata.title || "(untitled)"} (${metadata.url}).` }],
				details: { action: "type", selector: params.selector, textLength: params.text.length, clear: params.clear !== false, ...metadata },
			};
		},
	});

	pi.registerTool({
		name: "browser_wait",
		label: "Browser Wait",
		description: "Wait for time to pass or for a selector to reach a given state.",
		promptSnippet: "Wait for page state to settle or for an element to appear, disappear, or become visible.",
		parameters: Type.Object({
			selector: Type.Optional(Type.String({ description: "Optional selector to wait for." })),
			state: Type.Optional(StringEnum(["attached", "detached", "visible", "hidden"] as const)),
			timeoutMs: Type.Optional(Type.Number({ description: "Timeout in milliseconds. Used as wait duration or selector timeout." })),
		}),
		async execute(_toolCallId, params) {
			const page = requirePage();
			if (params.selector) {
				const state = (params.state ?? "visible") as WaitForSelectorState;
				await page.locator(params.selector).waitFor({
					state,
					timeout: Math.max(0, Math.round(params.timeoutMs ?? 5_000)),
				});
				const metadata = await readPageMetadata(page);
				return {
					content: [{ type: "text", text: `Waited for ${params.selector} to become ${state}. Current page: ${metadata.title || "(untitled)"} (${metadata.url}).` }],
					details: { action: "wait", selector: params.selector, state, timeoutMs: Math.max(0, Math.round(params.timeoutMs ?? 5_000)), ...metadata },
				};
			}

			const timeoutMs = Math.max(0, Math.round(params.timeoutMs ?? 1_000));
			await page.waitForTimeout(timeoutMs);
			const metadata = await readPageMetadata(page);
			return {
				content: [{ type: "text", text: `Waited ${timeoutMs}ms. Current page: ${metadata.title || "(untitled)"} (${metadata.url}).` }],
				details: { action: "wait", timeoutMs, ...metadata },
			};
		},
	});

	pi.registerTool({
		name: "browser_eval",
		label: "Browser Eval",
		description: "Evaluate a small JavaScript expression inside the current page.",
		promptSnippet: "Run a small JavaScript expression inside the active page for targeted DOM inspection.",
		parameters: Type.Object({
			expression: Type.String({ description: "A JavaScript expression to evaluate in the page context." }),
		}),
		async execute(_toolCallId, params) {
			const page = requirePage();
			const evaluation = await page.evaluate(async (expression) => {
				const escapeCssIdentifier = (value: string) => {
					if (window.CSS && typeof window.CSS.escape === "function") return window.CSS.escape(value);
					return value.replace(/[^a-zA-Z0-9_-]/g, (char) => `\\${char}`);
				};
				const nthOfType = (element: Element) => {
					let index = 1;
					let sibling = element.previousElementSibling;
					while (sibling) {
						if (sibling.tagName === element.tagName) index += 1;
						sibling = sibling.previousElementSibling;
					}
					return index;
				};
				const buildCssPath = (element: Element) => {
					const segments: string[] = [];
					let current: Element | null = element;
					while (current && current.tagName.toLowerCase() !== "html") {
						const html = current as HTMLElement;
						if (html.id) {
							segments.unshift(`#${escapeCssIdentifier(html.id)}`);
							break;
						}
						segments.unshift(`${html.tagName.toLowerCase()}:nth-of-type(${nthOfType(html)})`);
						current = html.parentElement;
						if (current?.tagName.toLowerCase() === "body") {
							segments.unshift("body");
							break;
						}
					}
					return segments.join(" > ");
				};
				const serialize = (value: unknown, seen = new WeakSet<object>()): unknown => {
					if (value === null || value === undefined) return value;
					if (typeof value === "bigint") return `${value.toString()}n`;
					if (typeof value === "function") return `[Function ${value.name || "anonymous"}]`;
					if (typeof value !== "object") return value;
					if (value instanceof Error) {
						return {
							name: value.name,
							message: value.message,
							stack: value.stack,
						};
					}
					if (value instanceof Element) {
						return {
							type: value.tagName.toLowerCase(),
							selectorHint: value.id ? `#${escapeCssIdentifier(value.id)}` : buildCssPath(value),
							text: (value.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 200),
							outerHTML: value.outerHTML.slice(0, 500),
						};
					}
					if (seen.has(value as object)) return "[Circular]";
					seen.add(value as object);
					if (Array.isArray(value)) return value.map((item) => serialize(item, seen));
					const entries = Object.entries(value as Record<string, unknown>);
					return Object.fromEntries(entries.map(([key, item]) => [key, serialize(item, seen)]));
				};

				const evaluated = (0, eval)(expression);
				const raw = evaluated && typeof evaluated === "object" && "then" in evaluated && typeof evaluated.then === "function"
					? await evaluated
					: evaluated;
				const serialized = serialize(raw);
				const text = typeof serialized === "string" ? serialized : JSON.stringify(serialized, null, 2) ?? String(serialized);
				return {
					text,
					valueType: raw === null ? "null" : Array.isArray(raw) ? "array" : typeof raw,
				};
			}, params.expression);
			const output = truncateText(`Expression: ${params.expression}\n\nResult:\n${evaluation.text ?? "undefined"}`);
			const metadata = await readPageMetadata(page);
			return {
				content: [{ type: "text", text: output }],
				details: { action: "eval", expression: params.expression, valueType: evaluation.valueType, preview: truncateText(evaluation.text ?? "undefined"), ...metadata },
			};
		},
	});

	pi.registerTool({
		name: "browser_screenshot",
		label: "Browser Screenshot",
		description: "Capture a screenshot of the current Playwright page.",
		promptSnippet: "Capture a screenshot of the active browser page as visual debugging evidence.",
		parameters: Type.Object({
			fullPage: Type.Optional(Type.Boolean({ description: "Capture the full page instead of only the viewport. Defaults to true." })),
		}),
		async execute(_toolCallId, params) {
			const page = requirePage();
			const metadata = await readPageMetadata(page);
			const image = await page.screenshot({
				fullPage: params.fullPage ?? true,
				type: "png",
			});
			return {
				content: [
					{ type: "text", text: `Captured a screenshot of ${metadata.title || "(untitled)"} (${metadata.url}).` },
					{ type: "image", data: image.toString("base64"), mimeType: "image/png" },
				],
				details: { action: "screenshot", fullPage: params.fullPage ?? true, ...metadata },
			};
		},
	});

	pi.registerTool({
		name: "browser_close",
		label: "Browser Close",
		description: "Close the current Playwright browser session.",
		promptSnippet: "Close the active browser session and discard its page state.",
		parameters: Type.Object({}),
		async execute() {
			await closeRuntime();
			return {
				content: [{ type: "text", text: "Closed the browser session." }],
				details: { action: "close" },
			};
		},
	});
}
