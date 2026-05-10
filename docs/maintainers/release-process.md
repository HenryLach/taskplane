# Release Process

This guide covers how to publish a new Taskplane npm release.

**TL;DR:** Pushing a `v*` tag triggers `.github/workflows/release.yml`, which
publishes to npm via Trusted Publishing (OIDC, no `NPM_TOKEN` needed) and
creates the GitHub release with notes from `CHANGELOG.md`. You don't run
`npm publish` or `gh release create` manually.

## GitHub Releases vs npm Publish

These are related, but not the same operation:

- **`npm publish`** uploads installable package artifacts to npm (`npm install taskplane`).
- **GitHub Release** is a repository release record tied to a git tag (`vX.Y.Z`) with notes/assets.

Best practice for Taskplane is to keep them aligned:

- one package version in `package.json`
- one git tag (`vX.Y.Z`)
- one npm publish (`taskplane@X.Y.Z`)
- one GitHub Release (`vX.Y.Z`)

The release workflow enforces this alignment automatically.

## How automation works

`.github/workflows/release.yml` is triggered by tag pushes (`push` event with
ref `refs/tags/v*`). It also supports `workflow_dispatch` for manual re-runs
on an existing tag.

The workflow:

1. Checks out the tagged commit
2. Validates the tag name matches `package.json#version` (no drift allowed)
3. Re-runs the test suite as belt-and-suspenders (PR CI already validated `main`,
   but the tag could in principle point at a different commit)
4. Publishes to npm with `--provenance` attestation via OIDC
5. Creates the GitHub release with notes extracted from the matching version
   section of `CHANGELOG.md`

**Authentication:** [npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers)
is configured for this package. The workflow uses GitHub's OIDC token to
authenticate to npm; no `NPM_TOKEN` secret is stored in the repository.
The trusted publisher is configured at:
<https://www.npmjs.com/package/taskplane/access>.

## Prerequisites

- Permission to push tags and merge PRs on the repository
- `gh` CLI authenticated (`gh auth status`)
- Node.js 22+ locally (workflow runs Node 24)
- Clean git working tree

You do **not** need npm publish credentials locally. The workflow handles publish.

---

## Default release sequence

The workflow assumes `main` is already in the state you want to release. Don't
include feature work in the release PR — merge content PRs first, then cut a
thin release PR that only bumps the version and updates the changelog.

### 1) Sync main and verify pre-release state

```bash
git switch main && git pull --ff-only
git status -sb                                    # working tree clean
```

Confirm:

- All bug-fix / feature PRs that should ship are already in `main`.
- No commits on `main` since the last `[Unreleased]` write that lack a
  changelog entry. (Easy to miss when hotfixes land between major batches.)

### 2) Validate package contents and run pre-release checks

From repo root:

```bash
npm pack --dry-run
```

Confirm only intended files ship (per `package.json#files`).

Run the test suite:

```bash
cd extensions
npm run test:fast
cd ..
```

Record the passing test count — useful for the release PR body.

CLI smoke:

```bash
node bin/taskplane.mjs help
node bin/taskplane.mjs doctor
```

### 3) Create the release branch and update CHANGELOG

```bash
git switch -c release/v<version>
```

Edit `CHANGELOG.md`:

- Rename the existing `## [Unreleased]` section to `## [<version>] - <YYYY-MM-DD>`
- Insert a fresh empty `## [Unreleased]` placeholder above it
- Add `Fixed` entries for any hotfixes that landed on `main` after the last
  `[Unreleased]` write but before the version bump
- Use Keep a Changelog style sections in this order: Breaking, New, Enhanced,
  Fixed, Docs, Internal (only sections that have entries)

The release workflow extracts notes from this section verbatim — write it
operator-readable, not as raw commit titles.

### 4) Bump version and create the local tag

```bash
npm version patch    # or minor / major
```

This:

- Updates `package.json` and `package-lock.json`
- Creates a git commit titled `<version>` (e.g., `0.29.0`)
- Creates a local git tag `v<version>` pointing at that commit

**Don't push the tag yet.** The tag has to wait until the release PR is merged
into `main` so it points at a commit reachable from `main`.

### 5) Push the release branch and open the release PR

```bash
git push -u origin release/v<version>
```

```bash
gh pr create --base main \
             --head release/v<version> \
             --title "release: v<version> — <summary>" \
             --body-file <release-body.md>
```

The PR body should:

- Justify the version bump (patch / minor / major) per semver
- List issues closed in this release
- Summarize highlights (features, fixes, internal changes)
- Note validation results (tests, smoke, polyrepo if applicable)
- Reference the tag-push step that follows the merge

