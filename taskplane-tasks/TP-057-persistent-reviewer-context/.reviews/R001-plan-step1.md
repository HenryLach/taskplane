## Plan Review: Step 1 — Create Reviewer Extension with `wait_for_review` Tool

### Verdict: REVISE

### Summary
The Step 1 plan captures the core mechanism (new extension, polling, timeout, shutdown, constants), but it currently misses a few required outcomes called out explicitly in the task prompt/spec. Those gaps are important because they affect determinism and recoverability of the signal protocol.

### Issues Found
1. **[Severity: important]** — The plan does not explicitly cover the `REVIEWER_SIGNAL_DIR` contract.
   - The PROMPT requires the signal directory path to be passed via environment variable.
   - Add an explicit outcome for how `wait_for_review` behaves when `REVIEWER_SIGNAL_DIR` is missing/invalid (fail fast vs no-op mode).

2. **[Severity: important]** — The plan does not explicitly include monotonic signal sequencing behavior.
   - The PROMPT requires a counter tracking which signal number to watch next.
   - Add an explicit outcome for numbered protocol handling (`.review-signal-{N}` ↔ `request-R00{N}.md`) and counter advancement semantics.

3. **[Severity: important]** — Missing-request-file handling is not called out as a planned outcome.
   - The PROMPT explicitly requires clean error handling when the signal fires but request file is absent.
   - Add a concrete outcome for this race/error path so it is not treated as incidental behavior.

4. **[Severity: minor]** — Shutdown signaling semantics are underspecified in the plan.
   - Step text references both a signal containing `shutdown` and a shutdown marker file pattern in later steps.
   - Clarify what Step 1 will detect (e.g., `.review-shutdown`, signal-content sentinel, or both) so protocol is unambiguous.

### Missing Items
- Explicit `REVIEWER_SIGNAL_DIR` behavior/validation outcome
- Explicit monotonic counter + filename mapping outcome
- Explicit missing-request-file error path outcome
- Explicit shutdown signal protocol choice/precedence

### Suggestions
- Keep Step 1 constants in `extensions/taskplane/types.ts` aligned with existing naming style (e.g., `*_POLL_INTERVAL_MS`, `*_TIMEOUT_MS`) for consistency with merge/execution patterns.
- Define the timeout return contract now (what exact tool response string indicates timeout) so Step 2 fallback logic can key off a stable signal.
