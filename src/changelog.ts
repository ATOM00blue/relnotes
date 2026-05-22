import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";

const DEFAULT_PREAMBLE = `# Changelog

All notable changes to this project are documented in this file.

This project adheres to [Conventional Commits](https://www.conventionalcommits.org/)
and the format is based on [Keep a Changelog](https://keepachangelog.com/).
`;

/**
 * Insert a new release section into existing changelog content, after any
 * top-of-file preamble (a leading `# ...` block) but before the first existing
 * `## ` release heading. Idempotent for distinct versions.
 */
export function prependRelease(
  existing: string,
  releaseSection: string,
): string {
  const normalizedExisting = existing.replace(/\r\n/g, "\n");
  const section = releaseSection.trim() + "\n";

  if (!normalizedExisting.trim()) {
    return `${DEFAULT_PREAMBLE}\n${section}`;
  }

  // Find the first level-2 heading (start of release entries).
  const lines = normalizedExisting.split("\n");
  let insertAt = lines.length;
  for (let i = 0; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i] ?? "")) {
      insertAt = i;
      break;
    }
  }

  const preamble = lines.slice(0, insertAt).join("\n").trimEnd();
  const rest = lines.slice(insertAt).join("\n").trimStart();

  const head = preamble ? `${preamble}\n\n` : "";
  const tail = rest ? `\n${rest}\n` : "";
  return `${head}${section}${tail}`.replace(/\n{3,}/g, "\n\n");
}

/**
 * Returns true if the changelog already contains a heading for `version`.
 */
export function hasVersion(existing: string, version: string): boolean {
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Match `## version`, `## [version]`, `## v..` headings.
  const re = new RegExp(`^##\\s+\\[?v?${escaped}\\]?[\\s(]`, "m");
  return re.test(existing.replace(/\r\n/g, "\n"));
}

/**
 * Write a release section to a changelog file, prepending to existing content.
 * Returns the full new file content.
 */
export async function updateChangelogFile(
  filePath: string,
  releaseSection: string,
): Promise<string> {
  const existing = existsSync(filePath)
    ? await readFile(filePath, "utf8")
    : "";
  const updated = prependRelease(existing, releaseSection);
  await writeFile(filePath, updated, "utf8");
  return updated;
}

/** Read an existing changelog file, or an empty string if absent. */
export async function readChangelog(filePath: string): Promise<string> {
  return existsSync(filePath) ? readFile(filePath, "utf8") : Promise.resolve("");
}
