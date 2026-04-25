import type { SessionEntry } from "@mariozechner/pi-coding-agent";

export const COMPACTION_MODE_ENTRY_TYPE = "compaction-extension-mode";
export const COMPACTION_MODES = ["local", "pi-vcc", "pi-lcm"] as const;
export type CompactionMode = (typeof COMPACTION_MODES)[number];
export type StoredCompactionMode = CompactionMode | null;

export type CompactionModeEntry = {
  mode: CompactionMode;
  updatedAt: string;
};

export const DEFAULT_COMPACTION_MODE: CompactionMode = "local";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

export function parseCompactionMode(value: string | null | undefined): CompactionMode | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === "local") return "local";
  if (normalized === "pi-vcc" || normalized === "pi_vcc" || normalized === "pivcc" || normalized === "vcc") return "pi-vcc";
  if (normalized === "pi-lcm" || normalized === "pi_lcm" || normalized === "pilcm" || normalized === "lcm") return "pi-lcm";
  return null;
}

export function readStoredCompactionMode(entries: SessionEntry[]): StoredCompactionMode {
  let current: StoredCompactionMode = null;
  for (const entry of entries) {
    if (entry.type !== "custom" || entry.customType !== COMPACTION_MODE_ENTRY_TYPE) continue;
    if (!isRecord(entry.data)) continue;
    const parsed = parseCompactionMode(typeof entry.data.mode === "string" ? entry.data.mode : null);
    if (!parsed) continue;
    current = parsed;
  }
  return current;
}

export function readCompactionMode(entries: SessionEntry[], piVccAvailable = false): CompactionMode {
  return readStoredCompactionMode(entries) ?? (piVccAvailable ? "pi-vcc" : DEFAULT_COMPACTION_MODE);
}

export function buildCompactionModeEntry(mode: CompactionMode, updatedAt: string): CompactionModeEntry {
  return { mode, updatedAt };
}

export function formatCompactionMode(mode: CompactionMode): string {
  if (mode === "pi-vcc") return "pi-vcc";
  if (mode === "pi-lcm") return "pi-lcm";
  return "local";
}

export function getCompactionModeChoices(): string[] {
  return [...COMPACTION_MODES];
}
