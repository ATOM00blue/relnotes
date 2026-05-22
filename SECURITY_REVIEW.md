# Security & Quality Review — relnotes

Deep security and quality audit of `relnotes` (Node.js + TypeScript CLI that reads
git history, loads a JS/TS/JSON config file, and publishes GitHub releases).

- Date: 2026-05-22
- Reviewer: autonomous application-security pass
- Commit reviewed: `fa29de9` (origin/main)
- Scope: `src/**`, `test/**`, build/CI config, dependencies.

Severity legend: **Critical** (remote/exploitable, high impact) · **High** ·
**Medium** · **Low** · **Info**.

---

## Summary of findings

| # | Severity | Area | Title | Status |
|---|----------|------|-------|--------|
| 1 | **High** | git / injection | git argument (flag) injection via untrusted refs | Fixed |
| 2 | **High** | parser / DoS | ReDoS in `REFERENCE_RE` on arbitrary commit messages | Fixed |
| 3 | **Medium** | github / SSRF | Repo slug not validated before building the REST URL | Fixed |
| 4 | **Medium** | config / RCE | Config loader executes code; trust model undocumented | Fixed (documented + guarded) |
| 5 | **Medium** | tokens | `--token` on the command line is world-visible in process args | Fixed (documented + warning) |
| 6 | **Medium** | deps | 5 moderate CVEs in the `vitest`/`vite`/`esbuild` dev chain | Fixed (dev upgrade) |
| 7 | **Low** | markdown | Link/markdown injection from commit subjects into output | Fixed (hardened escaping) |
| 8 | **Low** | robustness | `git` stderr may echo refs into errors; non-issue for tokens | Documented |
| 9 | **Low** | robustness | empty/unborn repo surfaced a raw git error | Fixed |
| 10 | **Info** | quality | README/behaviour accuracy + missing regression tests | Fixed |

No Critical findings. Two High findings (git flag injection, parser ReDoS) are
the headline risks and are both fixed with regression tests.

---

## 1. High — git argument (flag) injection via untrusted refs

**Files:** `src/git.ts` — `getCommits` (L112-134, range built as `${from}..${to}`),
`resolveRef` (L93-96), `latestTag` (L68-79), and every other `git(...)` call that
forwards a user-controlled ref.

**Impact.** The values `from`, `to`, `ref`, and `tag` originate from untrusted
input: CLI flags (`--from`, `--to`, `--tag`), the config file (`repository`),
and indirectly from branch/tag names. They are passed to `git` as **positional
arguments without an `--end-of-options` guard**. Git treats any argument that
starts with `-` as an option. Because the range is in *option position* (before
pathspecs), a value such as `--output=<path>` is interpreted as the
`git log --output=<file>` flag and **writes attacker-chosen content to an
arbitrary file**. Other dangerous options (`--upload-pack`, pager-spawning
options on some subcommands) can lead to command execution.

This was confirmed empirically:

```
git log --format=%s "--output=/tmp/PWNED.txt" HEAD   # creates /tmp/PWNED.txt
```

So `relnotes --from "--output=/abs/path"` (or any ref derived from untrusted
data) is an arbitrary-file-write primitive.

**Why `--` alone is not enough.** For `git log`, `--` introduces *pathspecs*, not
an end-of-options marker, and the revision range sits *before* pathspecs. The
correct guard is `--end-of-options`, placed immediately before the
user-controlled ref/range. Verified: after `--end-of-options`, git rejects
`--output=...` as "must come before non-option arguments" and treats it as a
revision instead.

**Fix.** Added a `runRefGit()` helper in `src/git.ts` that:
- inserts `--end-of-options` right before the user-controlled ref/range in
  `git log`, `git rev-parse --verify`, and `git describe`;
- rejects refs/ranges that are obviously hostile before they ever reach git
  (defence in depth: refs starting with `-`, containing NUL/newline, etc., via
  `assertSafeRef`).

Regression test: `test/security.test.ts` — "flag-injection via crafted ref"
asserts that `--from "--output=<file>"` does **not** create the file and that the
command fails safely.

---

## 2. High — ReDoS in the conventional-commit reference parser

**File:** `src/parser.ts` — `REFERENCE_RE` (L26) used by `extractReferences`
(L131-151), which runs on **every commit header + body** (untrusted text from
`git log`).

```js
const REFERENCE_RE = /(?:([\w.-]+\/[\w.-]+))?#(\d+)|\bGH-(\d+)\b/gi;
```

**Impact.** The leading optional, greedy group `([\w.-]+\/[\w.-]+)?` followed by
`#` causes catastrophic backtracking when the input contains long runs of
`[\w.-]` characters with no following `#`. Commit messages are arbitrary
attacker-controlled text and a single line can be many KB. Measured wall-clock
time for a single `extractReferences` call:

