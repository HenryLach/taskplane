# Task: TP-182 - Merge dependabot PR #526 (yaml 2.8.3 → 2.8.4)

**Created:** 2026-05-03
**Size:** S

## Review Level: 0 (None)

**Assessment:** Patch-version bump of a single dependency (`yaml`) in a sub-package lockfile. Two files (`extensions/package.json` + `extensions/package-lock.json`), +5/-5. No behavior change in the bumped library that affects taskplane's usage. The most important guardrail is that the test suite still passes — the bump is the test.
**Score:** 1/8 — Blast radius: 0, Pattern novelty: 0, Security: 0, Reversibility: 1

## Canonical Task Folder

```
taskplane-tasks/TP-182-bump-yaml-2.8.4/
├── PROMPT.md   ← This file (immutable above --- divider)
├── STATUS.md   ← Execution state (worker updates this)
├── .reviews/   ← Reviewer output (created by the orchestrator runtime)
└── .DONE       ← Created when complete
```

## Mission

Apply external PR [#526](https://github.com/HenryLach/taskplane/pull/526) by `dependabot[bot]` — a patch bump of the `yaml` dependency from 2.8.3 to 2.8.4 in `extensions/package.json`.

The 2.8.4 release notes:
- Disable alias resolution with `maxAliasCount:0` ([#677](https://github.com/eemeli/yaml/issues/677))
- Handle invalid unicode escapes
- Apply `minFractionDigits` only to decimal strings ([#676](https://github.com/eemeli/yaml/issues/676))

None of these touch surface area we depend on. The merge is a routine lockfile update — the only acceptance criterion is that the full test suite continues to pass.

## Dependencies

- **None**

## Context to Read First

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- (none — this is a lockfile-only update)

## Environment

- **Workspace:** `extensions/`
- **Services required:** None
- **Network required:** Yes — fetching the PR + npm registry

## File Scope

- `extensions/package.json` — single dependency version bump
- `extensions/package-lock.json` — lockfile update

## Steps

> **Hydration:** STATUS.md tracks outcomes, not individual code changes.

### Step 0: Preflight

- [ ] On `main`, working tree clean (excluding known unpushed TP-114 commits)
- [ ] `gh auth status` confirms HenryLach
- [ ] Confirm Node 24 active: `node -v`

### Step 1: Fetch and validate the PR

- [ ] `gh pr checkout 526` — pulls the dependabot branch locally
- [ ] Confirm exactly two files changed and they are `extensions/package.json` + `extensions/package-lock.json`: `git diff main...HEAD --stat`
- [ ] Confirm the version bump is from `2.8.3` to `2.8.4` and nothing else changed in `package.json`: `git diff main...HEAD -- extensions/package.json`
- [ ] Sanity check the lockfile diff is bounded (only `yaml` and its transitive children, if any): `git diff main...HEAD -- extensions/package-lock.json | head -80`

### Step 2: Install and test against the bumped lockfile

- [ ] Reinstall against the new lockfile to ensure node_modules is in sync: `cd extensions && npm ci`
- [ ] Run fast suite: `cd extensions && npm run test:fast`
- [ ] Run full suite (incl. integration): `cd extensions && node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test tests/*.test.ts tests/*.integration.test.ts`
- [ ] CLI smoke: `node bin/taskplane.mjs help && node bin/taskplane.mjs doctor`

### Step 3: Testing & Verification

> ZERO test failures allowed. The test suite IS the merge gate for this task.

- [ ] All tests passing on the PR branch
- [ ] CLI smoke clean
- [ ] PR #526 reports `MERGEABLE`: `gh pr view 526 --json mergeable --jq .mergeable`

### Step 4: Documentation & Delivery

- [ ] Merge PR #526: `gh pr merge 526 --merge --delete-branch`
- [ ] Verify merged: `gh pr view 526 --json state --jq .state` reports `MERGED`
- [ ] Sync local `main`: `git switch main && git pull --ff-only`
- [ ] Discoveries logged in STATUS.md

## Documentation Requirements

**Must Update:**
- (none — patch dependency bumps don't need a CHANGELOG entry per project convention)

**Check If Affected:**
- (none)

## Completion Criteria

- [ ] PR #526 merged into `main`
- [ ] Full test suite passing on `main` after merge
- [ ] Local `main` fast-forwarded

## Git Commit Convention

This task makes no project commits — the merge commit comes from `gh pr merge`. The dependabot PR's own commit message is preserved.

If any unexpected fix-up commit is needed (e.g., to address a test failure surfaced by the bump):

- **Step completion:** `chore(TP-182): complete Step N — description`

## Do NOT

- Bump any other dependency in the same task — keep the PR scope intact
- Skip the full test suite — that's the only thing standing between this and a silent regression
- Modify `package.json` outside the version field
- Push directly to `main`

---

## Amendments (Added During Execution)

<!-- Workers add amendments here if issues discovered during execution. -->
