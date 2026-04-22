## Plan Review: Step 6: Testing & Verification

### Verdict: REVISE

### Summary
The Step 6 plan is close, but it currently underspecifies a few required verification outcomes from the prompt that are high risk for regressions in boundary handling and rewiring correctness. In `STATUS.md:78-83`, coverage is grouped well, but two prompt-required scenarios are not explicitly represented, making it easy to finish the step without validating them. Tightening those outcomes now will make Step 6 acceptance unambiguous.

### Issues Found
1. **[Severity: important]** — Missing explicit test outcome for **failed-origin segment discard behavior** (`PROMPT.md:140`). Current Step 6 items in `STATUS.md:78-83` do not clearly call out that requests from a failed boundary segment must be discarded (and not mutated/replayed). Suggested fix: add an explicit checkbox for failed-segment discard verification.
2. **[Severity: important]** — Two distinct DAG semantics from the prompt are not explicitly covered as outcomes: **deterministic ordering for multiple requests at the same boundary** (`PROMPT.md:139`) and **end placement with multiple terminals** (`PROMPT.md:144`). `STATUS.md:78-80` is broad enough to imply these, but not specific enough to guarantee they are tested. Suggested fix: add explicit Step 6 outcomes for both scenarios.

### Missing Items
- Explicit Step 6 outcome: failed segment boundary requests are discarded and do not mutate frontier state.
- Explicit Step 6 outcome: multiple same-boundary requests are applied in deterministic requestId order.
- Explicit Step 6 outcome: `placement: "end"` behavior with multiple current terminals is validated.

### Suggestions
- For clarity, separate “duplicate requestId” from rejection-only tests and label it as idempotency/no-op behavior (even if surfaced via a rejected file state), to align with the intent in `PROMPT.md:141`.
- Optional: add a checklist item for creating `extensions/tests/segment-expansion-engine.test.ts` (`PROMPT.md:134`) so Step 6 deliverables are traceable in STATUS.md.
