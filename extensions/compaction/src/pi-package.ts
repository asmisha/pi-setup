import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

export type PiPackageManifest = {
  name?: string;
  version?: string;
  main?: string;
  pi?: {
    extensions?: string[];
  };
};

export type ResolvedPiExtensionPackage = {
  packageName: string;
  packageJsonPath: string;
  packageRoot: string;
  entryPath: string;
  manifest: PiPackageManifest;
};

let cachedGlobalNpmRoot: string | null | undefined;

function readManifest(packageJsonPath: string): PiPackageManifest | null {
  try {
    return JSON.parse(readFileSync(packageJsonPath, "utf8")) as PiPackageManifest;
  } catch {
    return null;
  }
}

function getGlobalNpmRoot(): string | null {
  if (cachedGlobalNpmRoot !== undefined) return cachedGlobalNpmRoot;
  try {
    const output = execFileSync("npm", ["root", "-g"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5_000,
    }).trim();
    cachedGlobalNpmRoot = output || null;
  } catch {
    cachedGlobalNpmRoot = null;
  }
  return cachedGlobalNpmRoot;
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (!value) continue;
    const resolved = resolve(value);
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    result.push(resolved);
  }
  return result;
}

function candidatePackageJsonFromRoot(root: string, packageName: string): string | null {
  const packageJsonPath = join(root, packageName, "package.json");
  return existsSync(packageJsonPath) ? packageJsonPath : null;
}

function resolvePackageJsonWithRequire(basePath: string, packageName: string): string | null {
  try {
    const requireFromBase = createRequire(basePath);
    return requireFromBase.resolve(`${packageName}/package.json`);
  } catch {
    return null;
  }
}

function getNodePathRoots(): string[] {
  return (process.env.NODE_PATH ?? "")
    .split(":")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function getPackageLookupRoots(cwd: string): string[] {
  return uniqueStrings([
    join(cwd, ".pi", "npm", "node_modules"),
    join(homedir(), ".pi", "agent", "npm", "node_modules"),
    ...getNodePathRoots(),
    getGlobalNpmRoot(),
    "/usr/lib/node_modules",
    "/usr/local/lib/node_modules",
  ]);
}

function resolvePackageJsonPath(cwd: string, packageName: string): string | null {
  const requireHits = [
    resolvePackageJsonWithRequire(resolve(cwd, "__pi_compaction_package_probe__.cjs"), packageName),
    resolvePackageJsonWithRequire(import.meta.url, packageName),
  ];
  for (const hit of requireHits) {
    if (hit && existsSync(hit)) return hit;
  }

  for (const root of getPackageLookupRoots(cwd)) {
    const hit = candidatePackageJsonFromRoot(root, packageName);
    if (hit) return hit;
  }

  return null;
}

export function resolveExtensionEntryPath(packageRoot: string, manifest: PiPackageManifest): string {
  const configured = Array.isArray(manifest.pi?.extensions)
    ? manifest.pi?.extensions.find((value): value is string => typeof value === "string" && value.trim().length > 0)
    : null;
  const entry = configured ?? manifest.main ?? "index.ts";
  return resolve(packageRoot, entry);
}

export function resolveInstalledPiPackage(cwd: string, candidates: readonly string[]): ResolvedPiExtensionPackage | null {
  for (const candidate of candidates) {
    const packageJsonPath = resolvePackageJsonPath(cwd, candidate);
    if (!packageJsonPath) continue;

    const manifest = readManifest(packageJsonPath);
    if (!manifest) continue;

    const packageRoot = dirname(packageJsonPath);
    return {
      packageName: manifest.name?.trim() || candidate,
      packageJsonPath,
      packageRoot,
      entryPath: resolveExtensionEntryPath(packageRoot, manifest),
      manifest,
    };
  }

  return null;
}
