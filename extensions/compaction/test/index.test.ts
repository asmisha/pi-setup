import test from "node:test";
import assert from "node:assert/strict";
import { evaluateThresholdCompaction, resolvePreviousContextPercentAfterTurnEnd } from "../src/turn-end-policy.ts";

test("evaluateThresholdCompaction only triggers after crossing the threshold and resets on missing usage", () => {
  assert.deepEqual(
    evaluateThresholdCompaction({
      currentPercent: null,
      previousContextPercent: 70,
      compactionInFlight: false,
      lastCompactionAt: 0,
      now: 60_000,
    }),
    { nextPreviousContextPercent: null, shouldCompact: false },
  );

  assert.deepEqual(
    evaluateThresholdCompaction({
      currentPercent: 60,
      previousContextPercent: 50,
      compactionInFlight: false,
      lastCompactionAt: 0,
      now: 60_000,
    }),
    { nextPreviousContextPercent: 60, shouldCompact: false },
  );

  assert.deepEqual(
    evaluateThresholdCompaction({
      currentPercent: 70,
      previousContextPercent: 60,
      compactionInFlight: false,
      lastCompactionAt: 0,
      now: 60_000,
    }),
    { nextPreviousContextPercent: 70, shouldCompact: true },
  );
});

test("evaluateThresholdCompaction preserves in-flight and cooldown guards at the threshold", () => {
  assert.deepEqual(
    evaluateThresholdCompaction({
      currentPercent: 70,
      previousContextPercent: 60,
      compactionInFlight: true,
      lastCompactionAt: 0,
      now: 60_000,
    }),
    { nextPreviousContextPercent: 70, shouldCompact: false },
  );

  assert.deepEqual(
    evaluateThresholdCompaction({
      currentPercent: 70,
      previousContextPercent: 60,
      compactionInFlight: false,
      lastCompactionAt: 45_000,
      now: 60_000,
    }),
    { nextPreviousContextPercent: 70, shouldCompact: false },
  );
});

test("resolvePreviousContextPercentAfterTurnEnd resets only when a threshold crossing had no compaction request", () => {
  const crossingDecision = {
    nextPreviousContextPercent: 70,
    shouldCompact: true,
  };
  const noCrossingDecision = {
    nextPreviousContextPercent: 60,
    shouldCompact: false,
  };

  assert.equal(
    resolvePreviousContextPercentAfterTurnEnd({ thresholdDecision: noCrossingDecision, didRequestCompaction: false }),
    60,
  );
  assert.equal(
    resolvePreviousContextPercentAfterTurnEnd({ thresholdDecision: crossingDecision, didRequestCompaction: false }),
    null,
  );
  assert.equal(
    resolvePreviousContextPercentAfterTurnEnd({ thresholdDecision: crossingDecision, didRequestCompaction: true }),
    70,
  );
});
