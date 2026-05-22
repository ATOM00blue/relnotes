import { writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { Command } from "commander";
import pc from "picocolors";

import { generate } from "./lib.js";
import { updateChangelogFile, hasVersion, readChangelog } from "./changelog.js";
import { createRelease } from "./github.js";
import { DEFAULT_CONFIG } from "./config.js";
import type { GenerateOptions } from "./types.js";

const VERSION = "0.1.0";

interface SharedFlags {
  from?: string;
  to?: string;
  releaseVersion?: string;
  output?: string;
  stdout?: boolean;
  dryRun?: boolean;
  emoji?: boolean;
  authors?: boolean;
  repo?: string;
  config?: string;
}

function toOptions(flags: SharedFlags): GenerateOptions {
  return {
    ...(flags.from !== undefined ? { from: flags.from } : {}),
    ...(flags.to !== undefined ? { to: flags.to } : {}),
    ...(flags.releaseVersion !== undefined
      ? { version: flags.releaseVersion }
      : {}),
    ...(flags.output !== undefined ? { output: flags.output } : {}),
    ...(flags.stdout !== undefined ? { stdout: flags.stdout } : {}),
    ...(flags.dryRun !== undefined ? { dryRun: flags.dryRun } : {}),
    ...(flags.emoji !== undefined ? { emoji: flags.emoji } : {}),
    ...(flags.authors !== undefined ? { authors: flags.authors } : {}),
    ...(flags.repo !== undefined ? { repo: flags.repo } : {}),
    ...(flags.config !== undefined ? { config: flags.config } : {}),
  };
}

function info(msg: string): void {
  process.stderr.write(`${pc.cyan("relnotes")} ${msg}\n`);
}
function success(msg: string): void {
  process.stderr.write(`${pc.green("✔")} ${msg}\n`);
}
function warn(msg: string): void {
  process.stderr.write(`${pc.yellow("!")} ${msg}\n`);
}
function fail(msg: string): void {
  process.stderr.write(`${pc.red("✖")} ${msg}\n`);
}

async function runGenerate(flags: SharedFlags): Promise<void> {
  const options = toOptions(flags);
  const result = await generate(options);

  const { context, changelogSection } = result;
  const totalCommits = context.groups.reduce(
    (n, g) => n + g.commits.length,
    0,
  );

  if (totalCommits === 0 && context.breaking.length === 0) {
    warn(
      `No notable commits found in range ${result.range.from ?? "(start)"}..${result.range.to}.`,
    );
  }

  // stdout mode: print the section and exit (no file writes).
  if (flags.stdout) {
    process.stdout.write(changelogSection.endsWith("\n") ? changelogSection : changelogSection + "\n");
    return;
  }

  const output = options.output ?? DEFAULT_CONFIG.output;
  const outputPath = path.isAbsolute(output)
    ? output
    : path.join(options.cwd ?? process.cwd(), output);

  if (flags.dryRun) {
    info(`Dry run — would write ${pc.bold(output)}:`);
    process.stdout.write("\n" + changelogSection + "\n");
    return;
  }

  const existing = await readChangelog(outputPath);
  if (existing && hasVersion(existing, context.version)) {
    warn(
      `${output} already contains a section for ${pc.bold(context.version)}. Skipping write. ` +
        `Use --stdout to preview or --version to set a different label.`,
    );
    return;
  }

  await updateChangelogFile(outputPath, changelogSection);
  success(
    `Wrote ${pc.bold(context.version)} to ${pc.bold(output)} (${totalCommits} commits).`,
  );
}

interface ReleaseFlags extends SharedFlags {
  tag?: string;
  title?: string;
  draft?: boolean;
  prerelease?: boolean;
  token?: string;
  changelog?: boolean;
}

async function runRelease(flags: ReleaseFlags): Promise<void> {
  const options = toOptions(flags);
  const result = await generate(options);
  const { context, releaseNotes, changelogSection } = result;

  const tag = flags.tag ?? (context.version.startsWith("v") ? context.version : `v${context.version}`);

  if (flags.dryRun) {
    info(`Dry run — would create GitHub release ${pc.bold(tag)}:`);
    process.stdout.write("\n" + releaseNotes + "\n");
    return;
  }

  // Optionally update the changelog file too (default: yes).
  if (flags.changelog !== false) {
    const output = options.output ?? DEFAULT_CONFIG.output;
    const outputPath = path.isAbsolute(output)
      ? output
      : path.join(process.cwd(), output);
    const existing = await readChangelog(outputPath);
    if (!(existing && hasVersion(existing, context.version))) {
      await updateChangelogFile(outputPath, changelogSection);
      success(`Updated ${pc.bold(output)}.`);
    }
  }

  info(`Creating GitHub release ${pc.bold(tag)}…`);
  const res = await createRelease({
    tag,
    title: flags.title ?? context.version,
    body: releaseNotes,
    ...(flags.draft ? { draft: true } : {}),
    ...(flags.prerelease ? { prerelease: true } : {}),
    repo: context.repo,
    ...(flags.token ? { token: flags.token } : {}),
    cwd: process.cwd(),
  });
  success(
    `Created release via ${res.via}${res.url ? `: ${pc.underline(res.url)}` : ""}`,
  );
}

async function runInit(): Promise<void> {
  const target = path.join(process.cwd(), "relnotes.config.json");
  if (existsSync(target)) {
    warn(`relnotes.config.json already exists — not overwriting.`);
    return;
  }
  const sample = {
    emoji: true,
    authors: true,
    linkReferences: true,
    groupByScope: false,
    types: [
      { type: "feat", section: "Features", emoji: "✨" },
      { type: "fix", section: "Bug Fixes", emoji: "🐛" },
      { type: "perf", section: "Performance", emoji: "⚡" },
      { type: "refactor", section: "Refactors", emoji: "♻️" },
      { type: "docs", section: "Documentation", emoji: "📝" },
      { type: "chore", section: "Chores", emoji: "🔧", hidden: true },
    ],
  };
  await writeFile(target, JSON.stringify(sample, null, 2) + "\n", "utf8");
  success(`Created ${pc.bold("relnotes.config.json")}.`);
}

function addSharedOptions(cmd: Command): Command {
  return cmd
    .option("--from <ref>", "start ref (default: latest tag)")
    .option("--to <ref>", "end ref (default: HEAD)")
    .option("--release-version <version>", "version label for this release")
    .option("-o, --output <file>", "changelog file (default: CHANGELOG.md)")
    .option("--stdout", "print to stdout instead of writing a file")
    .option("--dry-run", "do everything except writing files / publishing")
    .option("--no-emoji", "disable section emoji")
    .option("--no-authors", "omit the contributors section")
    .option("--repo <owner/name>", "override repository slug for links")
    .option("-c, --config <path>", "path to a config file");
}

/** Build the commander program. Exposed for testing. */
export function buildProgram(): Command {
  const program = new Command();
  program
    .name("relnotes")
    .description(
      "Generate beautiful changelogs and GitHub release notes from your conventional commits.",
    )
    .version(VERSION, "-V, --version", "print the relnotes version");

  addSharedOptions(
    program
      .command("generate", { isDefault: true })
      .description("generate changelog markdown from conventional commits"),
  ).action(async (flags: SharedFlags) => {
    await runGenerate(flags);
  });

  const release = addSharedOptions(
    program
      .command("release")
      .description("generate notes and create a GitHub release"),
  );
  release
    .option("--tag <tag>", "git tag to attach the release to")
    .option("--title <title>", "release title (default: version)")
    .option("--draft", "create the release as a draft")
    .option("--prerelease", "mark the release as a prerelease")
    .option("--token <token>", "GitHub token (else uses gh CLI / GITHUB_TOKEN)")
    .option("--no-changelog", "do not also update CHANGELOG.md")
    .action(async (flags: ReleaseFlags) => {
      await runRelease(flags);
    });

  program
    .command("init")
    .description("write a starter relnotes.config.json")
    .action(async () => {
      await runInit();
    });

  return program;
}

/** CLI entrypoint. */
export async function run(argv: string[] = process.argv): Promise<void> {
  const program = buildProgram();
  try {
    await program.parseAsync(argv);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    fail(message);
    process.exitCode = 1;
  }
}
