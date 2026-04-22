# Task: TP-039 — Tier 0 Watchdog Engine Integration

**Created:** 2026-03-21
**Size:** M

## Review Level: 2 (Plan and Code)

**Assessment:** Wires recovery patterns into the engine's execution loop. Touches core wave lifecycle. Must not break happy path.
**Score:** 5/8 — Blast radius: 2, Pattern novelty: 1, Security: 0, Reversibility: 2

## Canonical Task Folder

```
taskplane-tasks/TP-039-tier0-watchdog-integration/
├── PROMPT.md   ← This file
├── STATUS.md   ← Execution state
├── .reviews/   ← Reviewer output
└── .DONE       ← Created when complete
```

## Mission

Integrate Tier 0 watchdog recovery patterns into the engine's execution loop.
The retry matrix (from TP-033) and partial progress preservation (from TP-028)
exist as code, but the engine doesn't USE them automatically yet. Wire them in
so that merge timeouts, session crashes, and stale worktrees trigger automatic
recovery without pausing the batch. Add Tier 0 event logging to
`.pi/supervisor/events.jsonl` and an escalation interface for the future
supervisor agent.

## Dependencies

- **Task:** TP-037 (resume bugs must be fixed — Tier 0 builds on correct resume logic)
- **Task:** TP-038 (merge timeout retry must work — Tier 0 uses it)

## Context to Read First

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `docs/specifications/taskplane/watchdog-and-recovery-tiers.md` — Sections 5.1-5.4, 9.1
- `extensions/taskplane/engine.ts` — wave loop, merge invocation, cleanup
- `extensions/taskplane/types.ts` — retry budget types, escalation context

## Environment

- **Workspace:** `extensions/taskplane/`
- **Services required:** None


## Execution Target

- **Repo:** taskplane
- **Submodule path:** `.pi/git/github.com/loopyd/taskplane`
- **Upstream URL:** `https://github.com/loopyd/taskplane.git`

> This task operates within the `taskplane` submodule. All file paths, git operations, and worktrees are scoped to this submodule's repository root.

## File Scope

- `extensions/taskplane/engine.ts`
- `extensions/taskplane/types.ts`
- `extensions/taskplane/persistence.ts`
- `extensions/tests/tier0-watchdog.test.ts` (new)

## Steps

### Step 0: Preflight

- [ ] Read engine.ts wave loop — identify where merge failures, session crashes, and cleanup failures are currently handled
- [ ] Read the retry matrix from TP-033 — understand how retry counters are stored and checked
- [ ] Read the partial progress code from TP-028 — understand saved branch creation
- [ ] Read spec Sections 5.1-5.4 for the full Tier 0 design

### Step 1: Wire Automatic Recovery into Engine

- [ ] On merge timeout: instead of immediately pausing, invoke the merge retry logic (from TP-038) automatically
- [ ] On worker session crash: check for partial progress (commits on lane branch), save branch if found, classify exit, retry if classification is retryable
- [ ] On stale worktree blocking provisioning: force cleanup + prune + retry before failing
- [ ] On post-merge cleanup failure: retry once, then pause with wave gate (block next wave)
- [ ] Persist retry counters in batch state after each attempt

**Artifacts:**
- `extensions/taskplane/engine.ts` (modified)

### Step 2: Tier 0 Event Logging

- [ ] Create `.pi/supervisor/` directory if needed
- [ ] Write structured JSONL events to `.pi/supervisor/events.jsonl` for each Tier 0 action:
  - `tier0_recovery_attempt` — pattern, attempt number, timeout
  - `tier0_recovery_success` — pattern, resolution
  - `tier0_recovery_exhausted` — pattern, final error, escalation context
- [ ] Include timestamp, batchId, waveIndex, laneNumber, repoId in each event

**Artifacts:**
- `extensions/taskplane/engine.ts` (modified)
- `extensions/taskplane/persistence.ts` (modified — event writing utility)

### Step 3: Escalation Interface

- [ ] Define `EscalationContext` interface in types.ts (pattern, attempts, lastError, affectedTasks, suggestion)
- [ ] When Tier 0 exhausts retries, emit a `tier0_escalation` event with full context
- [ ] For now, escalation falls through to the existing pause behavior (the supervisor will consume these events in TP-041)

**Artifacts:**
- `extensions/taskplane/types.ts` (modified)
- `extensions/taskplane/engine.ts` (modified)

### Step 4: Testing & Verification

> ZERO test failures allowed.

- [ ] Test: merge timeout triggers automatic retry (not immediate pause)
- [ ] Test: retry exhaustion pauses batch with escalation event
- [ ] Test: worker crash with commits saves branch and records partial progress
- [ ] Test: stale worktree cleaned and provisioning retried
- [ ] Test: events written to .pi/supervisor/events.jsonl with correct schema
- [ ] Test: happy path (no failures) unaffected — no events logged, no retries
- [ ] Run full test suite: `cd extensions && npx vitest run`
- [ ] Fix all failures

### Step 5: Documentation & Delivery

- [ ] `.DONE` created in this folder

## Documentation Requirements

**Must Update:**
- None (internal engine behavior)

**Check If Affected:**
- `docs/explanation/architecture.md` — if Tier 0 mentioned in architecture overview

## Completion Criteria

- [ ] All steps complete
- [ ] All tests passing
- [ ] Engine automatically retries merge timeouts and session crashes
- [ ] Tier 0 events logged to .pi/supervisor/events.jsonl
- [ ] Escalation context emitted when retries exhausted
- [ ] Happy path unaffected
- [ ] `.DONE` created

## Git Commit Convention

- **Step completion:** `feat(TP-039): complete Step N — description`
- **Bug fixes:** `fix(TP-039): description`
- **Tests:** `test(TP-039): description`
- **Hydration:** `hydrate: TP-039 expand Step N checkboxes`

## Do NOT

- Make the engine non-blocking (that's TP-040)
- Implement supervisor agent logic (that's TP-041)
- Change the merge flow itself (that's TP-038)
- Change resume logic (that's TP-037)

---

## Amendments (Added During Execution)
