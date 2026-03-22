# Task: TP-038 — Merge Timeout Resilience

**Created:** 2026-03-21
**Size:** S

## Review Level: 1 (Plan Only)

**Assessment:** Targeted improvements to merge timeout handling. Well-scoped changes in merge.ts. Low blast radius.
**Score:** 2/8 — Blast radius: 1, Pattern novelty: 0, Security: 0, Reversibility: 1

## Canonical Task Folder

```
taskplane-tasks/TP-038-merge-timeout-resilience/
├── PROMPT.md   ← This file
├── STATUS.md   ← Execution state
├── .reviews/   ← Reviewer output
└── .DONE       ← Created when complete
```

## Mission

Fix two merge timeout issues discovered during the v0.6.0 batch run:

1. **Check merge result before killing:** When the merge agent times out, the
   current code kills the session immediately. But the merge may have actually
   succeeded — the verification tests just pushed past the timeout. Before
   killing, check if the merge result JSON file exists with `status: SUCCESS`.

2. **Re-read config before retry:** When retrying a merge after timeout, use
   fresh config from disk (not the cached session config). This allows the
   operator to increase `merge.timeoutMinutes` without restarting the pi session.

Also add merge retry with backoff: on timeout, retry with 2x the timeout (up to
a configured maximum of 2 retries).

## Dependencies

- **None**

## Context to Read First

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `docs/specifications/taskplane/watchdog-and-recovery-tiers.md` — Section 5.2 Pattern 1, Section 7.4, Section 13.1
- `extensions/taskplane/merge.ts` — `waitForMergeResult()` and merge agent timeout logic

## Environment

- **Workspace:** `extensions/taskplane/`
- **Services required:** None

## File Scope

- `extensions/taskplane/merge.ts`
- `extensions/tests/transactional-merge.test.ts`

## Steps

### Step 0: Preflight

- [ ] Read `waitForMergeResult()` — understand timeout and kill logic
- [ ] Read how `merge.timeoutMinutes` is loaded and passed through
- [ ] Read the spec Pattern 1 for the full retry flow

### Step 1: Check Result Before Kill + Config Reload

- [ ] Before killing the merge agent on timeout, check if the merge result JSON file exists and contains `status: SUCCESS`
- [ ] If result exists with SUCCESS: accept it, log "merge agent slow but succeeded", return success
- [ ] If result missing or FAILURE: proceed with kill as before
- [ ] On retry: re-read `merge.timeoutMinutes` from config file on disk (not cached config)

**Artifacts:**
- `extensions/taskplane/merge.ts` (modified)

### Step 2: Add Retry with Backoff

- [ ] On merge timeout (after kill): retry with 2x the original timeout
- [ ] Maximum retries: 2 (configurable via retry budget)
- [ ] Log each retry attempt with the new timeout value
- [ ] If all retries exhausted: return failure as before (engine handles escalation)

**Artifacts:**
- `extensions/taskplane/merge.ts` (modified)

### Step 3: Testing & Verification

> ZERO test failures allowed.

- [ ] Test: merge result exists at timeout → accepted without kill
- [ ] Test: no merge result at timeout → kill and retry with 2x timeout
- [ ] Test: retry also times out → second retry with 4x timeout
- [ ] Test: all retries exhausted → failure returned
- [ ] Test: config re-read on retry picks up new timeout value
- [ ] Run full test suite: `cd extensions && npx vitest run`
- [ ] Fix all failures

### Step 4: Documentation & Delivery

- [ ] `.DONE` created in this folder

## Documentation Requirements

**Must Update:**
- None (internal behavior improvement)

**Check If Affected:**
- `docs/reference/configuration/task-orchestrator.yaml.md` — if merge retry config is user-facing

## Completion Criteria

- [ ] All steps complete
- [ ] All tests passing
- [ ] Succeeded merges not killed on timeout
- [ ] Config re-read on retry
- [ ] Retry with backoff works
- [ ] `.DONE` created

## Git Commit Convention

- **Step completion:** `feat(TP-038): complete Step N — description`
- **Bug fixes:** `fix(TP-038): description`
- **Tests:** `test(TP-038): description`
- **Hydration:** `hydrate: TP-038 expand Step N checkboxes`

## Do NOT

- Modify resume logic (that's TP-037)
- Modify the engine's wave loop (that's TP-039)
- Change the merge agent prompt or merge flow — only the timeout/retry handling

---

## Amendments (Added During Execution)
