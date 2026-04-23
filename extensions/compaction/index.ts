import { complete } from "@mariozechner/pi-ai";
import type { ExtensionAPI, ExtensionContext, SessionBeforeCompactEvent, SessionStartEvent, TurnEndEvent } from "@mariozechner/pi-coding-agent";
import { convertToLlm, serializeConversation } from "@mariozechner/pi-coding-agent";
import { buildCompactionPrompt, COMPACTION_SYSTEM_PROMPT, normalizeAdvisory, parseJsonObject, renderAdvisorySummary } from "./src/compaction.ts";
import { SUMMARY_MAX_TOKENS } from "./src/config.ts";
import { canSelectCompactionMode, formatPiVccUnavailableMessage, resolveCompactionExecutionMode } from "./src/mode-policy.ts";
import { canAutoUsePiVccDelegate, hasPiVccHandler, invokePiVccHandlers, loadPiVccDelegate } from "./src/pi-vcc.ts";
import { evaluateThresholdCompaction, resolvePreviousContextPercentAfterTurnEnd, resolveTurnEndCompactionAction } from "./src/turn-end-policy.ts";
import { buildCompactionModeEntry, COMPACTION_MODE_ENTRY_TYPE, formatCompactionMode, getCompactionModeChoices, parseCompactionMode, readCompactionMode, readStoredCompactionMode } from "./src/session-config.ts";

