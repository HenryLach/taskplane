## Plan Review: Step 5: Sparse project config in taskplane init

### Verdict: REVISE

### Summary
The plan is close, but it currently misses one required outcome from the task prompt: handling init-time **explicit orchestrator overrides**. As written in `STATUS.md`, Step 5 covers sparse base fields, removing agent settings, and backward compatibility, but it does not specify how user-chosen init overrides (e.g., max lanes) are preserved without reintroducing full config writes.

### Issues Found
1. **[Severity: important]** — Missing required outcome for explicit init overrides. The prompt requires: “Orchestrator settings NOT included unless explicitly chosen during init” (`PROMPT.md:164`), but the Step 5 plan only lists three items (`STATUS.md:63-65`) and omits this behavior. Without this, implementation may either (a) drop user-selected init overrides or (b) keep writing orchestrator defaults, both of which violate sparse-override semantics.

### Missing Items
- Add a Step 5 outcome explicitly covering: detect init-time explicit overrides and persist only those override keys in `.pi/taskplane-config.json`.
- Define what counts as “explicitly chosen during init” (e.g., non-default prompt responses / explicit flags) so behavior is deterministic.

### Suggestions
- Consider a small UX guard: if init still asks for agent model/thinking values in this step, ensure those choices are either routed to global preferences or clearly messaged as not project-persisted to avoid user confusion.
- Add one targeted assertion in Step 6 for this step’s behavior: default init writes no orchestrator block, but an explicit init override writes only that specific orchestrator key.
