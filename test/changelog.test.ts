import { describe, it, expect } from "vitest";
import { prependRelease, hasVersion } from "../src/changelog.js";

describe("prependRelease", () => {
  it("creates a preamble when the file is empty", () => {
    const out = prependRelease("", "## 1.0.0 (2026-01-01)\n\n### Features\n\n- a\n");
    expect(out).toContain("# Changelog");
    expect(out).toContain("## 1.0.0");
  });

  it("inserts a new release above existing releases, after the preamble", () => {
    const existing = `# Changelog

Some preamble text.

## 0.9.0 (2025-12-01)

### Features

- old feature
`;
    const out = prependRelease(
      existing,
      "## 1.0.0 (2026-01-01)\n\n### Features\n\n- new feature\n",
    );
    const idxNew = out.indexOf("## 1.0.0");
    const idxOld = out.indexOf("## 0.9.0");
    const idxPreamble = out.indexOf("Some preamble text.");
    expect(idxPreamble).toBeGreaterThanOrEqual(0);
    expect(idxNew).toBeGreaterThan(idxPreamble);
    expect(idxOld).toBeGreaterThan(idxNew);
  });

  it("preserves existing release content", () => {
    const existing = `# Changelog

## 0.9.0

- old feature
`;
    const out = prependRelease(existing, "## 1.0.0\n\n- new\n");
    expect(out).toContain("old feature");
    expect(out).toContain("new");
  });

  it("does not produce more than two consecutive newlines", () => {
    const existing = `# Changelog


## 0.9.0


- old
`;
    const out = prependRelease(existing, "## 1.0.0\n\n- new\n");
    expect(out).not.toMatch(/\n{3,}/);
  });

  it("handles CRLF line endings", () => {
    const existing = "# Changelog\r\n\r\n## 0.9.0\r\n\r\n- old\r\n";
    const out = prependRelease(existing, "## 1.0.0\n\n- new\n");
    expect(out).toContain("## 1.0.0");
    expect(out).toContain("## 0.9.0");
  });
});

describe("hasVersion", () => {
  it("detects an existing plain version heading", () => {
    expect(hasVersion("## 1.0.0 (2026-01-01)\n", "1.0.0")).toBe(true);
  });

  it("detects a bracketed/linked version heading", () => {
    expect(
      hasVersion("## [1.2.3](https://x/compare) (2026-01-01)\n", "1.2.3"),
    ).toBe(true);
  });

  it("detects a v-prefixed heading", () => {
    expect(hasVersion("## v2.0.0 (2026-01-01)\n", "2.0.0")).toBe(true);
  });

  it("returns false for absent versions", () => {
    expect(hasVersion("## 1.0.0\n", "2.0.0")).toBe(false);
  });

  it("does not match a version that is a prefix of another", () => {
    expect(hasVersion("## 1.0.10 (2026-01-01)\n", "1.0.1")).toBe(false);
  });
});
