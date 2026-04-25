import test from "node:test";
import assert from "node:assert/strict";
import { buildCompactionModeEntry, COMPACTION_MODE_ENTRY_TYPE, parseCompactionMode, readCompactionMode, readStoredCompactionMode } from "../src/session-config.ts";

test("parseCompactionMode accepts local, pi-vcc, and pi-lcm aliases", () => {
  assert.equal(parseCompactionMode("local"), "local");
  assert.equal(parseCompactionMode("pi-vcc"), "pi-vcc");
  assert.equal(parseCompactionMode("pivcc"), "pi-vcc");
  assert.equal(parseCompactionMode("vcc"), "pi-vcc");
  assert.equal(parseCompactionMode("pi-lcm"), "pi-lcm");
  assert.equal(parseCompactionMode("lcm"), "pi-lcm");
  assert.equal(parseCompactionMode("unknown"), null);
});

test("readCompactionMode auto-selects installed pi-vcc by default and uses the latest valid custom entry", () => {
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

  assert.equal(readStoredCompactionMode([] as any), null);
  assert.equal(readCompactionMode([] as any), "local");
  assert.equal(readCompactionMode([] as any, true), "pi-vcc");
  assert.equal(readStoredCompactionMode(entries), "local");
  assert.equal(readCompactionMode(entries, true), "local");
});
