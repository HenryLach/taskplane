## Code Review: Step 3: Preserve Existing Behavior

### Verdict: REVISE

### Summary
The new `launching` handoff closes the immediate post-`/orch` race, and the related enum/test updates are consistent. However, two correctness regressions remain: `/orch-resume` can get stuck in `launching` on common early-return paths, and `/orch-status` disk fallback reads from the wrong root in workspace mode. These both violate Step 3’s “preserve existing behavior” goal for operational commands.

### Issues Found
1. **[extensions/taskplane/extension.ts:1154, extensions/taskplane/resume.ts:774-789] [critical]** — `/orch-resume` now sets `orchBatchState.phase = "launching"` before dispatch, but `resumeOrchBatch()` has multiple non-throwing early returns (`no state`, `ineligible phase`, diagnostics failure) that return without mutating `batchState` back out of launching. Result: state can remain stuck at `launching`, and subsequent `/orch-resume` is blocked by the active-phase guard (`extension.ts:1138-1145`). **Fix:** ensure all pre-execution resume failures transition batch state to a non-active phase (e.g., idle/paused/failed as appropriate), or move launching assignment until after resume eligibility is confirmed.
2. **[extensions/taskplane/extension.ts:1056] [important]** — `/orch-status` disk fallback resolves `stateRoot` from `execCtx?.repoRoot`, but orchestrator state files are persisted under `workspaceRoot` in workspace mode (`extensions/taskplane/engine.ts:495-497`, `extensions/taskplane/resume.ts:754-756`, contract note in `extensions/taskplane/types.ts:2670-2671`). This can report “No batch is running” while an active `.pi/batch-state.json` exists at workspace root. **Fix:** resolve disk status from `execCtx?.workspaceRoot ?? execCtx?.repoRoot ?? ctx.cwd`.

### Pattern Violations
- State-root resolution for disk-backed status is inconsistent with engine/resume workspace-root persistence semantics.

### Test Gaps
- No test covers `/orch-resume` early-return paths after the new launching pre-state (e.g., missing state file or non-resumable phase) to ensure phase does not stay `launching`.
- No test covers `/orch-status` disk fallback when `workspaceRoot !== repoRoot`.

### Suggestions
- Add a shared `resolveStateRoot(execCtx, ctx.cwd)` helper used by extension, engine, and resume call sites to prevent future root drift.
