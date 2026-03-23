## Plan Review: Step 1: /orch Routing Logic

### Verdict: REVISE

### Summary
The plan captures the high-level intent (state detection, routing, and preserving `/orch` with args), but it currently misses one required routing outcome and a key failure mode that can cause incorrect entry-point behavior. In particular, the Step 1 checklist is too coarse to guarantee the no-args decision tree required by the prompt. Tightening the outcome-level checks now will prevent rework in implementation and tests.

### Issues Found
1. **[Severity: important]** — The plan does not explicitly include the **"completed batch needs integration"** branch required by the task prompt (`PROMPT.md:75`). `STATUS.md` Step 1 only lists `config, batch, tasks` detection (`STATUS.md:23-25`), which can skip the integration-offer route.  
   **Suggested fix:** Add an explicit Step 1 outcome for detecting a completed batch with an existing orch branch and routing to the integration conversation.

2. **[Severity: important]** — The plan does not call out how to distinguish **"no config exists"** from **"defaults loaded"**. In this codebase, config loaders return defaults when files are absent, so checking loaded config objects alone will not reliably trigger onboarding.  
   **Suggested fix:** Add a Step 1 outcome to detect actual config-file presence (JSON-first path resolution), not just successful config load.

3. **[Severity: important]** — Routing precedence is unspecified. Without explicit ordering, overlapping states (e.g., active batch + pending tasks, or completed batch + pending tasks) can route incorrectly.  
   **Suggested fix:** Add a decision-order outcome for no-args `/orch` (active batch → completed needs integration → onboarding/no-config → pending tasks → no tasks), including handling unreadable/corrupt persisted state without crashing.

### Missing Items
- Explicit Step 1 outcome for **completed-but-not-integrated** state routing.
- Explicit Step 1 outcome for **real config existence detection** (file presence, not default config object presence).
- Explicit Step 1 outcome for **routing precedence / tie-break order** across all no-args states.

### Suggestions
- Reuse existing state/disk semantics helpers where possible so no-args routing stays consistent with current `/orch`/resume lifecycle behavior.
- Keep the with-args code path as an early return to existing execution flow to minimize regression risk.