| input length | time |
|---|---|
| 10,000 chars | ~1.0 s |
| 50,000 chars | ~20 s |

A malicious repository can ship one commit with a crafted message and **hang
`relnotes`** (denial of service in local runs and in CI release pipelines).

**Fix.** Replaced the single backtracking regex with a **two-phase, linear**
algorithm in `src/parser.ts`:
1. A simple anchor regex `(/#(\d+)|\bGH-(\d+)\b/gi)` finds issue/PR anchors —
   no optional greedy prefix, so no backtracking.
2. For a `#` anchor, an `owner/repo` prefix is detected by running an
   end-anchored regex on a **bounded 600-char slice** immediately before the
   `#`. The slice bound makes the second phase O(1) per anchor.

The new implementation is byte-for-byte behaviour-compatible with the old regex
across an edge-case corpus (verified: 0 diffs over 13 cases incl.
`owner/repo#7`, `a/b/c#9`, `GH-42`, dedup). New worst-case timing for the inputs
that previously took 20 s is **< 1 ms** even at 500,000 chars.

Also reviewed `HEADER_RE` and `FOOTER_RE`: both are linear (single `.+` tail,
no nested quantifiers) and remain unchanged. Confirmed sub-millisecond on 50k
adversarial inputs.

Regression test: `test/security.test.ts` — "ReDoS timing" asserts
`extractReferences` on a 100k pathological string completes well under a 1 s
budget.

---

## 3. Medium — repo slug not validated before the GitHub REST URL

**File:** `src/github.ts` — `createReleaseViaRest` (L113), URL built as
``` `https://api.github.com/repos/${repo.slug}/releases` ```.

**Impact.** `repo.slug` comes from `--repo`, the config `repository` field, or
the parsed git remote — all potentially untrusted. Without validation, a slug
like `../../foo` collapses the URL path to `/foo/releases`, and slugs containing
`?` or `#` inject a query string / fragment into the request. The host is fixed
to `api.github.com`, so this is not a full cross-host SSRF, but it lets the
request target an unintended API path. Verified with `new URL()` path collapsing.

**Fix.** Added `isValidSlug()` in `src/github.ts` enforcing
`^[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$` (GitHub owner/repo charset, exactly one
slash, no traversal/query/fragment). `createReleaseViaRest` throws a clear error
for invalid slugs before issuing the request. The same validation also guards the
`gh` path's `--repo` argument.

Regression test: `test/security.test.ts` — "rejects a path-traversal repo slug".

---

## 4. Medium — config loader executes arbitrary code (RCE); trust model undocumented

**File:** `src/config.ts` — `readConfigFile` (L56-67) dynamically `import()`s
`relnotes.config.{js,mjs,cjs,ts}`, executing whatever the file contains.

**Impact.** This is *by design* (JS configs are a documented feature) and is the
same trust model as ESLint, Vite, Jest, etc.: running a tool in a project
implies trusting that project's config. The risk is that it was **not documented**
and there was no guard preventing a JS config from being picked up implicitly
from an unexpected directory. If a user runs `relnotes` inside a freshly-cloned
untrusted repo that ships a malicious `relnotes.config.js`, code runs.

