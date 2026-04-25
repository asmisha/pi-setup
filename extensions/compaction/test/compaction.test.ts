import test from "node:test";
import assert from "node:assert/strict";
import { buildCompactionPrompt, normalizeAdvisory, renderAdvisorySummary } from "../src/compaction.ts";

test("buildCompactionPrompt keeps split-turn guidance but omits injected durable state", () => {
  const prompt = buildCompactionPrompt({
    serializedConversation: "[User]: What's in Pi compaction?\n\n[Assistant]: I inspected the source.",
    customInstructions: "Focus on async subagent sync points.",
    isSplitTurn: true,
    turnPrefixText: "[User]: Continue the compaction investigation.",
  });

  assert.doesNotMatch(prompt, /Open asks:/);
  assert.doesNotMatch(prompt, /Active tasks:/);
  assert.doesNotMatch(prompt, /Previous advisory packet:/);
  assert.doesNotMatch(prompt, /Current execution stage:/);
  assert.doesNotMatch(prompt, /Current next action:/);
  assert.match(prompt, /Focus on async subagent sync points\./);
  assert.match(prompt, /Compaction is happening mid-turn\./);
  assert.match(prompt, /<turn-prefix-being-discarded>/);
  assert.match(prompt, /<conversation-being-compacted>/);
  assert.match(prompt, /Do not inject or restate current durable state/);
});

test("normalizeAdvisory drops extra fields and deduplicates artifacts", () => {
  const advisory = normalizeAdvisory(
    {
      latestUserIntent: "Investigate compaction prompt",
      recentFocus: ["Removed prompt-state injection from compaction prompt"],
      suggestedNextAction: null,
      blockers: [],
      relevantFiles: ["extensions/task-tracker/index.ts"],
      artifacts: [
        { kind: "file", value: "extensions/task-tracker/index.ts" },
        { kind: "file", value: "extensions/task-tracker/index.ts" },
      ],
      avoidRepeating: ["Do not put durable tracker state back into the prompt"],
      unresolvedQuestions: ["Whether discarded-span-only advisory is enough"],
    },
    "2026-04-19T11:00:00.000Z",
  );

  assert.ok(advisory);
  assert.deepEqual(advisory?.artifacts, [{ kind: "file", value: "extensions/task-tracker/index.ts" }]);
  assert.equal("relevantFiles" in (advisory as object), false);
});

test("renderAdvisorySummary keeps the summary human-readable", () => {
  const summary = renderAdvisorySummary({
    latestUserIntent: "Speed up parallel work",
    recentFocus: ["Split tracker and compaction ownership"],
    suggestedNextAction: "Run the focused extension test suites.",
    blockers: ["None"],
    artifacts: [{ kind: "file", value: "extensions/compaction/index.ts" }],
    avoidRepeating: ["Do not treat compaction summary as canonical task state"],
    unresolvedQuestions: [],
    updatedAt: "2026-04-19T11:05:00.000Z",
  });

  assert.match(summary, /Speed up parallel work/);
  assert.match(summary, /Run the focused extension test suites\./);
  assert.match(summary, /Split tracker and compaction ownership/);
});
