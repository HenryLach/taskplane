## Plan Review: Step 3: Diagnostic Reports

### Verdict: REVISE

### Summary
The Step 3 plan captures the high-level deliverables, but it is still too underspecified to reliably satisfy TP-031’s diagnostics contract. The current checklist does not define when reports are emitted, how `{opId}` is sourced, or how to handle sparse v3 diagnostic data paths. Add these outcome-level contracts and targeted test intent before implementation.

### Issues Found
1. **[Severity: important]** — Emission trigger/phase contract is missing, which risks either over-emitting on every state write or missing resume/failure endings.
   - Evidence: Step 3 plan is currently generic (`STATUS.md:50-55`), while `persistRuntimeState()` is called for many non-terminal reasons (`engine.ts:246,255,262,293,319,347,366,373,411,430,490,1048` and `resume.ts:1233,1245,1251,1287,1312,1349,1367,1373,1407,1469,1794`).
   - Suggested fix: explicitly define that diagnostic artifacts emit exactly once per end-of-run via the `batch-terminal` path (engine + resume parity), including paused/stopped outcomes that now represent many failure endings (`engine.ts:1050-1053`, `resume.ts:1796-1797`).

2. **[Severity: important]** — File naming requires `{opId}` but the plan does not define how to obtain it in the persistence path.
   - Evidence: Requirement requires `.pi/diagnostics/{opId}-{batchId}-...` (`PROMPT.md:86-87`), but `persistRuntimeState()` has no `opId` parameter (`persistence.ts:258-266`).
   - Suggested fix: add a plan outcome for opId sourcing (e.g., resolve in engine/resume via `resolveOperatorId(orchConfig)` and pass to a diagnostics-writer helper, or extend persistence API cleanly).

3. **[Severity: important]** — Data-source contract for per-task diagnostics is undefined, likely producing empty or partial reports.
   - Evidence: v3 diagnostics default to empty (`types.ts:1306-1310`), and current plan does not specify fallback behavior when `diagnostics.taskExits` is empty.
   - Suggested fix: define source precedence for report/event generation (e.g., prefer `state.diagnostics.taskExits`, fall back to `tasks[].exitDiagnostic` / legacy fields with explicit defaults), including retry/cost/duration handling.

4. **[Severity: minor]** — Required directory creation and non-fatal write behavior are not explicitly planned.
   - Evidence: Prompt requires creating `.pi/diagnostics/` (`PROMPT.md:90`), but Step 3 checklist omits it (`STATUS.md:50-55`). Existing persistence contract treats write failures as non-fatal (`persistence.ts:247-248`).
   - Suggested fix: add explicit outcomes for `mkdir -p` behavior and best-effort report writing (log/record errors without breaking batch finalization).

### Missing Items
- Explicit emission lifecycle (when exactly reports are written, and that engine/resume behave identically).
- Explicit `{opId}` derivation path for filename contract.
- Explicit fallback behavior when v3 diagnostic aggregates are incomplete.
- Step-specific test intent for:
  - terminal-only emission gating,
  - workspace per-repo section content,
  - resume-path emission parity,
  - write-failure non-fatal behavior.

### Suggestions
- Keep report/event ordering deterministic (stable sort by repo/lane/task/timestamp) to align with project determinism goals and reduce test flakiness.
