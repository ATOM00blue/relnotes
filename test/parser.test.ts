import { describe, it, expect } from "vitest";
import {
  parseCommit,
  parseCommits,
  parseFooters,
  extractReferences,
} from "../src/parser.js";
import type { RawCommit } from "../src/types.js";

function raw(header: string, body = ""): RawCommit {
  return {
    hash: "0".repeat(40),
    shortHash: "0000000",
    header,
    body,
    authorName: "Jane Doe",
    authorEmail: "jane@example.com",
    date: "2026-01-01T00:00:00Z",
  };
}

describe("parseCommit - header grammar", () => {
  it("parses a simple feat", () => {
    const c = parseCommit(raw("feat: add a thing"));
    expect(c.type).toBe("feat");
    expect(c.scope).toBeNull();
    expect(c.subject).toBe("add a thing");
    expect(c.breaking).toBe(false);
    expect(c.conventional).toBe(true);
  });

  it("parses type with scope", () => {
    const c = parseCommit(raw("fix(parser): handle empty body"));
    expect(c.type).toBe("fix");
    expect(c.scope).toBe("parser");
    expect(c.subject).toBe("handle empty body");
  });

  it("lowercases the type", () => {
    const c = parseCommit(raw("FEAT: shout"));
    expect(c.type).toBe("feat");
  });

  it("detects breaking via ! before colon", () => {
    const c = parseCommit(raw("feat!: drop old api"));
    expect(c.breaking).toBe(true);
    expect(c.breakingNotes).toContain("drop old api");
  });

  it("detects breaking via !(scope) form", () => {
    const c = parseCommit(raw("feat(api)!: drop old api"));
    expect(c.breaking).toBe(true);
    expect(c.scope).toBe("api");
  });

  it("treats non-conventional headers as non-conventional", () => {
    const c = parseCommit(raw("just a random message"));
    expect(c.conventional).toBe(false);
    expect(c.type).toBeNull();
    expect(c.subject).toBe("just a random message");
  });

  it("supports hyphenated types", () => {
    const c = parseCommit(raw("wip-feat: experimental"));
    expect(c.type).toBe("wip-feat");
  });
});

describe("parseFooters", () => {
  it("extracts a BREAKING CHANGE footer", () => {
    const { breakingNotes } = parseFooters(
      "Some body\n\nBREAKING CHANGE: config moved to new location",
    );
    expect(breakingNotes).toEqual(["config moved to new location"]);
  });

  it("supports the BREAKING-CHANGE hyphenated token", () => {
    const { breakingNotes } = parseFooters("BREAKING-CHANGE: it broke");
    expect(breakingNotes).toEqual(["it broke"]);
  });

  it("parses git trailer footers", () => {
    const { notes } = parseFooters("Reviewed-by: Bob\nRefs: #99");
    expect(notes.find((n) => n.token === "Reviewed-by")?.text).toBe("Bob");
  });

  it("captures multi-line footer values until the next token", () => {
    const { breakingNotes } = parseFooters(
      "BREAKING CHANGE: line one\ncontinues here\nAcked-by: Sue",
    );
    expect(breakingNotes[0]).toContain("line one");
    expect(breakingNotes[0]).toContain("continues here");
  });
});

describe("breaking change resolution", () => {
  it("prefers the footer description over the subject", () => {
    const c = parseCommit(
      raw("feat(api)!: drop node 16", "BREAKING CHANGE: node 18+ required"),
    );
    expect(c.breaking).toBe(true);
    expect(c.breakingNotes).toEqual(["node 18+ required"]);
  });

  it("falls back to subject when only ! is present", () => {
    const c = parseCommit(raw("feat!: rewrite engine"));
    expect(c.breakingNotes).toEqual(["rewrite engine"]);
  });
});

describe("extractReferences", () => {
  it("extracts #123 references", () => {
    const refs = extractReferences("fix: thing (#123)");
    expect(refs).toHaveLength(1);
    expect(refs[0]?.issue).toBe("123");
  });

  it("extracts cross-repo references", () => {
    const refs = extractReferences("see owner/repo#7 for details");
    expect(refs[0]?.repository).toBe("owner/repo");
    expect(refs[0]?.issue).toBe("7");
  });

  it("extracts GH-style references", () => {
    const refs = extractReferences("relates to GH-42");
    expect(refs[0]?.issue).toBe("42");
  });

  it("dedupes repeated references", () => {
    const refs = extractReferences("fix: x (#5) also closes #5");
    expect(refs).toHaveLength(1);
  });
});

describe("subject normalization", () => {
  it("strips a trailing PR reference from the subject", () => {
    const c = parseCommit(raw("feat: add parser (#12)"));
    expect(c.subject).toBe("add parser");
    expect(c.references[0]?.issue).toBe("12");
  });
});

describe("parseCommits", () => {
  it("parses an array of commits", () => {
    const out = parseCommits([raw("feat: a"), raw("fix: b")]);
    expect(out.map((c) => c.type)).toEqual(["feat", "fix"]);
  });
});
