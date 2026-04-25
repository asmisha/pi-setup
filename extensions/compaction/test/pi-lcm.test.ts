import test from "node:test";
import assert from "node:assert/strict";
import { createHostedPiLcmApi, formatPiLcmUnavailableMessage } from "../src/pi-lcm.ts";

test("hosted pi-lcm API lets LCM keep message subscriptions but gates its compaction hook", async () => {
  const handlers = new Map<string, Function[]>();
  const pi = {
    on(eventName: string, handler: Function) {
      const list = handlers.get(eventName) ?? [];
      list.push(handler);
      handlers.set(eventName, list);
    },
  } as any;

  const wrapped = createHostedPiLcmApi(pi, (ctx: any) => ctx.useLcm === true) as any;
  const calls: string[] = [];

  wrapped.on("message_end", async () => {
    calls.push("message_end");
  });
  wrapped.on("session_before_compact", async () => {
    calls.push("session_before_compact");
    return { compaction: { summary: "lcm", firstKeptEntryId: "entry_1", tokensBefore: 123 } };
  });

  assert.equal(handlers.get("message_end")?.length, 1);
  assert.equal(handlers.get("session_before_compact")?.length, 1);

  await handlers.get("message_end")?.[0]({}, { useLcm: false });
  assert.deepEqual(calls, ["message_end"]);

  assert.equal(await handlers.get("session_before_compact")?.[0]({}, { useLcm: false }), undefined);
  assert.deepEqual(calls, ["message_end"]);

  assert.deepEqual(await handlers.get("session_before_compact")?.[0]({}, { useLcm: true }), {
    compaction: { summary: "lcm", firstKeptEntryId: "entry_1", tokensBefore: 123 },
  });
  assert.deepEqual(calls, ["message_end", "session_before_compact"]);
});

test("formatPiLcmUnavailableMessage describes fail-open behavior", () => {
  const message = formatPiLcmUnavailableMessage("pi-lcm is not installed");
  assert.match(message, /pi-lcm/);
  assert.match(message, /fail open/i);
});
