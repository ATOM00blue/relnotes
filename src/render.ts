import { findTypeConfig } from "./config.js";
import type {
  CommitGroup,
  Contributor,
  ParsedCommit,
  ReleaseContext,
  ResolvedConfig,
} from "./types.js";
import {
  capitalize,
  commitUrl,
  compareUrl,
  dedupeBy,
  escapeMarkdown,
  issueUrl,
} from "./util.js";

/**
 * Build grouped commits according to config: respect type order, drop hidden
 * types, and bucket unknown/non-conventional commits into "other".
 */
export function groupCommits(
  commits: ParsedCommit[],
  config: ResolvedConfig,
): CommitGroup[] {
  const order = config.types.map((t) => t.type);
  const groups = new Map<string, CommitGroup>();

  const ensure = (
    key: string,
    section: string,
    emoji: string | undefined,
    type: string | null,
  ): CommitGroup => {
    let g = groups.get(key);
    if (!g) {
      g = { type, section, emoji, commits: [] };
      groups.set(key, g);
    }
    return g;
  };

  for (const c of commits) {
    const tc = findTypeConfig(config, c.type);
    if (tc) {
      if (tc.hidden) continue;
      ensure(tc.type, tc.section, tc.emoji, tc.type).commits.push(c);
    } else {
      // Unknown type or non-conventional commit.
      if (!c.conventional && !config.includeNonConventional) continue;
      ensure(
        "__other__",
        config.otherSection,
        config.otherEmoji,
        null,
      ).commits.push(c);
    }
  }

  // Sort groups by configured type order, with "other" last.
  return [...groups.values()].sort((a, b) => {
    if (a.type === null) return 1;
    if (b.type === null) return -1;
    return order.indexOf(a.type) - order.indexOf(b.type);
  });
}

/** Aggregate contributors from commits, deduped and sorted by commit count. */
export function aggregateContributors(commits: ParsedCommit[]): Contributor[] {
  const map = new Map<string, Contributor>();
  for (const c of commits) {
    const key = c.authorEmail.toLowerCase() || c.authorName.toLowerCase();
    if (!key) continue;
    const existing = map.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      map.set(key, {
        name: c.authorName,
        email: c.authorEmail,
        count: 1,
        ...(inferHandle(c.authorEmail) ? { handle: inferHandle(c.authorEmail)! } : {}),
      });
    }
  }
  return [...map.values()].sort(
    (a, b) => b.count - a.count || a.name.localeCompare(b.name),
  );
}

/** Infer a GitHub handle from a noreply email like 123+user@users.noreply.github.com. */
function inferHandle(email: string): string | null {
  const m = email.match(/^(?:\d+\+)?([^@]+)@users\.noreply\.github\.com$/i);
  return m?.[1] ?? null;
}

