# Changelog

All notable changes to this project are documented in this file.

This project adheres to [Conventional Commits](https://www.conventionalcommits.org/)
and the format is based on [Keep a Changelog](https://keepachangelog.com/).

## Unreleased

### 🔒 Security

- Harden git invocation against argument/flag injection: untrusted refs
  (`--from`/`--to`/`--tag`, config, branch names) are validated and passed after
  `--end-of-options`, so a value like `--output=...` can no longer be
  interpreted as a git flag (arbitrary file write).
- Make the conventional-commit reference parser ReDoS-safe: replaced the
  backtracking reference regex with a linear two-phase scan. Pathological commit
  messages that previously took ~20s now complete in <1ms.
- Validate the GitHub repository slug before building the REST URL / passing it
  to `gh`, preventing path-traversal and query/fragment injection.
- Escape link/markup-significant characters in commit subjects so a crafted
  message can't inject links or raw HTML into changelogs and release notes.
- Document the config-file execution trust model (JS/TS configs run code) and
  token handling guidance; prefer `GITHUB_TOKEN`/`GH_TOKEN` over `--token`.

### 🐛 Bug Fixes

- Handle empty / unborn repositories gracefully instead of surfacing a raw
  `ambiguous argument 'HEAD'` git error.

### 🔧 Chores

- Upgrade `vitest` to v3.2.4 (pulls `vite@7`/`esbuild@0.27`) to clear 5 moderate
  (dev-only) advisories while keeping Node 18 support; `npm audit` is now clean.
- Add regression tests for flag injection, ReDoS timing, slug validation,
  token-not-logged, and empty-repo handling.

## 0.1.0 (2026-05-22)

### ✨ Features

- Parse conventional commits in any range (default: latest tag → HEAD).
- Group commits by type with configurable sections and emoji.
- Dedicated breaking-changes callout from `!` and `BREAKING CHANGE:` footers.
- Autolink PR/issue references and commit hashes (GitHub, GitLab, Bitbucket).
- Contributors section with inferred GitHub handles.
- Prepend new releases into `CHANGELOG.md` without clobbering history.
- `relnotes release` publishes a GitHub release via the `gh` CLI or REST API.
- Zero-config defaults plus `relnotes.config.json` / `package.json#relnotes`.
- `--stdout`, `--dry-run`, `--no-emoji`, `--no-authors`, and `--repo` flags.
