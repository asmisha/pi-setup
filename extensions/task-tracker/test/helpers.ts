import type { KnownLedgerEvent } from "../src/types.ts";
import { applyTaskTrackerAction, applyTaskTrackerInput } from "../src/actions.ts";
import { buildBootstrapEvents } from "../src/bootstrap.ts";
import { projectLedger } from "../src/projector.ts";
import type { ProjectedState, TaskTrackerAction, TaskTrackerAtomicAction } from "../src/types.ts";

export function createDeterministicIdFactory() {
  let counter = 0;
  return (prefix: string) => {
    counter += 1;
    return `${prefix}_${String(counter).padStart(3, "0")}`;
  };
}

export function bootstrap(objective = "Ship task tracker") {
  const nextId = createDeterministicIdFactory();
  const now = "2026-04-18T10:00:00.000Z";
  const events = buildBootstrapEvents({ objective, now, nextId, sourceMessageId: "m1" });
  return {
    nextId,
    now,
    events,
    state: projectLedger(events, now),
  };
}

export function applyAction(
  state: ProjectedState,
  action: TaskTrackerAtomicAction | TaskTrackerAction,
  options?: Partial<Parameters<typeof applyTaskTrackerAction>[2]> & { priorEvents?: KnownLedgerEvent[] },
) {
  const nextId = options?.nextId ?? createDeterministicIdFactory();
  const priorEvents = options?.priorEvents ?? [];
  const result = applyTaskTrackerInput(state, priorEvents, "actions" in action ? action : { actions: [action] }, {
    now: options?.now ?? "2026-04-18T10:05:00.000Z",
    actor: options?.actor ?? "assistant",
    authority: options?.authority ?? "authoritative",
    maxInferredTasksPerTurn: options?.maxInferredTasksPerTurn ?? 3,
    createdInferredTasksThisTurn: options?.createdInferredTasksThisTurn ?? 0,
    nextId,
  });
  const nextEvents = [...priorEvents, ...result.events] as KnownLedgerEvent[];
  return {
    result,
    nextEvents,
    nextState: projectLedger(nextEvents),
  };
}
