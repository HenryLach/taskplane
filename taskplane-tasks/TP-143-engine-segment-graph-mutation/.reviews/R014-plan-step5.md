## Plan Review: Step 5: Resume compatibility

### Verdict: REVISE

### Summary
The Step 5 plan is directionally correct, but it is currently missing one required outcome from the prompt and underspecifies resume/idempotency verification in a way that can allow subtle regressions. In `STATUS.md:67-71`, the checklist is shorter than the required Step 5 outcomes in `PROMPT.md:120-125`. Tightening the plan now will reduce risk of resume drift and duplicate expansion processing after restart.

### Issues Found
1. **[Severity: important]** — The plan omits the explicit prompt requirement that expanded segments be **indistinguishable from original segments after persistence/resume** (`PROMPT.md:122`). `STATUS.md:69-71` currently says “resume reconstructs expanded segments,” but does not explicitly capture field/lifecycle parity (dependency edges, status transitions, active/pending selection, and persisted segment metadata continuity). Suggested fix: add a dedicated Step 5 outcome for parity verification of expanded vs original segment behavior after resume.
2. **[Severity: important]** — Step 5 does not include explicit targeted test intent (required by `PROMPT.md:125`) and the idempotency item is too broad to guarantee the specific resume scenario in `PROMPT.md:124` (processed request files must not be replayed). Suggested fix: add explicit Step 5 test-intent outcomes for (a) approved-but-unexecuted expansion resuming as pending/executable, and (b) resume with already-processed request files proving idempotency guard blocks reprocessing.

### Missing Items
- Explicit Step 5 outcome: expanded segments are reconstructed with full behavior parity to original segments after resume (not just present in state).
- Explicit Step 5 targeted-test intent for resume-specific idempotency/file-lifecycle replay scenarios.

### Suggestions
- Since Step 4 added persisted idempotency/provenance safeguards, explicitly call out that Step 5 validates those persisted records are what drive resume idempotency (not mailbox filename state alone).
- Consider one targeted scenario covering multi-request same boundary + resume to ensure the Step 4 R012 persistence resync remains correct after reconstruction.
