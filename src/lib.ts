/**
 * Public library API for relnotes. Importable as `import { generate } from "relnotes"`.
 */
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

import { loadConfig } from "./config.js";
import {
  getCommits,
  getRepoInfo,
  isGitRepo,
  latestTag,
  previousTag,
} from "./git.js";
import { parseCommits } from "./parser.js";
import {
  aggregateContributors,
  groupCommits,
  renderBody,
  renderRelease,
} from "./render.js";
import { stripV, today } from "./util.js";
import type {
  GenerateOptions,
  ReleaseContext,
  ResolvedConfig,
} from "./types.js";

export * from "./types.js";
export { loadConfig, DEFAULT_CONFIG, DEFAULT_TYPES } from "./config.js";
export { parseCommit, parseCommits, extractReferences, parseFooters } from "./parser.js";
export {
  renderRelease,
  renderBody,
  groupCommits,
  aggregateContributors,
} from "./render.js";
export { prependRelease, updateChangelogFile, hasVersion } from "./changelog.js";
export { createRelease } from "./github.js";
export {
  getCommits,
  getRepoInfo,
  latestTag,
  previousTag,
  isGitRepo,
  hasCommits,
  parseRemoteUrl,
} from "./git.js";

export interface GenerateResult {
  /** The release context (groups, contributors, repo, etc.). */
  context: ReleaseContext;
  /** Markdown including the version heading (for CHANGELOG.md). */
  changelogSection: string;
  /** Markdown body without the heading (for GitHub release notes). */
  releaseNotes: string;
  /** Resolved version label. */
  version: string;
  /** The from/to range used. */
  range: { from: string | null; to: string };
}

/** Try to read the version from package.json in cwd. */
async function readPackageVersion(cwd: string): Promise<string | null> {
  const pkgPath = path.join(cwd, "package.json");
  if (!existsSync(pkgPath)) return null;
  try {
    const pkg = JSON.parse(await readFile(pkgPath, "utf8")) as {
      version?: string;
    };
    return pkg.version ?? null;
  } catch {
    return null;
  }
}

/**
 * Resolve the version label: explicit option > package.json > stripped latest
 * tag > "Unreleased".
 */
async function resolveVersion(
  cwd: string,
  explicit: string | undefined,
  latest: string | null,
): Promise<string> {
  if (explicit) return explicit;
  const pkgVersion = await readPackageVersion(cwd);
  if (pkgVersion) return pkgVersion;
  if (latest) return stripV(latest);
  return "Unreleased";
}

/**
 * Core generation pipeline. Reads git, parses commits, builds the release
 * context, and renders markdown. Does not write any files.
 */
export async function generate(
  options: GenerateOptions = {},
): Promise<GenerateResult> {
  const cwd = options.cwd ?? process.cwd();

  if (!(await isGitRepo(cwd))) {
    throw new Error(`Not a git repository: ${cwd}`);
  }

  const config = await applyOverrides(
    await loadConfig(cwd, options.config),
    options,
  );

  const latest = await latestTag(cwd);

  // Resolve range. Default from = latest tag; to = HEAD.
  const to = options.to ?? "HEAD";
  let from: string | null;
  if (options.from !== undefined) {
    from = options.from || null;
  } else if (options.to !== undefined) {
    // If a specific `to` tag was given, use the tag before it for the range.
    from = (await previousTag(cwd, options.to)) ?? latest;
  } else {
    from = latest;
  }

  const raw = await getCommits(cwd, from, to);
  const commits = parseCommits(raw);

  const repo = await getRepoInfo(cwd, config.repository ?? options.repo);
  const groups = groupCommits(commits, config);
  const breaking = commits.filter((c) => c.breaking);
  const contributors = config.authors ? aggregateContributors(commits) : [];

  const version = await resolveVersion(cwd, options.version, latest ?? to);

  // previousTag for compare links: when `from` is a tag, link from it.
  const previousRef =
    from && from !== "" ? from : (latest ?? undefined);

  const context: ReleaseContext = {
    version,
    ...(previousRef ? { previousTag: previousRef } : {}),
    currentRef: to,
    date: today(),
    repo,
    groups,
    breaking,
    contributors,
    config,
  };

  return {
    context,
    changelogSection: renderRelease(context),
    releaseNotes: renderBody(context),
    version,
    range: { from, to },
  };
}

/** Apply CLI flag overrides onto the resolved config. */
async function applyOverrides(
  config: ResolvedConfig,
  options: GenerateOptions,
): Promise<ResolvedConfig> {
  const next: ResolvedConfig = { ...config };
  if (options.emoji === false) next.emoji = false;
  if (options.authors === false) next.authors = false;
  if (options.output) next.output = options.output;
  if (options.repo) next.repository = options.repo;
  return next;
}
