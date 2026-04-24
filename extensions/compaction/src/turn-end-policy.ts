import { MIN_COMPACTION_INTERVAL_MS, SOFT_COMPACTION_THRESHOLD_PERCENT } from "./config.ts";

export type ThresholdCompactionDecision = {
  nextPreviousContextPercent: number | null;
  shouldCompact: boolean;
};

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

export function resolvePreviousContextPercentAfterTurnEnd(options: {
  thresholdDecision: ThresholdCompactionDecision;
  didRequestCompaction: boolean;
}): number | null {
  const { thresholdDecision, didRequestCompaction } = options;
  if (!thresholdDecision.shouldCompact) return thresholdDecision.nextPreviousContextPercent;
  return didRequestCompaction ? thresholdDecision.nextPreviousContextPercent : null;
}
