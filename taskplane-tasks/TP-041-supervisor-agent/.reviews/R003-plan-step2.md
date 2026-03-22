## Plan Review: Step 2: Lockfile + Session Takeover

### Verdict: REVISE

### Summary
The Step 2 plan captures the core lockfile lifecycle (create, heartbeat, startup check, takeover, cleanup), but it is missing two outcome-level requirements that are explicitly called out in the task prompt/spec. Without those, the implementation can drift into false-positive lock conflicts and incomplete crash recovery behavior. Add those outcomes to the plan before implementation.

### Issues Found
1. **Severity: important** — The plan does not explicitly include the startup gate "active non-terminal batch first, then lockfile check" (spec 13.10 startup behavior). Current Step 2 wording in `STATUS.md` only says "Startup detection (live vs stale lockfile)" (`STATUS.md:40`), which can lead to lock handling being applied even when no active batch exists. **Suggested fix:** add an explicit outcome to check `.pi/batch-state.json` phase first and skip supervisor-lock takeover logic when batch is terminal/absent.
2. **Severity: important** — The stale-lock takeover path is missing explicit rehydration from supervisor history. Prompt requires: "If pid dead → take over, reconstruct from audit trail" (`PROMPT.md:95`), but Step 2 checklist doesn’t state reconstruction from `actions.jsonl`/`events.jsonl` and operator summary. **Suggested fix:** add a takeover rehydration outcome (read batch state + actions/events + summarize "what happened since you left").

### Missing Items
- Explicit startup sequencing: active batch detection before lockfile arbitration.
- Explicit stale-supervisor rehydration and handoff summary after takeover.

### Suggestions
- Add one non-blocking resilience note for malformed/corrupt `lock.json` (treat as stale + rewrite) to preserve recoverability.
- Keep lockfile writes atomic (temp file + rename) to reduce heartbeat race/corruption risk.
- Minor STATUS consistency fix: top-level `**Status:** ✅ Complete` (`STATUS.md:4`) conflicts with Step 2 being in progress (`STATUS.md:37`).
