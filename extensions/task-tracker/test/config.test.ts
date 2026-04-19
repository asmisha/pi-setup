import test from "node:test";
import assert from "node:assert/strict";
import { PI_SUBAGENT_DEPTH_ENV, isSubagentProcess } from "../src/config.ts";

test("task-tracker disables tracker-owned UI/bootstrap inside subagent processes", () => {
  assert.equal(isSubagentProcess({} as NodeJS.ProcessEnv), false);
  assert.equal(isSubagentProcess({ [PI_SUBAGENT_DEPTH_ENV]: "0" } as NodeJS.ProcessEnv), false);
  assert.equal(isSubagentProcess({ [PI_SUBAGENT_DEPTH_ENV]: "2" } as NodeJS.ProcessEnv), true);
});
