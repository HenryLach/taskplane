## Plan Review: Step 2: Add Size Cap and Batch-Start Cleanup

### Verdict: REVISE

### Summary
The Step 2 plan captures the main functional direction (telemetry size cap, preflight wiring, and batch-start cleanup) and includes targeted testing intent. However, it currently omits one explicit Step 2 outcome from the task prompt, so it risks completing implementation without meeting the stated requirements. Add that missing outcome before proceeding.

### Issues Found
1. **[Severity: important]** — The plan in `STATUS.md` does not include the prompt’s required outcome to **"Make thresholds configurable or clearly documented as constants"** (`PROMPT.md:73-77` vs `STATUS.md:52-55`). This is a stated Step 2 requirement and should be tracked explicitly to avoid drift/hardcoded behavior without documentation. Suggested fix: add a Step 2 checkbox covering threshold constants/config (e.g., telemetry cap bytes and age threshold), and ensure implementation uses named exported constants or config plumbing.

### Missing Items
- Explicitly call out that batch-start cleanup must only target **prior completed** batch artifacts and must never delete active/current-batch artifacts.

### Suggestions
- Since Step 0 found preflight cleanup actually runs from engine start, make sure the hook point is the real `/orch` batch-start path (or shared `runPreflightCleanup`) so behavior is consistent across execution paths.
- In targeted tests, include one safeguard case proving active/current batch artifacts are preserved when cleanup runs.
