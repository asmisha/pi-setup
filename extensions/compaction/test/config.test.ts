import test from "node:test";
import assert from "node:assert/strict";
import { MIN_COMPACTION_INTERVAL_MS, SOFT_COMPACTION_THRESHOLD_PERCENT } from "../src/config.ts";

test("compaction uses the requested 65 percent threshold", () => {
  assert.equal(SOFT_COMPACTION_THRESHOLD_PERCENT, 65);
});

test("compaction keeps the expected debounce interval", () => {
  assert.equal(MIN_COMPACTION_INTERVAL_MS, 30_000);
});