function serializeConversationFragment(messages: unknown[]): string {
  if (!Array.isArray(messages) || messages.length === 0) return "";
  return serializeConversation(convertToLlm(messages as Parameters<typeof convertToLlm>[0]));
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const LOCAL_COMPACTION_INSTRUCTIONS = "Generate a concise structured advisory for the discarded conversation span. Keep durable task-tracker state separate from the compaction summary.";

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

  async function getPiVccDelegateOrNull(ctx: ExtensionContext, warnIfUnavailable = true) {
    const result = await loadPiVccDelegate(ctx.cwd);
    if (result.ok) {
      clearPiVccUnavailableWarning();
      return result.delegate;
    }

    if (warnIfUnavailable) {
      warnPiVccUnavailable(ctx, formatPiVccUnavailableMessage(result.error));
    }
    return null;
  }

  async function resolveCompactionRuntime(ctx: ExtensionContext) {
    const configuredMode = readStoredCompactionMode(ctx.sessionManager.getEntries());
    if (configuredMode === "local") {
      return { configuredMode, executionMode: "local" as const, delegate: null };
    }

    const delegate = await getPiVccDelegateOrNull(ctx, configuredMode === "pi-vcc");
    const piVccAvailable = configuredMode === "pi-vcc"
      ? Boolean(delegate)
      : Boolean(delegate && canAutoUsePiVccDelegate(delegate));
    return {
      configuredMode,
      executionMode: resolveCompactionExecutionMode(configuredMode, piVccAvailable),
      delegate,
    };
  }

  function requestThresholdCompaction(event: TurnEndEvent, ctx: ExtensionContext, customInstructions: string) {
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

    const { executionMode, delegate } = await resolveCompactionRuntime(ctx);
    if (executionMode !== "pi-vcc" || !delegate || !hasPiVccHandler(delegate, "session_start")) return;

    try {
      await invokePiVccHandlers(delegate, "session_start", event, ctx);
    } catch (error) {
      warnPiVccUnavailable(ctx, `pi-vcc session startup failed: ${getErrorMessage(error)}. Failing open.`);
    }
  });

  pi.on("session_tree", async (event, ctx) => {
    resetLocalCompactionState();

    const { executionMode, delegate } = await resolveCompactionRuntime(ctx);
    if (executionMode !== "pi-vcc" || !delegate || !hasPiVccHandler(delegate, "session_tree")) return;

    try {
      await invokePiVccHandlers(delegate, "session_tree", event, ctx);
    } catch (error) {
      warnPiVccUnavailable(ctx, `pi-vcc tree sync failed: ${getErrorMessage(error)}. Failing open.`);
    }
  });

  pi.on("session_compact", async (event, ctx) => {
    handleCompactionCompleted();

    const { executionMode, delegate } = await resolveCompactionRuntime(ctx);
    if (executionMode !== "pi-vcc" || !delegate || !hasPiVccHandler(delegate, "session_compact")) return;

    try {
      await invokePiVccHandlers(delegate, "session_compact", event, ctx);
    } catch (error) {
      warnPiVccUnavailable(ctx, `pi-vcc compaction sync failed: ${getErrorMessage(error)}. Failing open.`);
    }
  });

  pi.on("turn_end", async (event, ctx) => {
    const { executionMode, delegate } = await resolveCompactionRuntime(ctx);
    const thresholdDecision = evaluateThresholdCompaction({
      currentPercent: ctx.getContextUsage()?.percent ?? null,
      previousContextPercent,
      compactionInFlight,
      lastCompactionAt,
      now: Date.now(),
    });
    const action = resolveTurnEndCompactionAction(
      executionMode,
      executionMode === "pi-vcc" && Boolean(delegate) ? hasPiVccHandler(delegate, "turn_end") : false,
      thresholdDecision.shouldCompact,
    );
    if (action === "skip") {
      previousContextPercent = resolvePreviousContextPercentAfterTurnEnd({ thresholdDecision, action });
      return;
    }

    if (action === "delegate-turn_end" && delegate) {
      try {
        await invokePiVccHandlers(delegate, "turn_end", event, ctx);
        previousContextPercent = resolvePreviousContextPercentAfterTurnEnd({ thresholdDecision, action });
      } catch (error) {
        previousContextPercent = resolvePreviousContextPercentAfterTurnEnd({ thresholdDecision, action, delegateTurnEndFailed: true });
        warnPiVccUnavailable(ctx, `${delegate.packageName} turn_end failed: ${getErrorMessage(error)}. Failing open.`);
      }
      return;
    }

    if (executionMode === "pi-vcc" && delegate) {
      if (!delegate.compactionInstruction) {
        previousContextPercent = resolvePreviousContextPercentAfterTurnEnd({ thresholdDecision, action: "skip" });
        warnPiVccUnavailable(ctx, `${delegate.packageName} did not expose a compaction trigger instruction or turn_end hook. Failing open.`);
        return;
      }
      previousContextPercent = resolvePreviousContextPercentAfterTurnEnd({ thresholdDecision, action });
      requestThresholdCompaction(event, ctx, delegate.compactionInstruction);
      return;
    }

    previousContextPercent = resolvePreviousContextPercentAfterTurnEnd({ thresholdDecision, action });
    requestThresholdCompaction(
      event,
      ctx,
      LOCAL_COMPACTION_INSTRUCTIONS,
    );
  });

  pi.on("session_before_compact", async (event, ctx) => {
    const { executionMode, delegate } = await resolveCompactionRuntime(ctx);
    if (executionMode === "open") return;
    if (executionMode === "pi-vcc" && delegate) {
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
        const storedMode = readStoredCompactionMode(ctx.sessionManager.getEntries());
        const availability = await loadPiVccDelegate(ctx.cwd);
        const autoPiVccAvailable = availability.ok && canAutoUsePiVccDelegate(availability.delegate);
        const currentMode = readCompactionMode(ctx.sessionManager.getEntries(), autoPiVccAvailable);
        const lines = [`Current compaction mode: ${formatCompactionMode(currentMode)}${storedMode ? "" : " (default)"}`];
        if (availability.ok) {
          lines.push(`pi-vcc: available as ${availability.delegate.packageName} (${availability.delegate.resolvedPath})`);
          if (!autoPiVccAvailable) {
            lines.push("pi-vcc auto/default mode is unavailable because the installed package does not expose compaction-generation hooks.");
          }
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
      const piVccAvailable = availability?.ok === true && canAutoUsePiVccDelegate(availability.delegate);
      if (!canSelectCompactionMode(nextMode, piVccAvailable)) {
        const unavailableReason = availability?.ok === true
          ? "the installed package does not expose compaction-generation hooks"
          : availability?.error ?? "pi-vcc is unavailable";
        ctx.ui.notify(`Cannot select pi-vcc compaction for this session: ${unavailableReason}`, "error");
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
