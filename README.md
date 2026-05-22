<div align="center">

# relnotes

**Generate beautiful changelogs and GitHub release notes from your conventional commits.**

[![CI](https://github.com/ATOM00blue/relnotes/actions/workflows/ci.yml/badge.svg)](https://github.com/ATOM00blue/relnotes/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/relnotes.svg)](https://www.npmjs.com/package/relnotes)
[![node](https://img.shields.io/node/v/relnotes.svg)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Conventional Commits](https://img.shields.io/badge/Conventional%20Commits-1.0.0-fe5196.svg)](https://www.conventionalcommits.org/)

</div>

`relnotes` reads your [Conventional Commits](https://www.conventionalcommits.org/),
groups them into clean, emoji-labelled sections, highlights breaking changes,
auto-links PRs/issues/commits, lists your contributors — and can publish the
whole thing as a GitHub release. Zero config to start; one tiny JSON file when
you want to customize.

```bash
npx relnotes --stdout
```

That's it. No setup, no presets to learn, no version-bump opinions forced on you.

---

## ✨ Why relnotes?

| | relnotes | conventional-changelog | changelogen | git-cliff |
| --- | :---: | :---: | :---: | :---: |
| Zero-config, runs with `npx` | ✅ | ⚠️ preset-driven | ✅ | ⚠️ needs binary |
| No forced version-bump / publish workflow | ✅ | ✅ | ❌ | ✅ |
| Breaking-change callout | ✅ | ⚠️ | ✅ | ✅ |
| Auto-link PRs, issues **and** commits | ✅ | ✅ | ✅ | ✅ |
| Contributors with GitHub handles | ✅ | ❌ | ✅ | ⚠️ |
| Publish a GitHub release | ✅ `gh` **or** REST | ❌ | ✅ | ⚠️ |
| Tiny, readable config (JSON/JS) | ✅ | ❌ | ✅ | ⚠️ Tera templates |
| Pure Node, cross-platform | ✅ | ✅ | ✅ | ❌ Rust binary |

---

## 🚀 Quickstart

```bash
# Preview release notes for everything since your last tag:
npx relnotes --stdout

# Write/prepend them into CHANGELOG.md:
npx relnotes

# Generate for a specific range and version label:
npx relnotes --from v1.2.0 --to HEAD --release-version 1.3.0

# Publish a GitHub release (uses your `gh` login or $GITHUB_TOKEN):
npx relnotes release --release-version 1.3.0
```

Install it globally if you prefer:

```bash
npm install -g relnotes
relnotes --help
```

---

## 📄 Example output

Given commits like:

```
feat(parser): add conventional commit parser (#12)
feat(cli): add release command
fix: handle empty commit body (#15)
perf: speed up log parsing
feat(api)!: drop Node 16 support

BREAKING CHANGE: Node 18+ is now required.
docs: improve README examples
```

`relnotes` produces:

```markdown
## [1.0.0](https://github.com/acme/widget/compare/v0.1.0...1.0.0) (2026-05-22)

### ⚠️ BREAKING CHANGES

- **api:** Node 18+ is now required. ([4b8c0c5](https://github.com/acme/widget/commit/4b8c0c5))

### ✨ Features

- **[BREAKING]** **api:** Drop Node 16 support ([4b8c0c5](https://github.com/acme/widget/commit/4b8c0c5))
- **cli:** Add release command ([daba7a7](https://github.com/acme/widget/commit/daba7a7))
- **parser:** Add conventional commit parser ([#12](https://github.com/acme/widget/issues/12)) ([96f6311](https://github.com/acme/widget/commit/96f6311))

### 🐛 Bug Fixes

- Handle empty commit body ([#15](https://github.com/acme/widget/issues/15)) ([5ce08d7](https://github.com/acme/widget/commit/5ce08d7))

### ⚡ Performance

- Speed up log parsing ([9f9af69](https://github.com/acme/widget/commit/9f9af69))

### 📝 Documentation

- Improve README examples ([2cc21bc](https://github.com/acme/widget/commit/2cc21bc))

### ❤️ Contributors

[@octocat](https://github.com/octocat), Jane Doe
```

Which renders as nicely grouped, linked sections on GitHub. 🎉

---

## 🧭 Commands

```text
relnotes [generate] [options]   Generate changelog markdown (default command)
relnotes release   [options]    Generate notes and create a GitHub release
relnotes init                   Write a starter relnotes.config.json
```

### `generate` (default)

Reads commits in the range, renders grouped markdown, and prepends it to your
changelog file (or prints it).

### `release`

Everything `generate` does, plus it creates a GitHub release. It prefers the
[`gh` CLI](https://cli.github.com/) (using your existing auth), and falls back
to the GitHub REST API when you provide a token. By default it also updates
`CHANGELOG.md` (disable with `--no-changelog`).

### `init`

Writes a starter `relnotes.config.json` you can tweak.

---

## 🚩 Options

| Flag | Description | Default |
| --- | --- | --- |
| `--from <ref>` | Start ref (exclusive). | latest tag |
| `--to <ref>` | End ref (inclusive). | `HEAD` |
| `--release-version <v>` | Version label for the heading/release. | `package.json` version → latest tag → `Unreleased` |
| `-o, --output <file>` | Changelog file to write/prepend. | `CHANGELOG.md` |
| `--stdout` | Print to stdout instead of writing a file. | off |
| `--dry-run` | Do everything except writing/publishing. | off |
| `--no-emoji` | Disable section emoji. | emoji on |
| `--no-authors` | Omit the contributors section. | authors on |
| `--repo <owner/name>` | Override the repository slug for links. | from `git remote` |
| `-c, --config <path>` | Path to a config file. | auto-detect |

**`release` adds:**

| Flag | Description |
| --- | --- |
| `--tag <tag>` | Git tag to attach the release to (default: `v<version>`). |
| `--title <title>` | Release title (default: the version). |
| `--draft` | Create the release as a draft. |
| `--prerelease` | Mark the release as a prerelease. |
| `--token <token>` | GitHub token (else uses `gh` / `GITHUB_TOKEN`). |
| `--no-changelog` | Don't also update `CHANGELOG.md`. |

---

## ⚙️ Configuration

`relnotes` works with zero config. To customize, add any of:

- `relnotes.config.json`
- `relnotes.config.{js,mjs,cjs,ts}` (export default an object)
- `.relnotesrc.json`
- a `"relnotes"` field in `package.json`

```jsonc
{
  "emoji": true,            // show emoji in section headings
  "authors": true,          // include a contributors section
  "linkReferences": true,   // autolink #PRs/issues and commit hashes
  "groupByScope": false,    // sub-group commits by scope
  "includeNonConventional": false, // bucket non-conventional commits into "Other"
  "repository": "owner/name",       // override the slug used for links
  "output": "CHANGELOG.md",
  "header": "## {version} ({date})", // optional heading template
  "types": [
    { "type": "feat",     "section": "Features",       "emoji": "✨" },
    { "type": "fix",      "section": "Bug Fixes",      "emoji": "🐛" },
    { "type": "perf",     "section": "Performance",    "emoji": "⚡" },
    { "type": "refactor", "section": "Refactors",      "emoji": "♻️" },
    { "type": "docs",     "section": "Documentation",  "emoji": "📝" },
    { "type": "chore",    "section": "Chores",         "emoji": "🔧", "hidden": true }
  ]
}
```

User-defined `types` are merged over the built-in defaults: matching types are
overridden, new ones are appended, and the array order controls section order.
Set `"hidden": true` to keep a type's commits out of the output entirely.

---

## 🐙 Publishing a GitHub release

```bash
# Tag your release first (relnotes will create a release for this tag):
git tag v1.3.0 && git push --tags

# Then publish notes generated from your commits:
relnotes release --release-version 1.3.0
```

- **With `gh`:** if the [GitHub CLI](https://cli.github.com/) is installed and
  authenticated, `relnotes` shells out to `gh release create` — no token needed.
- **Without `gh`:** set `GITHUB_TOKEN` (or pass `--token`) and `relnotes` uses
  the REST API. The repo slug is auto-detected from your `origin` remote, or
  pass `--repo owner/name`.

In CI:

```yaml
- run: npx relnotes release --release-version ${{ github.ref_name }}
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

---

## 📚 Programmatic API

`relnotes` is also a library:

```ts
import { generate } from "relnotes";

const { changelogSection, releaseNotes, context } = await generate({
  from: "v1.2.0",
  version: "1.3.0",
});

console.log(changelogSection); // markdown with the version heading
console.log(releaseNotes);     // markdown body for a GitHub release
console.log(context.contributors);
```

Lower-level helpers are exported too: `parseCommit`, `groupCommits`,
`renderRelease`, `prependRelease`, `getRepoInfo`, `createRelease`, and more.

---

## ❓ FAQ

**Does it require a specific commit format?**
It expects [Conventional Commits](https://www.conventionalcommits.org/)
(`type(scope)!: subject`). Non-conventional commits are skipped by default; set
`includeNonConventional: true` to collect them under "Other Changes".

**What counts as a breaking change?**
Either a `!` before the colon (`feat!:` / `feat(api)!:`) or a `BREAKING CHANGE:`
(or `BREAKING-CHANGE:`) footer. Both feed the dedicated callout.

**Which hosts are supported for links?**
GitHub, GitLab, and Bitbucket link formats are detected from your `git remote`.
Unknown hosts still get a clean changelog, just without hyperlinks.

**Will it overwrite my CHANGELOG.md?**
No. It prepends the new release above existing entries, preserving your
preamble and history. If a section for that version already exists, it skips the
write (use `--release-version` to label differently, or `--stdout` to preview).

**Does it bump my version or publish to npm?**
No — that's intentionally out of scope. `relnotes` focuses on great notes and
release publishing. Pair it with your favorite versioning tool.

**Windows support?**
Yes. `relnotes` is pure Node, shells out to `git` portably, and the test suite
runs on Windows and Linux in CI.

---

## 🤝 Contributing

Contributions are very welcome — see [CONTRIBUTING.md](./CONTRIBUTING.md).

```bash
npm install && npm run build && npm test
```

---

## 📜 License

[MIT](./LICENSE) © 2026 ATOM00blue
