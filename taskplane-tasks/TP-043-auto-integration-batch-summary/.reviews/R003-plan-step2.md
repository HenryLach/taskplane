## Plan Review: Step 2: Batch Summary Generation

### Verdict: REVISE

### Summary
The revised Step 2 plan is much stronger: it now captures summary sequencing across manual/supervised/auto flows and includes the required output path contract. However, one prompt requirement is still not explicitly planned: incidents/recoveries must be sourced from **Tier 0 events and audit trail**, while the current checklist only commits to audit trail sourcing. Without that, the delivered summary can miss required incident history.

### Issues Found
1. **[Severity: important]** — Incident/recovery sourcing is still underspecified versus the prompt contract.
   - Evidence: `PROMPT.md:91` requires incidents/recoveries from **Tier 0 events and audit trail**; current plan line `STATUS.md:38` says incidents/recoveries from audit trail only.
   - Why this blocks: Tier 0 recoveries/escalations are emitted to `.pi/supervisor/events.jsonl`, and are not guaranteed to be represented in `actions.jsonl` audit entries, so summaries can omit required incidents.
   - Suggested fix: Add an explicit outcome to read and batch-filter `.pi/supervisor/events.jsonl` for `tier0_recovery_attempt|success|exhausted|escalation` (reusing existing parsing patterns in `extensions/taskplane/supervisor.ts:2493-2568`), then merge with `readAuditTrail(...)` (`extensions/taskplane/supervisor.ts:255-295`).

### Missing Items
- Explicit Tier 0 event ingestion outcome (`events.jsonl` + batchId filter) for incidents/recoveries, in addition to audit trail.

### Suggestions
- Follow the existing non-fatal report-emission pattern used in `extensions/taskplane/diagnostic-reports.ts` so summary write errors do not break supervisor shutdown/integration completion.
- Keep deterministic ordering in the summary (wave order, timestamp order) and emit section skeletons with “not available” placeholders when telemetry is partial.
