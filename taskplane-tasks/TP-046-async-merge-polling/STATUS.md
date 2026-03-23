# TP-046: Async Merge Polling — Status

**Current Step:** Not Started
**Status:** 🔵 Ready for Execution
**Last Updated:** 2026-03-23
**Review Level:** 2
**Review Counter:** 0
**Iteration:** 0
**Size:** M

---

### Step 0: Preflight
**Status:** ⬜ Not Started
- [ ] Read waitForMergeResult polling loop
- [ ] Read mergeWave and mergeWaveByRepo
- [ ] Read engine.ts and resume.ts callers
- [ ] Identify all sleepSync call sites in merge.ts
- [ ] Read sleepSync implementation

---

### Step 1: Add Async Sleep Utility
**Status:** ⬜ Not Started
- [ ] Add sleepAsync to worktree.ts
- [ ] Keep sleepSync for non-merge callers

---

### Step 2: Convert waitForMergeResult to Async
**Status:** ⬜ Not Started
- [ ] Make waitForMergeResult async
- [ ] Replace sleepSync with sleepAsync in polling loop
- [ ] Preserve timeout/retry/grace period behavior

---

### Step 3: Convert mergeWave and Callers to Async
**Status:** ⬜ Not Started
- [ ] Make mergeWave async
- [ ] Update mergeWaveByRepo
- [ ] Update engine.ts callers
- [ ] Update resume.ts callers
- [ ] Convert spawnMergeAgent retry delays

---

### Step 4: Testing & Verification
**Status:** ⬜ Not Started
- [ ] Merge timeout tests pass
- [ ] Merge repo-scoped tests pass
- [ ] Cleanup resilience tests pass
- [ ] Full test suite passes

---

### Step 5: Documentation & Delivery
**Status:** ⬜ Not Started
- [ ] `.DONE` created

---

## Reviews

| # | Type | Step | Verdict | File |
|---|------|------|---------|------|

## Discoveries

| Discovery | Disposition | Location |
|-----------|-------------|----------|

## Execution Log

| Timestamp | Action | Outcome |
|-----------|--------|---------|
| 2026-03-23 | Task staged | PROMPT.md and STATUS.md created |

## Blockers

*None*

## Notes

*Reserved for execution notes*
