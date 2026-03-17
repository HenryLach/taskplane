## Plan Review: Step 0: Preflight

### Verdict: REVISE

### Summary
The current Step 0 plan is too thin to de-risk implementation: it has a single generic checkbox and does not define what “confirm path convention” means in practice. The core requirement is clear in the prompt, but the plan should explicitly lock the path-resolution contract before Step 1 starts so preferences loading doesn’t hardcode an incorrect location.

### Issues Found
1. **Severity: important** — Step 0 is not sufficiently hydrated for a preflight gate. `STATUS.md:20` only says “Confirm path convention,” but does not specify evidence or acceptance output (e.g., exact resolved path rules and fallback behavior) for the requirement in `PROMPT.md:54`.
2. **Severity: important** — The plan does not account for pi’s configurable agent root. Pi supports `PI_CODING_AGENT_DIR` as an override for the default `~/.pi/agent` (`pi-coding-agent/README.md:561`). If Step 1 proceeds with a hardcoded `~/.pi/agent/taskplane/preferences.json`, custom agent-dir users will break.
3. **Severity: minor** — No explicit preflight check is listed to avoid confusion between project-scoped `.pi/agents/*` and user-scoped `~/.pi/agent/*` conventions (contrast in `settings-and-onboarding-spec.md:67` vs `settings-and-onboarding-spec.md:83-84`).

### Missing Items
- A concrete Step 0 outcome statement for path resolution contract (default + override + path join behavior).
- A recorded discovery/note in `STATUS.md` capturing the final convention decision for Step 1 implementation.
- A test-intent note that Step 2 must include path-resolution coverage for default and override cases.

### Suggestions
- Add 2–3 Step 0 checklist items in `STATUS.md` that explicitly confirm:
  - default location (`~/.pi/agent/taskplane/preferences.json`),
  - `PI_CODING_AGENT_DIR` override behavior,
  - how the resolved path will be reused by loader/write-back code.
- Include one short execution-log line with the finalized convention decision to make later review deterministic.
