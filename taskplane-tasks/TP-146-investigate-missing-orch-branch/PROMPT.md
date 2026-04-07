# Task: TP-146 - Investigate Missing Orch Branch in Workspace Mode

**Created:** 2026-04-07
**Size:** S

## Review Level: 1 (Plan Only)

**Assessment:** Investigation task — read code paths, trace branch creation, determine root cause. No code changes expected until root cause is found.
**Score:** 2/8 — Blast radius: 1, Pattern novelty: 1, Security: 0, Reversibility: 0

## Canonical Task Folder

```
taskplane-tasks/TP-146-investigate-missing-orch-branch/
├── PROMPT.md
├── STATUS.md
├── .reviews/
└── .DONE
```

## Mission

During polyrepo e2e testing (batch 20260406T205618), the api-service repo had all task commits on the `develop` branch with no separate orch branch. The shared-libs and web-client repos correctly had orch branches (`orch/henrylach-20260406T205618`). (#458)

The orch branch model requires ALL repos to have isolated orch branches during batch execution. Direct commits to develop violate the isolation model and could cause merge conflicts or lost work if the operator makes concurrent changes.

### Investigation goals

1. **Determine why** api-service didn't get an orch branch. Possible causes:
   - Branch creation failed silently for api-service
   - api-service worktrees were provisioned on develop instead of an orch branch
   - The orch branch was created but later merged/deleted during wave processing
   - api-service tasks (TP-002, TP-005 api segment, TP-006 api segment) had different branch handling

2. **Trace the branch creation path** for workspace mode — where and when does each repo get its orch branch?

3. **Document findings** in STATUS.md with specific code paths, commit evidence, and recommended fix.

## Dependencies

- None

## Context to Read First

**Tier 2:**
- `taskplane-tasks/CONTEXT.md`

**Tier 3:**
- `extensions/taskplane/engine.ts` — orch branch creation per repo
- `extensions/taskplane/worktree.ts` — worktree provisioning, branch creation
- `extensions/taskplane/waves.ts` — per-repo lane allocation
- `extensions/taskplane/merge.ts` — per-repo merge flow

## File Scope

- `extensions/taskplane/engine.ts` (read only)
- `extensions/taskplane/worktree.ts` (read only)
- `extensions/taskplane/waves.ts` (read only)
- `extensions/taskplane/merge.ts` (read only)

## Steps

### Step 0: Preflight
- [ ] Read PROMPT.md and STATUS.md
- [ ] Read engine.ts orch branch creation for workspace mode
- [ ] Read worktree.ts branch/worktree provisioning
- [ ] Read waves.ts per-repo lane allocation

### Step 1: Trace orch branch creation
- [ ] Identify where orch branches are created per-repo in workspace mode
- [ ] Determine if api-service meets the conditions for orch branch creation
- [ ] Check if branch creation is conditional on task presence (api-service may have been skipped in wave 1)
- [ ] Check if worktree provisioning uses the orch branch or falls back to develop

### Step 2: Analyze batch evidence
- [ ] Check the test workspace git history for clues (api-service branch reflog if available)
- [ ] Compare branch state between api-service, shared-libs, and web-client
- [ ] Determine which wave first touched api-service and what branch was used

### Step 3: Document findings
- [ ] Write root cause analysis in STATUS.md Discoveries table
- [ ] Recommend specific fix (with code path and approach)
- [ ] If fix is straightforward, implement it; otherwise recommend a follow-up task

### Step 4: Testing & Verification
- [ ] Run FULL test suite: `cd extensions && node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test tests/*.test.ts`
- [ ] Fix all failures (if any code changes made)

## Git Commit Convention

- `fix(TP-146): description` (if fix implemented)
- `docs(TP-146): investigation findings` (if investigation only)

## Do NOT

- Make speculative fixes without understanding the root cause
- Modify the test workspace repos
- Change orch branch naming convention

---

## Amendments (Added During Execution)

### Root Cause Analysis

**Primary cause:** `resolveBaseBranch` (waves.ts:564) silently falls back to the repo's current branch (e.g., `develop`) when the orch branch is not found in a secondary repo. The original fix (6294209f) had two bugs (`check.status` instead of `check.ok` + missing `runGit` import) that were corrected in follow-up commits.

**Contributing factors:**
1. `buildIntegrationExecutor` (extension.ts:1329) only integrates the primary repo — supervisor auto-integration misses secondary workspace repos
2. `doOrchIntegrate` (extension.ts:3170) processes repos non-atomically — partial success leaves inconsistent state

**Fix applied:** Added structured WARNING log in `resolveBaseBranch` when orch branch fallback occurs (was previously silent or had debug-only console.error).

**Recommended follow-up tasks:** See CONTEXT.md tech debt entries for `buildIntegrationExecutor` workspace gap and `/orch-integrate` atomicity.
