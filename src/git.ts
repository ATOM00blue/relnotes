import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { RawCommit, RepoInfo } from "./types.js";

const execFileAsync = promisify(execFile);

/** Unit-separator and record-separator markers for robust log parsing. */
const FIELD = "\x1f"; // field separator
const RECORD = "\x1e"; // record separator

export class GitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GitError";
  }
}

async function git(args: string[], cwd: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", args, {
      cwd,
      maxBuffer: 64 * 1024 * 1024,
      windowsHide: true,
    });
    return stdout;
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stderr?: string };
    if (e.code === "ENOENT") {
      throw new GitError(
        "git executable not found. Is git installed and on your PATH?",
      );
    }
    const detail = (e.stderr ?? e.message ?? "").trim();
    throw new GitError(`git ${args.join(" ")} failed: ${detail}`);
  }
}

/**
 * Validate a user-supplied git ref / range before it reaches git.
 *
 * Refs (from `--from`/`--to`/`--tag`, config, branch names) are untrusted. Even
 * with `execFile` (no shell), git interprets any argument that begins with `-`
 * as an option, so a value like `--output=<file>` becomes a `git log --output`
 * flag — an arbitrary-file-write primitive. We both validate here and pass
 * `--end-of-options` at the call sites (defence in depth).
 */
function assertSafeRef(ref: string): void {
  if (ref.startsWith("-")) {
    throw new GitError(
      `Refusing to use a ref/range that looks like an option: ${JSON.stringify(ref)}`,
    );
  }
  // NUL, newlines, and other control characters cannot appear in a valid ref and
  // signal an injection attempt; reject them outright.
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(ref)) {
    throw new GitError(
      "Refusing to use a ref/range containing control characters.",
    );
  }
}

/**
 * Run a git command whose argument list ends in one or more untrusted refs.
 * `--end-of-options` is inserted immediately before the refs so git treats them
 * as revisions, never as options. The refs are also validated up front.
 */
async function runRefGit(
  fixedArgs: string[],
  refs: string[],
  cwd: string,
): Promise<string> {
  for (const r of refs) assertSafeRef(r);
  return git([...fixedArgs, "--end-of-options", ...refs], cwd);
}

/** Returns true when cwd is inside a git work tree. */
export async function isGitRepo(cwd: string): Promise<boolean> {
  try {
    const out = await git(["rev-parse", "--is-inside-work-tree"], cwd);
    return out.trim() === "true";
  } catch {
    return false;
  }
}

/** Returns true when the repo has at least one commit (HEAD resolves). */
export async function hasCommits(cwd: string): Promise<boolean> {
  try {
    await git(["rev-parse", "--verify", "--quiet", "HEAD"], cwd);
    return true;
  } catch {
    return false;
  }
}

/**
 * List tags sorted by version (descending), falling back to creation date.
 * Tags that don't parse as versions are still included after version tags.
 */
