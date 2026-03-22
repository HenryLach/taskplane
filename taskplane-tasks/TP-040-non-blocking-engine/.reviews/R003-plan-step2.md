## Plan Review: Step 2: Make Engine Non-Blocking

### Verdict: REVISE

### Summary
The Step 2 plan captures the core direction (detach `/orch` from `await executeOrchBatch()` and keep widget updates callback-driven), and it aligns with the TP-040 mission. However, it is missing one critical risk mitigation for fire-and-forget execution and one important scope item already identified in preflight. Without those, the non-blocking transition can leave runtime failures unobserved and partially preserve the old blocking behavior.

### Issues Found
1. **[Severity: critical]** — The plan does not include an explicit async error boundary for detached engine execution. If `/orch` (or `/orch-resume`) is switched to fire-and-forget without `.catch(...)`/finalization handling, rejected promises can become unhandled, potentially crashing/log-spamming and leaving batch state visibility inconsistent. **Suggested fix:** add a launch wrapper in `extensions/taskplane/extension.ts` that starts the promise without awaiting but always attaches `catch` logic to set phase/error, notify operator, and refresh widget.
2. **[Severity: important]** — Step 2 planning scope does not explicitly include making `/orch-resume` non-blocking, even though STATUS preflight calls out `await resumeOrchBatch()` as a second blocking path and the architecture notes say it needs the same treatment. **Suggested fix:** include `/orch-resume` in this step’s implementation plan (or explicitly defer with a tracked checkbox tied to Step 3) so resume behavior is not accidentally left blocking.

### Missing Items
- Explicit handling for detached promise rejection/failure path (including operator notification + state/widget update).
- Explicit non-blocking treatment for `/orch-resume` (or a documented defer plan with owner step).

### Suggestions
- Prefer a small `startBatchAsync(...)`/`startResumeAsync(...)` helper to avoid duplicating fire-and-forget + error handling patterns.
- Update Step 2 checkbox wording to focus on caller detachment in `extension.ts` (the wave loop can remain internally async/await-driven).
