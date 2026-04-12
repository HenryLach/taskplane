## Plan Review: Step 2: Add Size Cap and Batch-Start Cleanup

### Verdict: APPROVE

### Summary
The revised Step 2 plan now covers all required outcomes from the prompt: telemetry size capping, batch-start preflight integration, prior completed batch artifact cleanup, and explicit threshold constants/documentation. It also includes the key safety guard (never delete active batch artifacts) and targeted test intent. This is sufficient to proceed without rework risk.

### Issues Found
None.

### Missing Items
- None.

### Suggestions
- Add one targeted test that forces cleanup errors (e.g., unreadable file) and confirms `/orch` start remains non-fatal and continues.
- In the Step 2 implementation notes, explicitly state whether thresholds are constants-only or config-backed so Step 4 docs check is unambiguous.