### 6) Wait for CI green, then merge the release PR

Monitor:

```bash
gh pr view <num> --json statusCheckRollup
```

Once green, merge **with `--merge` (NOT `--squash` or `--rebase`)**:

```bash
gh pr merge <num> --merge --delete-branch
```

Why `--merge` matters: the local tag created in step 4 points at the
version-bump commit's SHA. `--squash` and `--rebase` rewrite that commit's
SHA, which would orphan the tag. `--merge` preserves the original commit
under a merge commit on `main`, so the tag still resolves correctly.

### 7) Sync local main, then push the tag

```bash
git switch main && git pull --ff-only
git push origin v<version>
```

This tag push is what triggers the release workflow. Monitor with:

```bash
gh run list --workflow=release.yml --limit 1 --json databaseId,status
gh run view <run-id> --log         # if you want full logs
```

The workflow typically completes in 30–60 seconds.

### 8) Verify

```bash
npm view taskplane version
```

Allow ~10–15 seconds for the npm registry to propagate. If it returns the
old version or empty, retry.

```bash
gh release view v<version>
```

Should show the GitHub release with notes from `CHANGELOG.md`.

Optional sanity install in scratch project:

```bash
pi install -l npm:taskplane
npx taskplane --version
```

---

## What NOT to do

- **Do not** run `npm publish` locally. The workflow does it. Local publish
  bypasses tag↔version validation, the test re-run, and provenance
  attestation. It also can't use OIDC.
- **Do not** create the GitHub release manually with `gh release create`. The
  workflow does it with notes from `CHANGELOG.md`. A manual release would
  either conflict with or duplicate the workflow's release.
- **Do not** push the tag before the release PR is merged into `main`. The
  tag must point at a commit that's reachable from `main` — otherwise the
  release references an orphan commit.
- **Do not** use `--squash` or `--rebase` to merge the release PR. They
  rewrite the version-bump commit's SHA, orphaning your local tag.

---

## If the workflow fails

Inspect:

```bash
gh run view <run-id> --log-failed
```

Common causes and fixes:

| Cause | Fix |
|---|---|
| Tag/version drift (tag is `v0.29.0`, but `package.json` says `0.28.8`) | Delete the tag, re-bump correctly: `git tag -d v<version>; git push --delete origin v<version>; npm version <bump>; git push --follow-tags` |
| Test failure on the re-run | Investigate the failure. CI on the PR was green, so the failure is either flaky-test or environment-difference. Re-trigger via Actions UI `workflow_dispatch` with the same tag input. |
| npm registry hiccup (timeout, transient 5xx) | Re-trigger via Actions UI `workflow_dispatch`. The workflow is idempotent on retry — npm rejects republish of an existing version, but the GitHub release step uses `gh release create --notes-file ...` which is safe to re-run (it errors if the release already exists; manual fix is to delete the existing release first). |
| OIDC token rejected by npm | Check the trusted-publisher config at <https://www.npmjs.com/package/taskplane/access>. The repo / workflow filename must match exactly (`HenryLach/taskplane` and `release.yml`). |

---

## Pre-release tags (beta / rc)

The workflow doesn't currently special-case `--tag beta` or rc/alpha versions.
For now, pre-release publishing is manual:

```bash
npm version prerelease --preid=beta    # e.g., 0.30.0-beta.0
npm publish --tag beta
```

If pre-releases become regular, extend `release.yml` to read a dist-tag from
the version string (e.g., publish under `--tag beta` if the version contains
a `-` qualifier).

---

## Pre-release checklist

- [ ] `main` is clean and synced
- [ ] All content PRs that should ship are merged
- [ ] Tests pass: `cd extensions && npm run test:fast`
- [ ] CLI smoke: `node bin/taskplane.mjs help` and `node bin/taskplane.mjs doctor`
- [ ] `npm pack --dry-run` reviewed (only intended files ship)
- [ ] Hotfix scan: any commits on `main` since last `[Unreleased]` write that need entries?

## Post-release checklist

- [ ] `npm view taskplane version` reports the new version
- [ ] `gh release view v<version>` shows the GitHub release with proper notes
- [ ] Workflow run completed successfully (`gh run list --workflow=release.yml --limit 1`)
- [ ] Optional install smoke test passed

---

## Notes

- Taskplane currently ships as a single package.
- `package.json#files` controls the published file whitelist.
- Keep templates generic and public-safe before publishing.
- Trusted Publishing was set up in PRs #536 / #544 / #545 (the v0.28.5 release
  cycle). Before that, releases used a manual `npm publish` against an `NPM_TOKEN`
  secret. The workflow has been used continuously since v0.28.5 with no failures.
