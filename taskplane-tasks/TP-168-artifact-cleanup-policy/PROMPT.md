# Task: TP-168 - Artifact Cleanup Policy

**Created:** 2026-04-12
**Size:** M

## Review Level: 2 (Plan and Code)

**Assessment:** Cleanup policy changes risk accidental data loss if scoping is wrong. Multiple artifact types affected. Needs careful validation.
**Score:** 4/8 — Blast radius: 1, Pattern novelty: 1, Security: 0, Reversibility: 2

## Canonical Task Folder

```
taskplane-tasks/TP-168-artifact-cleanup-policy/
├── PROMPT.md   ← This file (immutable above --- divider)
├── STATUS.md   ← Execution state (worker updates this)
├── .reviews/   ← Reviewer output (created by the orchestrator runtime)
└── .DONE       ← Created when complete
```

## Mission

Tighten artifact cleanup to prevent unbounded accumulation of telemetry, conversation logs, and verification snapshots (#296). Currently observed: 1.1GB in `.pi/telemetry/`, 100MB in conversation logs, 35 stale verification snapshots. The current cleanup only runs post-integrate (misses manual integration) and the preflight age sweep is too conservative (7 days, telemetry-only).

Changes needed:
1. Reduce telemetry age sweep from 7 days to 3 days
2. Include `.pi/verification/` and `.pi/worker-conversation-*.jsonl` in the age sweep
3. Add telemetry directory size cap (500MB) with oldest-first eviction
4. Clean up prior batch artifacts when a new batch starts

## Dependencies

- **None**

## Context to Read First

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

## Environment

- **Workspace:** `extensions/taskplane/`
- **Services required:** None

## File Scope

- `extensions/taskplane/cleanup.ts`
- `extensions/taskplane/extension.ts`
- `extensions/tests/cleanup*.test.ts`

## Steps

### Step 0: Preflight

- [ ] Read cleanup.ts — understand `cleanupPostIntegrate`, `sweepStaleArtifacts`, `runPreflightCleanup`
- [ ] Read extension.ts — where cleanup functions are called (post-integrate, preflight)
- [ ] Identify all artifact types and their current cleanup coverage
- [ ] Document findings in STATUS.md

### Step 1: Expand Age Sweep Scope

- [ ] Reduce telemetry age threshold from 7 days to 3 days in `sweepStaleArtifacts`
- [ ] Add `.pi/verification/` files to the age sweep
- [ ] Add `.pi/worker-conversation-*.jsonl` to the age sweep
- [ ] Add `.pi/lane-state-*.json` to the age sweep
- [ ] Run targeted tests

**Artifacts:**
- `extensions/taskplane/cleanup.ts` (modified)

### Step 2: Add Size Cap and Batch-Start Cleanup

- [ ] Add telemetry directory size cap (500MB default) — delete oldest files first until under cap
- [ ] Wire size cap check into preflight cleanup (runs on `/orch` start)
- [ ] Add cleanup of prior completed batch artifacts when a new batch starts
- [ ] Make thresholds configurable or clearly documented as constants
- [ ] Run targeted tests

**Artifacts:**
- `extensions/taskplane/cleanup.ts` (modified)
- `extensions/taskplane/extension.ts` (modified — batch-start cleanup hook)

### Step 3: Testing & Verification

- [ ] Run FULL test suite: `cd extensions && node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test tests/*.test.ts`
- [ ] Fix all failures
- [ ] Add tests: age sweep covers all artifact types
- [ ] Add tests: size cap eviction deletes oldest first
- [ ] Add tests: batch-start cleanup removes prior batch artifacts

### Step 4: Documentation & Delivery

- [ ] Update docs/how-to/configure-task-orchestrator.md if cleanup is configurable
- [ ] Discoveries logged in STATUS.md

## Documentation Requirements

**Must Update:**
- None (cleanup is internal behavior)

**Check If Affected:**
- `docs/how-to/configure-task-orchestrator.md` — if cleanup thresholds become configurable

## Completion Criteria

- [ ] All steps complete
- [ ] Telemetry aged out at 3 days (not 7)
- [ ] All artifact types swept (telemetry, verification, conversations, lane-state)
- [ ] Size cap enforced on telemetry directory
- [ ] All tests passing

## Git Commit Convention

- **Step completion:** `fix(TP-168): complete Step N — description`
- **Tests:** `test(TP-168): description`
- **Hydration:** `hydrate: TP-168 expand Step N checkboxes`

## Do NOT

- Delete artifacts from the currently active batch
- Change the post-integrate cleanup behavior (only add new cleanup triggers)
- Make cleanup blocking on `/orch` start (should be fast and non-fatal)
- Skip tests
- Commit without the task ID prefix in the commit message

---

## Amendments (Added During Execution)

