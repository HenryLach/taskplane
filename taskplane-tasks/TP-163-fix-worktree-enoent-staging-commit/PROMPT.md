# Task: TP-163 - Fix ENOENT when task folders are uncommitted at batch start (#471)

**Created:** 2026-04-11
**Size:** S

## Review Level: 2 (Plan and Code)

**Assessment:** Small change but touches the orch branch creation and worktree sequencing — core to batch correctness. Plan review is essential to confirm the chosen fix approach before touching git branch operations. Code review verifies the fix doesn't break the existing staging-commit mechanism or workspace mode.
**Score:** 4/8 — Blast radius: 1, Pattern novelty: 1, Security: 0, Reversibility: 2

## Canonical Task Folder

```
taskplane-tasks/TP-163-fix-worktree-enoent-staging-commit/
├── PROMPT.md   ← This file (immutable above --- divider)
├── STATUS.md   ← Execution state (worker updates this)
├── .reviews/   ← Reviewer output (created by the orchestrator runtime)
└── .DONE       ← Created when complete
```

## Mission

Fix issue #471: when task folders exist on disk but haven't been committed to git, the orchestrator's auto-staging commit lands on `main` AFTER the orch branch was already created. Worktrees branch from the orch branch and therefore don't see the staged task files, causing an immediate ENOENT crash when workers try to open `PROMPT.md`.

**Root cause timeline:**
```
4e5d103  [existing commits]          ← orch branch created here (from baseBranch/HEAD)
30fe05d  chore: stage task files     ← staging commit lands on main AFTER orch branch creation
          (ensureTaskFilesCommitted)
```

Worktrees are created from the orch branch at `4e5d103`, so `PROMPT.md` from `30fe05d` is invisible.

**The fix:** fast-forward the orch branch to include the staging commit before worktrees are created.

In `engine.ts`, the orch branch is created at planning time (before `executeWave` is called). The staging commit happens inside `executeWave` → `ensureTaskFilesCommitted`. The correct fix is: after `ensureTaskFilesCommitted` commits to `main`, also fast-forward the orch branch to include that commit before worktrees are allocated.

The cleanest place to do this: in `ensureTaskFilesCommitted` itself (in `execution.ts`), after the staging commit succeeds, update the orch branch ref to include the new commit. The orch branch name is available via the `orchBranch` parameter already passed to `executeWave`.

## Dependencies

- **None**

## Context to Read First

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `extensions/taskplane/engine.ts` — orch branch creation at line ~2157; `executeWave` call sites
- `extensions/taskplane/execution.ts` — `ensureTaskFilesCommitted` function (~line 1410), `executeWave` signature (~line 1547)
- `extensions/taskplane/worktree.ts` — to confirm worktrees are allocated AFTER `ensureTaskFilesCommitted`

## Environment

- **Workspace:** `extensions/taskplane/`
- **Services required:** None (git operations only)

## File Scope

- `extensions/taskplane/execution.ts` — update `ensureTaskFilesCommitted` and `executeWave`

## Steps

### Step 0: Preflight

- [ ] Read `ensureTaskFilesCommitted` in `execution.ts` — understand the full staging commit flow
- [ ] Read `executeWave` — confirm `ensureTaskFilesCommitted` runs BEFORE lane allocation/worktree creation
- [ ] Read orch branch creation in `engine.ts` — confirm it runs before `executeWave` is called
- [ ] Read `executeWave` signature — identify where `orchBranch` (the orch branch name) is available (it's passed as `baseBranch` parameter)
- [ ] Verify test baseline: `cd extensions && npm run test:fast`

### Step 1: Fast-forward orch branch after staging commit

In `ensureTaskFilesCommitted` (execution.ts), after the successful `git commit`, add a fast-forward of the orch branch to include the new staging commit:

```typescript
// Fast-forward the orch branch to include the staging commit so that
// worktrees (which branch from orchBranch) see the new task files.
// Uses update-ref to move the branch pointer without switching branches.
if (orchBranch) {
    const headSha = runGit(["rev-parse", "HEAD"], repoRoot);
    if (headSha.ok && headSha.stdout.trim()) {
        runGit(["update-ref", `refs/heads/${orchBranch}`, headSha.stdout.trim()], repoRoot);
    }
}
```

To make `orchBranch` available in `ensureTaskFilesCommitted`, add it as an optional parameter to that function. Then pass it through from `executeWave`, which already receives `baseBranch` (the orch branch name — verify this is the orch branch, not the user's working branch).

**Important:** Double-check what `baseBranch` is in `executeWave`. Looking at the call site in `engine.ts`:
```typescript
await executeWave(..., batchState.orchBranch, ...)
```
The `baseBranch`/`orchBranch` parameter passed to `executeWave` IS the orch branch. Confirm this before implementing.

- [ ] Add optional `orchBranch?: string` parameter to `ensureTaskFilesCommitted`
- [ ] After successful staging commit, fast-forward orch branch via `git update-ref`
- [ ] Wrap in try/catch — failure to fast-forward is logged but non-fatal (the commit still happened; the worktree creation that follows will fail with a clear error rather than crashing silently)
- [ ] Pass `orchBranch` through from `executeWave` to `ensureTaskFilesCommitted`
- [ ] Verify this works for workspace mode (multiple repos): in workspace mode, the staging commit happens in `repoRoot`. The orch branch also exists in `repoRoot`. The update-ref should be scoped to the same repo.

### Step 2: Testing & Verification

- [ ] Run full test suite: `cd extensions && node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test tests/*.test.ts`
- [ ] Run CLI smoke: `node bin/taskplane.mjs help && node bin/taskplane.mjs init --preset full --dry-run --force`
- [ ] Fix all failures

### Step 3: Documentation & Delivery

- [ ] Add a comment explaining why the fast-forward is needed (the ENOENT issue)
- [ ] Discoveries logged in STATUS.md

## Documentation Requirements

**Must Update:**
- Inline comment in `ensureTaskFilesCommitted` explaining the orch branch fast-forward

**Check If Affected:**
- None

## Completion Criteria

- [ ] All steps complete
- [ ] `ensureTaskFilesCommitted` fast-forwards the orch branch after staging
- [ ] Workspace mode handled correctly
- [ ] No regression when task files are already committed (fast-forward is a no-op)
- [ ] Full test suite passes

## Git Commit Convention

- **Step completion:** `fix(TP-163): complete Step N — description`
- **Hydration:** `hydrate: TP-163 expand Step N checkboxes`

## Do NOT

- Move orch branch creation to after `executeWave` — too disruptive and breaks resume/state
- Change the existing `ensureTaskFilesCommitted` staging behavior
- Hard-fail if the fast-forward fails — log and continue
- Commit without the task ID prefix

---

## Amendments (Added During Execution)
