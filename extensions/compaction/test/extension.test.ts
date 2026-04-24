import test from "node:test";
import assert from "node:assert/strict";
import compactionExtension from "../index.ts";

test("extension only registers lifecycle/turn handlers and requests plain compaction at threshold", async () => {
  const handlers = new Map<string, Function[]>();
  const pi = {
    on(eventName: string, handler: Function) {
      const list = handlers.get(eventName) ?? [];
      list.push(handler);
      handlers.set(eventName, list);
    },
  } as any;

  compactionExtension(pi);

  assert.deepEqual([...handlers.keys()].sort(), ["session_compact", "session_start", "session_tree", "turn_end"]);
  assert.equal(handlers.has("session_before_compact"), false);

  let compactOptions: any;
  const ctx = {
    getContextUsage: () => ({ tokens: 70, contextWindow: 100, percent: 70 }),
    compact(options: any) {
      compactOptions = options;
      options.onComplete?.({} as any);
    },
  };

  await handlers.get("turn_end")?.[0]({ type: "turn_end", toolResults: [{ toolName: "bash" }] }, ctx);

  assert.equal(typeof compactOptions?.onComplete, "function");
  assert.equal(typeof compactOptions?.onError, "function");
  assert.equal("customInstructions" in compactOptions, false);
});
