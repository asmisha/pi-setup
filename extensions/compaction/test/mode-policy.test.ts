import test from "node:test";
import assert from "node:assert/strict";
import { canSelectCompactionMode, formatPiVccUnavailableMessage, resolveCompactionExecutionMode } from "../src/mode-policy.ts";

test("resolveCompactionExecutionMode fails open when pi-vcc mode is selected but unavailable", () => {
  assert.equal(resolveCompactionExecutionMode("local", false), "local");
  assert.equal(resolveCompactionExecutionMode("pi-vcc", true), "pi-vcc");
  assert.equal(resolveCompactionExecutionMode("pi-vcc", false), "open");
});

test("canSelectCompactionMode rejects choosing pi-vcc when unavailable", () => {
  assert.equal(canSelectCompactionMode("local", false), true);
  assert.equal(canSelectCompactionMode("pi-vcc", true), true);
  assert.equal(canSelectCompactionMode("pi-vcc", false), false);
});

test("formatPiVccUnavailableMessage describes fail-open behavior without mentioning local fallback", () => {
  const message = formatPiVccUnavailableMessage("pi-vcc is not installed under /tmp/project");
  assert.match(message, /fail open/i);
  assert.doesNotMatch(message, /falling back to local/i);
});
