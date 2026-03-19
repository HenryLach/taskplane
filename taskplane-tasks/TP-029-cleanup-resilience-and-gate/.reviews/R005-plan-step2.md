## Plan Review: Step 2: Post-Merge Cleanup Gate

### Verdict: REVISE

### Summary
The Step 2 direction is correct, but the current plan is too high-level to reliably enforce the cleanup gate semantics required by TP-029. It does not yet pin down how cleanup failure is classified/persisted and what exact verification checks block wave advancement. Tightening those outcomes now will reduce risk of a “logged but not gated” implementation.

### Issues Found
1. **[Severity: important]** — `taskplane-tasks/TP-029-cleanup-resilience-and-gate/STATUS.md:53-55` omits an explicit Step 2 outcome for `cleanup_post_merge_failed`, even though it is required by `PROMPT.md:84` (and roadmap acceptance at `docs/specifications/taskplane/resilience-and-diagnostics-roadmap.md:451-452`). The note at `STATUS.md:167-169` mentions it, but it is not in the actionable Step 2 checklist. **Fix:** add a concrete Step 2 checkbox that defines where/how this classification is recorded (at minimum in `batchState.errors` + persisted state/log context).
2. **[Severity: important]** — `STATUS.md:53` says “Verify cleanup success” but does not define the repo-scoped verification criteria that decide pass/fail. In current flow, inter-wave reset failures are mostly logged and execution can continue (`extensions/taskplane/engine.ts:623-644`), so a vague gate risks becoming non-blocking. **Fix:** add a Step 2 outcome requiring deterministic per-repo verification (e.g., no remaining registered worktrees/lane cleanup failures for this wave) before allowing next-wave transition, with repo-specific failure payloads.
3. **[Severity: important]** — `STATUS.md:54-55` does not call out persistence semantics when pausing on cleanup failure. To actually block next-wave execution across process restarts, the paused state must be persisted at the failure point (same pattern as merge-failure handling at `extensions/taskplane/engine.ts:523-526`). **Fix:** add an explicit outcome for phase transition + `persistRuntimeState(...)` on cleanup-gate failure, and require diagnostics to include recovery + `/orch-resume` guidance.

### Missing Items
- Step 2-specific test intent for both paths: (a) cleanup failure pauses and prevents wave N+1 start, and (b) cleanup success still advances normally (regression guard).
- A parity decision for resumed execution: `extensions/taskplane/resume.ts:1382-1428` has the same post-merge reset shape; either include parity in scope now or explicitly defer with rationale.

### Suggestions
- Add a short “Step 2 done when” block under Notes (similar to Step 1) with explicit gate outcomes: verification scope, paused transition/persistence, and diagnostic content requirements.
- Reuse centralized message templates (`extensions/taskplane/messages.ts`) for deterministic operator-facing recovery instructions.
