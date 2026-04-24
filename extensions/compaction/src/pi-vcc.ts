import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync, copyFileSync } from "node:fs";
import { dirname, extname, join, basename, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createRequire, stripTypeScriptTypes } from "node:module";
import { pathToFileURL } from "node:url";
import type {
  ExtensionAPI,
  ExtensionContext,
  SessionBeforeCompactEvent,
  SessionBeforeCompactResult,
  SessionCompactEvent,
  SessionStartEvent,
  SessionTreeEvent,
  TurnEndEvent,
} from "@mariozechner/pi-coding-agent";
import { resolveInstalledPiPackage } from "./pi-package.ts";

export const PI_VCC_PACKAGE_CANDIDATES = ["pi-vcc", "@sting8k/pi-vcc"] as const;

export const ROUTED_COMPACTION_EVENTS = [
  "session_start",
  "session_tree",
  "session_compact",
  "turn_end",
  "session_before_compact",
] as const;

export type RoutedCompactionEventName = (typeof ROUTED_COMPACTION_EVENTS)[number];

export type RoutedCompactionEventMap = {
  session_start: SessionStartEvent;
  session_tree: SessionTreeEvent;
  session_compact: SessionCompactEvent;
  turn_end: TurnEndEvent;
  session_before_compact: SessionBeforeCompactEvent;
};

type AnyHandler = (event: any, ctx: ExtensionContext) => unknown | Promise<unknown>;

type PiPackageManifest = {
  name?: string;
  version?: string;
  main?: string;
  pi?: {
    extensions?: string[];
  };
};

type ResolvedPiVccPackage = {
  packageName: string;
  packageJsonPath: string;
  packageRoot: string;
  entryPath: string;
};

export type PiVccHandlers = {
  [K in RoutedCompactionEventName]?: AnyHandler[];
};

export type PiVccDelegate = {
  packageName: string;
  resolvedPath: string;
  handlers: PiVccHandlers;
  compactionInstruction: string | null;
};

export type LoadPiVccDelegateResult =
  | { ok: true; delegate: PiVccDelegate }
  | { ok: false; error: string };

