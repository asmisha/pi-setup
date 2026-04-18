export const EXTENSION_ID = "context-guardian-v2";
export const ENV_ENABLE_FLAG = "PI_CONTEXT_GUARDIAN_V2_ENABLED";
export const SOFT_COMPACTION_THRESHOLD_PERCENT = 60;
export const MIN_COMPACTION_INTERVAL_MS = 30_000;
export const MAX_INFERRED_TASKS_PER_TURN = 3;
export const SUMMARY_MAX_TOKENS = 2048;

const DISABLED_VALUES = new Set(["0", "false", "no", "off"]);
const ENABLED_VALUES = new Set(["1", "true", "yes", "on"]);

export function isExtensionEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env[ENV_ENABLE_FLAG]?.trim().toLowerCase();
  if (!value) return true;
  if (DISABLED_VALUES.has(value)) return false;
  if (ENABLED_VALUES.has(value)) return true;
  return true;
}
