/**
 * Shared types for relnotes. These form the contract between the git layer,
 * parser, renderer, changelog writer, and GitHub integration.
 */

/** A raw commit read from `git log`, before conventional-commit parsing. */
export interface RawCommit {
  /** Full 40-char SHA. */
  hash: string;
  /** Abbreviated SHA (typically 7 chars). */
  shortHash: string;
  /** First line of the commit message (the "header"). */
  header: string;
  /** Everything after the header (body + footers), may be empty. */
  body: string;
  /** Author display name. */
  authorName: string;
  /** Author email. */
  authorEmail: string;
  /** ISO author date. */
  date: string;
}

/** A reference (PR or issue) extracted from a commit. */
export interface CommitReference {
  /** Raw matched text, e.g. "#123" or "owner/repo#123". */
  raw: string;
  /** Numeric id without the leading '#'. */
  issue: string;
  /** Optional "owner/repo" prefix for cross-repo references. */
  repository?: string;
}

/** A footer trailer such as `Reviewed-by: Jane`. */
export interface CommitNote {
  token: string;
  text: string;
}

/** A fully parsed conventional commit. */
export interface ParsedCommit extends RawCommit {
  /** Conventional type, lowercased (e.g. "feat"). Null if not conventional. */
  type: string | null;
  /** Optional scope inside parentheses. */
  scope: string | null;
  /** Whether the commit is a breaking change (`!` or BREAKING CHANGE footer). */
  breaking: boolean;
  /** Description text (header minus the `type(scope): ` prefix). */
  subject: string;
  /** Extracted PR/issue references. */
  references: CommitReference[];
  /** Breaking-change descriptions (from `!` subject and/or footers). */
  breakingNotes: string[];
  /** All footer trailers. */
  notes: CommitNote[];
  /** True when the header matched the conventional-commit grammar. */
  conventional: boolean;
}

/** Configuration for a single commit type / section. */
export interface TypeConfig {
  /** The conventional type, e.g. "feat". */
  type: string;
  /** Human section title, e.g. "Features". */
  section: string;
  /** Emoji shown before the section title when emoji is enabled. */
  emoji?: string;
  /** When true, commits of this type are omitted from output. */
  hidden?: boolean;
}

/** Fully-resolved configuration (after merging defaults + user config). */
export interface ResolvedConfig {
  types: TypeConfig[];
  /** Section title for conventional commits with unknown types. */
  otherSection: string;
  /** Emoji for the "other" section. */
  otherEmoji: string;
  /** Whether to include emoji in section headings. */
  emoji: boolean;
  /** Whether to render a contributors section. */
  authors: boolean;
  /** Whether to render avatar thumbnails for contributors. */
  authorAvatars: boolean;
  /** Whether to autolink PR/issue references and commit hashes. */
  linkReferences: boolean;
  /** Whether to add a scope sub-heading / prefix grouping. */
  groupByScope: boolean;
  /** Whether to include non-conventional commits under "other". */
  includeNonConventional: boolean;
  /** Override "owner/name" repository slug. */
  repository?: string;
  /** Default output changelog file. */
  output: string;
  /** Title template for the version heading; {version} and {date} tokens. */
  header?: string;
}

/** User-supplied config (all fields optional / partial). */
export interface UserConfig {
  types?: TypeConfig[];
  otherSection?: string;
  otherEmoji?: string;
  emoji?: boolean;
  authors?: boolean;
  authorAvatars?: boolean;
  linkReferences?: boolean;
  groupByScope?: boolean;
  includeNonConventional?: boolean;
  repository?: string;
  output?: string;
  header?: string;
}

/** Information about the host repository derived from the git remote. */
export interface RepoInfo {
  /** "github" | "gitlab" | "bitbucket" | "unknown". */
  host: "github" | "gitlab" | "bitbucket" | "unknown";
  /** Base web URL, e.g. "https://github.com". */
  baseUrl: string;
  /** "owner/name" slug, if detectable. */
  slug?: string;
  /** Owner part of the slug. */
  owner?: string;
  /** Repo name part of the slug. */
  name?: string;
}

/** A contributor aggregated across commits. */
export interface Contributor {
  name: string;
  email: string;
  /** Number of commits in the range. */
  count: number;
  /** GitHub-style handle if it can be inferred (without leading @). */
  handle?: string;
}

/** A group of parsed commits sharing a type/section. */
export interface CommitGroup {
  type: string | null;
  section: string;
  emoji?: string;
  commits: ParsedCommit[];
}

/** Everything the renderer needs to produce markdown. */
export interface ReleaseContext {
  /** Version label, e.g. "1.2.0" or "v1.2.0". */
  version: string;
  /** Previous tag/ref the range started from (for compare links). */
  previousTag?: string;
  /** The end ref (tag/HEAD). */
  currentRef: string;
  /** ISO or YYYY-MM-DD date string for the heading. */
  date: string;
  /** Resolved repo info for links. */
  repo: RepoInfo;
  /** Grouped, filtered commits ready to render. */
  groups: CommitGroup[];
  /** Commits flagged as breaking (for the callout). */
  breaking: ParsedCommit[];
  /** Aggregated contributors. */
  contributors: Contributor[];
  /** The full resolved config. */
  config: ResolvedConfig;
}

/** Options resolved from CLI flags + config, passed into the pipeline. */
export interface GenerateOptions {
  from?: string;
  to?: string;
  version?: string;
  output?: string;
  stdout?: boolean;
  dryRun?: boolean;
  emoji?: boolean;
  authors?: boolean;
  repo?: string;
  config?: string;
  cwd?: string;
}
