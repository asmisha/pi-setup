import test from "node:test";
import assert from "node:assert/strict";
import { ENV_ENABLE_FLAG, isExtensionEnabled } from "../src/config.ts";

test("context-guardian-v2 defaults to enabled when env flag is unset", () => {
  assert.equal(isExtensionEnabled({} as NodeJS.ProcessEnv), true);
  assert.equal(isExtensionEnabled({ [ENV_ENABLE_FLAG]: "" } as NodeJS.ProcessEnv), true);
});

test("context-guardian-v2 can be explicitly disabled", () => {
  assert.equal(isExtensionEnabled({ [ENV_ENABLE_FLAG]: "0" } as NodeJS.ProcessEnv), false);
  assert.equal(isExtensionEnabled({ [ENV_ENABLE_FLAG]: "false" } as NodeJS.ProcessEnv), false);
  assert.equal(isExtensionEnabled({ [ENV_ENABLE_FLAG]: "no" } as NodeJS.ProcessEnv), false);
  assert.equal(isExtensionEnabled({ [ENV_ENABLE_FLAG]: "off" } as NodeJS.ProcessEnv), false);
});

test("context-guardian-v2 still accepts explicit enabled values", () => {
  assert.equal(isExtensionEnabled({ [ENV_ENABLE_FLAG]: "1" } as NodeJS.ProcessEnv), true);
  assert.equal(isExtensionEnabled({ [ENV_ENABLE_FLAG]: "true" } as NodeJS.ProcessEnv), true);
  assert.equal(isExtensionEnabled({ [ENV_ENABLE_FLAG]: "yes" } as NodeJS.ProcessEnv), true);
  assert.equal(isExtensionEnabled({ [ENV_ENABLE_FLAG]: "on" } as NodeJS.ProcessEnv), true);
});
