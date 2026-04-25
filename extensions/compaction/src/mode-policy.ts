import type { CompactionMode, StoredCompactionMode } from "./session-config.ts";

export type CompactionExecutionMode = "local" | "pi-vcc" | "pi-lcm" | "open";

export function resolveCompactionExecutionMode(mode: StoredCompactionMode, piVccAvailable: boolean, piLcmAvailable = false): CompactionExecutionMode {
  if (mode === "local") return "local";
  if (mode === "pi-vcc") return piVccAvailable ? "pi-vcc" : "open";
  if (mode === "pi-lcm") return piLcmAvailable ? "pi-lcm" : "open";
  return piVccAvailable ? "pi-vcc" : "local";
}

export function canSelectCompactionMode(mode: CompactionMode, piVccAvailable: boolean, piLcmAvailable = false): boolean {
  if (mode === "local") return true;
  if (mode === "pi-vcc") return piVccAvailable;
  return piLcmAvailable;
}

export function formatPiVccUnavailableMessage(reason: string): string {
  return `pi-vcc compaction is selected for this session, but ${reason}. Compaction will fail open until pi-vcc becomes available.`;
}
