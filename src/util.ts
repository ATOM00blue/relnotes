import type { RepoInfo } from "./types.js";

/**
 * Build a web URL for a commit on the host.
 */
export function commitUrl(repo: RepoInfo, hash: string): string | null {
  if (!repo.slug || repo.host === "unknown") return null;
  switch (repo.host) {
    case "github":
    case "gitlab":
      return `${repo.baseUrl}/${repo.slug}/commit/${hash}`;
    case "bitbucket":
      return `${repo.baseUrl}/${repo.slug}/commits/${hash}`;
    default:
      return null;
  }
}

/**
 * Build a web URL for an issue/PR reference.
 */
export function issueUrl(
  repo: RepoInfo,
  issue: string,
  overrideSlug?: string,
): string | null {
  const slug = overrideSlug ?? repo.slug;
  if (!slug || repo.host === "unknown") return null;
  switch (repo.host) {
    case "github":
      // GitHub resolves /issues/<n> to PRs too.
      return `${repo.baseUrl}/${slug}/issues/${issue}`;
    case "gitlab":
      return `${repo.baseUrl}/${slug}/-/issues/${issue}`;
    case "bitbucket":
      return `${repo.baseUrl}/${slug}/issues/${issue}`;
    default:
      return null;
  }
}

/**
 * Build a compare URL between two refs.
 */
export function compareUrl(
  repo: RepoInfo,
  from: string,
  to: string,
): string | null {
  if (!repo.slug || repo.host === "unknown") return null;
  switch (repo.host) {
    case "github":
      return `${repo.baseUrl}/${repo.slug}/compare/${from}...${to}`;
    case "gitlab":
      return `${repo.baseUrl}/${repo.slug}/-/compare/${from}...${to}`;
    case "bitbucket":
      return `${repo.baseUrl}/${repo.slug}/branches/compare/${to}%0D${from}`;
    default:
      return null;
  }
}

/** Today's date as YYYY-MM-DD (UTC). */
export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Capitalize the first character of a string. */
export function capitalize(s: string): string {
  return s.length === 0 ? s : s[0]!.toUpperCase() + s.slice(1);
}

/**
 * Compare two version strings loosely (semver-ish). Returns -1, 0, 1.
 * Tolerates a leading "v" and missing parts.
 */
export function compareVersions(a: string, b: string): number {
  const norm = (v: string) =>
    v
      .replace(/^v/i, "")
      .split(/[.+-]/)
      .map((p) => (/^\d+$/.test(p) ? Number(p) : p));
  const pa = norm(a);
  const pb = norm(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = pa[i];
    const y = pb[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (x === y) continue;
    if (typeof x === "number" && typeof y === "number") return x < y ? -1 : 1;
    return String(x) < String(y) ? -1 : 1;
  }
  return 0;
}

/** Strip a leading "v" from a version string. */
export function stripV(v: string): string {
  return v.replace(/^v/i, "");
}

/** Escape characters that would break markdown table/inline formatting minimally. */
export function escapeMarkdown(s: string): string {
  // Only escape pipe to avoid breaking inline contexts; keep text readable.
  return s.replace(/\|/g, "\\|");
}

/** Deduplicate an array preserving order, by a key function. */
export function dedupeBy<T>(arr: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of arr) {
    const k = key(item);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(item);
  }
  return out;
}
