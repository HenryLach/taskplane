# Task: TP-023 - `/orch-integrate` Command

**Created:** 2026-03-18
**Size:** M

## Review Level: 2 (Plan and Code)

**Assessment:** New command with git operations and branch safety checks. Medium blast radius, touches extension.ts.
**Score:** 4/8 — Blast radius: 1, Pattern novelty: 1, Security: 1, Reversibility: 1

## Canonical Task Folder

```
taskplane-tasks/TP-023-orch-integrate-command/
├── PROMPT.md   ← This file (immutable above --- divider)
├── STATUS.md   ← Execution state (worker updates this)
├── .reviews/   ← Reviewer output (task-runner creates this)
└── .DONE       ← Created when complete
```

## Mission

Implement the `/orch-integrate` command that lets users apply completed batch work from the orchestrator-managed branch into their working branch. This is the final step of the managed branch workflow — the user reviews the orch branch and integrates when ready.

Three modes: fast-forward (default), real merge (`--merge`), and PR (`--pr`). A branch safety check prevents accidentally merging into the wrong branch.

## Dependencies

- **Task:** TP-022 (orch branch must be created and used by the engine)

## Context to Read First

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `.pi/local/docs/orch-managed-branch-spec.md` — spec section 4 (integration command)
- `extensions/taskplane/extension.ts` — existing command registrations (pattern to follow)
- `extensions/taskplane/persistence.ts` — `loadBatchState()` / batch state loading
- `extensions/taskplane/types.ts` — `OrchBatchRuntimeState`, `PersistedBatchState` (for orchBranch, baseBranch, phase)
- `extensions/taskplane/git.ts` — `runGit()`, `getCurrentBranch()`

## Environment

- **Workspace:** `extensions/taskplane/`
- **Services required:** None


## Execution Target

- **Repo:** taskplane
- **Submodule path:** `.pi/git/github.com/loopyd/taskplane`
- **Upstream URL:** `https://github.com/loopyd/taskplane.git`

> This task operates within the `taskplane` submodule. All file paths, git operations, and worktrees are scoped to this submodule's repository root.

## File Scope

- `extensions/taskplane/extension.ts`
- `extensions/taskplane/git.ts` (if helper functions needed)
- `extensions/taskplane/persistence.ts` (if loading batch state needs changes)
- `extensions/tests/extension*.test.ts`

## Steps

### Step 0: Preflight

- [ ] Read `extension.ts` — understand command registration pattern (args parsing, config loading, output formatting). Study existing commands like `/orch-status` and `/orch-resume` as templates.
- [ ] Read `persistence.ts` — understand how to load persisted batch state to get `orchBranch`, `baseBranch`, `phase`
- [ ] Read `git.ts` — understand `runGit()` and `getCurrentBranch()`
- [ ] Verify TP-022 changes: `orchBranch` is set in batch state and persisted

### Step 1: Register `/orch-integrate` Command

Register the command in the extension setup function:

- [ ] Add `pi.registerCommand("orch-integrate", { ... })` following existing patterns
- [ ] Parse arguments: `--merge`, `--pr`, `--force` (use simple string matching — existing commands use this pattern)
- [ ] Command description: `"Integrate completed orch batch into your working branch"`

**Artifacts:**
- `extensions/taskplane/extension.ts` (modified)

### Step 2: Implement Integration Logic

Core integration flow:

- [ ] Load persisted batch state from `.pi/batch-state.json`
- [ ] Validate: batch state exists (if not: "No completed batch found. Run /orch first.")
- [ ] Validate: `phase === "completed"` (if not: show current phase and suggest waiting or using `/orch-status`)
- [ ] Validate: `orchBranch` is non-empty (if empty: "Batch used legacy merge mode — work already merged into {baseBranch}.")
- [ ] Get current branch via `getCurrentBranch(cwd)`
- [ ] **Branch safety check:** If current branch !== `baseBranch` and no `--force`:
  - Show warning: `"⚠ Batch was started from {baseBranch}, but you're on {currentBranch}.\n  Switch to {baseBranch} first, or use /orch-integrate --force"`
  - Return without action
- [ ] Show pre-integration summary: orch branch name, number of commits ahead, files changed

**Artifacts:**
- `extensions/taskplane/extension.ts` (modified)

### Step 3: Implement Integration Modes

Three modes, defaulting to fast-forward:

- [ ] **Default (fast-forward):** `git merge --ff-only {orchBranch}`. If fails (diverged), show error and suggest `--merge` or `--pr`.
- [ ] **`--merge`:** `git merge {orchBranch} --no-edit`. Creates a real merge commit. Show result.
- [ ] **`--pr`:** `git push origin {orchBranch}`, then `gh pr create --base {currentBranch} --head {orchBranch} --title "Integrate orch batch {batchId}" --fill`. Show PR URL.
- [ ] On success (ff or merge): delete the orch branch (`git branch -D {orchBranch}`), clean up batch state file
- [ ] On success: show summary — "✅ Integrated {orchBranch} into {currentBranch}. N commits applied."

**Artifacts:**
- `extensions/taskplane/extension.ts` (modified)

### Step 4: Testing & Verification

> ZERO test failures allowed.

- [ ] Run unit tests: `cd extensions && npx vitest run`
- [ ] Verify command registration and argument parsing
- [ ] Verify branch safety check (same branch, different branch, --force)
- [ ] Verify error messages for missing state, wrong phase, empty orchBranch
- [ ] Fix all failures

### Step 5: Documentation & Delivery

- [ ] Discoveries logged in STATUS.md
- [ ] `.DONE` created in this folder

## Documentation Requirements

**Must Update:**
- None (docs task TP-024 handles user-facing docs)

**Check If Affected:**
- `docs/reference/commands.md` — will need `/orch-integrate` entry (handled by TP-024)

## Completion Criteria

- [ ] `/orch-integrate` registered and functional
- [ ] Fast-forward, merge, and PR modes work
- [ ] Branch safety check prevents wrong-branch integration
- [ ] `--force` bypasses safety check
- [ ] Cleanup after successful integration (orch branch deleted, state cleaned)
- [ ] Clear error messages for all failure cases
- [ ] All tests passing

## Git Commit Convention

- **Step completion:** `feat(TP-023): complete Step N — description`
- **Bug fixes:** `fix(TP-023): description`
- **Tests:** `test(TP-023): description`
- **Hydration:** `hydrate: TP-023 expand Step N checkboxes`

## Do NOT

- Modify the batch engine or merge flow — that's TP-022
- Change schema/types — that's TP-020
- Change worktree paths — that's TP-021
- Implement complex git operations beyond ff/merge/push — keep it simple
- Skip tests

---

## Amendments (Added During Execution)
