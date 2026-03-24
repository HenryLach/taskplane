## Plan Review: Step 1: Register orchestrator tools

### Verdict: REVISE

### Summary
The Step 1 checklist is directionally correct (shared helpers + 5 tool registrations), but it is still underspecified in a few high-risk areas where behavior parity can easily drift from the existing slash commands. Given the blast radius (resume/abort/integrate lifecycle control), tighten the plan before implementation continues.

### Issues Found
1. **[Severity: important] `doOrchIntegrate` scope is under-defined and risks losing existing command behavior.**
   - Evidence:
     - Plan says helper “wraps `parseIntegrateArgs + resolveIntegrationContext + executeIntegration`” (`STATUS.md:31`).
     - Existing `/orch-integrate` behavior includes additional required logic: branch-protection warning, integration summary, workspace multi-repo selection, cleanup/acceptance report, and deferred supervisor summary/deactivation (`extensions/taskplane/extension.ts` in current baseline around lines `2393-2589`).
   - Risk: tool/command behavior drift, especially around cleanup and supervisor lifecycle.
   - Suggested fix: explicitly define helper boundary as “full integrate flow parity” (all post-parse steps), not just parse+resolve+execute.

2. **[Severity: important] No explicit mapping contract for tool params vs existing integrate internals.**
   - Evidence:
     - Prompt requires tool `mode`: `"fast-forward" | "merge" | "pr"` (`PROMPT.md:86`).
     - Existing internal integrate mode uses `"ff" | "merge" | "pr"` (`extensions/taskplane/extension.ts:77-83`).
   - Risk: schema/behavior mismatch or silent mode errors.
   - Suggested fix: add a Step 1 checklist item for deterministic mapping (`fast-forward -> ff`), defaulting, and branch passthrough rules for tool→helper conversion.

3. **[Severity: important] Resume tool return semantics are not explicit for async launch behavior.**
   - Evidence:
     - Plan says `doOrchResume` “returns status message, calls `startBatchAsync` internally” (`STATUS.md:29`).
     - Existing resume flow is fire-and-forget and emits later updates through notify callbacks (`extensions/taskplane/extension.ts` baseline around `1845+`).
   - Risk: ambiguous tool result contract (immediate ACK vs final outcome), which can confuse supervisor actions.
   - Suggested fix: explicitly state that tool returns **immediate initiation/guard result only**; downstream resume progress remains asynchronous.

### Missing Items
- Explicit “register tools unconditionally” checklist item (required by `PROMPT.md:109-110`).
- Explicit severity/level contract for shared helper returns (e.g., `{ text, level }`) so command notifications and tool text stay consistent.

### Suggestions
- Use a small shared reporter pattern (`emit(text, level)`) so command handlers can notify and tools can accumulate text without duplicating orchestration logic.
- Add one Step 3 parity test intent: existing slash commands still call the same shared helpers (to prevent command regressions while adding tools).