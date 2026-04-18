import type { KnownLedgerEvent, LedgerEventType, PersistedLedgerEventData } from "./types.ts";
import { ENTRY_TYPES } from "./types.ts";
import { normalizeAdvisory } from "./compaction.ts";

const LEDGER_EVENT_TYPES = new Set<string>(Object.values(ENTRY_TYPES));

export function isLedgerEventType(value: unknown): value is LedgerEventType {
  return typeof value === "string" && LEDGER_EVENT_TYPES.has(value);
}

export function serializeEventData(event: KnownLedgerEvent): PersistedLedgerEventData {
  const { type: _type, ...data } = event;
  return data;
}

export function loadLedgerEvents(branchEntries: Array<unknown>): KnownLedgerEvent[] {
  const result: KnownLedgerEvent[] = [];
  for (const entry of branchEntries) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    if (record.type !== "custom") continue;
    if (!isLedgerEventType(record.customType)) continue;
    if (!record.data || typeof record.data !== "object") continue;
    const data = record.data as PersistedLedgerEventData;
    result.push({
      type: record.customType,
      actor: data.actor,
      authority: data.authority,
      sourceMessageId: data.sourceMessageId,
      sourceEntryId: data.sourceEntryId,
      createdAt: data.createdAt,
      payload: data.payload,
    } as KnownLedgerEvent);
  }
  return result;
}

export function extractAdvisoryFromCompactionDetails(details: unknown, now: string) {
  if (!details || typeof details !== "object") return null;
  const record = details as Record<string, unknown>;
  if (!("advisory" in record)) return null;
  return normalizeAdvisory(record.advisory, now);
}
