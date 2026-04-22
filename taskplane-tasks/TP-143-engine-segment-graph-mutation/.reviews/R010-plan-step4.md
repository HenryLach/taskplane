## Plan Review: Step 4: Persistence and supervisor alerts

### Verdict: REVISE

### Summary
The Step 4 checklist is close to the prompt goals, but it currently leaves out two execution-critical persistence outcomes and one required test-planning item. As written, implementation could mark requests `.processed` without a crash-safe persisted audit trail, which risks irrecoverable expansion loss on interruption. Tightening the plan now will prevent rework in Step 5/resume validation.

### Issues Found
1. **[Severity: important]** — The Step 4 plan in `STATUS.md:56-61` does not explicitly include persisting expansion provenance on each new `PersistedSegmentRecord` (`expandedFrom`, `expansionRequestId`), even though this is called out in the task artifacts (`PROMPT.md:118`) and spec persistence schema (`docs/specifications/taskplane/dynamic-segment-expansion.md:512-526`). Suggested fix: add an explicit Step 4 outcome for writing these fields when inserting new segment records.
2. **[Severity: important]** — The plan lists persist/alert/rename as separate bullets but does not capture crash-safe ordering/atomicity (persisted state + idempotency record before final `.processed` rename). Spec requires atomic persistence semantics before completion lifecycle (`docs/specifications/taskplane/dynamic-segment-expansion.md:291-304`). Suggested fix: add an explicit outcome that approval path writes batch state/idempotency audit durably before marking request file `.processed`.
3. **[Severity: important]** — Step 4 in `STATUS.md` omits the required targeted-test intent from `PROMPT.md:113`. Suggested fix: add a Step 4 test-intent item covering approval persistence (segments[], task.segmentIds[], requestId tracking), `.processed` transition, and alert payload content.

### Missing Items
- Explicit Step 4 outcome: persist `expandedFrom` and `expansionRequestId` on newly added `PersistedSegmentRecord` rows.
- Explicit Step 4 outcome: crash-safe approval transaction ordering (durable state/idempotency before `.processed`).
- Explicit Step 4 targeted-test intent (at least one approval-path persistence + lifecycle smoke).

### Suggestions
- In the `segment-expansion-approved` alert outcome, explicitly include before/after segment lists in the checklist text (the prompt requires this), so payload completeness is not left implicit.
- Keep this approval flow in the same boundary-processing path introduced in earlier steps to preserve deterministic ordering and file-lifecycle handling.