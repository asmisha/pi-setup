import { complete } from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { convertToLlm, serializeConversation } from "@mariozechner/pi-coding-agent";
import { buildCompactionPrompt, COMPACTION_SYSTEM_PROMPT, normalizeAdvisory, parseJsonObject, renderAdvisorySummary } from "./src/compaction.ts";
import { MIN_COMPACTION_INTERVAL_MS, SOFT_COMPACTION_THRESHOLD_PERCENT, SUMMARY_MAX_TOKENS } from "./src/config.ts";

function serializeConversationFragment(messages: unknown[]): string {
  if (!Array.isArray(messages) || messages.length === 0) return "";
  return serializeConversation(convertToLlm(messages as Parameters<typeof convertToLlm>[0]));
}

export default function compactionExtension(pi: ExtensionAPI) {
  let previousContextPercent: number | null = null;
  let compactionInFlight = false;
  let lastCompactionAt = 0;

  const resetCompactionState = () => {
    previousContextPercent = null;
    compactionInFlight = false;
  };

  pi.on("session_start", async () => {
    resetCompactionState();
  });

  pi.on("session_tree", async () => {
    resetCompactionState();
  });

  pi.on("session_compact", async () => {
    resetCompactionState();
    lastCompactionAt = Date.now();
  });

  pi.on("turn_end", async (event, ctx) => {
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
      customInstructions: "Generate a concise structured advisory for the discarded conversation span. Keep durable task-tracker state separate from the compaction summary.",
      onComplete: () => {
        compactionInFlight = false;
        lastCompactionAt = Date.now();
        previousContextPercent = null;
        if (shouldAutoResume) {
          pi.sendUserMessage("continue");
        }
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
  });
}
