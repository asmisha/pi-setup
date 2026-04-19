import { complete } from "@mariozechner/pi-ai";
import type { ExtensionAPI, ExtensionContext, SessionBeforeCompactEvent, SessionStartEvent, TurnEndEvent } from "@mariozechner/pi-coding-agent";
import { convertToLlm, serializeConversation } from "@mariozechner/pi-coding-agent";
import { buildCompactionPrompt, COMPACTION_SYSTEM_PROMPT, normalizeAdvisory, parseJsonObject, renderAdvisorySummary } from "./src/compaction.ts";
import { MIN_COMPACTION_INTERVAL_MS, SOFT_COMPACTION_THRESHOLD_PERCENT, SUMMARY_MAX_TOKENS } from "./src/config.ts";
import { canSelectCompactionMode, formatPiVccUnavailableMessage, resolveCompactionExecutionMode } from "./src/mode-policy.ts";
import { hasPiVccHandler, invokePiVccHandlers, loadPiVccDelegate } from "./src/pi-vcc.ts";
import { buildCompactionModeEntry, COMPACTION_MODE_ENTRY_TYPE, formatCompactionMode, getCompactionModeChoices, parseCompactionMode, readCompactionMode } from "./src/session-config.ts";

function serializeConversationFragment(messages: unknown[]): string {
  if (!Array.isArray(messages) || messages.length === 0) return "";
  return serializeConversation(convertToLlm(messages as Parameters<typeof convertToLlm>[0]));
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export default function compactionExtension(pi: ExtensionAPI) {
  let previousContextPercent: number | null = null;
  let compactionInFlight = false;
  let lastCompactionAt = 0;
  let warnedPiVccUnavailable = false;

  const resetLocalCompactionState = () => {
    previousContextPercent = null;
    compactionInFlight = false;
  };

  const handleCompactionCompleted = () => {
    resetLocalCompactionState();
    lastCompactionAt = Date.now();
  };

  const clearPiVccUnavailableWarning = () => {
    warnedPiVccUnavailable = false;
  };

  const warnPiVccUnavailable = (ctx: ExtensionContext, message: string) => {
    if (!warnedPiVccUnavailable && ctx.hasUI) {
      ctx.ui.notify(message, "warning");
    }
    warnedPiVccUnavailable = true;
  };

  async function getPiVccDelegateOrNull(ctx: ExtensionContext) {
    const result = await loadPiVccDelegate(ctx.cwd);
    if (result.ok) {
      clearPiVccUnavailableWarning();
      return result.delegate;
    }

    warnPiVccUnavailable(ctx, formatPiVccUnavailableMessage(result.error));
    return null;
  }

  async function runThresholdCompaction(event: TurnEndEvent, ctx: ExtensionContext, customInstructions: string) {
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

    const shouldAutoResume = Array.isArray(event.toolResults) && event.toolResults.length > 0;

    compactionInFlight = true;
    ctx.compact({
      customInstructions,
      onComplete: () => {
        handleCompactionCompleted();
        if (shouldAutoResume) {
          pi.sendUserMessage("continue");
        }
      },
      onError: () => {
        compactionInFlight = false;
        previousContextPercent = null;
      },
    });
  }

  async function runLocalSessionBeforeCompact(event: SessionBeforeCompactEvent, ctx: ExtensionContext) {
    if (!ctx.model) return;
    const auth = await ctx.modelRegistry.getApiKeyAndHeaders(ctx.model);
    if (!auth.ok || !auth.apiKey) return;

    const serializedConversation = serializeConversationFragment(event.preparation.messagesToSummarize);
    const turnPrefixText = serializeConversationFragment(event.preparation.turnPrefixMessages);
    const prompt = buildCompactionPrompt({
      serializedConversation,
      customInstructions: event.customInstructions,
      isSplitTurn: event.preparation.isSplitTurn,
      turnPrefixText,
    });

    try {
      const response = await complete(
        ctx.model,
        {
          systemPrompt: COMPACTION_SYSTEM_PROMPT,
          messages: [{ role: "user", content: [{ type: "text", text: prompt }], timestamp: Date.now() }],
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
      const advisory = normalizeAdvisory(parsed, new Date().toISOString());
      if (!advisory) return;

      return {
        compaction: {
          summary: renderAdvisorySummary(advisory),
          firstKeptEntryId: event.preparation.firstKeptEntryId,
          tokensBefore: event.preparation.tokensBefore,
        },
      };
    } catch {
      return;
    }
  }

  pi.on("session_start", async (event, ctx) => {
    resetLocalCompactionState();

    if (readCompactionMode(ctx.sessionManager.getEntries()) !== "pi-vcc") return;
    const delegate = await getPiVccDelegateOrNull(ctx);
    if (!delegate || !hasPiVccHandler(delegate, "session_start")) return;

    try {
      await invokePiVccHandlers(delegate, "session_start", event, ctx);
    } catch (error) {
      warnPiVccUnavailable(ctx, `pi-vcc session startup failed: ${getErrorMessage(error)}. Failing open.`);
    }
  });

  pi.on("session_tree", async (event, ctx) => {
    resetLocalCompactionState();

    if (readCompactionMode(ctx.sessionManager.getEntries()) !== "pi-vcc") return;
    const delegate = await getPiVccDelegateOrNull(ctx);
    if (!delegate || !hasPiVccHandler(delegate, "session_tree")) return;

    try {
      await invokePiVccHandlers(delegate, "session_tree", event, ctx);
    } catch (error) {
      warnPiVccUnavailable(ctx, `pi-vcc tree sync failed: ${getErrorMessage(error)}. Failing open.`);
    }
  });

  pi.on("session_compact", async (event, ctx) => {
    handleCompactionCompleted();

    if (readCompactionMode(ctx.sessionManager.getEntries()) !== "pi-vcc") return;
    const delegate = await getPiVccDelegateOrNull(ctx);
    if (!delegate || !hasPiVccHandler(delegate, "session_compact")) return;

    try {
      await invokePiVccHandlers(delegate, "session_compact", event, ctx);
    } catch (error) {
      warnPiVccUnavailable(ctx, `pi-vcc compaction sync failed: ${getErrorMessage(error)}. Failing open.`);
    }
  });

  pi.on("turn_end", async (event, ctx) => {
    const mode = readCompactionMode(ctx.sessionManager.getEntries());
    if (mode === "pi-vcc") {
      const delegate = await getPiVccDelegateOrNull(ctx);
      const executionMode = resolveCompactionExecutionMode(mode, Boolean(delegate));
      if (executionMode === "open") return;
      if (hasPiVccHandler(delegate, "turn_end")) {
        try {
          await invokePiVccHandlers(delegate, "turn_end", event, ctx);
        } catch (error) {
          warnPiVccUnavailable(ctx, `${delegate.packageName} turn_end failed: ${getErrorMessage(error)}. Failing open.`);
        }
        return;
      }
      if (!delegate.compactionInstruction) {
        warnPiVccUnavailable(ctx, `${delegate.packageName} did not expose a compaction trigger instruction or turn_end hook. Failing open.`);
        return;
      }
      await runThresholdCompaction(event, ctx, delegate.compactionInstruction);
      return;
    }

    await runThresholdCompaction(event, ctx, "Generate a concise structured advisory for the discarded conversation span. Keep durable task-tracker state separate from the compaction summary.");
  });

  pi.on("session_before_compact", async (event, ctx) => {
    const mode = readCompactionMode(ctx.sessionManager.getEntries());
    if (mode === "pi-vcc") {
      const delegate = await getPiVccDelegateOrNull(ctx);
      const executionMode = resolveCompactionExecutionMode(mode, Boolean(delegate));
      if (executionMode === "open") return;
      if (!hasPiVccHandler(delegate, "session_before_compact")) {
        warnPiVccUnavailable(ctx, `${delegate.packageName} did not expose a session_before_compact hook. Failing open.`);
        return;
      }
      const forwardedEvent = delegate.compactionInstruction
        ? { ...event, customInstructions: delegate.compactionInstruction }
        : event;
      try {
        return await invokePiVccHandlers(delegate, "session_before_compact", forwardedEvent, ctx);
      } catch (error) {
        warnPiVccUnavailable(ctx, `${delegate.packageName} compaction generation failed: ${getErrorMessage(error)}. Failing open.`);
        return;
      }
    }

    return runLocalSessionBeforeCompact(event, ctx);
  });

  pi.registerCommand("compaction-mode", {
    description: "Show or set the compaction mode for this session. Usage: /compaction-mode [local|pi-vcc]",
    handler: async (args, ctx) => {
      const input = args.trim();
      if (!input) {
        const currentMode = readCompactionMode(ctx.sessionManager.getEntries());
        const availability = await loadPiVccDelegate(ctx.cwd);
        const lines = [`Current compaction mode: ${formatCompactionMode(currentMode)}`];
        if (availability.ok) {
          lines.push(`pi-vcc: available as ${availability.delegate.packageName} (${availability.delegate.resolvedPath})`);
        } else {
          lines.push(`pi-vcc: unavailable (${availability.error})`);
          if (currentMode === "pi-vcc") {
            lines.push("Current pi-vcc mode behavior: fail open (no local fallback).");
          }
        }
        lines.push(`Usage: /compaction-mode [${getCompactionModeChoices().join("|")}]`);
        ctx.ui.notify(lines.join("\n"), "info");
        return;
      }

      const nextMode = parseCompactionMode(input);
      if (!nextMode) {
        ctx.ui.notify(`Usage: /compaction-mode [${getCompactionModeChoices().join("|")}]`, "error");
        return;
      }

      const availability = nextMode === "pi-vcc" ? await loadPiVccDelegate(ctx.cwd) : null;
      const piVccAvailable = availability?.ok === true;
      if (!canSelectCompactionMode(nextMode, piVccAvailable)) {
        ctx.ui.notify(`Cannot select pi-vcc compaction for this session: ${availability?.error ?? "pi-vcc is unavailable"}`, "error");
        return;
      }
      const delegatePath = availability?.ok ? availability.delegate.resolvedPath : null;
      const delegateName = availability?.ok ? availability.delegate.packageName : null;

      pi.appendEntry(COMPACTION_MODE_ENTRY_TYPE, buildCompactionModeEntry(nextMode, new Date().toISOString()));
      clearPiVccUnavailableWarning();
      resetLocalCompactionState();

      if (nextMode === "pi-vcc" && availability?.ok) {
        const delegate = await getPiVccDelegateOrNull(ctx);
        if (delegate && hasPiVccHandler(delegate, "session_start")) {
          try {
            const syntheticEvent: SessionStartEvent = {
              type: "session_start",
              reason: "reload",
              previousSessionFile: ctx.sessionManager.getSessionFile(),
            };
            await invokePiVccHandlers(delegate, "session_start", syntheticEvent, ctx);
          } catch (error) {
            warnPiVccUnavailable(ctx, `pi-vcc session initialization failed after switching modes: ${getErrorMessage(error)}. Failing open.`);
          }
        }
      }

      ctx.ui.notify(
        nextMode === "pi-vcc"
          ? `Compaction mode for this session set to pi-vcc. Using ${delegateName} (${delegatePath}).`
          : "Compaction mode for this session set to local.",
        "info",
      );
    },
  });
}
