import { describe, it, expect } from "vitest";
import {
  groupCommits,
  aggregateContributors,
  renderRelease,
  renderBody,
  renderHeading,
} from "../src/render.js";
import { DEFAULT_CONFIG } from "../src/config.js";
import { parseCommit } from "../src/parser.js";
import type {
  ParsedCommit,
  RawCommit,
  ReleaseContext,
  RepoInfo,
  ResolvedConfig,
} from "../src/types.js";

const githubRepo: RepoInfo = {
  host: "github",
  baseUrl: "https://github.com",
  slug: "acme/widget",
  owner: "acme",
  name: "widget",
};

function commit(
  header: string,
  body = "",
  author = { name: "Jane Doe", email: "jane@example.com" },
  hash = "abc1234abc1234abc1234abc1234abc1234abc12",
): ParsedCommit {
  const r: RawCommit = {
    hash,
    shortHash: hash.slice(0, 7),
    header,
    body,
    authorName: author.name,
    authorEmail: author.email,
    date: "2026-01-01T00:00:00Z",
  };
  return parseCommit(r);
}

function context(
  commits: ParsedCommit[],
  config: ResolvedConfig = DEFAULT_CONFIG,
  overrides: Partial<ReleaseContext> = {},
): ReleaseContext {
  const groups = groupCommits(commits, config);
  return {
    version: "1.0.0",
    previousTag: "v0.1.0",
    currentRef: "HEAD",
    date: "2026-05-22",
    repo: githubRepo,
    groups,
    breaking: commits.filter((c) => c.breaking),
    contributors: aggregateContributors(commits),
    config,
    ...overrides,
  };
}

describe("groupCommits", () => {
  it("buckets commits by type and respects order", () => {
    const groups = groupCommits(
      [commit("fix: b"), commit("feat: a"), commit("perf: c")],
      DEFAULT_CONFIG,
    );
    expect(groups.map((g) => g.type)).toEqual(["feat", "fix", "perf"]);
  });

  it("hides hidden types by default (chore)", () => {
    const groups = groupCommits(
      [commit("feat: a"), commit("chore: cleanup")],
      DEFAULT_CONFIG,
    );
    expect(groups.map((g) => g.type)).toEqual(["feat"]);
  });

  it("buckets unknown conventional types into other", () => {
    const cfg: ResolvedConfig = { ...DEFAULT_CONFIG, includeNonConventional: false };
    const groups = groupCommits([commit("wibble: strange")], cfg);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.type).toBeNull();
    expect(groups[0]?.section).toBe(cfg.otherSection);
  });

  it("excludes non-conventional commits unless includeNonConventional", () => {
    const groups = groupCommits([commit("just a message")], DEFAULT_CONFIG);
    expect(groups).toHaveLength(0);
    const cfg: ResolvedConfig = {
      ...DEFAULT_CONFIG,
      includeNonConventional: true,
    };
    const groups2 = groupCommits([commit("just a message")], cfg);
    expect(groups2).toHaveLength(1);
  });
});

describe("aggregateContributors", () => {
  it("dedupes by email and counts commits", () => {
    const contributors = aggregateContributors([
      commit("feat: a"),
      commit("fix: b"),
      commit("docs: c", "", { name: "Bob", email: "bob@example.com" }),
    ]);
    expect(contributors[0]?.count).toBe(2);
    expect(contributors).toHaveLength(2);
  });

  it("infers a github handle from noreply emails", () => {
    const contributors = aggregateContributors([
      commit("feat: a", "", {
        name: "Octo",
        email: "123+octocat@users.noreply.github.com",
      }),
    ]);
    expect(contributors[0]?.handle).toBe("octocat");
  });
});

describe("renderRelease", () => {
  it("renders a heading with compare link", () => {
    const out = renderRelease(context([commit("feat: a")]));
    expect(out).toContain(
      "## [1.0.0](https://github.com/acme/widget/compare/v0.1.0...1.0.0) (2026-05-22)",
    );
  });

  it("renders sections with emoji", () => {
    const out = renderRelease(context([commit("feat: add feature")]));
    expect(out).toContain("### ✨ Features");
    expect(out).toContain("- Add feature");
  });

  it("omits emoji when disabled", () => {
    const cfg: ResolvedConfig = { ...DEFAULT_CONFIG, emoji: false };
    const out = renderRelease(context([commit("feat: add feature")], cfg));
    expect(out).toContain("### Features");
    expect(out).not.toContain("✨");
  });

  it("renders a breaking changes callout", () => {
    const out = renderRelease(
      context([commit("feat(api)!: drop v1", "BREAKING CHANGE: gone")]),
    );
    expect(out).toContain("BREAKING CHANGES");
    expect(out).toContain("**api:** gone");
  });

  it("links PR references and commit hashes", () => {
    const out = renderBody(context([commit("fix: bug (#42)")]));
    expect(out).toContain("[#42](https://github.com/acme/widget/issues/42)");
    expect(out).toContain("https://github.com/acme/widget/commit/");
  });

  it("renders contributors with github links when handle is known", () => {
    const out = renderBody(
      context([
        commit("feat: a", "", {
          name: "Octo",
          email: "1+octocat@users.noreply.github.com",
        }),
      ]),
    );
    expect(out).toContain("[@octocat](https://github.com/octocat)");
  });

  it("omits contributors when authors disabled", () => {
    const cfg: ResolvedConfig = { ...DEFAULT_CONFIG, authors: false };
    const out = renderBody(context([commit("feat: a")], cfg));
    expect(out).not.toContain("Contributors");
  });
});

describe("renderHeading", () => {
  it("supports a custom header template", () => {
    const cfg: ResolvedConfig = {
      ...DEFAULT_CONFIG,
      header: "# Release {version} on {date}",
    };
    const out = renderHeading(context([commit("feat: a")], cfg));
    expect(out).toBe("# Release 1.0.0 on 2026-05-22");
  });

  it("renders plain version when no repo slug", () => {
    const out = renderHeading(
      context([commit("feat: a")], DEFAULT_CONFIG, {
        repo: { host: "unknown", baseUrl: "" },
      }),
    );
    expect(out).toBe("## 1.0.0 (2026-05-22)");
  });
});

describe("groupByScope", () => {
  it("groups commits under scope sub-bullets", () => {
    const cfg: ResolvedConfig = { ...DEFAULT_CONFIG, groupByScope: true };
    const out = renderBody(
      context([commit("feat(cli): a"), commit("feat(cli): b")], cfg),
    );
    expect(out).toContain("- **cli**");
  });
});
