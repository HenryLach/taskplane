## Plan Review: Step 1: Model registry access from CLI

### Verdict: APPROVE

### Summary
The Step 1 plan in `STATUS.md` covers the required outcomes from `PROMPT.md` for this phase: implementing a CLI model discovery helper, normalizing output to `{ provider, id, displayName }[]`, handling missing/unavailable model sources gracefully, and adding targeted tests. The scope is appropriate for a standalone foundational step before wiring interactive prompts in Step 2. I don’t see any blocking gaps that would force rework later.

### Issues Found
1. **[Severity: minor]** — The plan item "use `pi --list-models`" does not explicitly call out machine-readable output/contract stability. Prefer a structured output mode (if available) plus defensive parsing so the helper remains resilient to CLI text formatting changes.

### Missing Items
- None.

### Suggestions
- Add a subprocess timeout and non-zero-exit handling in the helper so init cannot hang if `pi` is slow/unavailable.
- In targeted tests, include malformed/partial output and empty-list cases (not just happy-path parsing) to verify graceful fallback behavior.
- Consider deterministic sorting/deduplication of returned models (`provider`, then `id`) so Step 2 picker ordering stays stable.
