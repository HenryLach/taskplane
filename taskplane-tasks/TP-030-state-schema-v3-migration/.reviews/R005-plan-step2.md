## Plan Review: Step 2: Implement Migration

### Verdict: REVISE

### Summary
The Step 2 plan captures the headline migration outcomes (version detection, v1/v2 upconversion, corrupt-state handling, and unknown-field preservation). However, two outcome-level gaps remain that can cause data loss or violate the “never auto-delete on corrupt state” requirement. Tightening these before implementation will reduce rework in Step 3.

### Issues Found
1. **[Severity: important]** — Corrupt-state handling is not fully planned through the `/orch` startup decision path.
   - Evidence: plan bullets only reference generic handling in `STATUS.md:43-47`, but current behavior still recommends/executes cleanup for invalid state (`extensions/taskplane/persistence.ts:1248-1258`, `extensions/taskplane/extension.ts:771-775`).
   - Why this matters: `PROMPT.md:80` requires corrupt/unparseable state to enter paused+diagnostic and **never auto-delete**.
   - Suggested fix: add an explicit Step 2 outcome for end-to-end startup behavior (detection + command handling) so invalid/parse-error state cannot flow into cleanup deletion.

2. **[Severity: important]** — The plan does not explicitly require preserving existing v3 resilience/diagnostics/exitDiagnostic values across subsequent writes.
   - Evidence: current serializer still rebuilds task/state records from runtime defaults (`extensions/taskplane/persistence.ts:798-808`, `extensions/taskplane/persistence.ts:897-898`), and Step 2 checklist does not call out non-default v3 field roundtripping (`STATUS.md:43-47`).
   - Why this matters: `PROMPT.md:118` requires v3 state to preserve resilience+diagnostics fields; without explicit carry-forward, resumed batches can silently zero them out.
   - Suggested fix: add a migration outcome that loaded v3 sections (including task `exitDiagnostic`) are retained unless intentionally updated, not reset by serialization defaults.

### Missing Items
- Test-coverage intent for the upgrade-guidance/version-mismatch path (`PROMPT.md:81`) is not currently listed in Step 3 (`STATUS.md:53-58`).
- A specific verification that corrupt-state flow does **not** delete `.pi/batch-state.json` during `/orch` startup is missing.

### Suggestions
- Add a short Step 2 acceptance checklist in `STATUS.md` covering: “no auto-delete on invalid state,” “v3 non-default fields survive resume+persistence,” and “unsupported-version error text includes upgrade guidance.”
