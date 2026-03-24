## Plan Review: Step 2 — Update `review_step` Handler for Persistent Mode

### Verdict: REVISE

### Summary
The Step 2 checklist has the right top-level outcomes (spawn/reuse/fallback/cleanup), but it is still underspecified for this code path. In `task-runner.ts`, reviewer lifecycle touches multiple exit paths and filename contracts; without a few explicit plan items, this change is likely to be nondeterministic or leak sessions.

### Issues Found
1. **[Severity: important]** Signal/request numbering contract is not explicit enough.
   - `wait_for_review` currently consumes numbered signals and expects matching numbered request files.
   - The plan must define how numbering behaves across **persistent session respawn** (after crash/timeout/fallback), or you risk counter drift and reviewer reading the wrong/nonexistent request.

2. **[Severity: important]** Cleanup is scoped to "task completion" only, but task-runner has many non-complete exits.
   - `executeTask()` can return on pause, stall/no-progress, quality-gate failure, and errors.
   - Plan should require a centralized shutdown helper used on **all terminal/early-exit paths** to avoid orphan reviewer tmux sessions.

3. **[Severity: important]** `REVIEWER_SIGNAL_DIR` delivery mechanism is not specified at spawn-time.
   - The plan says to pass env var, but not *how* relative to session start.
   - It should be set deterministically before reviewer tool execution (avoid race where reviewer starts before env is visible).

4. **[Severity: important]** Stale control-file handling is missing.
   - Persistent mode introduces control artifacts (`.review-signal-*`, `.review-shutdown`).
   - Plan should define first-spawn hygiene (e.g., remove stale shutdown marker / stale pending signals) so a newly spawned reviewer does not immediately exit or consume old signals.

5. **[Severity: minor]** Fallback observability contract is vague.
   - Prompt requires warning + telemetry/supervisor visibility.
   - Plan should specify exact logging side effects (at minimum STATUS execution log entry + stderr structured message) so fallback is operator-visible and testable.

### Missing Items
- Explicit numbering continuity strategy across reviewer restarts
- Centralized reviewer shutdown helper invoked on all exit paths
- Deterministic env injection method for `REVIEWER_SIGNAL_DIR`
- Stale signal/shutdown file hygiene on first persistent spawn
- Concrete fallback logging contract for tests/dashboard

### Suggestions
- Add a Step 2 sub-outcome: "Define and enforce one canonical mapping for review ID ↔ signal ID (including respawn behavior)."
- Add a Step 2 sub-outcome: "Implement `shutdownPersistentReviewer(reason)` and call it from success/failure/pause/session-reset paths."
- Add a Step 2 sub-outcome for deterministic spawn contract: extensions list + env vars must be applied in the same spawn transaction.
- Add source-based tests (Step 5) that assert these contracts exist in `review_step` and task finalization paths, not just happy-path reuse.
