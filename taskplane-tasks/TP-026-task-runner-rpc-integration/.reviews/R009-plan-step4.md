## Plan Review: Step 4: Testing & Verification

### Verdict: REVISE

### Summary
The Step 4 checklist captures the core TP-026 test bullets (command generation, sidecar accumulation, exit classification, crash fallback, workspace paths) and includes a full-suite gate. However, it is still too narrow against the task’s completion criteria and known regression points from Step 3. Add explicit outcomes for persistence/resume propagation and `/orch` no-change protection so verification closes the full contract, not just helper behavior.

### Issues Found
1. **[Severity: important]** — The plan does not include a verification outcome for `exitDiagnostic` surviving persistence/resume flows, even though this is a task completion criterion (`PROMPT.md:133`) and a recent regression area (`R008`). Current Step 4 items in `STATUS.md:70-75` stop at “read/classify” and do not assert state carry-forward behavior.
2. **[Severity: important]** — There is no explicit non-regression gate for the `/orch` subprocess path remaining unchanged (`PROMPT.md:27`, `PROMPT.md:134`, `PROMPT.md:146`). Given this task modifies core spawn logic, Step 4 should include a concrete verification item (test or diff guard) that subprocess/orchestrator paths are unaffected.
3. **[Severity: minor]** — The plan does not identify the dedicated RPC integration test artifact expected in scope (`PROMPT.md:57`), and `STATUS.md:70-75` does not map test outcomes to files. Add a clear test-file target (or explicit rationale for reusing existing files) to avoid fragmented or duplicated coverage.

### Missing Items
- A Step 4 check that task outcomes persisted in batch state retain both `exitReason` (legacy) and `exitDiagnostic` (additive) after monitor sync/resume paths.
- A Step 4 guardrail check for “no changes outside tmux `/task` path,” especially `spawnAgent()` and `/orch` execution polling.
- A test matrix mapping each Step 4 bullet to concrete test files (existing or new).

### Suggestions
- Add a short “Step 4 verification matrix” subsection in `STATUS.md` listing each required scenario and the exact test file that covers it.
- Keep one fast targeted run command (TP-026-related tests) before the full `vitest` sweep to speed iteration when fixing failures.
