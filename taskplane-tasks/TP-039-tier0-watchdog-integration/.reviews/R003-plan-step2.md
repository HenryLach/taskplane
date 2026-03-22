## Plan Review: Step 2: Tier 0 Event Logging

### Verdict: REVISE

### Summary
The Step 2 checklist captures the broad goal (create supervisor log dir + emit JSONL events), but it is missing a few outcome-level requirements needed to satisfy the PROMPT and current engine shape. In particular, the plan does not explicitly cover merge-timeout retry events, required exhaustion payload content, or runtime-safe persistence semantics/pathing. Add these outcomes before implementation to avoid incomplete Tier 0 observability.

### Issues Found
1. **[Severity: important]** Missing explicit outcome for merge-timeout Tier 0 events.
   - Evidence: Step 2 plan in `taskplane-tasks/TP-039-tier0-watchdog-integration/STATUS.md:38-40` is generic, while merge timeout recovery runs through `applyMergeRetryLoop` (`extensions/taskplane/engine.ts:951`, `extensions/taskplane/messages.ts:701-776`).
   - Why this blocks: If instrumentation is added only to new TP-039 helpers (`attemptWorkerCrashRetry` / stale-worktree / cleanup-gate), merge-timeout retries can remain unlogged even though they are Tier 0 recovery actions.
   - Suggested fix: Add a plan outcome to emit `tier0_recovery_attempt/success/exhausted` for merge retry loop paths as well (likely via callback extension or wrapper at the `applyMergeRetryLoop` integration point).

2. **[Severity: important]** Required exhausted-event payload is not represented in the plan.
   - Evidence: PROMPT requires `tier0_recovery_exhausted` to include `pattern, final error, escalation context` (`PROMPT.md:82-85`), but Step 2 plan only says “attempts/success/exhaustion” + “full context” (`STATUS.md:39-40`).
   - Why this blocks: Without an explicit escalation-context outcome, implementation can pass local checkboxes while still missing required event schema content.
   - Suggested fix: Add a concrete Step 2 outcome that `tier0_recovery_exhausted` includes escalation-ready context fields (even if final `EscalationContext` typing is formalized in Step 3).

3. **[Severity: important]** Plan omits state-root pathing and non-fatal write behavior for event logging.
   - Evidence: Engine state files are rooted at workspace state root (`extensions/taskplane/engine.ts:354-356`), and persistence writes are intentionally non-fatal (`extensions/taskplane/persistence.ts:247-304`). Step 2 currently only says “Create .pi/supervisor/ directory” (`STATUS.md:38`).
   - Why this blocks: Writing under repoRoot in workspace mode or allowing append failures to throw can break operator visibility and batch continuity.
   - Suggested fix: Add an outcome that events are written under `stateRoot/.pi/supervisor/events.jsonl` and write failures are best-effort (logged, but do not crash/pause the batch).

### Missing Items
- Explicit merge-timeout (`applyMergeRetryLoop`) event emission coverage.
- Explicit `tier0_recovery_exhausted` schema requirement including escalation context.
- Explicit workspace-root path + non-fatal event-write semantics.

### Suggestions
- Define a small shared event schema/type (in `types.ts` or `persistence.ts`) now to keep Step 2 and Step 3 event payloads consistent.
- Prefer one event-writing utility in `persistence.ts` (append JSONL + ensure directory) to avoid ad-hoc file IO in multiple engine branches.
