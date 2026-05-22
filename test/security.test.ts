import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { extractReferences } from "../src/parser.js";
import { getCommits, resolveRef } from "../src/git.js";
import { isValidSlug, createRelease } from "../src/github.js";
import { generate } from "../src/lib.js";
import { escapeMarkdown } from "../src/util.js";
import { renderCommitLine } from "../src/render.js";
import { parseCommit } from "../src/parser.js";
import { DEFAULT_CONFIG } from "../src/config.js";
import type { RawCommit, ReleaseContext, RepoInfo } from "../src/types.js";
import { TempRepo } from "./helpers.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const cli = path.join(root, "dist", "index.js");

const githubRepo: RepoInfo = {
  host: "github",
  baseUrl: "https://github.com",
  slug: "acme/widget",
  owner: "acme",
  name: "widget",
};

function ctx(): ReleaseContext {
  return {
    version: "1.0.0",
    currentRef: "HEAD",
    date: "2026-05-22",
    repo: githubRepo,
    groups: [],
    breaking: [],
    contributors: [],
    config: DEFAULT_CONFIG,
  };
}

// ---------------------------------------------------------------------------
// #2 — ReDoS in the conventional-commit reference parser
// ---------------------------------------------------------------------------
describe("ReDoS-safety: extractReferences", () => {
  it("handles a pathological input well under a time budget", () => {
    // This input drove the old regex to ~1s at 10k chars / ~20s at 50k chars.
    const evil = "a.".repeat(50000); // 100,000 chars, no '#'
    const start = process.hrtime.bigint();
    const refs = extractReferences(evil);
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    expect(refs).toHaveLength(0);
    expect(ms).toBeLessThan(500);
  });

  it("still extracts references correctly", () => {
    expect(extractReferences("fix: thing (#123)")[0]?.issue).toBe("123");
    const cross = extractReferences("see owner/repo#7");
    expect(cross[0]?.repository).toBe("owner/repo");
    expect(cross[0]?.issue).toBe("7");
    expect(extractReferences("relates to GH-42")[0]?.issue).toBe("42");
  });

  it("does not hang even when a long repo-like prefix precedes '#'", () => {
    const evil = "x.".repeat(40000) + "owner/repo#9";
    const start = process.hrtime.bigint();
    const refs = extractReferences(evil);
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    expect(refs.some((r) => r.issue === "9")).toBe(true);
    expect(ms).toBeLessThan(500);
  });
});

// ---------------------------------------------------------------------------
// #3 — repo slug validation (SSRF / path injection)
// ---------------------------------------------------------------------------
describe("repo slug validation", () => {
  it("accepts valid owner/repo slugs", () => {
    expect(isValidSlug("acme/widget")).toBe(true);
    expect(isValidSlug("My-Org/some.repo_1")).toBe(true);
  });

  it("rejects path traversal and injection slugs", () => {
    expect(isValidSlug("../../foo")).toBe(false);
    expect(isValidSlug("owner/name/../../evil")).toBe(false);
    expect(isValidSlug("o/n?y=z")).toBe(false);
    expect(isValidSlug("o/n#frag")).toBe(false);
    expect(isValidSlug("onlyone")).toBe(false);
    expect(isValidSlug("a b/c d")).toBe(false);
  });

  it("createRelease (REST) refuses a path-traversal slug", async () => {
    await expect(
      createRelease({
        tag: "v1.0.0",
        body: "notes",
        token: "x-fake-token",
        repo: {
          host: "github",
          baseUrl: "https://github.com",
          slug: "../../evil",
        },
      }),
    ).rejects.toThrow(/Invalid repository slug|repository for the REST API/);
  });
});

