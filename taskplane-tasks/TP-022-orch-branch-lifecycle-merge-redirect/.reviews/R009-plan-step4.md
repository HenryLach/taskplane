## Plan Review: Step 4: Auto-Integration and Cleanup

### Verdict: REVISE

### Summary
The Step 4 checklist in `STATUS.md` captures the headline goals, but it is still too high-level to safely implement this phase. It does not yet define key failure-path behavior for auto integration or parity expectations for resumed batches. Tightening those outcomes now will prevent regressions in branch cleanup and user-facing completion behavior.

### Issues Found
1. **[Severity: important]** — The plan does not define the auto-integration failure matrix (diverged refs, checked-out dirty tree, base branch not checked out) or the required fallback semantics. `STATUS.md:76` only says “config-driven ff,” but the implementation in `engine.ts` must explicitly preserve `orchBranch`, emit a warning, and avoid converting a successful batch into `failed` when integration cannot be applied.
2. **[Severity: important]** — Resume parity is missing from the plan. Cleanup/completion logic currently exists in both `engine.ts` (`~L659+`) and `resume.ts` (`~L1329+`), but Step 4 plan items only target `engine.ts`/`messages.ts`. Without explicit parity, `/orch-resume` completions will keep old branch-lifecycle behavior and inconsistent completion messaging.
3. **[Severity: important]** — The plan does not call out which branch should be used for unmerged-branch protection during cleanup. Current code passes `baseBranch` to `removeAllWorktrees` in `engine.ts:695-699` and `resume.ts:1332-1339`; with lane merges now targeting `orchBranch`, this can preserve lane work as `saved/*` refs unnecessarily and conflict with the Step 4 outcome “delete lane branches as before.”
4. **[Severity: minor]** — Test intent is underspecified. The checklist has no explicit scenarios for manual mode default behavior, auto success, auto failure fallback, or completion-message content updates (`messages.ts:39+`, `engine.ts:781+`).

### Missing Items
- Explicit auto-integration outcome table: success path, non-fast-forward/divergence, dirty checkout, and detached/branch-missing handling.
- Explicit decision for cleanup comparison target (`baseBranch` vs `orchBranch`) consistent with lane-branch deletion goals.
- Resume-path parity statement for cleanup + completion messaging.
- Concrete Step 4 test coverage goals (at least structural + behavioral checks for auto/manual integration and branch preservation).

### Suggestions
- Reuse the merge-step “checked-out vs not checked-out” branch-advancement pattern to keep integration deterministic and workspace-safe.
- Add one new ORCH message helper for post-batch integration guidance so both `/orch` and `/orch-resume` can share consistent wording.
