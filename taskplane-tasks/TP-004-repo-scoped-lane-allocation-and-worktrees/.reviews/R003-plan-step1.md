# R003 — Plan Review (Step 1: Make worktree operations repo-scoped)

## Verdict
**Changes requested**

## What I reviewed
- `taskplane-tasks/TP-004-repo-scoped-lane-allocation-and-worktrees/PROMPT.md`
- `taskplane-tasks/TP-004-repo-scoped-lane-allocation-and-worktrees/STATUS.md`
- `extensions/taskplane/waves.ts`
- `extensions/taskplane/worktree.ts`
- `extensions/taskplane/engine.ts`
- `extensions/taskplane/resume.ts`
- `extensions/taskplane/types.ts`
- `extensions/taskplane/workspace.ts`

## Findings

### 1) **Blocking**: Step 1 still has no concrete plan in `STATUS.md`
Step 1 currently remains at two prompt-level checkboxes only. For Review Level 3, this is not sufficient to start implementation safely.

Missing plan detail includes:
- exact function signature changes,
- repo-root/base-branch resolution source,
- deterministic ordering contract,
- rollback semantics for partial multi-repo failure,
- targeted tests.

### 2) **Blocking**: Repo-scoped create/reset path is not planned at contract level
Current flow still uses a single repo root end-to-end:
- `allocateLanes(..., repoRoot, ...)` in `extensions/taskplane/waves.ts:780`
- `ensureLaneWorktrees(..., repoRoot, ...)` call in `extensions/taskplane/waves.ts:881`
- `ensureLaneWorktrees()` signature in `extensions/taskplane/worktree.ts:1186`
- internal list/reset/create all scoped to one `repoRoot` (`worktree.ts:1195`, `1211`)

Step 1 plan must define how each allocated lane resolves `{ repoId -> repoRoot }` (workspace mode), and what happens when `repoId` is missing/unknown.

### 3) **Blocking**: Repo-scoped **remove** operations are not included in the Step 1 plan
Prompt Step 1 explicitly includes remove behavior, but current remove calls are still single-repo:
- allocation rollback: `removeAllWorktrees(..., repoRoot)` in `waves.ts:927`
- final cleanup: `removeAllWorktrees(prefix, repoRoot, targetBranch)` in `engine.ts:682`
- resume cleanup: `removeAllWorktrees(wtPrefix, repoRoot, targetBranch)` in `resume.ts:1063`

Plan must explicitly cover whether Step 1 updates only allocation-time remove, or also engine/resume cleanup paths (and if deferred, say so explicitly).

### 4) **Major**: Amendment 1 requirement (per-repo base branch) is not planned
The prompt amendment requires passing the **appropriate per-repo base branch** through worktree creation/ensure.

Current runtime captures one base branch (`engine.ts:65`) and threads it globally. Step 1 plan needs explicit workspace-mode rules, e.g.:
- source priority (repo default branch override vs runtime branch detection),
- branch existence checks per repo,
- deterministic failure behavior if one repo branch is invalid.

### 5) **Major**: Deterministic ordering + rollback scope not defined
Step 1 requires deterministic ordering across repo groups/lane numbers, but there is no explicit operation order contract for create/reset/remove across multiple repos.

Also missing: failure atomicity policy. Example: repo A operations succeed, repo B fails — do we roll back only newly created worktrees in failing repo, or all repos touched in this call?

### 6) **Major**: Missing Step 1 test plan
No concrete tests are listed for Step 1. At minimum, add targeted cases for:
- workspace mode with 2 repos and deterministic multi-repo operation ordering,
- per-repo repoRoot targeting for create/reset/remove,
- per-repo base branch selection and failure path,
- partial-failure rollback behavior,
- repo-mode backward compatibility unchanged.

## Required updates before approval
1. Expand Step 1 in `STATUS.md` into a concrete, file-level checklist.
2. Define a repo-scoped worktree contract (laneNumber, repoId, repoRoot, baseBranch) and where it is resolved.
3. Define exact deterministic ordering for multi-repo create/reset/remove operations.
4. Define rollback scope for partial failures.
5. Add explicit Step 1 tests (target files + scenarios).
6. Mark what is deferred to Step 2 so ownership is unambiguous.

## Note
Keep the existing Step 0 follow-up risks tracked (notably `/orch-plan` parity and repo-aware session handling) so Step 1/2 don’t drift from operator-visible behavior.
