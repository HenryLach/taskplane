## Plan Review: Step 3: Update All Callers

### Verdict: REVISE

### Summary
The Step 3 checklist is pointed at the right modules, but it does not yet cover all runtime callers that must be batch-scoped to satisfy the collision-prevention mission. In its current form, the plan could still allow cross-batch reuse/removal of lane worktrees for the same operator. Tightening caller coverage and test intent will make this step implementation-safe.

### Issues Found
1. **[Severity: critical]** — The plan omits the `listWorktrees()` caller inside `ensureLaneWorktrees()` (`extensions/taskplane/worktree.ts:1393`), even though Step 3 is explicitly “Update All Callers.” `STATUS.md` already records this runtime caller (`STATUS.md:111`), but the Step 3 checklist only names `waves.ts`, `engine.ts`, `merge.ts`, `execution.ts`, `resume.ts` (`STATUS.md:54-58`). If `ensureLaneWorktrees()` continues calling `listWorktrees(prefix, repoRoot, opId)` without `batchId`, concurrent batches can still reuse/reset each other’s lane worktrees. **Suggested fix:** add `worktree.ts` to Step 3 scope and require `listWorktrees(prefix, repoRoot, opId, batchId)` in `ensureLaneWorktrees()`.
2. **[Severity: important]** — “Update `allocateLanes()`” is under-specified and does not explicitly call out the rollback cleanup path that currently uses operator-wide removal (`extensions/taskplane/waves.ts:1076`). That call must be updated to batch-scoped removal to avoid deleting sibling batches during defensive rollback. **Suggested fix:** explicitly include `removeAllWorktrees(..., targetBranch?, batchId, config)` updates in `waves.ts` (not just worktree creation path).
3. **[Severity: important]** — The plan does not state caller-side requirements for container cleanup behavior when no worktrees are found. `removeAllWorktrees()` now supports passing `batchId` + `config` to remove an expected empty container (`extensions/taskplane/worktree.ts:1500-1569`), but Step 3 checklist only says “update reset and cleanup.” **Suggested fix:** require engine/resume/waves cleanup callers to pass both `batchId` and config where appropriate so empty batch containers are consistently cleaned up.

### Missing Items
- Add `extensions/taskplane/worktree.ts` (specifically `ensureLaneWorktrees()`) to Step 3 artifacts/caller checklist.
- Explicit per-caller outcome table (engine reset, engine cleanup, resume reset, resume cleanup, waves rollback) indicating required batch-scoped arguments.
- Step 4 test intent for caller isolation: concurrent same-op batches should not be reset/removed by each other.

### Suggestions
- Add a short “caller migration matrix” to STATUS for Step 3: old call signature → new call signature for each runtime callsite.
- Include one targeted regression scenario in Step 4 for same `opId` + different `batchId` to verify reset/cleanup isolation in both engine and resume flows.
