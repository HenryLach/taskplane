## Plan Review: Step 4: Testing & Verification

### Verdict: REVISE

### Summary
The Step 4 plan is currently too generic to guarantee the required verification outcomes. `STATUS.md` captures high-level goals, but it drops several explicit checks required by `PROMPT.md`, which makes the test step non-deterministic and easier to mark complete without proving key contracts. Tightening the checklist to concrete verification targets will make this step reliably reviewable.

### Issues Found
1. **[Severity: important]** — The Step 4 checklist in `STATUS.md` is underspecified compared with the prompt contract. It only lists broad items (`Unit tests passing`, `Schema defaults verified`, etc.) at `taskplane-tasks/TP-020-orch-managed-branch-schema/STATUS.md:60-63`, but the prompt requires explicit checks for: running `cd extensions && npx vitest run`, verifying `freshOrchBatchState().orchBranch === ""`, verifying `DEFAULT_ORCHESTRATOR_CONFIG.orchestrator.integration === "manual"`, and verifying Settings Advanced discoverability behavior (`PROMPT.md:109-113`). Add these exact outcomes back into Step 4 acceptance criteria.
2. **[Severity: important]** — The plan does not explicitly include backward-compat verification for persisted state files missing `orchBranch`, even though that is a completion criterion (`PROMPT.md:133`). This is a risk area because compatibility is implemented via load-time normalization (`extensions/taskplane/persistence.ts:369-379`) and resume rehydration (`extensions/taskplane/resume.ts:615`). Add a concrete test intent/checklist item to validate that older state payloads load with `orchBranch: ""` and resume state keeps a defined value.

### Missing Items
- Explicit Step 4 pass/fail criteria mirroring `PROMPT.md:109-113`.
- A named compatibility verification for missing `orchBranch` in persisted v2 data (not just generic “schema defaults verified”).
- A targeted mention that Advanced-section exclusion for editable fields is verified via existing Settings TUI coverage (`extensions/tests/settings-tui.test.ts:1423-1435`, `1509-1519`).

### Suggestions
- Keep `npx vitest run` as the gate, but include a short triage note for failures pointing first to changed-surface suites (config loader, persistence/resume, settings-tui) to speed iteration.
- When Step 4 is done, record the exact command run and key assertion outcomes in `STATUS.md` for auditability.
