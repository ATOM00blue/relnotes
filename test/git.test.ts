import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  getCommits,
  getRepoInfo,
  isGitRepo,
  latestTag,
  parseRemoteUrl,
  previousTag,
  refExists,
} from "../src/git.js";
import { parseCommits } from "../src/parser.js";
import { generate } from "../src/lib.js";
import { TempRepo } from "./helpers.js";

describe("parseRemoteUrl", () => {
  it("parses an https github url", () => {
    const info = parseRemoteUrl("https://github.com/acme/widget.git");
    expect(info.host).toBe("github");
    expect(info.slug).toBe("acme/widget");
    expect(info.baseUrl).toBe("https://github.com");
  });

  it("parses an ssh scp-style url", () => {
    const info = parseRemoteUrl("git@github.com:acme/widget.git");
    expect(info.host).toBe("github");
    expect(info.slug).toBe("acme/widget");
  });

  it("parses a gitlab url with subgroups", () => {
    const info = parseRemoteUrl("https://gitlab.com/group/sub/proj.git");
    expect(info.host).toBe("gitlab");
    expect(info.slug).toBe("group/sub/proj");
  });

  it("parses a bitbucket url", () => {
    const info = parseRemoteUrl("https://bitbucket.org/acme/widget.git");
    expect(info.host).toBe("bitbucket");
  });

  it("returns unknown for null", () => {
    expect(parseRemoteUrl(null).host).toBe("unknown");
  });
});

describe("git integration (temp repo)", () => {
  let repo: TempRepo;

  beforeAll(async () => {
    repo = await TempRepo.create("https://github.com/acme/widget.git");
    await repo.commit("chore: initial", "seed.txt");
    repo.tag("v0.1.0");
    await repo.commit("feat(parser): add parser (#1)");
    await repo.commit("fix: a bug (#2)");
    await repo.commit("feat(api)!: breaking change\n\nBREAKING CHANGE: gone");
    await repo.commit("docs: update readme");
    repo.tag("v0.2.0");
  });

  afterAll(async () => {
    await repo.cleanup();
  });

  it("detects a git repo", async () => {
    expect(await isGitRepo(repo.dir)).toBe(true);
  });

  it("finds the latest tag", async () => {
    expect(await latestTag(repo.dir)).toBe("v0.2.0");
  });

  it("finds the previous tag", async () => {
    expect(await previousTag(repo.dir, "v0.2.0")).toBe("v0.1.0");
  });

  it("checks ref existence", async () => {
    expect(await refExists(repo.dir, "v0.1.0")).toBe(true);
    expect(await refExists(repo.dir, "nope")).toBe(false);
  });

  it("reads commits in a range", async () => {
    const commits = await getCommits(repo.dir, "v0.1.0", "v0.2.0");
    expect(commits.length).toBe(4);
    const parsed = parseCommits(commits);
    expect(parsed.filter((c) => c.type === "feat")).toHaveLength(2);
    expect(parsed.filter((c) => c.breaking)).toHaveLength(1);
  });

  it("derives repo info from the remote", async () => {
    const info = await getRepoInfo(repo.dir);
    expect(info.slug).toBe("acme/widget");
    expect(info.host).toBe("github");
  });

  it("generates a full release section end to end", async () => {
    const result = await generate({
      cwd: repo.dir,
      from: "v0.1.0",
      to: "v0.2.0",
      version: "0.2.0",
    });
    expect(result.changelogSection).toContain("## [0.2.0]");
    expect(result.changelogSection).toContain("### ✨ Features");
    expect(result.changelogSection).toContain("BREAKING CHANGES");
    expect(result.changelogSection).toContain(
      "https://github.com/acme/widget/issues/1",
    );
    expect(result.changelogSection).toContain("Test User");
  });

  it("defaults the range to the latest tag when not specified", async () => {
    // Add a commit after the latest tag.
    await repo.commit("feat: post-tag feature");
    const result = await generate({ cwd: repo.dir, version: "0.3.0" });
    expect(result.range.from).toBe("v0.2.0");
    expect(result.changelogSection.toLowerCase()).toContain("post-tag feature");
  });
});
