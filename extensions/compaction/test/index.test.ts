import test from "node:test";
import assert from "node:assert/strict";
import { evaluateThresholdCompaction, resolvePreviousContextPercentAfterTurnEnd, resolveTurnEndCompactionAction } from "../src/turn-end-policy.ts";

test("evaluateThresholdCompaction only triggers after crossing the existing threshold and resets on missing usage", () => {
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

test("resolveTurnEndCompactionAction gates delegated turn_end hooks behind the threshold decision", () => {
  assert.equal(resolveTurnEndCompactionAction("open", true, true), "skip");
  assert.equal(resolveTurnEndCompactionAction("local", false, false), "skip");
  assert.equal(resolveTurnEndCompactionAction("local", false, true), "request-compaction");
  assert.equal(resolveTurnEndCompactionAction("pi-vcc", true, false), "skip");
  assert.equal(resolveTurnEndCompactionAction("pi-vcc", true, true), "delegate-turn_end");
  assert.equal(resolveTurnEndCompactionAction("pi-vcc", false, true), "request-compaction");
  assert.equal(resolveTurnEndCompactionAction("pi-lcm", false, false), "skip");
  assert.equal(resolveTurnEndCompactionAction("pi-lcm", false, true), "request-compaction");
});

test("resolvePreviousContextPercentAfterTurnEnd resets threshold state when no compaction path actually ran", () => {
  const thresholdDecision = {
    nextPreviousContextPercent: 70,
    shouldCompact: true,
  };

  assert.equal(
    resolvePreviousContextPercentAfterTurnEnd({ thresholdDecision, action: "skip" }),
    null,
  );
  assert.equal(
    resolvePreviousContextPercentAfterTurnEnd({ thresholdDecision, action: "delegate-turn_end", delegateTurnEndFailed: true }),
    null,
  );
  assert.equal(
    resolvePreviousContextPercentAfterTurnEnd({ thresholdDecision, action: "delegate-turn_end" }),
    70,
  );
  assert.equal(
    resolvePreviousContextPercentAfterTurnEnd({ thresholdDecision, action: "request-compaction" }),
    70,
  );
});
