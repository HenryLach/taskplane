## Plan Review: Step 3: Preserve Existing Behavior

### Verdict: REVISE

### Summary
The Step 3 checklist captures the right compatibility goals, but it is still too broad to guarantee them under the new detached-launch model. The current plan can be marked complete while `/orch-status`, `/orch-pause`, and `/orch-abort` regress in the immediate post-launch window. It also does not explicitly cover the prompt requirement that `/orch-status` reflect persisted state from disk.

### Issues Found
1. **[Severity: critical]** — The plan does not include an outcome for the launch-handoff race introduced by `setTimeout(..., 0)` in `extensions/taskplane/extension.ts:705-735`. `/orch` resets runtime state (`extension.ts:886-889`) and returns before `executeOrchBatch()` sets `phase="planning"` (`engine.ts:533-535`), leaving a window where follow-up commands can see `idle` and behave as if no batch exists. **Suggested fix:** add an explicit Step 3 outcome for immediate post-`/orch` correctness (`/orch-status`, `/orch-pause`, `/orch-abort`, duplicate `/orch`) during pre-engine boot.
2. **[Severity: important]** — The plan still does not explicitly cover the prompt contract: `/orch-status` should read batch state from disk. Current status handling is in-memory only (`extensions/taskplane/extension.ts:1038-1062`), so a broad “still works” checkbox is insufficient to ensure disk-backed behavior is preserved/validated. **Suggested fix:** add a concrete outcome for persisted-state status semantics (load/validate `.pi/batch-state.json`, with defined precedence/fallback behavior).

### Missing Items
- Explicit compatibility outcome for command behavior in the detached launch window before engine phase transition.
- Explicit `/orch-status` disk-state requirement and validation path.

### Suggestions
- Use one shared “launching/starting” compatibility path for both `/orch` and `/orch-resume` so behavior and tests stay aligned.
- Add a targeted test intent for “command issued immediately after non-blocking launch” instead of relying only on “existing tests pass.”
