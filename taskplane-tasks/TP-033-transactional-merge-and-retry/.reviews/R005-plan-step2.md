## Plan Review: Step 2: Retry Policy Matrix

### Verdict: REVISE

### Summary
The Step 2 plan is directionally correct, but it is currently too generic for a policy-heavy resilience change. It does not yet capture key outcomes required by the roadmap matrix (class-by-class behavior, wave gating, and persisted scope semantics), so implementation risk remains high. Tightening these outcomes now will reduce the chance of inconsistent retry behavior across execution and resume paths.

### Issues Found
1. **[Severity: critical]** — The plan does not explicitly commit to the in-scope class matrix outcomes (max/cooldown/exhaustion action), which are the core requirement of Step 2.
   - Evidence: `STATUS.md:37-42` only lists broad bullets, while `PROMPT.md:77-83` and roadmap `4c` require classification-keyed behavior and idempotent retry rules (`docs/specifications/taskplane/resilience-and-diagnostics-roadmap.md:613-637`).
   - Suggested fix: Add explicit Step 2 outcomes for each TP-033 in-scope merge class (`verification_new_failure`, `merge_conflict_unresolved`, `cleanup_post_merge_failed`, `git_worktree_dirty`, `git_lock_file`) including retry-allowed, max attempts, cooldown, and exhaustion transition.

2. **[Severity: important]** — Retry counter key semantics are not fully specified against existing v3 contract drift.
   - Evidence: discovery already notes mismatch (`STATUS.md:79`), and current type docs still describe task-scoped keys (`extensions/taskplane/types.ts:1345-1347`) rather than repo-scoped keys from prompt (`PROMPT.md:78`).
   - Suggested fix: Add a clear outcome for canonical key format (including repo-mode fallback, e.g., `default:wN:lK`) and compatibility handling for pre-existing `retryCountByScope` entries so persisted state remains deterministic/resumable.

3. **[Severity: important]** — Plan does not address execution/resume parity risk for retry policy application.
   - Evidence: merge failure policy is intentionally shared for parity (`extensions/taskplane/engine.ts:559-562`, `extensions/taskplane/resume.ts:1537-1540`), but Step 2 artifacts currently call out only engine/persistence/types in prompt (`PROMPT.md:85-87`) and no parity outcome is stated in `STATUS.md:37-42`.
   - Suggested fix: Add a Step 2 outcome that retry decisions are applied consistently in both fresh execution and resume flows (either via shared helper or explicit mirrored behavior).

### Missing Items
- Explicit outcome that `cleanup_post_merge_failed` remains a hard wave gate (no advancement to next wave) per roadmap rule (`docs/specifications/taskplane/resilience-and-diagnostics-roadmap.md:637`).
- Step 2-specific validation intent for non-retriable classes (e.g., `merge_conflict_unresolved` should not retry) and persisted counter reuse across resume/restart.

### Suggestions
- Add a short “Step 2 done when” block in `STATUS.md` with matrix outcomes + scoping contract + parity statement.
- Keep classification-to-policy mapping centralized/pure (similar to existing message policy helpers) to minimize divergence and simplify tests.
