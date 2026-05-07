## Plan Review: Step 1: Plan all three sub-fix designs

### Verdict: REVISE

### Summary
The plan is strong on file-level discovery and correctly identifies the real integration surfaces for `supervisor_takeover`, no-progress fallback messaging, and post-abort resume behavior. The #538 design also correctly recognizes that outbox draining alone cannot solve alerts already in transit to the supervisor. However, the current alert-suppression lifecycle is under-specified in a way that would likely suppress legitimate alerts after recovery.

### Issues Found
1. **[Severity: important]** — `terminatedLanes` / `terminatedAgents` are only described as resetting on **new batch start** (STATUS.md lines 55–58), while `supervisor_takeover` explicitly marks **all active agents as terminated** and recommends `orch_resume` as a next step (lines 65–67). That creates a likely false-negative path where resumed lanes continue running but their future alerts are permanently dropped for the rest of the same batch. **Suggested fix:** define a clear lifecycle for suppression state (e.g., clear on `orch_resume`, or scope suppression by cutoff timestamp so only pre-takeover backlog is dropped).
2. **[Severity: minor]** — Step 2 checkbox text still says `supervisor_takeover` is registered in `agent-bridge-extension.ts` (line 112), while this Step 1 design correctly places it in `extension.ts` (line 62). Leaving this mismatch risks execution drift. **Suggested fix:** align Step 2 checklist wording to the chosen design surface.

### Missing Items
- Explicit reset/unmute policy for the zombie-alert filter during same-batch recovery (`orch_resume`, lane relaunch, or explicit takeover exit).

### Suggestions
- Consider timestamp-based filtering (`drop alerts older than takeoverTs for affected lane/agent`) instead of static lane/agent blacklists; this tends to be safer for pause/resume cycles.
