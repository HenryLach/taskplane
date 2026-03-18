## Plan Review: Step 5: Testing & Verification

### Verdict: REVISE

### Summary
The Step 5 plan is directionally correct, but it is currently too narrow versus the Step 5 requirements in `PROMPT.md`. It covers test execution and a few core checks, but misses several required verification outcomes and one important mode-specific risk in merge behavior. Tightening those outcomes will make final verification consistent with the implemented engine/resume/merge paths.

### Issues Found
1. **[Severity: important]** — The current Step 5 checklist in `taskplane-tasks/TP-022-orch-branch-lifecycle-merge-redirect/STATUS.md:94-98` omits required verification outcomes from `.../PROMPT.md:133-137`: (a) worktrees are based on `orchBranch`, (b) post-merge reset targets `orchBranch`, and (c) cleanup preserves `orchBranch` in manual integration mode. **Suggested fix:** add explicit Step 5 checklist items for each omitted outcome and tie them to concrete assertions against current call sites (`extensions/taskplane/engine.ts:267-277,377-385,512-515,698-701`; `extensions/taskplane/resume.ts:1107-1117,1224-1232,1346-1361,1389-1411`).
2. **[Severity: important]** — The plan item “Merge no longer touches user's branch” (`STATUS.md:96`) is too absolute for current implementation behavior. `merge.ts` intentionally uses a checked-out-branch fallback (`git merge --ff-only` + stash path) in workspace scenarios (`extensions/taskplane/merge.ts:775-800`), while non-checked-out paths use `update-ref` (`merge.ts:813-823`). **Suggested fix:** make Step 5 verification mode-aware: verify repo-mode/primary isolation via `update-ref` path and separately verify checked-out workspace fallback safety/cleanliness.
3. **[Severity: important]** — Auto-integration verification is underspecified relative to recently fixed regressions. The plan says only “Auto-integration verified” (`STATUS.md:97`), but should explicitly include terminal-phase gating and resume parity checks (`extensions/taskplane/engine.ts:783-801`, `extensions/taskplane/resume.ts:1431-1448`). **Suggested fix:** add explicit Step 5 outcomes for “no integration/guidance on paused/stopped” in both engine and resume flows.

### Missing Items
- Explicit verification items for all Step 5 prompt requirements currently absent from STATUS.
- Mode-specific merge verification matrix (non-checked-out `update-ref` vs checked-out `ff-only` fallback).
- Explicit resume-path verification intent for auto-integration and completion guidance gating.

### Suggestions
- Keep `cd extensions && npx vitest run` as the gate, but add a short targeted checklist naming the high-risk TP-022 scenarios (branch creation edge cases, repo/workspace merge advancement, inter-wave reset target, manual preservation behavior) so sign-off is auditable.
