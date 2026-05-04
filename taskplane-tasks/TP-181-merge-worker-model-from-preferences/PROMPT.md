# Task: TP-181 - Validate and merge PR #522 (worker model from preferences)

**Created:** 2026-05-03
**Size:** S

## Review Level: 2 (Plan and Code)

**Assessment:** External contribution that touches the critical execution-path for spawning workers. The change mirrors an existing well-understood pattern (reviewer model wiring from TP-160) so pattern novelty is low, but blast radius covers every batch run and silent regressions would be hard to spot. Plan + code review needed before merge.
**Score:** 4/8 — Blast radius: 2, Pattern novelty: 1, Security: 0, Reversibility: 1

## Canonical Task Folder

```
taskplane-tasks/TP-181-merge-worker-model-from-preferences/
├── PROMPT.md   ← This file (immutable above --- divider)
├── STATUS.md   ← Execution state (worker updates this)
├── .reviews/   ← Reviewer output (created by the orchestrator runtime)
└── .DONE       ← Created when complete
```

## Mission

Apply external PR [#522](https://github.com/HenryLach/taskplane/pull/522) by `@NerfEko`, which wires `taskRunner.worker.{model,thinking,tools}` from `preferences.json` through to the lane runner so it actually takes effect.

The PR fixes a real bug: `LaneRunnerConfig.workerModel` is currently hardcoded to `""`, so `taskRunner.worker.model` in user preferences is ignored. The fix mirrors the existing reviewer pipeline (TP-160) — adds `buildWorkerEnv()` next to `buildReviewerEnv()`, threads through `executeWave` → `executeLaneV2` → worker subprocess via `TASKPLANE_WORKER_MODEL` / `TASKPLANE_WORKER_THINKING` / `TASKPLANE_WORKER_TOOLS` env vars.

The contribution is high-quality (mirrors existing patterns, adds a regression test, has a Copilot reviewer pass), but it must be validated against this repo's standards before merge. Specifically:

1. The PR's tests and code comments tag the change as `@since TP-183`. The author guessed at a task ID; since this work is being tracked as TP-181, those `@since` annotations must be rewritten to `@since TP-181` before merge.
2. The full test suite must pass on Windows + Node 24 (the development environment in use).
3. The PR's history is mildly suspicious — #521 was closed silently and resubmitted as #522 with no comment. Diff should be inspected to confirm no untracked surprises crept in across the two PRs.

## Dependencies

- **None**

## Context to Read First

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `taskplane-tasks/TP-160-reviewer-model-not-passed-to-subprocess/PROMPT.md` — sibling pattern this PR mirrors. Read first to understand what "good" looks like for this kind of change.
- `extensions/taskplane/execution.ts` — `buildReviewerEnv` (~line 2510-2530), `executeWave` signature (~line 1755), `executeLaneV2` (~line 2630-2660). The PR adds `buildWorkerEnv` next to `buildReviewerEnv` and a `workerConfig` param next to `reviewerConfig`.
- `extensions/taskplane/types.ts` — `TaskRunnerConfig` interface (~line 310-345). The PR adds a `worker?: { model, thinking, tools, excludeExtensions }` block next to the existing `reviewer` block.

## Environment

- **Workspace:** `extensions/taskplane/` + `extensions/tests/`
- **Services required:** None
- **Network required:** Yes — fetching the PR branch from GitHub

## File Scope

Files modified by PR #522 (do not introduce changes outside this scope):

- `extensions/taskplane/types.ts` — adds `TaskRunnerConfig.worker` block
- `extensions/taskplane/config-loader.ts` — adds `worker` to `toTaskRunnerConfig()`
- `extensions/taskplane/execution.ts` — adds `buildWorkerEnv()`, adds `workerConfig` param to `executeWave`, reads worker env vars in `executeLaneV2`
- `extensions/taskplane/engine.ts` — passes `worker` config in `executeWave` calls and the worker-crash-retry path
- `extensions/taskplane/resume.ts` — passes `runnerConfig.worker` into `executeWave` on resume
- `extensions/tests/worker-model.test.ts` — new test file for `buildWorkerEnv`

## Steps

> **Hydration:** STATUS.md tracks outcomes, not individual code changes. Workers
> expand steps when runtime discoveries warrant it. See task-worker agent for rules.

### Step 0: Preflight

- [ ] On `main`, working tree clean. `git status` shows no uncommitted changes (other than the existing local-only TP-114 commits already known to be ahead of origin)
- [ ] Confirm gh CLI is authenticated as `HenryLach`: `gh auth status`
- [ ] Confirm Node 24 is active: `node -v`
- [ ] Baseline test pass: `cd extensions && npm run test:fast` — record the pass count before applying PR

### Step 1: Fetch and review PR #522 diff

- [ ] Fetch the PR locally: `gh pr checkout 522` (creates local branch `fix/worker-model-from-preferences`)
- [ ] Inspect the diff with `git diff main...HEAD` and verify the changed-files list matches the expected six files in **File Scope** above (no surprise edits)
- [ ] Read each modified file's diff and confirm:
   - `buildWorkerEnv()` mirrors `buildReviewerEnv()` exactly in shape (same null/undefined handling, same env-var emission rules, same omit-when-empty semantics)
   - `executeWave` adds `workerConfig` as a new optional param positioned after `reviewerConfig`, and threads it through to `executeLaneV2` via `extraEnvVars`
   - `executeLaneV2` reads `TASKPLANE_WORKER_MODEL` / `_THINKING` / `_TOOLS` from `extraEnvVars` and writes them to the lane runner config (replacing the hardcoded `""`)
   - All `executeWave` call sites in `engine.ts` and `resume.ts` pass the worker config
   - The worker-crash-retry path in `engine.ts` (`attemptWorkerCrashRetry`) also threads worker env via `buildWorkerEnv(runnerConfig?.worker)`
- [ ] Read the new `extensions/tests/worker-model.test.ts` file. Verify the assertions are tight (every field separately, empty-string omission, exclude-extensions ownership boundary)

**Artifacts:**
- (read-only review — no file changes yet)

### Step 2: Run the regression test and full suite against the PR branch

- [ ] Run the new test in isolation first: `cd extensions && node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test tests/worker-model.test.ts` — must show all assertions passing
- [ ] Run the fast suite: `cd extensions && npm run test:fast` — pass count must be ≥ baseline from Step 0 (10 new tests from `worker-model.test.ts` should appear)
- [ ] CLI smoke: `node bin/taskplane.mjs help && node bin/taskplane.mjs doctor` — both succeed cleanly

**Artifacts:**
- (read-only verification — no file changes)

### Step 3: Rewrite `@since TP-183` annotations to `@since TP-181`

The PR author tagged their additions with `@since TP-183` (a guessed task ID). Since this work is tracked as TP-181, those tags must be corrected for traceability.

- [ ] In `extensions/taskplane/types.ts`: change `@since TP-183` (in the new `worker?:` block JSDoc) to `@since TP-181`
- [ ] In `extensions/taskplane/execution.ts`: change `@since TP-183` (in the `buildWorkerEnv` JSDoc) to `@since TP-181`
- [ ] In `extensions/tests/worker-model.test.ts`: change the `TP-183` reference in the file header comment to `TP-181`
- [ ] Re-run the fast suite to confirm no regressions: `cd extensions && npm run test:fast`
- [ ] Commit the corrections to the PR branch with: `fix(TP-181): retag worker-model wiring annotations from TP-183 to TP-181`

**Artifacts:**
- `extensions/taskplane/types.ts` (modified)
- `extensions/taskplane/execution.ts` (modified)
- `extensions/tests/worker-model.test.ts` (modified)

### Step 4: Testing & Verification

> ZERO test failures allowed. Full quality gate before merge.

- [ ] Run FULL test suite: `cd extensions && node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test tests/*.test.ts tests/*.integration.test.ts`
- [ ] Confirm all tests pass including the new `worker-model.test.ts`
- [ ] CLI smoke (one more time, post-fix): `node bin/taskplane.mjs help && node bin/taskplane.mjs doctor`
- [ ] Verify the branch is still mergeable against `main`: `gh pr view 522 --json mergeable --jq '.mergeable'` should report `MERGEABLE`

### Step 5: Documentation & Delivery

- [ ] Update `CHANGELOG.md` — add an entry under **Unreleased** in the **Fixed** section: "Worker model/thinking/tools from `taskRunner.worker.*` preferences now flow through to spawned workers (previously silently ignored). Mirrors the reviewer pipeline. Thanks to @NerfEko (#522)."
- [ ] Push the corrected branch back to the PR: `git push` (the PR will pick up the commit since the contributor enabled "allow edits from maintainers" by default; if not, this step becomes a hand-off note for the user)
- [ ] Merge the PR via the user's preferred policy. Default per AGENTS.md: `gh pr merge 522 --merge --delete-branch` (creates a merge commit, deletes the head branch)
- [ ] Verify on GitHub: `gh pr view 522 --json state,mergeCommit --jq '{state, mergeCommit: .mergeCommit.oid[:8]}'` should show `MERGED`
- [ ] Sync local `main`: `git switch main && git pull --ff-only`
- [ ] Discoveries logged in STATUS.md

## Documentation Requirements

**Must Update:**
- `CHANGELOG.md` — Unreleased / Fixed entry as described in Step 5

**Check If Affected:**
- `docs/reference/configuration/taskplane-settings.md` — if it documents the worker model field as already-working, no change needed; if it disclaims the field as not-yet-wired, update it to reflect that it now works
- `extensions/taskplane/types.ts` JSDoc on `TaskRunnerConfig.worker` — already added by the PR; just verify the `@since` line was retagged in Step 3

## Completion Criteria

- [ ] PR #522 merged into `main`
- [ ] All `@since TP-183` annotations rewritten to `@since TP-181` before merge
- [ ] Full test suite passing on `main` after merge
- [ ] `CHANGELOG.md` updated with attribution to @NerfEko
- [ ] Local `main` fast-forwarded to match origin

## Git Commit Convention

Commits happen at **step boundaries** (not after every checkbox). All commits MUST include the task ID:

- **Step completion:** `chore(TP-181): complete Step N — description`
- **The retag fixup commit (Step 3):** `fix(TP-181): retag worker-model wiring annotations from TP-183 to TP-181`
- **CHANGELOG entry:** `docs(TP-181): add changelog entry for #522 worker model wiring`

## Do NOT

- Modify the PR's logic or expand its scope. The only acceptable code edits in this task are the `@since` retag in Step 3.
- Push directly to `main` — always go through the PR merge.
- Skip the regression-test-against-baseline check. The PR's value depends on not breaking anything else.
- Resolve linked issue #519 — that's tracked separately by PR #520 (Nix CLI fix).

---

## Amendments (Added During Execution)

<!-- Workers add amendments here if issues discovered during execution. -->