const DIRECT_HANDLER_KEYS: Record<RoutedCompactionEventName, string[]> = {
  session_start: ["sessionStart", "session_start"],
  session_tree: ["sessionTree", "session_tree"],
  session_compact: ["sessionCompact", "session_compact"],
  turn_end: ["turnEnd", "turn_end"],
  session_before_compact: ["sessionBeforeCompact", "session_before_compact"],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && (typeof value === "object" || typeof value === "function");
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function pushHandler(handlers: PiVccHandlers, eventName: RoutedCompactionEventName, handler: AnyHandler): void {
  const existing = handlers[eventName] ?? [];
  existing.push(handler);
  handlers[eventName] = existing;
}

function mergeHandlers(target: PiVccHandlers, source: PiVccHandlers): void {
  for (const eventName of ROUTED_COMPACTION_EVENTS) {
    const handlers = source[eventName];
    if (!handlers || handlers.length === 0) continue;
    for (const handler of handlers) pushHandler(target, eventName, handler);
  }
}

function hasAnyHandlers(handlers: PiVccHandlers): boolean {
  return ROUTED_COMPACTION_EVENTS.some((eventName) => (handlers[eventName]?.length ?? 0) > 0);
}

function normalizeSessionBeforeCompactResult(result: unknown): SessionBeforeCompactResult | undefined {
  if (!result) return;
  if (isRecord(result) && ("cancel" in result || "compaction" in result)) {
    return result as SessionBeforeCompactResult;
  }
  if (
    isRecord(result)
    && typeof result.summary === "string"
    && typeof result.firstKeptEntryId === "string"
    && typeof result.tokensBefore === "number"
  ) {
    return {
      compaction: {
        summary: result.summary,
        firstKeptEntryId: result.firstKeptEntryId,
        tokensBefore: result.tokensBefore,
        details: result.details,
      },
    };
  }
  return;
}

function wrapCompactFunction(compactFn: (...args: any[]) => unknown): AnyHandler {
  return async (event: SessionBeforeCompactEvent, ctx: ExtensionContext) => {
    if (!ctx.model) return;
    const auth = await ctx.modelRegistry.getApiKeyAndHeaders(ctx.model);
    if (!auth.ok || !auth.apiKey) return;
    const result = await compactFn(
      event.preparation,
      ctx.model,
      auth.apiKey,
      auth.headers,
      event.customInstructions,
      event.signal,
    );
    return normalizeSessionBeforeCompactResult(result);
  };
}

function collectObjectHandlers(source: Record<string, unknown>, handlers: PiVccHandlers): void {
  for (const eventName of ROUTED_COMPACTION_EVENTS) {
    for (const key of DIRECT_HANDLER_KEYS[eventName]) {
      const candidate = source[key];
      if (typeof candidate !== "function") continue;
      pushHandler(handlers, eventName, candidate as AnyHandler);
      break;
    }
  }

  if ((handlers.session_before_compact?.length ?? 0) === 0) {
    const compactCandidate = source.compact;
    if (typeof compactCandidate === "function") {
      pushHandler(handlers, "session_before_compact", wrapCompactFunction(compactCandidate as (...args: any[]) => unknown));
    }
  }
}

async function captureHandlersFromFactory(factory: (api: ExtensionAPI) => unknown): Promise<PiVccHandlers> {
  const captured: PiVccHandlers = {};
  const api = new Proxy({}, {
    get(_target, property) {
      if (property === "on") {
        return (eventName: unknown, handler: unknown) => {
          if (typeof eventName !== "string" || typeof handler !== "function") return;
          if (!ROUTED_COMPACTION_EVENTS.includes(eventName as RoutedCompactionEventName)) return;
          pushHandler(captured, eventName as RoutedCompactionEventName, handler as AnyHandler);
        };
      }
      return () => undefined;
    },
  }) as ExtensionAPI;

  await Promise.resolve(factory(api));
  return captured;
}

function resolveRelativeImportSpecifier(specifier: string): string {
  if (!specifier.startsWith(".")) return specifier;
  if (specifier.endsWith(".ts")) return `${specifier.slice(0, -3)}.mjs`;
  if (!extname(specifier)) return `${specifier}.mjs`;
  return specifier;
}

function rewriteModuleSpecifiers(source: string): string {
  return source
    .replace(/(from\s+["'])([^"']+)(["'])/g, (_match, prefix: string, specifier: string, suffix: string) => `${prefix}${resolveRelativeImportSpecifier(specifier)}${suffix}`)
    .replace(/(\bimport\s+["'])([^"']+)(["'])/g, (_match, prefix: string, specifier: string, suffix: string) => `${prefix}${resolveRelativeImportSpecifier(specifier)}${suffix}`)
    .replace(/(import\s*\(\s*["'])([^"']+)(["']\s*\))/g, (_match, prefix: string, specifier: string, suffix: string) => `${prefix}${resolveRelativeImportSpecifier(specifier)}${suffix}`);
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
      const rewritten = rewriteModuleSpecifiers(stripped);
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

function ensureRuntimeMirror(resolvedPackage: ResolvedPiVccPackage): string {
  const manifestStat = statSync(resolvedPackage.packageJsonPath);
  const cacheKey = createHash("sha1")
    .update(JSON.stringify({
      packageName: resolvedPackage.packageName,
      packageRoot: resolvedPackage.packageRoot,
      packageJsonPath: resolvedPackage.packageJsonPath,
      packageJsonMtimeMs: manifestStat.mtimeMs,
      entryPath: resolvedPackage.entryPath,
    }))
    .digest("hex");

  const runtimeRoot = join(tmpdir(), "pi-compaction-pi-vcc", cacheKey);
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

function resolveExtensionEntryPath(packageRoot: string, manifest: PiPackageManifest): string {
  const configured = Array.isArray(manifest.pi?.extensions) ? manifest.pi?.extensions.find((value): value is string => typeof value === "string" && value.trim().length > 0) : null;
  const entry = configured ?? manifest.main ?? "index.ts";
  return resolve(packageRoot, entry);
}

function resolveInstalledPiVccPackage(cwd: string): ResolvedPiVccPackage | null {
  return resolveInstalledPiPackage(cwd, PI_VCC_PACKAGE_CANDIDATES);
}

async function loadRuntimeModule(resolvedPackage: ResolvedPiVccPackage, sourcePath: string): Promise<unknown> {
  const runtimeRoot = ensureRuntimeMirror(resolvedPackage);
  const relativeSourcePath = relative(resolvedPackage.packageRoot, sourcePath);
  const runtimePath = join(runtimeRoot, relativeSourcePath.replace(/\.ts$/, ".mjs"));
  return import(pathToFileURL(runtimePath).href);
}

async function readCompactionInstruction(resolvedPackage: ResolvedPiVccPackage): Promise<string | null> {
  const hookSourcePath = resolve(resolvedPackage.packageRoot, "src/hooks/before-compact.ts");
  if (!existsSync(hookSourcePath)) return null;
  try {
    const hookModule = await loadRuntimeModule(resolvedPackage, hookSourcePath) as Record<string, unknown>;
    return typeof hookModule.PI_VCC_COMPACT_INSTRUCTION === "string" ? hookModule.PI_VCC_COMPACT_INSTRUCTION : null;
  } catch {
    return null;
  }
}

export async function resolvePiVccHandlersFromModule(moduleValue: unknown): Promise<PiVccHandlers> {
  const handlers: PiVccHandlers = {};
  if (isRecord(moduleValue)) {
    collectObjectHandlers(moduleValue, handlers);
    const defaultExport = moduleValue.default;
    if (isRecord(defaultExport)) {
      collectObjectHandlers(defaultExport, handlers);
    }
    if (typeof defaultExport === "function") {
      try {
        const captured = await captureHandlersFromFactory(defaultExport as (api: ExtensionAPI) => unknown);
        mergeHandlers(handlers, captured);
      } catch {
        // default export may be a direct handler instead of an extension factory
      }
      if (!hasAnyHandlers(handlers)) {
        pushHandler(handlers, "session_before_compact", defaultExport as AnyHandler);
      }
    }
    return handlers;
  }

  if (typeof moduleValue === "function") {
    try {
      const captured = await captureHandlersFromFactory(moduleValue as (api: ExtensionAPI) => unknown);
      mergeHandlers(handlers, captured);
    } catch {
      // module may itself be a direct handler instead of an extension factory
    }
    if (!hasAnyHandlers(handlers)) {
      pushHandler(handlers, "session_before_compact", moduleValue as AnyHandler);
    }
  }
  return handlers;
}

export async function loadPiVccDelegate(cwd: string): Promise<LoadPiVccDelegateResult> {
  const resolvedPackage = resolveInstalledPiVccPackage(cwd);
  if (!resolvedPackage) {
    return { ok: false, error: `${PI_VCC_PACKAGE_CANDIDATES.join(" or ")} is not installed under ${cwd}` };
  }

  try {
    const imported = await loadRuntimeModule(resolvedPackage, resolvedPackage.entryPath);
    const handlers = await resolvePiVccHandlersFromModule(imported);
    if (!hasAnyHandlers(handlers)) {
      return { ok: false, error: `${resolvedPackage.packageName} was loaded from ${resolvedPackage.entryPath}, but it did not expose supported compaction hooks` };
    }
    return {
      ok: true,
      delegate: {
        packageName: resolvedPackage.packageName,
        resolvedPath: resolvedPackage.entryPath,
        handlers,
        compactionInstruction: await readCompactionInstruction(resolvedPackage),
      },
    };
  } catch (error) {
    return { ok: false, error: `failed to load ${resolvedPackage.packageName}: ${getErrorMessage(error)}` };
  }
}

export async function invokePiVccHandlers<K extends RoutedCompactionEventName>(
  delegate: PiVccDelegate,
  eventName: K,
  event: RoutedCompactionEventMap[K],
  ctx: ExtensionContext,
): Promise<unknown> {
  const handlers = delegate.handlers[eventName] ?? [];
  if (handlers.length === 0) return;

  if (eventName === "session_before_compact") {
    for (const handler of handlers) {
      const result = await handler(event, ctx);
      const normalized = normalizeSessionBeforeCompactResult(result);
      if (normalized) return normalized;
      if (result !== undefined) {
        throw new Error("pi-vcc session_before_compact handler returned an unsupported result shape");
      }
    }
    return;
  }

  for (const handler of handlers) {
    await handler(event, ctx);
  }
}

export function hasPiVccHandler(delegate: PiVccDelegate, eventName: RoutedCompactionEventName): boolean {
  return (delegate.handlers[eventName]?.length ?? 0) > 0;
}

export function canAutoUsePiVccDelegate(delegate: PiVccDelegate): boolean {
  return hasPiVccHandler(delegate, "turn_end") || (hasPiVccHandler(delegate, "session_before_compact") && delegate.compactionInstruction !== null);
}
