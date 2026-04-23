import type { CompactionMode, StoredCompactionMode } from "./session-config.ts";

export type CompactionExecutionMode = "local" | "pi-vcc" | "open";

export function resolveCompactionExecutionMode(mode: StoredCompactionMode, piVccAvailable: boolean): CompactionExecutionMode {
  if (mode === "local") return "local";
  if (mode === "pi-vcc") return piVccAvailable ? "pi-vcc" : "open";
  return piVccAvailable ? "pi-vcc" : "local";
}

export function canSelectCompactionMode(mode: CompactionMode, piVccAvailable: boolean): boolean {
  if (mode === "local") return true;
  return piVccAvailable;
}

export function formatPiVccUnavailableMessage(reason: string): string {
  return `pi-vcc compaction is selected for this session, but ${reason}. Compaction will fail open until pi-vcc becomes available.`;
}