/** Render the markdown body of a release (no leading version heading). */
export function renderBody(ctx: ReleaseContext): string {
  const { config } = ctx;
  const lines: string[] = [];

  // Breaking changes callout first.
  if (ctx.breaking.length > 0) {
    lines.push(sectionHeading("⚠️", "BREAKING CHANGES", config.emoji));
    lines.push("");
    for (const c of ctx.breaking) {
      const notes = c.breakingNotes.length > 0 ? c.breakingNotes : [c.subject];
      for (const note of notes) {
        const scope = c.scope ? `**${escapeMarkdown(c.scope)}:** ` : "";
        lines.push(`- ${scope}${escapeMarkdown(note)}${renderMeta(c, ctx)}`);
      }
    }
    lines.push("");
  }

  for (const group of ctx.groups) {
    if (group.commits.length === 0) continue;
    lines.push(sectionHeading(group.emoji, group.section, config.emoji));
    lines.push("");
    if (config.groupByScope) {
      lines.push(...renderScoped(group, ctx));
    } else {
      for (const c of group.commits) {
        lines.push(renderCommitLine(c, ctx));
      }
    }
    lines.push("");
  }

  if (config.authors && ctx.contributors.length > 0) {
    lines.push(sectionHeading("❤️", "Contributors", config.emoji));
    lines.push("");
    lines.push(renderContributors(ctx.contributors));
    lines.push("");
  }

  // Collapse trailing blank lines to a single newline.
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

function renderScoped(group: CommitGroup, ctx: ReleaseContext): string[] {
  const out: string[] = [];
  const byScope = new Map<string, ParsedCommit[]>();
  for (const c of group.commits) {
    const key = c.scope ?? "";
    const arr = byScope.get(key) ?? [];
    arr.push(c);
    byScope.set(key, arr);
  }
  const scopes = [...byScope.keys()].sort((a, b) => {
    if (a === "") return 1;
    if (b === "") return -1;
    return a.localeCompare(b);
  });
  for (const scope of scopes) {
    const commits = byScope.get(scope)!;
    if (scope) {
      out.push(`- **${escapeMarkdown(scope)}**`);
      for (const c of commits) {
        out.push("  " + renderCommitLine(c, ctx, true));
      }
    } else {
      for (const c of commits) {
        out.push(renderCommitLine(c, ctx));
      }
    }
  }
  return out;
}

/** Render a single commit bullet line. */
export function renderCommitLine(
  c: ParsedCommit,
  ctx: ReleaseContext,
  noScope = false,
): string {
  const scope =
    !noScope && c.scope ? `**${escapeMarkdown(c.scope)}:** ` : "";
  const subject = capitalize(escapeMarkdown(c.subject));
  const breakingBadge = c.breaking ? "**[BREAKING]** " : "";
  return `- ${breakingBadge}${scope}${subject}${renderMeta(c, ctx)}`;
}

/** Render the trailing metadata: PR/issue links and commit hash link. */
function renderMeta(c: ParsedCommit, ctx: ReleaseContext): string {
  const { config, repo } = ctx;
  const parts: string[] = [];

  if (config.linkReferences && c.references.length > 0) {
    const refs = dedupeBy(c.references, (r) => `${r.repository ?? ""}#${r.issue}`)
      .map((r) => {
        const url = issueUrl(repo, r.issue, r.repository);
        const label = r.repository ? `${r.repository}#${r.issue}` : `#${r.issue}`;
        return url ? `[${label}](${url})` : label;
      })
      .join(", ");
    parts.push(`(${refs})`);
  }

  if (config.linkReferences && c.shortHash) {
    const url = commitUrl(repo, c.hash);
    parts.push(url ? `([${c.shortHash}](${url}))` : `(${c.shortHash})`);
  }

  return parts.length > 0 ? ` ${parts.join(" ")}` : "";
}

function renderContributors(contributors: Contributor[]): string {
  return contributors
    .map((ct) => {
      if (ct.handle) return `[@${ct.handle}](https://github.com/${ct.handle})`;
      return ct.name;
    })
    .join(", ");
}

function sectionHeading(
  emoji: string | undefined,
  title: string,
  useEmoji: boolean,
): string {
  if (useEmoji && emoji) return `### ${emoji} ${title}`;
  return `### ${title}`;
}

/**
 * Render the full release section, including the version heading and an
 * optional compare link.
 */
export function renderRelease(ctx: ReleaseContext): string {
  const heading = renderHeading(ctx);
  const body = renderBody(ctx);
  return `${heading}\n\n${body}`;
}

/** Render the `## [version](compareLink) - date` heading line. */
export function renderHeading(ctx: ReleaseContext): string {
  const { version, date, repo, previousTag, currentRef, config } = ctx;
  if (config.header) {
    return config.header
      .replace(/\{version\}/g, version)
      .replace(/\{date\}/g, date);
  }
  const link =
    previousTag && repo.slug
      ? compareUrl(repo, previousTag, currentRef === "HEAD" ? version : currentRef)
      : null;
  const versionText = link ? `[${version}](${link})` : version;
  return `## ${versionText} (${date})`;
}
