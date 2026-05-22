import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { RepoInfo } from "./types.js";

const execFileAsync = promisify(execFile);

export interface ReleaseInput {
  /** Git tag to create/attach the release to (e.g. "v1.2.0"). */
  tag: string;
  /** Release title (defaults to the tag). */
  title?: string;
  /** Markdown body of the release notes. */
  body: string;
  /** Mark as a draft release. */
  draft?: boolean;
  /** Mark as a prerelease. */
  prerelease?: boolean;
  /** Repo slug "owner/name" (required for the REST fallback). */
  repo?: RepoInfo;
  /** Explicit token; otherwise GITHUB_TOKEN / GH_TOKEN env is used for REST. */
  token?: string;
  /** Working directory (for the gh CLI path). */
  cwd?: string;
}

export interface ReleaseResult {
  /** Web URL of the created/updated release, if known. */
  url?: string;
  /** Which transport was used. */
  via: "gh" | "rest";
}

/** Check whether the `gh` CLI is installed and on PATH. */
export async function hasGhCli(): Promise<boolean> {
  try {
    await execFileAsync("gh", ["--version"], { windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * Create a GitHub release. Prefers the `gh` CLI (uses the user's existing auth),
 * falling back to the GitHub REST API with a token.
 */
export async function createRelease(
  input: ReleaseInput,
): Promise<ReleaseResult> {
  if (await hasGhCli()) {
    return createReleaseViaGh(input);
  }
  return createReleaseViaRest(input);
}

async function createReleaseViaGh(input: ReleaseInput): Promise<ReleaseResult> {
  const { tag, title, body, draft, prerelease, cwd } = input;
  // Write the body to a temp file to avoid shell-escaping issues with newlines.
  const file = path.join(
    tmpdir(),
    `relnotes-${Date.now()}-${Math.random().toString(36).slice(2)}.md`,
  );
  await writeFile(file, body, "utf8");
  try {
    const args = [
      "release",
      "create",
      tag,
      "--title",
      title ?? tag,
      "--notes-file",
      file,
    ];
    if (draft) args.push("--draft");
    if (prerelease) args.push("--prerelease");
    if (input.repo?.slug) args.push("--repo", input.repo.slug);

    const { stdout } = await execFileAsync("gh", args, {
      cwd: cwd ?? process.cwd(),
      windowsHide: true,
      env: input.token
        ? { ...process.env, GH_TOKEN: input.token }
        : process.env,
    });
    const url = stdout.trim().split(/\r?\n/).find((l) => l.startsWith("http"));
    return { ...(url ? { url } : {}), via: "gh" };
  } finally {
    await unlink(file).catch(() => {});
  }
}

async function createReleaseViaRest(
  input: ReleaseInput,
): Promise<ReleaseResult> {
  const { tag, title, body, draft, prerelease, repo } = input;
  const token =
    input.token ?? process.env["GITHUB_TOKEN"] ?? process.env["GH_TOKEN"];
  if (!token) {
    throw new Error(
      "No GitHub token available. Install the `gh` CLI or set GITHUB_TOKEN.",
    );
  }
  if (!repo?.slug || repo.host !== "github") {
    throw new Error(
      "Could not determine the GitHub repository for the REST API. " +
        "Pass --repo <owner/name>.",
    );
  }

  const res = await fetch(
    `https://api.github.com/repos/${repo.slug}/releases`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "relnotes",
      },
      body: JSON.stringify({
        tag_name: tag,
        name: title ?? tag,
        body,
        draft: Boolean(draft),
        prerelease: Boolean(prerelease),
      }),
    },
  );

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `GitHub API error ${res.status} ${res.statusText}: ${text.slice(0, 500)}`,
    );
  }
  const json = (await res.json()) as { html_url?: string };
  return { ...(json.html_url ? { url: json.html_url } : {}), via: "rest" };
}
