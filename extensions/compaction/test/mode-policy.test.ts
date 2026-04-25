import test from "node:test";
import assert from "node:assert/strict";
import { canSelectCompactionMode, formatPiVccUnavailableMessage, resolveCompactionExecutionMode } from "../src/mode-policy.ts";

test("resolveCompactionExecutionMode prefers installed pi-vcc by default and fails open for unavailable explicit delegated modes", () => {
  assert.equal(resolveCompactionExecutionMode(null, false), "local");
  assert.equal(resolveCompactionExecutionMode(null, true), "pi-vcc");
  assert.equal(resolveCompactionExecutionMode(null, false, true), "local");
  assert.equal(resolveCompactionExecutionMode("local", false), "local");
  assert.equal(resolveCompactionExecutionMode("pi-vcc", true), "pi-vcc");
  assert.equal(resolveCompactionExecutionMode("pi-vcc", false), "open");
  assert.equal(resolveCompactionExecutionMode("pi-lcm", false, true), "pi-lcm");
  assert.equal(resolveCompactionExecutionMode("pi-lcm", false, false), "open");
});

test("canSelectCompactionMode rejects choosing delegated modes when unavailable", () => {
  assert.equal(canSelectCompactionMode("local", false), true);
  assert.equal(canSelectCompactionMode("pi-vcc", true), true);
  assert.equal(canSelectCompactionMode("pi-vcc", false), false);
  assert.equal(canSelectCompactionMode("pi-lcm", false, true), true);
  assert.equal(canSelectCompactionMode("pi-lcm", false, false), false);
});

test("formatPiVccUnavailableMessage describes fail-open behavior without mentioning local fallback", () => {
  const message = formatPiVccUnavailableMessage("pi-vcc is not installed under /tmp/project");
  assert.match(message, /fail open/i);
  assert.doesNotMatch(message, /falling back to local/i);
});
