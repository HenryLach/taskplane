# Task: TP-094 - Context Pressure and Telemetry Accuracy Fix

**Created:** 2026-03-29
**Size:** M

## Review Level: 2 (Plan and Code)

**Assessment:** Fixes a critical bug (#338) that has rendered the entire context pressure system non-functional since inception. Also adds context % snapshots for observability. High impact on worker reliability.
**Score:** 6/8 — Blast radius: 2, Pattern novelty: 1, Security: 0, Reversibility: 3

## Canonical Task Folder

```
taskplane-tasks/TP-094-context-pressure-telemetry-fix/
├── PROMPT.md   ← This file (immutable above --- divider)
├── STATUS.md   ← Execution state (worker updates this)
├── .reviews/   ← Reviewer output (task-runner creates this)
└── .DONE       ← Created when complete
```

## Mission

Fix the critical field name mismatch (#338) where pi sends `contextUsage.percent` but taskplane checks for `contextUsage.percentUsed`, causing all context pressure thresholds (85% wrap-up, 95% kill) to silently fail. Remove the manual token-based fallback calculation entirely — use pi's authoritative context % exclusively. Add context % snapshots at worker iteration boundaries (#340) for post-batch analysis.

## Dependencies

- **None**

## Context to Read First

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `extensions/task-runner.ts` — sidecar tailing `tailSidecarJsonl()` function, worker `onTelemetry` callback, context pressure thresholds
- `bin/rpc-wrapper.mjs` — `get_session_stats` response handling, `contextUsage` extraction

## Environment

- **Workspace:** `extensions/`, `bin/`
- **Services required:** None


## Execution Target

- **Repo:** taskplane
- **Submodule path:** `.pi/git/github.com/loopyd/taskplane`
- **Upstream URL:** `https://github.com/loopyd/taskplane.git`

> This task operates within the `taskplane` submodule. All file paths, git operations, and worktrees are scoped to this submodule's repository root.

## File Scope

- `extensions/task-runner.ts`
- `bin/rpc-wrapper.mjs`
- `extensions/tests/rpc-wrapper.test.ts`
- `extensions/tests/sidecar-tailing.test.ts`
- `extensions/tests/persistent-reviewer-context.test.ts`
- `extensions/taskplane/cleanup.ts`

## Steps

### Step 0: Preflight

- [ ] Verify the field name mismatch: read a real sidecar JSONL with `get_session_stats` response and confirm `percent` vs `percentUsed`
- [ ] Trace all code paths that read `contextUsage.percentUsed` — task-runner sidecar tailing, rpc-wrapper state, exit summary
- [ ] Identify the manual token fallback paths that must be removed

### Step 1: Fix field name mismatch in sidecar tailing

- [ ] In `tailSidecarJsonl()`: change `cu.percentUsed` to `cu.percent ?? cu.percentUsed` (backward compatible)
- [ ] In rpc-wrapper: verify `state.contextUsage` extraction uses correct field name
- [ ] Remove manual token-based context % fallback in the worker `onTelemetry` callback — use authoritative pi metric only
- [ ] If pi's authoritative metric is unavailable (older pi), log a warning and leave context % at 0 (no false thresholds)

**Artifacts:**
- `extensions/task-runner.ts` (modified)
- `bin/rpc-wrapper.mjs` (modified if needed)

### Step 2: Context % snapshots at iteration boundaries

- [ ] At worker iteration end (after `runWorker()` returns), write a JSONL snapshot line to `.pi/context-snapshots/{batchId}/{sessionName}.jsonl`
- [ ] Snapshot fields: iteration, contextPct, tokens, contextWindow, cost, toolCalls, timestamp, exitReason
- [ ] Create directory on first write (mkdirSync recursive)
- [ ] Best-effort write (non-fatal on failure)
- [ ] Add context-snapshots/ to batch artifact cleanup (same lifecycle as telemetry)

**Artifacts:**
- `extensions/task-runner.ts` (modified)
- `extensions/taskplane/cleanup.ts` (modified)

### Step 3: Testing & Verification

- [ ] Create or update tests confirming `percent` field is read correctly

> ZERO test failures allowed.

- [ ] Test: sidecar tailing extracts `percent` from real pi response format
- [ ] Test: manual fallback is NOT used when authoritative metric is available
- [ ] Test: context snapshot file is written at iteration boundary
- [ ] Run full suite: `cd extensions && node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test tests/*.test.ts`
- [ ] Fix all failures

### Step 4: Documentation & Delivery

- [ ] Log discoveries in STATUS.md
- [ ] Update inline code comments explaining the authoritative metric

## Documentation Requirements

**Must Update:**
- None (internal fix)

**Check If Affected:**
- `docs/specifications/taskplane/resilience-architecture.md`

## Completion Criteria

- [ ] Pi's authoritative `contextUsage.percent` is read correctly
- [ ] Manual token fallback removed from threshold decisions
- [ ] Context % snapshots written at iteration boundaries
- [ ] Context pressure wrap-up (85%) and kill (95%) trigger correctly
- [ ] All tests pass

## Git Commit Convention

- **Step completion:** `feat(TP-094): complete Step N — description`
- **Bug fixes:** `fix(TP-094): description`

## Do NOT

- Implement new supervisor tools (TP-096)
- Modify dashboard rendering (TP-096)
- Change context pressure thresholds (data-driven decision later)
- Skip full-suite tests

---

## Amendments (Added During Execution)

<!-- Workers add amendments here if issues discovered during execution. -->
