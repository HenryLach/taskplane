## Plan Review: Step 1: Define TaskExitDiagnostic Type & Classification Logic

### Verdict: REVISE

### Summary
The Step 1 plan is directionally correct but too underspecified to guarantee the required 9-path exit classification behavior. Right now it lists artifacts, but not the classification precedence or signal contract needed to make `classifyExit()` deterministic across wrapper/task-runner edge cases. Tightening those outcomes now will prevent drift between roadmap intent and implementation.

### Issues Found
1. **[Severity: important]** — `taskplane-tasks/TP-025-rpc-wrapper-and-exit-classification/STATUS.md:30-33` defines only high-level deliverables and omits the required classification decision order. The roadmap specifies concrete precedence signals (`.DONE`, retry failure, compaction/context pressure, timeout, crash, missing summary, no-progress stall) in `docs/specifications/taskplane/resilience-and-diagnostics-roadmap.md:302-313`; add that precedence to the Step 1 plan so behavior is deterministic.
2. **[Severity: important]** — The plan does not define the input contract needed for all 9 classifications. With only “exit summary + .DONE boolean” (`PROMPT.md:76`), paths like `wall_clock_timeout`, `stall_timeout`, `session_vanished`, and `user_killed` need explicit context fields/flags and conflict-resolution rules (e.g., summary classification vs local signals).
3. **[Severity: minor]** — “Types exported for downstream use” is listed (`STATUS.md:33`), but export route is not specified. If downstream modules consume the taskplane barrel, include `extensions/taskplane/index.ts` re-export to avoid inconsistent deep imports.

### Missing Items
- Explicit outcome: a single authoritative classification matrix (signals → classification) with precedence and tie-break rules.
- Explicit outcome: a typed `ExitSummary`/classification input shape that includes non-summary runtime signals (timeout/stall/user-kill/summary-missing).
- Risk mitigation for roadmap mismatch: `user_killed` exists in the union (`resilience-and-diagnostics-roadmap.md:287`) but is absent from the listed algorithm (`:306-313`).
- Testing intent for this step’s behavior (at least enumerating precedence collision cases) before Step 3 implementation.

### Suggestions
- Add an `ExitClassification` string-literal union (or `as const` list) in `diagnostics.ts` and use it as the return type of `classifyExit()`.
- Define `classifyExit(input)` around a single structured input object rather than positional args, to keep the contract extensible for TP-026 integration.
- Record the chosen precedence table in code comments/JSDoc so wrapper, task-runner, and dashboard stay aligned.
