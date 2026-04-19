import test from "node:test";
import assert from "node:assert/strict";
import { buildCompactionModeEntry, COMPACTION_MODE_ENTRY_TYPE, parseCompactionMode, readCompactionMode } from "../src/session-config.ts";

test("parseCompactionMode accepts local and pi-vcc aliases", () => {
  assert.equal(parseCompactionMode("local"), "local");
  assert.equal(parseCompactionMode("pi-vcc"), "pi-vcc");
  assert.equal(parseCompactionMode("pivcc"), "pi-vcc");
  assert.equal(parseCompactionMode("vcc"), "pi-vcc");
  assert.equal(parseCompactionMode("unknown"), null);
});

test("readCompactionMode defaults to local and uses the latest valid custom entry", () => {
  const entries = [
    {
      type: "custom",
      customType: COMPACTION_MODE_ENTRY_TYPE,
      data: buildCompactionModeEntry("pi-vcc", "2026-04-19T12:00:00.000Z"),
    },
    {
      type: "custom",
      customType: COMPACTION_MODE_ENTRY_TYPE,
      data: { mode: "not-a-mode", updatedAt: "2026-04-19T12:01:00.000Z" },
    },
    {
      type: "custom",
      customType: COMPACTION_MODE_ENTRY_TYPE,
      data: buildCompactionModeEntry("local", "2026-04-19T12:02:00.000Z"),
    },
  ] as any;

  assert.equal(readCompactionMode([] as any), "local");
  assert.equal(readCompactionMode(entries), "local");
});
