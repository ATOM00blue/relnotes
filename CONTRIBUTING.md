# Contributing to relnotes

Thanks for your interest in improving **relnotes**! Contributions of all kinds
are welcome — bug reports, feature ideas, docs, and pull requests.

## Getting started

```bash
git clone https://github.com/ATOM00blue/relnotes.git
cd relnotes
npm install
npm run build      # compile TypeScript -> dist/
npm test           # run the full test suite
```

## Project layout

```
src/
  index.ts       # bin entry (npx relnotes)
  cli.ts         # commander wiring
  config.ts      # config loading + defaults
  git.ts         # git shellouts + remote parsing
  parser.ts      # conventional-commit parser
  render.ts      # markdown renderer
  changelog.ts   # CHANGELOG.md prepend logic
  github.ts      # GitHub release publishing (gh CLI + REST)
  lib.ts         # public library API (the generate() pipeline)
  types.ts       # shared types
test/            # vitest suite, including a temp-git e2e test
```

## Development workflow

- We use **TypeScript** in strict mode. Run `npm run typecheck` before pushing.
- Tests live in `test/` and use [vitest](https://vitest.dev/). The git and e2e
  tests create disposable git repositories in your temp directory, so they need
  `git` on your PATH. The e2e test runs the built CLI, so run `npm run build`
  first (CI does this automatically).
- Format and lint are kept light; please match the surrounding style.

### Useful scripts

| Script | Description |
| ------ | ----------- |
| `npm run build` | Bundle to `dist/` with tsup (ESM + CJS + d.ts). |
| `npm run dev` | Rebuild on change. |
| `npm test` | Run the test suite once. |
| `npm run test:watch` | Watch mode. |
| `npm run typecheck` | Type-check without emitting. |

## Commit messages

relnotes is built on [Conventional Commits](https://www.conventionalcommits.org/),
so naturally we use them too. Examples:

```
feat(render): add scope sub-grouping
fix(parser): handle BREAKING-CHANGE footer token
docs: clarify --from default in README
```

Breaking changes use `!` and/or a `BREAKING CHANGE:` footer.

## Pull requests

1. Fork and create a feature branch.
2. Add tests for new behavior.
3. Make sure `npm run build`, `npm run typecheck`, and `npm test` all pass.
4. Open a PR with a clear description. Link any relevant issues.

## Reporting bugs

Please open an issue including:

- What you ran (the exact `relnotes` command).
- What you expected vs. what happened.
- Your OS, Node version, and `relnotes --version`.

By contributing, you agree that your contributions are licensed under the
project's [MIT License](./LICENSE).
