import type { SessionEntry } from "@mariozechner/pi-coding-agent";

export const COMPACTION_MODE_ENTRY_TYPE = "compaction-extension-mode";
export const COMPACTION_MODES = ["local", "pi-vcc"] as const;
export type CompactionMode = (typeof COMPACTION_MODES)[number];

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
  return null;
}

export function readCompactionMode(entries: SessionEntry[]): CompactionMode {
  let current = DEFAULT_COMPACTION_MODE;
  for (const entry of entries) {
    if (entry.type !== "custom" || entry.customType !== COMPACTION_MODE_ENTRY_TYPE) continue;
    if (!isRecord(entry.data)) continue;
    const parsed = parseCompactionMode(typeof entry.data.mode === "string" ? entry.data.mode : null);
    if (!parsed) continue;
    current = parsed;
  }
  return current;
}

export function buildCompactionModeEntry(mode: CompactionMode, updatedAt: string): CompactionModeEntry {
  return { mode, updatedAt };
}

export function formatCompactionMode(mode: CompactionMode): string {
  return mode === "pi-vcc" ? "pi-vcc" : "local";
}

export function getCompactionModeChoices(): string[] {
  return [...COMPACTION_MODES];
}
