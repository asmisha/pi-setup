import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync, copyFileSync } from "node:fs";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import { stripTypeScriptTypes } from "node:module";
import { pathToFileURL } from "node:url";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { resolveInstalledPiPackage, type ResolvedPiExtensionPackage } from "./pi-package.ts";

export const PI_LCM_PACKAGE_CANDIDATES = ["pi-lcm", "pi-l7"] as const;

export type HostedPiLcmResult =
  | {
      ok: true;
      packageName: string;
      resolvedPath: string;
      packageRoot: string;
      registeredEvents: string[];
    }
  | { ok: false; error: string };

export type PiLcmAvailabilityResult =
  | {
      ok: true;
      packageName: string;
      resolvedPath: string;
      packageRoot: string;
    }
  | { ok: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && (typeof value === "object" || typeof value === "function");
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function resolveRelativeImportSpecifier(specifier: string, sourcePath: string): string {
  if (!specifier.startsWith(".")) return specifier;

  const sourceDir = dirname(sourcePath);
  const resolvedSourceSpecifier = resolve(sourceDir, specifier);

  if (specifier.endsWith(".ts")) return `${specifier.slice(0, -3)}.mjs`;
  if (specifier.endsWith(".js")) {
    const tsAlternative = `${resolvedSourceSpecifier.slice(0, -3)}.ts`;
    return existsSync(tsAlternative) ? `${specifier.slice(0, -3)}.mjs` : specifier;
  }
  if (!extname(specifier)) {
    if (existsSync(`${resolvedSourceSpecifier}.ts`)) return `${specifier}.mjs`;
    if (existsSync(join(resolvedSourceSpecifier, "index.ts"))) return `${specifier}/index.mjs`;
  }
  return specifier;
}

function rewriteModuleSpecifiers(source: string, sourcePath: string): string {
  return source
    .replace(/(from\s+["'])([^"']+)(["'])/g, (_match, prefix: string, specifier: string, suffix: string) => `${prefix}${resolveRelativeImportSpecifier(specifier, sourcePath)}${suffix}`)
    .replace(/(\bimport\s+["'])([^"']+)(["'])/g, (_match, prefix: string, specifier: string, suffix: string) => `${prefix}${resolveRelativeImportSpecifier(specifier, sourcePath)}${suffix}`)
    .replace(/(import\s*\(\s*["'])([^"']+)(["']\s*\))/g, (_match, prefix: string, specifier: string, suffix: string) => `${prefix}${resolveRelativeImportSpecifier(specifier, sourcePath)}${suffix}`);
}

function mirrorPackageTree(sourceDir: string, targetDir: string): void {
  mkdirSync(targetDir, { recursive: true });
  for (const dirent of readdirSync(sourceDir, { withFileTypes: true })) {
    if (dirent.name === "node_modules") continue;
    const sourcePath = join(sourceDir, dirent.name);
    const targetPath = join(targetDir, dirent.name);
    if (dirent.isDirectory()) {
      mirrorPackageTree(sourcePath, targetPath);
      continue;
    }
    if (dirent.isSymbolicLink()) {
      continue;
    }
    if (dirent.isFile() && sourcePath.endsWith(".ts")) {
      const source = readFileSync(sourcePath, "utf8");
      const stripped = stripTypeScriptTypes(source, { mode: "strip" });
      const rewritten = rewriteModuleSpecifiers(stripped, sourcePath);
      writeFileSync(targetPath.replace(/\.ts$/, ".mjs"), rewritten, "utf8");
      continue;
    }
    mkdirSync(dirname(targetPath), { recursive: true });
    copyFileSync(sourcePath, targetPath);
  }
}

function findNearestNodeModulesDir(startPath: string): string | null {
  let current = startPath;
  while (true) {
    if (basename(current) === "node_modules") return current;
    const candidate = join(current, "node_modules");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function ensureRuntimeMirror(resolvedPackage: ResolvedPiExtensionPackage): string {
  const manifestStat = statSync(resolvedPackage.packageJsonPath);
  const entryStat = existsSync(resolvedPackage.entryPath) ? statSync(resolvedPackage.entryPath) : null;
  const cacheKey = createHash("sha1")
    .update(JSON.stringify({
      packageName: resolvedPackage.packageName,
      packageRoot: resolvedPackage.packageRoot,
      packageJsonPath: resolvedPackage.packageJsonPath,
      packageJsonMtimeMs: manifestStat.mtimeMs,
      entryPath: resolvedPackage.entryPath,
      entryMtimeMs: entryStat?.mtimeMs ?? null,
    }))
    .digest("hex");

  const runtimeRoot = join(tmpdir(), "pi-compaction-pi-lcm", cacheKey);
  if (!existsSync(runtimeRoot)) {
    rmSync(runtimeRoot, { recursive: true, force: true });
    mirrorPackageTree(resolvedPackage.packageRoot, runtimeRoot);
    const nodeModulesDir = findNearestNodeModulesDir(resolvedPackage.packageRoot);
    if (nodeModulesDir) {
      symlinkSync(nodeModulesDir, join(runtimeRoot, "node_modules"), "dir");
    }
  }
  return runtimeRoot;
}

async function loadRuntimeModule(resolvedPackage: ResolvedPiExtensionPackage, sourcePath: string): Promise<unknown> {
  const runtimeRoot = ensureRuntimeMirror(resolvedPackage);
  const relativeSourcePath = relative(resolvedPackage.packageRoot, sourcePath);
  const runtimePath = join(runtimeRoot, relativeSourcePath.replace(/\.ts$/, ".mjs"));
  return import(pathToFileURL(runtimePath).href);
}

export function createHostedPiLcmApi(
  pi: ExtensionAPI,
  shouldOwnCompaction: (ctx: ExtensionContext) => boolean | Promise<boolean>,
  onRegister?: (eventName: string) => void,
): ExtensionAPI {
  return new Proxy(pi as any, {
    get(target, property, receiver) {
      if (property === "on") {
        return (eventName: unknown, handler: unknown) => {
          if (typeof eventName === "string") onRegister?.(eventName);
          if (eventName === "session_before_compact" && typeof handler === "function") {
            target.on(eventName, async (event: unknown, ctx: ExtensionContext) => {
              if (!(await shouldOwnCompaction(ctx))) return;
              return await (handler as (event: unknown, ctx: ExtensionContext) => unknown | Promise<unknown>)(event, ctx);
            });
            return;
          }
          return target.on(eventName, handler);
        };
      }

      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as ExtensionAPI;
}

export function resolvePiLcmAvailability(cwd: string): PiLcmAvailabilityResult {
  const resolvedPackage = resolveInstalledPiPackage(cwd, PI_LCM_PACKAGE_CANDIDATES);
  if (!resolvedPackage) {
    return { ok: false, error: `${PI_LCM_PACKAGE_CANDIDATES.join(" or ")} is not installed under ${cwd} or the global npm root` };
  }

  return {
    ok: true,
    packageName: resolvedPackage.packageName,
    resolvedPath: resolvedPackage.entryPath,
    packageRoot: resolvedPackage.packageRoot,
  };
}

export async function installHostedPiLcm(
  pi: ExtensionAPI,
  cwd: string,
  shouldOwnCompaction: (ctx: ExtensionContext) => boolean | Promise<boolean>,
): Promise<HostedPiLcmResult> {
  const resolvedPackage = resolveInstalledPiPackage(cwd, PI_LCM_PACKAGE_CANDIDATES);
  if (!resolvedPackage) {
    return { ok: false, error: `${PI_LCM_PACKAGE_CANDIDATES.join(" or ")} is not installed under ${cwd} or the global npm root` };
  }

  try {
    const imported = await loadRuntimeModule(resolvedPackage, resolvedPackage.entryPath);
    const factory = isRecord(imported) ? imported.default : imported;
    if (typeof factory !== "function") {
      return { ok: false, error: `${resolvedPackage.packageName} was loaded from ${resolvedPackage.entryPath}, but it did not export a Pi extension factory` };
    }

    const registeredEvents = new Set<string>();
    await factory(createHostedPiLcmApi(pi, shouldOwnCompaction, (eventName) => registeredEvents.add(eventName)));
    if (!registeredEvents.has("session_before_compact")) {
      return { ok: false, error: `${resolvedPackage.packageName} was hosted from ${resolvedPackage.entryPath}, but it did not register a session_before_compact hook` };
    }
    return {
      ok: true,
      packageName: resolvedPackage.packageName,
      resolvedPath: resolvedPackage.entryPath,
      packageRoot: resolvedPackage.packageRoot,
      registeredEvents: [...registeredEvents].sort(),
    };
  } catch (error) {
    return { ok: false, error: `failed to host ${resolvedPackage.packageName}: ${getErrorMessage(error)}` };
  }
}

export function formatPiLcmUnavailableMessage(reason: string): string {
  return `pi-lcm/L7 compaction is selected for this session, but ${reason}. Compaction will fail open until pi-lcm becomes available.`;
}
