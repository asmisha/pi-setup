import test from "node:test";
import assert from "node:assert/strict";
import { MIN_COMPACTION_INTERVAL_MS, SOFT_COMPACTION_THRESHOLD_PERCENT, SUMMARY_MAX_TOKENS } from "../src/config.ts";

test("compaction uses the requested 65 percent threshold", () => {
  assert.equal(SOFT_COMPACTION_THRESHOLD_PERCENT, 65);
});

test("compaction keeps the expected debounce interval and summary token budget", () => {
  assert.equal(MIN_COMPACTION_INTERVAL_MS, 30_000);
  assert.equal(SUMMARY_MAX_TOKENS, 2048);
});
