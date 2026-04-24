import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { evaluateThresholdCompaction, resolvePreviousContextPercentAfterTurnEnd } from "./src/turn-end-policy.ts";

const LOCAL_COMPACTION_INSTRUCTIONS = "Generate a concise structured advisory for the discarded conversation span. Keep durable task-tracker state separate from the compaction summary.";

export default function compactionExtension(pi: ExtensionAPI) {
  let previousContextPercent: number | null = null;
  let compactionInFlight = false;
  let lastCompactionAt = 0;

  const resetThresholdState = () => {
    previousContextPercent = null;
    compactionInFlight = false;
  };

  const handleCompactionCompleted = () => {
    resetThresholdState();
    lastCompactionAt = Date.now();
  };

  function requestThresholdCompaction(ctx: ExtensionContext) {
    compactionInFlight = true;
    ctx.compact({
      customInstructions: LOCAL_COMPACTION_INSTRUCTIONS,
      onComplete: () => {
        handleCompactionCompleted();
      },
      onError: () => {
        resetThresholdState();
      },
    });
  }

  pi.on("session_start", async () => {
    resetThresholdState();
  });

  pi.on("session_tree", async () => {
    resetThresholdState();
  });

  pi.on("session_compact", async () => {
    handleCompactionCompleted();
  });

  pi.on("turn_end", async (event, ctx) => {
    const thresholdDecision = evaluateThresholdCompaction({
      currentPercent: ctx.getContextUsage()?.percent ?? null,
      previousContextPercent,
      compactionInFlight,
      lastCompactionAt,
      now: Date.now(),
    });

    if (!thresholdDecision.shouldCompact) {
      previousContextPercent = resolvePreviousContextPercentAfterTurnEnd({ thresholdDecision, didRequestCompaction: false });
      return;
    }

    previousContextPercent = resolvePreviousContextPercentAfterTurnEnd({ thresholdDecision, didRequestCompaction: true });
    requestThresholdCompaction(ctx);
  });
}
