import test from "node:test";
import assert from "node:assert/strict";
import { hasPiVccHandler, invokePiVccHandlers, resolvePiVccHandlersFromModule } from "../src/pi-vcc.ts";

test("resolvePiVccHandlersFromModule captures handlers from an extension factory default export", async () => {
  const callLog: string[] = [];
  const handlers = await resolvePiVccHandlersFromModule({
    default: (pi: any) => {
      pi.on("turn_end", async () => {
        callLog.push("turn_end");
      });
      pi.on("session_before_compact", async () => ({ cancel: true }));
    },
  });

  const delegate = { resolvedPath: "/tmp/pi-vcc/index.js", handlers };

  assert.equal(hasPiVccHandler(delegate, "turn_end"), true);
  assert.equal(hasPiVccHandler(delegate, "session_before_compact"), true);

  await invokePiVccHandlers(delegate, "turn_end", {} as any, {} as any);
  assert.deepEqual(callLog, ["turn_end"]);
  assert.deepEqual(await invokePiVccHandlers(delegate, "session_before_compact", {} as any, {} as any), { cancel: true });
});

test("resolvePiVccHandlersFromModule falls back to a direct default handler export", async () => {
  const directHandler = async () => ({ cancel: true });
  const handlers = await resolvePiVccHandlersFromModule({ default: directHandler });
  const delegate = { resolvedPath: "/tmp/pi-vcc/index.js", handlers };

  assert.equal(hasPiVccHandler(delegate, "session_before_compact"), true);
  assert.deepEqual(await invokePiVccHandlers(delegate, "session_before_compact", {} as any, {} as any), { cancel: true });
});

test("resolvePiVccHandlersFromModule wraps a compact export into session_before_compact", async () => {
  const handlers = await resolvePiVccHandlersFromModule({
    compact: async (preparation: any) => ({
      summary: "delegated summary",
      firstKeptEntryId: preparation.firstKeptEntryId,
      tokensBefore: preparation.tokensBefore,
    }),
  });
  const delegate = { resolvedPath: "/tmp/pi-vcc/index.js", handlers };

  const result = await invokePiVccHandlers(
    delegate,
    "session_before_compact",
    {
      preparation: {
        firstKeptEntryId: "entry_123",
        tokensBefore: 321,
      },
      customInstructions: "focus on handoff state",
      signal: new AbortController().signal,
    } as any,
    {
      model: { id: "fake-model" },
      modelRegistry: {
        getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "test-key", headers: { "x-test": "1" } }),
      },
    } as any,
  );

  assert.deepEqual(result, {
    compaction: {
      summary: "delegated summary",
      firstKeptEntryId: "entry_123",
      tokensBefore: 321,
      details: undefined,
    },
  });
});
