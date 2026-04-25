import type { CompactionExecutionMode } from "./mode-policy.ts";
import { MIN_COMPACTION_INTERVAL_MS, SOFT_COMPACTION_THRESHOLD_PERCENT } from "./config.ts";

export type ThresholdCompactionDecision = {
  nextPreviousContextPercent: number | null;
  shouldCompact: boolean;
};

export type TurnEndCompactionAction = "skip" | "delegate-turn_end" | "request-compaction";

export function evaluateThresholdCompaction(options: {
  currentPercent: number | null;
  previousContextPercent: number | null;
  compactionInFlight: boolean;
  lastCompactionAt: number;
  now: number;
  thresholdPercent?: number;
  minCompactionIntervalMs?: number;
}): ThresholdCompactionDecision {
  const {
    currentPercent,
    previousContextPercent,
    compactionInFlight,
    lastCompactionAt,
    now,
    thresholdPercent = SOFT_COMPACTION_THRESHOLD_PERCENT,
    minCompactionIntervalMs = MIN_COMPACTION_INTERVAL_MS,
  } = options;

  if (currentPercent === null) {
    return { nextPreviousContextPercent: null, shouldCompact: false };
  }

  const crossedThreshold = previousContextPercent === null
    ? currentPercent >= thresholdPercent
    : previousContextPercent < thresholdPercent && currentPercent >= thresholdPercent;

  return {
    nextPreviousContextPercent: currentPercent,
    shouldCompact: crossedThreshold && !compactionInFlight && now - lastCompactionAt >= minCompactionIntervalMs,
  };
}

export function resolveTurnEndCompactionAction(
  executionMode: CompactionExecutionMode,
  hasPiVccTurnEndHandler: boolean,
  shouldCompact: boolean,
): TurnEndCompactionAction {
  if (executionMode === "open" || !shouldCompact) return "skip";
  if (executionMode === "pi-vcc" && hasPiVccTurnEndHandler) return "delegate-turn_end";
  return "request-compaction";
}

export function resolvePreviousContextPercentAfterTurnEnd(options: {
  thresholdDecision: ThresholdCompactionDecision;
  action: TurnEndCompactionAction;
  delegateTurnEndFailed?: boolean;
}): number | null {
  const { thresholdDecision, action, delegateTurnEndFailed = false } = options;
  if (!thresholdDecision.shouldCompact) return thresholdDecision.nextPreviousContextPercent;
  if (action === "skip") return null;
  if (action === "delegate-turn_end" && delegateTurnEndFailed) return null;
  return thresholdDecision.nextPreviousContextPercent;
}
