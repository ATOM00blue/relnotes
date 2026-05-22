import type {
  CommitNote,
  CommitReference,
  ParsedCommit,
  RawCommit,
} from "./types.js";

/**
 * Conventional-commit header grammar:
 *   <type>[(scope)][!]: <subject>
 *
 * - type: one or more word chars (we lowercase it)
 * - scope: optional, inside parentheses
 * - !: optional breaking marker before the colon
 * - subject: the rest of the line
 *
 * Reverts (e.g. "Revert \"feat: x\"") and merge subjects are treated as
 * non-conventional and bucketed into "other".
 */
const HEADER_RE = /^(?<type>[a-zA-Z][\w-]*)(?:\((?<scope>[^()]*)\))?(?<breaking>!)?:\s+(?<subject>.+)$/;

/** Footer trailer: `Token: value` or `Token #value` (git-trailer style). */
const FOOTER_RE = /^(?<token>BREAKING[ -]CHANGE|[A-Za-z][\w-]*)(?::\s+| #)(?<value>.+)$/;

/**
 * Reference anchors: `#123` or `GH-123`. Deliberately has NO optional greedy
 * prefix so it cannot backtrack — see `extractReferences` for how the optional
 * `owner/repo` prefix is recovered safely (ReDoS-safe, two-phase).
 */
const REFERENCE_ANCHOR_RE = /#(\d+)|\bGH-(\d+)\b/gi;

/**
 * Recovers an `owner/repo` prefix that sits immediately before a `#` anchor.
 * Run only on a short, bounded slice of text (see `REPO_LOOKBACK`), so the
 * end-anchored match is O(1) and cannot blow up.
 */
const REPO_BEFORE_RE = /([\w.-]+\/[\w.-]+)$/;

/** Max characters to inspect before a `#` when looking for an `owner/repo`. */
const REPO_LOOKBACK = 600;

/**
 * Parse a single raw commit into a conventional commit structure. Never throws.
 */
export function parseCommit(raw: RawCommit): ParsedCommit {
  const headerMatch = HEADER_RE.exec(raw.header);

  let type: string | null = null;
  let scope: string | null = null;
  let breaking = false;
  let subject = raw.header;
  let conventional = false;

  if (headerMatch?.groups) {
    const g = headerMatch.groups;
    type = (g["type"] ?? "").toLowerCase();
    scope = g["scope"] ? g["scope"].trim() || null : null;
    breaking = Boolean(g["breaking"]);
    subject = (g["subject"] ?? "").trim();
    conventional = true;
  }

  // Strip a trailing PR reference like " (#123)" from the subject; it is
  // rendered separately as a linked reference, so keeping it would duplicate.
  subject = subject.replace(/\s*\((?:[\w.-]+\/[\w.-]+)?#\d+\)\s*$/, "").trim();

  const { notes, breakingNotes: footerBreaking } = parseFooters(raw.body);

  const breakingNotes: string[] = [];
  for (const note of footerBreaking) {
    breakingNotes.push(note);
    breaking = true;
  }
  // A `!` breaking marker with no explicit footer note falls back to the
  // subject as the breaking description.
  if (breaking && breakingNotes.length === 0) {
    breakingNotes.push(subject);
  }

  const references = extractReferences(`${raw.header}\n${raw.body}`);

  return {
    ...raw,
    type,
    scope,
    breaking,
    subject,
    references,
    breakingNotes: dedupe(breakingNotes),
    notes,
    conventional,
  };
}

/** Parse all commits. */
export function parseCommits(raws: RawCommit[]): ParsedCommit[] {
  return raws.map(parseCommit);
}

/**
 * Extract footer trailers from a commit body. Implements the spec rule that a
 * footer value may span multiple lines until the next valid token is seen.
 */
export function parseFooters(body: string): {
  notes: CommitNote[];
  breakingNotes: string[];
} {
  const notes: CommitNote[] = [];
  const breakingNotes: string[] = [];
  if (!body) return { notes, breakingNotes };

  const lines = body.split(/\r?\n/);
  let current: CommitNote | null = null;

  const flush = () => {
    if (!current) return;
    const text = current.text.trim();
    const normalizedToken = current.token.replace(/\s+/g, "-").toUpperCase();
    if (normalizedToken === "BREAKING-CHANGE") {
      breakingNotes.push(text);
    } else {
      notes.push({ token: current.token, text });
    }
    current = null;
  };

  for (const line of lines) {
    const m = FOOTER_RE.exec(line.trim());
    if (m?.groups) {
      flush();
      current = {
        token: m.groups["token"] ?? "",
        text: m.groups["value"] ?? "",
      };
    } else if (current) {
      // Continuation of the current footer value.
      current.text += `\n${line}`;
    }
  }
  flush();

  return { notes, breakingNotes };
}

/**
 * Extract PR/issue references from text.
 *
 * ReDoS-safe by construction: phase 1 finds `#`/`GH-` anchors with a regex that
 * has no optional greedy prefix (so it is linear regardless of input). Phase 2
 * recovers an optional `owner/repo` prefix by matching an end-anchored regex on
 * a bounded slice of the text immediately before each `#`. Both phases are
 * linear in the input length even for adversarial commit messages.
 */
export function extractReferences(text: string): CommitReference[] {
  const refs: CommitReference[] = [];
  REFERENCE_ANCHOR_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = REFERENCE_ANCHOR_RE.exec(text)) !== null) {
    const hashIssue = m[1];
    const ghIssue = m[2];
    if (hashIssue) {
      const start = Math.max(0, m.index - REPO_LOOKBACK);
      const before = text.slice(start, m.index);
      const repoMatch = REPO_BEFORE_RE.exec(before);
      const repository = repoMatch?.[1];
      refs.push({
        raw: repository ? `${repository}#${hashIssue}` : `#${hashIssue}`,
        issue: hashIssue,
        ...(repository ? { repository } : {}),
      });
    } else if (ghIssue) {
      refs.push({ raw: `GH-${ghIssue}`, issue: ghIssue });
    }
  }
  return dedupeRefs(refs);
}

function dedupe(arr: string[]): string[] {
  return [...new Set(arr.map((s) => s.trim()).filter(Boolean))];
}

function dedupeRefs(refs: CommitReference[]): CommitReference[] {
  const seen = new Set<string>();
  const out: CommitReference[] = [];
  for (const r of refs) {
    const key = `${r.repository ?? ""}#${r.issue}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}
