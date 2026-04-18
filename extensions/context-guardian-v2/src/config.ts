export const EXTENSION_ID = "context-guardian-v2";
export const ENV_ENABLE_FLAG = "PI_CONTEXT_GUARDIAN_V2_ENABLED";
export const SOFT_COMPACTION_THRESHOLD_PERCENT = 60;
export const MIN_COMPACTION_INTERVAL_MS = 30_000;
export const MAX_INFERRED_TASKS_PER_TURN = 3;
export const SUMMARY_MAX_TOKENS = 2048;

export function isExtensionEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env[ENV_ENABLE_FLAG]?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}
