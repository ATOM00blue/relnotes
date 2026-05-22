import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  mergeTypes,
  mergeConfig,
  loadConfig,
  findTypeConfig,
  DEFAULT_CONFIG,
  DEFAULT_TYPES,
} from "../src/config.js";

describe("mergeTypes", () => {
  it("returns defaults when user types are empty", () => {
    expect(mergeTypes(DEFAULT_TYPES, undefined)).toBe(DEFAULT_TYPES);
  });

  it("overrides matching defaults and preserves order", () => {
    const merged = mergeTypes(DEFAULT_TYPES, [
      { type: "feat", section: "New Stuff", emoji: "🎉" },
    ]);
    expect(merged[0]?.type).toBe("feat");
    expect(merged[0]?.section).toBe("New Stuff");
    expect(merged[0]?.emoji).toBe("🎉");
    // The remaining defaults are still present.
    expect(merged.some((t) => t.type === "fix")).toBe(true);
  });

  it("appends new user-defined types", () => {
    const merged = mergeTypes(DEFAULT_TYPES, [
      { type: "security", section: "Security", emoji: "🔒" },
    ]);
    expect(merged[0]?.type).toBe("security");
  });
});

describe("mergeConfig", () => {
  it("returns base when user config is null", () => {
    expect(mergeConfig(DEFAULT_CONFIG, null)).toEqual(DEFAULT_CONFIG);
  });

  it("overrides scalar fields", () => {
    const merged = mergeConfig(DEFAULT_CONFIG, { emoji: false, authors: false });
    expect(merged.emoji).toBe(false);
    expect(merged.authors).toBe(false);
  });

  it("ignores undefined fields", () => {
    const merged = mergeConfig(DEFAULT_CONFIG, { emoji: undefined });
    expect(merged.emoji).toBe(DEFAULT_CONFIG.emoji);
  });
});

describe("findTypeConfig", () => {
  it("finds a configured type", () => {
    expect(findTypeConfig(DEFAULT_CONFIG, "feat")?.section).toBe("Features");
  });
  it("returns null for unknown types", () => {
    expect(findTypeConfig(DEFAULT_CONFIG, "nope")).toBeNull();
  });
  it("returns null for null type", () => {
    expect(findTypeConfig(DEFAULT_CONFIG, null)).toBeNull();
  });
});

describe("loadConfig", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "relnotes-cfg-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("returns defaults when no config exists", async () => {
    const cfg = await loadConfig(dir);
    expect(cfg).toEqual(DEFAULT_CONFIG);
  });

  it("loads a relnotes.config.json file", async () => {
    await writeFile(
      path.join(dir, "relnotes.config.json"),
      JSON.stringify({ emoji: false, authors: false }),
    );
    const cfg = await loadConfig(dir);
    expect(cfg.emoji).toBe(false);
    expect(cfg.authors).toBe(false);
  });

  it("loads config from package.json relnotes field", async () => {
    await writeFile(
      path.join(dir, "package.json"),
      JSON.stringify({ name: "x", relnotes: { output: "HISTORY.md" } }),
    );
    const cfg = await loadConfig(dir);
    expect(cfg.output).toBe("HISTORY.md");
  });

  it("prefers an explicit config path", async () => {
    const explicit = path.join(dir, "custom.json");
    await writeFile(explicit, JSON.stringify({ emoji: false }));
    const cfg = await loadConfig(dir, explicit);
    expect(cfg.emoji).toBe(false);
  });

  it("throws for a missing explicit config path", async () => {
    await expect(loadConfig(dir, path.join(dir, "nope.json"))).rejects.toThrow();
  });
});