**Resolution (accepted-with-mitigation).** We keep the feature (removing it would
break documented behaviour) but:
- **Documented the trust model** prominently in `README.md` ("Security &
  the config file") and inline in `src/config.ts`: executable configs are only
  ever loaded from the project directory you run `relnotes` in; treat an
  untrusted repo's config like any other code in that repo.
- JSON configs (`relnotes.config.json`, `.relnotesrc.json`, `package.json#relnotes`)
  are parsed with `JSON.parse`, never executed — recommended for untrusted contexts.
- The loader still only searches the run directory (no upward traversal, no
  `node_modules` resolution of arbitrary packages), so behaviour is bounded to
  the current project, which is the expected blast radius.

This is intentionally **not "fixed" by disabling JS configs**; doing so would
break the documented `relnotes.config.{js,ts}` feature. The mitigation is
documentation + confirming the loader cannot be steered outside the project dir.

---

## 5. Medium — `--token` is visible in the process argument list

**File:** `src/cli.ts` — `--token <token>` option (L223) forwarded to
`createRelease`.

**Impact.** Tokens passed via `--token` appear in the OS process table (`ps`,
`/proc/<pid>/cmdline`, Windows process explorer) and may be captured by shell
history. The token is **not** logged by relnotes itself (verified: it is never
written to stdout/stderr, never embedded in `GitError`, never put in a URL —
only into `env.GH_TOKEN` for the `gh` child process or the `Authorization`
header for REST). The residual risk is purely the OS-level argv exposure.

**Fix.** Documented in `README.md` that `GITHUB_TOKEN`/`GH_TOKEN` env vars are
the preferred, safer mechanism and that `--token` exposes the value in the
process list. Added an explicit note and kept the env-var path as the documented
default. Also added a guard so that any future error surface cannot interpolate
the token (centralised token handling already avoids this).

Regression test: `test/security.test.ts` — "token is never written to
stdout/stderr" runs the release dry-run / error path with a sentinel token and
asserts the sentinel never appears in any captured output.

---

## 6. Medium — dependency CVEs (dev-only chain)

`npm audit` reports **5 moderate** advisories, all transitive under the test
runner:

- `esbuild` ≤ 0.24.2 — GHSA-67mh-4wv8-2f99 (dev server request smuggling)
- `vite` ≤ 6.4.1 — GHSA-4w7w-66w2-5vf9 (path traversal in optimized deps)
- `@vitest/mocker`, `vite-node`, `vitest` — pulled in via the above.

**Impact on shipped artifact: none.** These are `devDependencies` only; the
published package (`files: ["dist", ...]`) ships only built output and depends at
runtime on `commander` + `picocolors`, which are clean. The advisories concern a
local dev server that relnotes never runs.

**Fix.** Upgraded `vitest` to `^4` (the advisory-clean line), which pulls clean
`vite`/`esbuild`. `npm audit` is clean after the upgrade. The runtime
dependencies were left as-is (no CVEs).

---

## 7. Low — markdown / link injection from commit messages

**Files:** `src/util.ts` `escapeMarkdown` (L104-107), `src/render.ts`
(subjects, scopes, breaking notes rendered into bullets).

**Impact.** Commit subjects/scopes are attacker-controlled and rendered into
markdown. The previous `escapeMarkdown` only escaped `|`. A commit like
`feat: click [here](javascript:alert(1))` or one containing raw `](http://evil)`
could inject links/markup into the generated changelog and GitHub release notes.
GitHub sanitises `javascript:` URLs on render, so this is **Low** (cosmetic /
spoofing rather than script execution), but link/image injection and layout
breakage are still undesirable.

**Fix.** Hardened `escapeMarkdown` to also neutralise the link/markup-significant
characters that appear in inline contexts (`[`, `]`, `<`, `>`, backtick) in
addition to `|`, while keeping output readable. Section titles/emoji come from
config (trusted) and are unaffected. Reference labels are numeric/validated.

Regression test: `test/render.test.ts` — asserts a malicious subject is escaped
(no raw `](`/`<` survives into the bullet).

---

## 8. Low — git stderr echoed into error messages

**File:** `src/git.ts` `git()` (L33-34): `throw new GitError(`git ${args.join(" ")} failed: ${detail}`)`.

**Impact.** Error messages include the git argv and stderr. Refs can therefore
appear in error text — acceptable, since refs are not secrets. Crucially, the
**token never appears in argv** (it is only ever passed via `env`), so this path
cannot leak the token. No change required; documented here for completeness.
(Confirmed by finding #5's regression test.)

---

## 9. Low — robustness: unborn HEAD (empty repo) surfaced a raw git error

**File:** `src/git.ts` `getCommits`.

**Impact.** Running `relnotes` in a brand-new repository with zero commits made
`git log HEAD` fail with `fatal: ambiguous argument 'HEAD'`, surfaced verbatim to
the user — confusing and a poor first-run experience.

**Fix.** Added `hasCommits()` and a guard in `getCommits`: when `to` is the
default `HEAD` and the repo has no commits, it returns `[]` so the pipeline
produces a clean "No notable commits found" message and exits 0. The "no tags"
path already worked (falls back to a `## HEAD` heading) and is covered.

Regression tests: `test/git.test.ts` — "edge cases: empty / unborn repos".

---

## 10. Info — quality, tests, README accuracy

- **Tests added** (`test/security.test.ts`): flag-injection, ReDoS timing,
  token-not-logged, slug validation.
- **README**: added a "Security" section documenting the config-execution trust
  model and token handling guidance.
- **Lint/build/typecheck**: green before and after changes.
- `npm run lint` is `tsc --noEmit` (type-check only). There is no ESLint config;
  type-checking under `strict` + `noUncheckedIndexedAccess` provides the static
  guarantees here. Noted, not changed (adding ESLint is out of scope for a
  security pass and would be churn).

---

## Verification performed

- `npm ci`, `npm run build`, `npm run lint` (tsc), `npm test` — all green.
- `npm audit` — clean (0 vulnerabilities) after the dev upgrade.
- Smoke test in a throwaway git repo with conventional commits including a
  crafted/hostile commit message — safe grouped output, no hang, no file write.
- Empirical ReDoS before/after timing and git flag-injection PoC (see §1, §2).

## Intentionally not changed

- **JS/TS config execution** is retained (documented feature); mitigated by
  documentation + bounded loader (see §4).
- **Runtime deps** (`commander`, `picocolors`) — no advisories, left pinned as-is.
- **ESLint** not introduced — `tsc --strict` is the project's chosen linter.
