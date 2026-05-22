# Changelog

All notable changes to this project are documented in this file.

This project adheres to [Conventional Commits](https://www.conventionalcommits.org/)
and the format is based on [Keep a Changelog](https://keepachangelog.com/).

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
