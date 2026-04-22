# R006 — Code Review (Step 2: Update execution contracts)

## Verdict
**Changes requested**

## Scope reviewed
Baseline: `8d0170f..HEAD`

Changed runtime files:
- `extensions/taskplane/execution.ts`
- `extensions/taskplane/engine.ts`
- `extensions/taskplane/resume.ts`
- `extensions/taskplane/abort.ts`

Changed tests:
- `extensions/tests/external-task-path-resolution.test.ts`

Neighbor checks performed:
- `extensions/taskplane/waves.ts`
- `extensions/taskplane/worktree.ts`

## Findings

### 1) Multi-repo cleanup is still single-repo scoped (worktrees can be leaked)
**Severity:** High

Step 2 marks cleanup as verified for workspace mode, but the runtime cleanup path still removes worktrees from only one repo root:
- `extensions/taskplane/engine.ts:683` → `removeAllWorktrees(prefix, repoRoot, targetBranch)`
- `extensions/taskplane/resume.ts:1064` → `removeAllWorktrees(wtPrefix, repoRoot, targetBranch)`

`removeAllWorktrees()` is repo-local:
- `extensions/taskplane/worktree.ts:1289` (calls `listWorktrees(prefix, repoRoot)`)
- `extensions/taskplane/worktree.ts:1050` (`listWorktrees` reads `git worktree list` for that repo only)

But lane provisioning is repo-scoped in workspace mode (`ensureLaneWorktrees(..., groupRepoRoot, ...)` in `waves.ts`), so non-default repos will not be cleaned up by the current batch-end cleanup path.

**Why this matters:** completed/aborted multi-repo batches can leave orphan worktrees in secondary repos, violating deterministic cleanup expectations.

**Suggested fix:** perform cleanup per resolved repo root (workspace repo set + default repo), or introduce a multi-repo wrapper around `removeAllWorktrees` and use it in both engine and resume.

---

### 2) Missing test coverage for the new `executeWave(..., workspaceConfig?)` contract threading
**Severity:** Medium

The Step 2 runtime contract change was implemented (good):
- `executeWave` now accepts `workspaceConfig`
- `engine` and `resume` pass it through

However, no test was added for this call-chain behavior. The new tests only cover abort session matching (`external-task-path-resolution.test.ts`).

Given this is a contract-threading change across three files, a regression test is expected per project standards.

**Suggested fix:** add a targeted unit/integration test that verifies workspace config reaches lane allocation through `executeWave` from both engine and resume paths (or at minimum from `executeWave` to `allocateLanes`).

## Validation notes
- Ran: `cd extensions && npx vitest run tests/external-task-path-resolution.test.ts` ✅ (36 passed)
- Ran: `cd extensions && npx vitest run tests/waves-repo-scoped.test.ts` ✅ (19 passed)
- Ran: `cd extensions && npx vitest run` ❌ (pre-existing failing suites remain in this worktree)