// ---------------------------------------------------------------------------
// #7 — markdown / link injection
// ---------------------------------------------------------------------------
describe("markdown injection hardening", () => {
  it("escapes link/markup-significant characters", () => {
    const out = escapeMarkdown("click [here](http://evil) <img src=x>");
    // Brackets and angle brackets are backslash-escaped, so no live link/HTML
    // can form (a markdown renderer treats `\[`/`\]`/`\<` as literal text).
    expect(out).not.toMatch(/(^|[^\\])\[/); // no unescaped '['
    expect(out).not.toMatch(/(^|[^\\])</); // no unescaped '<'
    expect(out).toContain("\\[here\\]");
    expect(out).toContain("\\<img");
  });

  it("renders a malicious commit subject without live markup", () => {
    const raw: RawCommit = {
      hash: "a".repeat(40),
      shortHash: "aaaaaaa",
      header: "feat: pwn [x](javascript:alert(1)) <b>bold</b>",
      body: "",
      authorName: "X",
      authorEmail: "x@example.com",
      date: "2026-01-01T00:00:00Z",
    };
    const line = renderCommitLine(parseCommit(raw), ctx());
    // The subject's '[' and '<' must be escaped so no live link/HTML forms.
    // (Trailing metadata legitimately contains the commit-hash link.)
    const subjectPart = line.slice(0, line.indexOf(" (["));
    expect(subjectPart).not.toMatch(/(^|[^\\])\[/);
    expect(subjectPart).not.toContain("<b>");
    expect(subjectPart).toContain("\\<b\\>");
  });
});

// ---------------------------------------------------------------------------
// #1 — git flag/argument injection via crafted refs
// ---------------------------------------------------------------------------
describe("git ref flag-injection hardening", () => {
  let repo: TempRepo;

  beforeAll(async () => {
    repo = await TempRepo.create("https://github.com/acme/widget.git");
    await repo.commit("feat: hello", "a.txt");
  });

  afterAll(async () => {
    await repo.cleanup();
  });

  it("rejects a ref that looks like a git option", async () => {
    await expect(getCommits(repo.dir, "--output=evil.txt", "HEAD")).rejects.toThrow(
      /option/i,
    );
    await expect(resolveRef(repo.dir, "--help")).rejects.toThrow(/option/i);
  });

  it("does not write an attacker-controlled file via --output flag injection", async () => {
    const target = path.join(repo.dir, "PWNED.txt");
    await getCommits(repo.dir, `--output=${target}`, "HEAD").catch(() => {});
    await resolveRef(repo.dir, `--output=${target}`).catch(() => {});
    expect(existsSync(target)).toBe(false);
  });

  it("built CLI: --from flag injection does not write a file", () => {
    if (!existsSync(cli)) return; // built only in CI/full runs
    const target = path.join(repo.dir, "CLI_PWNED.txt");
    try {
      execFileSync(
        process.execPath,
        [cli, "generate", "--from", `--output=${target}`, "--stdout"],
        { cwd: repo.dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
      );
    } catch {
      // expected to fail safely
    }
    expect(existsSync(target)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// #5 — token must never be logged / printed
// ---------------------------------------------------------------------------
describe("token is never written to output", () => {
  let repo: TempRepo;
  const SENTINEL = "ghp_SECRET_SENTINEL_DO_NOT_LEAK_0123456789";

  beforeAll(async () => {
    repo = await TempRepo.create("https://github.com/acme/widget.git");
    await repo.commit("feat: hello", "a.txt");
    repo.tag("v0.1.0");
    await repo.commit("fix: bug (#1)");
  });

  afterAll(async () => {
    await repo.cleanup();
  });

  it("does not appear in generated release notes / changelog", async () => {
    const result = await generate({
      cwd: repo.dir,
      from: "v0.1.0",
      to: "HEAD",
      version: "0.2.0",
    });
    expect(result.releaseNotes).not.toContain(SENTINEL);
    expect(result.changelogSection).not.toContain(SENTINEL);
    expect(JSON.stringify(result.context)).not.toContain(SENTINEL);
  });

  it("does not appear in an error thrown on the REST path", async () => {
    // Force the REST path's slug validation to fail; the thrown error must not
    // echo the token.
    let message = "";
    try {
      await createRelease({
        tag: "v1.0.0",
        body: "notes",
        token: SENTINEL,
        repo: {
          host: "github",
          baseUrl: "https://github.com",
          slug: "bad slug with spaces",
        },
      });
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }
    expect(message).not.toContain(SENTINEL);
  });
});
