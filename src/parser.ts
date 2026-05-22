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

/** Reference patterns like (#123), #123, GH-123, owner/repo#123. */
const REFERENCE_RE = /(?:([\w.-]+\/[\w.-]+))?#(\d+)|\bGH-(\d+)\b/gi;

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

/** Extract PR/issue references from text. */
export function extractReferences(text: string): CommitReference[] {
  const refs: CommitReference[] = [];
  REFERENCE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = REFERENCE_RE.exec(text)) !== null) {
    const repository = m[1];
    const hashIssue = m[2];
    const ghIssue = m[3];
    if (hashIssue) {
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
