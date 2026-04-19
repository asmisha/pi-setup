import type { KnownLedgerEvent, LedgerEventType, PersistedLedgerEventData } from "./types.ts";
import { ENTRY_TYPES, LEGACY_ENTRY_TYPE_ALIASES } from "./types.ts";

const LEDGER_EVENT_TYPES = new Set<string>([
  ...Object.values(ENTRY_TYPES),
  ...Object.keys(LEGACY_ENTRY_TYPE_ALIASES),
]);

export function isLedgerEventType(value: unknown): value is LedgerEventType | keyof typeof LEGACY_ENTRY_TYPE_ALIASES {
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
    const customType = LEGACY_ENTRY_TYPE_ALIASES[record.customType] ?? record.customType;
    result.push({
      type: customType,
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

