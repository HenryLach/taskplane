## Plan Review: Step 2: Batch Summary Generation

### Verdict: REVISE

### Summary
The Step 2 plan captures the high-level intent to generate and present a batch summary, but it currently misses key outcome-level requirements from the prompt that are necessary for deterministic execution. In particular, the plan does not yet define when summary generation happens relative to supervisor teardown across manual/supervised/auto flows. It also omits explicit requirements for filename contract and wave-level cost breakdown handling.

### Issues Found
1. **[Severity: critical]** — The plan does not include a deterministic summary trigger/ordering relative to supervisor deactivation across terminal paths.
   - Evidence: current code deactivates immediately in manual/non-completed terminal paths (`extensions/taskplane/extension.ts:1343-1365`, `extensions/taskplane/extension.ts:1669`) and after integration lifecycle paths (`extensions/taskplane/supervisor.ts:791`, `850`, `908`, `967`, `982`, `999`, `1018`).
   - Why this blocks: Prompt requires summary generation after integration (or on batch completion in manual mode) (`PROMPT.md:88-94`). Without an explicit sequencing outcome, summary generation can be skipped entirely.
   - Suggested fix: Add an explicit outcome that summary generation runs before final supervisor deactivation in manual mode and after integration lifecycle completion in supervised/auto mode (including PR CI/merge and error/fallback paths).

2. **[Severity: important]** — The plan does not capture the required output file contract.
   - Evidence: required path is explicit in `PROMPT.md:89` (`.pi/supervisor/{opId}-{batchId}-summary.md`), but current Step 2 plan only says “Generate summary file” (`STATUS.md:38`).
   - Why this matters: Missing the naming/location contract breaks discoverability and can cause collisions across operators/batches.
   - Suggested fix: Add an explicit outcome to resolve `opId` via project naming conventions (see `extensions/taskplane/naming.ts:60`) and write under the supervisor state root.

3. **[Severity: important]** — Required wave-level cost breakdown and incident source requirements are underspecified in the plan.
   - Evidence: prompt requires incidents/recoveries from Tier 0 events + audit trail and wave cost breakdown when telemetry exists (`PROMPT.md:91-93`), but Step 2 checklist only has broad bullets (`STATUS.md:39-41`).
   - Why this matters: The generated summary may omit required sections or produce inconsistent content when telemetry is partial.
   - Suggested fix: Add an explicit outcome for data sourcing/fallback rules (e.g., use persisted telemetry such as wave summaries when available; otherwise emit “not available” while still producing a complete summary skeleton).

### Missing Items
- Explicit sequencing outcome for summary generation in both `/orch` and `/orch-resume` terminal flows.
- Explicit file naming/location contract (`{opId}-{batchId}-summary.md` under `.pi/supervisor/`).
- Explicit telemetry fallback policy for wave cost breakdown and incident extraction.

### Suggestions
- Reuse existing report-generation patterns for non-fatal file emission and deterministic markdown construction (e.g., diagnostics report style).
- Keep summary assembly as a pure formatter/helper and perform I/O in a thin wrapper for easier testing in Step 3.
