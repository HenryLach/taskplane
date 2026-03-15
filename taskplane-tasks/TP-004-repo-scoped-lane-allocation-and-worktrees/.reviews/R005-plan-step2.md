# R005 — Plan Review (Step 2: Update execution contracts)

## Verdict
**Changes requested**

## What I reviewed
- `taskplane-tasks/TP-004-repo-scoped-lane-allocation-and-worktrees/PROMPT.md`
- `taskplane-tasks/TP-004-repo-scoped-lane-allocation-and-worktrees/STATUS.md`
- `extensions/taskplane/execution.ts`
- `extensions/taskplane/engine.ts`
- `extensions/taskplane/resume.ts`
- `extensions/taskplane/abort.ts`
- `extensions/taskplane/persistence.ts`
- `extensions/taskplane/types.ts`

## Findings

### 1) **Blocking**: Step 2 plan is still not concrete in `STATUS.md`
Step 2 currently has only the two prompt-level checkboxes. For a Review Level 3 task, this is not enough to safely implement/review execution-path changes.

Missing details:
- exact function signature changes,
- call-chain threading plan,
- callback/state contract updates,
- explicit backward-compatibility guardrails,
- targeted test plan.

### 2) **Blocking**: Workspace config is not threaded through wave execution contract
Current code shape shows a contract gap that Step 2 must explicitly plan to close:
- `allocateLanes(..., workspaceConfig?)` now accepts workspace config (`extensions/taskplane/waves.ts:859`),
- but `executeWave()` calls `allocateLanes(...)` without passing it (`extensions/taskplane/execution.ts:1708`),
- and `executeWave()` itself has no `workspaceConfig` param (`extensions/taskplane/execution.ts:1657`),
- while both callers already have workspace config available (`extensions/taskplane/engine.ts:45`, `extensions/taskplane/resume.ts:338`).

Step 2 plan should define the full contract chain (`engine/resume -> executeWave -> allocateLanes`) and repo-mode fallback behavior when config is absent.

### 3) **Blocking**: Abort session matching is not workspace-lane compatible
`selectAbortTargetSessions()` currently filters only suffixes starting with `lane-` or `merge-` (`extensions/taskplane/abort.ts:42`).
Workspace lane sessions are currently formatted like `<prefix>-<repoId>-lane-<n>`, which do not satisfy `suffix.startsWith("lane-")`.

This must be included in Step 2 planning, otherwise `/orch-abort` can miss active workspace lanes.

### 4) **Major**: Abort lane identity reconstruction loses repo-aware lane IDs
Persisted lookup in abort reconstructs lane IDs as `lane-${task.laneNumber}` (`extensions/taskplane/abort.ts:51`) instead of using persisted lane records (`PersistedLaneRecord.laneId`).

In workspace mode this drops repo dimension (e.g., should be `api/lane-1`). Step 2 should include a plan to source laneId from persisted lanes by session/task mapping and keep repo-mode output unchanged.

### 5) **Major**: Repo-scoped worktree lifecycle is still incomplete at cleanup points
Final cleanup paths still remove worktrees only from the single `repoRoot`:
- `extensions/taskplane/engine.ts:682`
- `extensions/taskplane/resume.ts:1063`

Given this task’s lifecycle scope, Step 2 plan should explicitly state whether multi-repo cleanup is being completed now (recommended), or deferred with a named follow-up task. Leaving this implicit is risky.

## Required updates before approval
1. Expand Step 2 in `STATUS.md` into a file-level checklist with explicit signatures and call sites.
2. Define execution contract threading for workspace mode:
   - `executeWave(..., workspaceConfig?)`
   - pass-through from `executeOrchBatch()` and `resumeOrchBatch()`
   - explicit repo-mode (`workspaceConfig == null`) compatibility expectations.
3. Add abort compatibility plan for workspace sessions:
   - target-session matching that supports `<prefix>-<repoId>-lane-<n>` and merge sessions,
   - persisted laneId sourcing from persisted lane records (not `laneNumber` reconstruction).
4. Clarify cleanup lifecycle ownership for multi-repo runs (engine + resume cleanup semantics).
5. Add a concrete Step 2 test list (target files + cases), at minimum:
   - execution call-chain uses workspace config,
   - abort selects workspace lane session names,
   - abort laneId enrichment preserves repo-aware lane IDs,
   - repo mode behavior remains unchanged.

## Note
There is also a status inconsistency at the top of `STATUS.md` (`Status: ✅ Complete` vs Step 2 marked in-progress). Please keep that metadata aligned before implementation/review handoff.
