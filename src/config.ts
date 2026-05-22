import { pathToFileURL } from "node:url";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import type { ResolvedConfig, TypeConfig, UserConfig } from "./types.js";

/** The default set of commit types and their presentation. */
export const DEFAULT_TYPES: TypeConfig[] = [
  { type: "feat", section: "Features", emoji: "✨" },
  { type: "fix", section: "Bug Fixes", emoji: "🐛" },
  { type: "perf", section: "Performance", emoji: "⚡" },
  { type: "refactor", section: "Refactors", emoji: "♻️" },
  { type: "revert", section: "Reverts", emoji: "⏪" },
  { type: "docs", section: "Documentation", emoji: "📝" },
  { type: "style", section: "Styles", emoji: "💄", hidden: true },
  { type: "test", section: "Tests", emoji: "✅", hidden: true },
  { type: "build", section: "Build System", emoji: "📦", hidden: true },
  { type: "ci", section: "Continuous Integration", emoji: "🤖", hidden: true },
  { type: "chore", section: "Chores", emoji: "🔧", hidden: true },
];

/** The baseline resolved config used when no user config is found. */
export const DEFAULT_CONFIG: ResolvedConfig = {
  types: DEFAULT_TYPES,
  otherSection: "Other Changes",
  otherEmoji: "🔀",
  emoji: true,
  authors: true,
  authorAvatars: false,
  linkReferences: true,
  groupByScope: false,
  includeNonConventional: false,
  output: "CHANGELOG.md",
};

const CONFIG_FILENAMES = [
  "relnotes.config.ts",
  "relnotes.config.mjs",
  "relnotes.config.js",
  "relnotes.config.cjs",
  "relnotes.config.json",
  ".relnotesrc.json",
  ".relnotesrc",
];

/** Find a config file in the given directory, returning its path or null. */
export function findConfigFile(cwd: string): string | null {
  for (const name of CONFIG_FILENAMES) {
    const full = path.join(cwd, name);
    if (existsSync(full)) return full;
  }
  return null;
}

/** Read and parse a config file (json or js/mjs/cjs module). */
async function readConfigFile(file: string): Promise<UserConfig> {
  const ext = path.extname(file).toLowerCase();
  if (ext === ".json" || file.endsWith(".relnotesrc") || ext === "") {
    const raw = await readFile(file, "utf8");
    return JSON.parse(raw) as UserConfig;
  }
  // .js / .mjs / .cjs / .ts — import as a module.
  const mod = (await import(pathToFileURL(file).href)) as {
    default?: UserConfig;
  } & UserConfig;
  return (mod.default ?? mod) as UserConfig;
}

/** Read the `relnotes` field from package.json if present. */
async function readPackageConfig(cwd: string): Promise<UserConfig | null> {
  const pkgPath = path.join(cwd, "package.json");
  if (!existsSync(pkgPath)) return null;
  try {
    const pkg = JSON.parse(await readFile(pkgPath, "utf8")) as {
      relnotes?: UserConfig;
    };
    return pkg.relnotes ?? null;
  } catch {
    return null;
  }
}

/**
 * Merge user types with defaults. User entries override defaults of the same
 * type; new types are appended. Order follows: user-specified order first,
 * then any remaining defaults that weren't overridden.
 */
export function mergeTypes(
  defaults: TypeConfig[],
  user: TypeConfig[] | undefined,
): TypeConfig[] {
  if (!user || user.length === 0) return defaults;
  const byType = new Map<string, TypeConfig>();
  for (const d of defaults) byType.set(d.type, d);

  const ordered: TypeConfig[] = [];
  const usedDefaults = new Set<string>();
  for (const u of user) {
    const base = byType.get(u.type);
    ordered.push({ ...base, ...u });
    usedDefaults.add(u.type);
  }
  // Keep remaining defaults that weren't mentioned, preserving default order.
  for (const d of defaults) {
    if (!usedDefaults.has(d.type)) ordered.push(d);
  }
  return ordered;
}

/** Merge a partial user config over the baseline. */
export function mergeConfig(
  base: ResolvedConfig,
  user: UserConfig | null | undefined,
): ResolvedConfig {
  if (!user) return base;
  const { types, ...rest } = user;
  return {
    ...base,
    ...stripUndefined(rest),
    types: mergeTypes(base.types, types),
  };
}

function stripUndefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  }
  return out;
}

/**
 * Load configuration: explicit path > config file > package.json > defaults.
 */
export async function loadConfig(
  cwd: string,
  explicitPath?: string,
): Promise<ResolvedConfig> {
  let userConfig: UserConfig | null = null;

  if (explicitPath) {
    const full = path.isAbsolute(explicitPath)
      ? explicitPath
      : path.join(cwd, explicitPath);
    if (!existsSync(full)) {
      throw new Error(`Config file not found: ${full}`);
    }
    userConfig = await readConfigFile(full);
  } else {
    const found = findConfigFile(cwd);
    if (found) {
      userConfig = await readConfigFile(found);
    } else {
      userConfig = await readPackageConfig(cwd);
    }
  }

  return mergeConfig(DEFAULT_CONFIG, userConfig);
}

/** Look up the TypeConfig for a given commit type. */
export function findTypeConfig(
  config: ResolvedConfig,
  type: string | null,
): TypeConfig | null {
  if (!type) return null;
  return config.types.find((t) => t.type === type) ?? null;
}
