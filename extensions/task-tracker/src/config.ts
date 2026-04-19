export const PI_SUBAGENT_DEPTH_ENV = "PI_SUBAGENT_DEPTH";
export const MAX_INFERRED_TASKS_PER_TURN = 3;

export function isSubagentProcess(env: NodeJS.ProcessEnv = process.env): boolean {
  const depth = Number.parseInt(env[PI_SUBAGENT_DEPTH_ENV] ?? "0", 10);
  return Number.isFinite(depth) && depth > 0;
}
