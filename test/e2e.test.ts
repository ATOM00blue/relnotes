import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TempRepo } from "./helpers.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const cli = path.join(root, "dist", "index.js");

/** Run the built CLI in a directory and capture stdout. */
function runCli(cwd: string, ...args: string[]): string {
  return execFileSync(process.execPath, [cli, ...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

describe("e2e: built CLI", () => {
  let repo: TempRepo;

  beforeAll(async () => {
    // The dist build must exist; CI runs `npm run build` before tests.
    if (!existsSync(cli)) {
      throw new Error(
        `Built CLI not found at ${cli}. Run \`npm run build\` first.`,
      );
    }
    repo = await TempRepo.create("https://github.com/acme/widget.git");
    await repo.commit("chore: initial", "seed.txt");
    repo.tag("v1.0.0");
    await repo.commit("feat(cli): add generate command (#10)");
    await repo.commit("fix(parser): handle CRLF (#11)");
    await repo.commit("perf: faster log reading");
    await repo.commit("feat!: new config format\n\nBREAKING CHANGE: config renamed");
  });

  afterAll(async () => {
    await repo.cleanup();
  });

  it("prints grouped markdown to stdout", () => {
    const out = runCli(repo.dir, "generate", "--release-version", "1.1.0", "--stdout");
    expect(out).toContain("## [1.1.0]");
    expect(out).toContain("### ✨ Features");
    expect(out).toContain("### 🐛 Bug Fixes");
    expect(out).toContain("### ⚡ Performance");
    expect(out).toContain("⚠️ BREAKING CHANGES");
    expect(out).toContain("[#10](https://github.com/acme/widget/issues/10)");
    expect(out).toContain("Test User");
  });

  it("supports --no-emoji", () => {
    const out = runCli(
      repo.dir,
      "generate",
      "--release-version",
      "1.1.0",
      "--stdout",
      "--no-emoji",
    );
    expect(out).not.toContain("✨");
    expect(out).toContain("### Features");
  });

  it("writes and prepends CHANGELOG.md", async () => {
    runCli(repo.dir, "generate", "--release-version", "1.1.0");
    const changelogPath = path.join(repo.dir, "CHANGELOG.md");
    expect(existsSync(changelogPath)).toBe(true);
    const content = await readFile(changelogPath, "utf8");
    expect(content).toContain("# Changelog");
    expect(content).toContain("## [1.1.0]");

    // Second run with a new version prepends above the existing one.
    await repo.commit("feat: another feature");
    runCli(repo.dir, "generate", "--release-version", "1.2.0", "--from", "v1.0.0");
    const updated = await readFile(changelogPath, "utf8");
    const idx12 = updated.indexOf("## [1.2.0]");
    const idx11 = updated.indexOf("## [1.1.0]");
    expect(idx12).toBeGreaterThanOrEqual(0);
    expect(idx11).toBeGreaterThan(idx12);
  });

  it("init writes a config file", () => {
    const dir = repo.dir;
    const out = runCli(dir, "init");
    // init writes to stderr; just ensure the file exists.
    expect(existsSync(path.join(dir, "relnotes.config.json"))).toBe(true);
    void out;
  });

  it("release --dry-run prints notes without publishing", () => {
    const out = runCli(
      repo.dir,
      "release",
      "--release-version",
      "1.3.0",
      "--from",
      "v1.0.0",
      "--dry-run",
    );
    // Body should not include the version heading (release notes form).
    expect(out).not.toContain("## [1.3.0]");
    expect(out).toContain("Features");
  });
});
