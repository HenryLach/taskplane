## Plan Review: Step 1: Periodic context % refresh in agent-host

### Verdict: REVISE

### Summary
The Step 1 plan captures the main direction (move from one-shot stats to periodic refresh) and correctly keeps `contextUsage` update handling in the existing response path. However, two prompt-level constraints are not explicitly carried into the step checklist: preserving the fast initial stats request and defining a non-aggressive refresh cadence. Without those, implementation could satisfy “more than once” while still regressing first-update latency or adding unnecessary Pi overhead.

### Issues Found
1. **[Severity: important]** — `STATUS.md` Step 1 (lines 22–24) does not explicitly require preserving the initial fast `get_session_stats` request, even though this is a stated requirement in `PROMPT.md` line 87. Add a Step 1 checklist item such as: “Keep immediate first request on first assistant `message_end`, then apply periodic refresh.”
2. **[Severity: important]** — `STATUS.md` line 23 leaves cadence open-ended (“every N turns or on timer”) and Step 3 only checks “requested more than once” (line 36). This can pass while being too aggressive (violating `PROMPT.md` line 88) or too sparse. Add an explicit cadence target and test intent that validates both periodic behavior and bounded frequency.

### Missing Items
- Explicit outcome: retain initial stats request for fast first context update.
- Explicit risk mitigation: fixed/defined refresh cadence to avoid overhead spikes.
- Explicit test intent: assert both initial request behavior and periodic follow-up behavior (not only “>1 request”).

### Suggestions
- Prefer a deterministic turn-based cadence (e.g., every 5 assistant `message_end` events after the first request) unless there is a clear need for a timer; it is easier to test and less sensitive to clock/timer edge cases.