export async function listTags(cwd: string): Promise<string[]> {
  // Prefer version sort; -creatordate as a secondary cue handled by git itself.
  const out = await git(
    ["tag", "--sort=-v:refname", "--sort=-creatordate"],
    cwd,
  );
  return out
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Get the most recent tag reachable from a ref (default HEAD).
 * Returns null if there are no tags.
 */
export async function latestTag(
  cwd: string,
  ref = "HEAD",
): Promise<string | null> {
  try {
    const out = await runRefGit(
      ["describe", "--tags", "--abbrev=0"],
      [ref],
      cwd,
    );
    const tag = out.trim();
    return tag || null;
  } catch {
    return null;
  }
}

/** Get the tag immediately before `tag` in version order, or null. */
export async function previousTag(
  cwd: string,
  tag: string,
): Promise<string | null> {
  const tags = await listTags(cwd);
  const idx = tags.indexOf(tag);
  if (idx === -1 || idx + 1 >= tags.length) return null;
  return tags[idx + 1] ?? null;
}

/** Resolve a ref to a full SHA; throws GitError if it doesn't exist. */
export async function resolveRef(cwd: string, ref: string): Promise<string> {
  // Validate the raw ref, then pass the `^{commit}` peel as the revision so the
  // leading `--end-of-options` still guards it.
  assertSafeRef(ref);
  const out = await git(
    ["rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`],
    cwd,
  );
  return out.trim();
}

/** Check whether a ref exists. */
export async function refExists(cwd: string, ref: string): Promise<boolean> {
  try {
    await resolveRef(cwd, ref);
    return true;
  } catch {
    return false;
  }
}

/**
 * Read commits in the range (from, to]. If `from` is null, reads all commits
 * reachable from `to`. Merge commits are excluded by default.
 */
export async function getCommits(
  cwd: string,
  from: string | null,
  to = "HEAD",
  includeMerges = false,
): Promise<RawCommit[]> {
  const format = [
    "%H", // full hash
    "%h", // short hash
    "%s", // subject (header)
    "%b", // body
    "%an", // author name
    "%ae", // author email
    "%aI", // author date, strict ISO
  ].join(FIELD);

  // Validate each ref independently before composing the range so the leading
  // `--end-of-options` (added by runRefGit) reliably guards the revision arg.
  if (from !== null) assertSafeRef(from);
  assertSafeRef(to);

  // An unborn HEAD (a repo with zero commits) is not an error — there are simply
  // no commits to report. Bail out cleanly instead of surfacing git's
  // "ambiguous argument 'HEAD'" failure.
  if (to === "HEAD" && !(await hasCommits(cwd))) return [];

  const range = from ? `${from}..${to}` : to;

  const fixedArgs = ["log", `--format=${format}${RECORD}`];
  if (!includeMerges) fixedArgs.push("--no-merges");

  const out = await runRefGit(fixedArgs, [range], cwd);
  return parseLog(out);
}

/** Parse the delimited `git log` output into RawCommit records. */
export function parseLog(out: string): RawCommit[] {
  return out
    .split(RECORD)
    .map((r) => r.replace(/^\r?\n/, ""))
    .filter((r) => r.trim().length > 0)
    .map((record) => {
      const parts = record.split(FIELD);
      const [hash, shortHash, header, body, authorName, authorEmail, date] = [
        parts[0] ?? "",
        parts[1] ?? "",
        parts[2] ?? "",
        parts[3] ?? "",
        parts[4] ?? "",
        parts[5] ?? "",
        parts[6] ?? "",
      ];
      return {
        hash: hash.trim(),
        shortHash: shortHash.trim(),
        header: header.trim(),
        body: body.replace(/\r\n/g, "\n").trim(),
        authorName: authorName.trim(),
        authorEmail: authorEmail.trim(),
        date: date.trim(),
      } satisfies RawCommit;
    });
}

/** Get the `origin` remote URL, or the first remote, or null. */
export async function getRemoteUrl(cwd: string): Promise<string | null> {
  try {
    const out = await git(["remote", "get-url", "origin"], cwd);
    const url = out.trim();
    if (url) return url;
  } catch {
    // fall through to listing remotes
  }
  try {
    const out = await git(["remote", "-v"], cwd);
    const first = out
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)[0];
    if (first) {
      const match = first.match(/^\S+\s+(\S+)/);
      if (match?.[1]) return match[1];
    }
  } catch {
    // ignore
  }
  return null;
}

/**
 * Parse a git remote URL into structured RepoInfo for building web links.
 * Handles https, ssh (git@host:owner/repo.git), and git:// forms.
 */
export function parseRemoteUrl(url: string | null): RepoInfo {
  const unknown: RepoInfo = {
    host: "unknown",
    baseUrl: "",
  };
  if (!url) return unknown;

  let host = "";
  let path = "";

  // scp-like: git@github.com:owner/repo.git
  const scp = url.match(/^[\w.-]+@([^:]+):(.+)$/);
  if (scp) {
    host = scp[1] ?? "";
    path = scp[2] ?? "";
  } else {
    try {
      const u = new URL(url);
      host = u.hostname;
      path = u.pathname.replace(/^\//, "");
    } catch {
      return unknown;
    }
  }

  path = path.replace(/\.git$/i, "").replace(/\/$/, "");
  const segments = path.split("/").filter(Boolean);
  if (segments.length < 2) {
    return { ...detectHost(host), slug: undefined };
  }
  // owner is first segment; name is the last; supports gitlab subgroups by
  // joining the middle segments into the owner for the slug.
  const name = segments[segments.length - 1]!;
  const owner = segments.slice(0, -1).join("/");
  const slug = `${owner}/${name}`;
  const base = detectHost(host);
  return { ...base, slug, owner, name };
}

function detectHost(host: string): RepoInfo {
  const h = host.toLowerCase();
  if (h.includes("github")) {
    return { host: "github", baseUrl: `https://${host}` };
  }
  if (h.includes("gitlab")) {
    return { host: "gitlab", baseUrl: `https://${host}` };
  }
  if (h.includes("bitbucket")) {
    return { host: "bitbucket", baseUrl: `https://${host}` };
  }
  return { host: "unknown", baseUrl: host ? `https://${host}` : "" };
}

/** Convenience: resolve RepoInfo from cwd, with optional slug override. */
export async function getRepoInfo(
  cwd: string,
  overrideSlug?: string,
): Promise<RepoInfo> {
  const url = await getRemoteUrl(cwd);
  const info = parseRemoteUrl(url);
  if (overrideSlug) {
    const segs = overrideSlug.split("/").filter(Boolean);
    const owner = segs.slice(0, -1).join("/");
    const name = segs[segs.length - 1];
    // If we couldn't detect a host, default to GitHub for the override.
    const base =
      info.host === "unknown"
        ? { host: "github" as const, baseUrl: "https://github.com" }
        : { host: info.host, baseUrl: info.baseUrl };
    return { ...base, slug: overrideSlug, owner, name };
  }
  return info;
}
