# relnotes — Project Plan

> Generate beautiful changelogs and GitHub release notes from your conventional commits.

## 1. Research summary

**Competitors & gaps**

| Tool | Lang | Notes / Gap |
|------|------|-------------|
| `conventional-changelog` | Node | Powerful but heavy, preset-driven, opaque config, dated output. |
| `changelogen` (unjs) | Node | Nice output, but tightly coupled to npm publishing / version bumping workflow. |
| `release-please` | Node/Action | Google's tool, great for CI release PRs but heavyweight, GitHub-centric, hard to run ad hoc. |
| `git-cliff` | Rust | Extremely customizable but requires a binary install + learning a Tera template language. |

**The gap relnotes fills:** a *lean, zero-config-by-default* Node CLI that you can run with `npx relnotes` to get gorgeous grouped markdown immediately, with **first-class GitHub release publishing** and a tiny, readable config — without forcing a version-bump/publish opinion on you. Standout: contributors with avatars, breaking-change callouts, PR/issue autolinking, emoji sections, `--dry-run` preview, and CHANGELOG.md prepend that respects existing content.

**Library choices**
- `commander` — CLI parsing (ubiquitous, well typed).
- `picocolors` — tiny terminal colors (faster/smaller than chalk).
- Shell out to `git` via `child_process` (no native deps, robust on Windows). Avoid `simple-git` to keep deps minimal and control output parsing.
- `gh` CLI (preferred) **or** GitHub REST via `fetch` (Node 18+) with a token for release publishing.
- `vitest` — tests. `tsup` — bundling to ESM+CJS with a shebang bin. `typescript` strict.

## 2. Spec (MVP + standout)

### MVP
- Parse conventional commits in a range (default: last tag → HEAD; or `--from`/`--to`).
- Group by type (feat, fix, perf, refactor, docs, …) with scope sub-grouping.
- Clean markdown: title with version + date + compare link, grouped sections with emoji, breaking-changes callout at top.
- Autolink PRs (`(#123)`) and issues; commit short-hash links.
- Contributors list (deduped, sorted), optional avatars.
- Write/prepend `CHANGELOG.md` (idempotent, keeps `## [x.y.z]` history).
- Config file: `relnotes.config.{json,js,mjs,cjs,ts}` + `package.json#relnotes`.

### Standout
- `--dry-run` prints to stdout without writing.
- `relnotes release` — create a GitHub release via `gh` (fallback to REST token).
- Emoji + custom section titles/order via config; `--no-emoji`.
- Breaking-change detection (`!` and `BREAKING CHANGE:` footer) with dedicated callout.
- Group "Other changes" for unknown types; hide types via config.
- Repo URL auto-detected from `git remote` for links (GitHub/GitLab/Bitbucket host-aware).
- Version inference: explicit `--version`, else read `package.json` version, else next-tag heuristic.

## 3. CLI design

```
relnotes [options]                 # default: generate notes for last range
relnotes generate [options]        # explicit alias
relnotes release [options]         # generate + create GitHub release
relnotes init                      # write a starter relnotes.config.json

Common options:
  --from <ref>          Start ref (default: latest tag)
  --to <ref>            End ref (default: HEAD)
  --version <v>         Version label for the release/section
  -o, --output <file>   Changelog file (default: CHANGELOG.md)
  --stdout              Print to stdout only (implies dry run for file)
  --dry-run             Do everything except writing files / publishing
  --no-emoji            Disable section emoji
  --no-authors          Omit contributors section
  --repo <owner/name>   Override repo for links
  --config <path>       Explicit config path
  --tag <tag>           Git tag to attach the release to (release cmd)
  --draft / --prerelease  GitHub release flags (release cmd)
  --token <t>           GitHub token (release cmd; else GITHUB_TOKEN / gh)
  -v, --version-flag    Print relnotes version
  -h, --help
```

## 4. Config format

```jsonc
{
  "types": [
    { "type": "feat", "section": "Features", "emoji": "✨" },
    { "type": "fix", "section": "Bug Fixes", "emoji": "🐛" },
    { "type": "perf", "section": "Performance", "emoji": "⚡" },
    { "type": "refactor", "section": "Refactors", "emoji": "♻️", "hidden": false },
    { "type": "docs", "section": "Documentation", "emoji": "📝" },
    { "type": "chore", "section": "Chores", "emoji": "🔧", "hidden": true }
  ],
  "emoji": true,
  "authors": true,
  "linkReferences": true,
  "groupByScope": false,
  "repository": "owner/name",   // optional override
  "output": "CHANGELOG.md"
}
```

## 5. File layout

```
relnotes/
  src/
    index.ts            # bin entry (shebang) -> cli()
    cli.ts              # commander wiring
    config.ts           # load + merge + defaults
    git.ts              # git shellouts: tags, log, remote
    parser.ts           # conventional commit parser
    render.ts           # markdown renderer
    changelog.ts        # CHANGELOG.md read/prepend/write
    github.ts           # release publishing (gh + REST)
    types.ts            # shared types
    util.ts             # small helpers (links, slug, semver-ish)
  test/
    parser.test.ts
    render.test.ts
    changelog.test.ts
    git.test.ts         # temp-repo integration
    e2e.test.ts         # build + run CLI in temp repo
  README.md LICENSE CONTRIBUTING.md CHANGELOG.md PLAN.md
  package.json tsconfig.json tsup.config.ts vitest.config.ts .gitignore
  .github/workflows/ci.yml
  relnotes.config.json (example, .example)
```

## 6. Quality bar
- Strict TS, no `any` in public APIs, cross-platform (Windows-tested).
- Tests for parser edge cases, renderer snapshots, changelog prepend, plus a real temp-git e2e.
- CI on Node 18/20/22 across ubuntu + windows.
