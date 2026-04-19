import test from "node:test";
import assert from "node:assert/strict";
import { buildBootstrapEvents, buildExplicitAskCaptureEvent } from "../src/bootstrap.ts";
import { projectLedger } from "../src/projector.ts";
import { extractUserPromptText } from "../src/utils.ts";
import { createDeterministicIdFactory } from "./helpers.ts";

test("explicit ask capture appends a new open ask for a later user prompt", () => {
  const nextId = createDeterministicIdFactory();
  const bootstrapNow = "2026-04-18T10:00:00.000Z";
  const events = buildBootstrapEvents({ objective: "Ship task tracker", now: bootstrapNow, nextId });
  const state = projectLedger(events, bootstrapNow);
  const event = buildExplicitAskCaptureEvent({
    currentContract: state.contract!,
    prompt: "Mid-run steer should count too",
    now: "2026-04-18T10:01:00.000Z",
    nextId,
  });

  assert.ok(event);

  const nextState = projectLedger([...events, event]);
  assert.deepEqual(nextState.contract?.explicitAsks.map((ask) => ask.text), [
    "Ship task tracker",
    "Mid-run steer should count too",
  ]);
  assert.equal(nextState.openAskIds.length, 2);
});

test("explicit ask capture skips duplicate open asks", () => {
  const nextId = createDeterministicIdFactory();
  const bootstrapNow = "2026-04-18T10:00:00.000Z";
  const events = buildBootstrapEvents({ objective: "Same ask", now: bootstrapNow, nextId });
  const state = projectLedger(events, bootstrapNow);

  const duplicate = buildExplicitAskCaptureEvent({
    currentContract: state.contract!,
    prompt: "Same ask",
    now: "2026-04-18T10:01:00.000Z",
    nextId,
  });

  assert.equal(duplicate, null);
});

test("explicit ask capture skips low-signal nudges", () => {
  const nextId = createDeterministicIdFactory();
  const bootstrapNow = "2026-04-18T10:00:00.000Z";
  const events = buildBootstrapEvents({ objective: "Real task", now: bootstrapNow, nextId });
  const state = projectLedger(events, bootstrapNow);

  const duplicate = buildExplicitAskCaptureEvent({
    currentContract: state.contract!,
    prompt: "continue",
    now: "2026-04-18T10:01:00.000Z",
    nextId,
  });

  assert.equal(duplicate, null);
});

test("extractUserPromptText keeps text parts and ignores non-text blocks", () => {
  assert.equal(extractUserPromptText("  Hello there  "), "Hello there");
  assert.equal(
    extractUserPromptText([
      { type: "text", text: "Need help" },
      { type: "image", mimeType: "image/png", data: "..." },
      { type: "text", text: "with this bug" },
    ]),
    "Need help\nwith this bug",
  );
  assert.equal(extractUserPromptText([{ type: "image", mimeType: "image/png", data: "..." }]), null);
});
