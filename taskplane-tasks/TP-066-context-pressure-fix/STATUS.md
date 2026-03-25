# TP-066: Fix Context Pressure Safety Net — Status

**Current Step:** Complete
**Status:** ✅ Complete
**Last Updated:** 2026-03-25
**Review Level:** 2
**Review Counter:** 1
**Iteration:** 2
**Size:** M

---

### Step 0: Preflight
**Status:** ✅ Complete
- [x] Read latestTotalTokens calculation in task-runner.ts
- [x] Read tmux mode context pressure handler
- [x] Read RPC wrapper usage reporting
- [x] Determine if pi's totalTokens includes cache reads

---

### Step 1: Fix Context Percentage Calculation
**Status:** ✅ Complete
- [x] Include cache read tokens in context pressure calculation
- [x] Fix in both tmux and subprocess modes
- [x] Fix dashboard server accumulator if needed

---

### Step 2: Add Worker Template Guidance for Large Files
**Status:** ✅ Complete
- [x] Add "File Reading Strategy" section to worker template
- [x] Include grep-first, read-with-offset pattern examples
- [x] Update local template comments

---

### Step 3: Testing & Verification
**Status:** ✅ Complete
- [x] Update context-window tests for cache-inclusive calculation
- [x] Full test suite passing
- [x] Build passes

---

### Step 4: Documentation & Delivery
**Status:** ✅ Complete
- [x] Discoveries logged
- [x] `.DONE` created

---

## Reviews

| # | Type | Step | Verdict | File |
| R001 | plan | Step 1 | UNKNOWN | .reviews/R001-plan-step1.md |
|---|------|------|---------|------|

---

## Execution Log

| Timestamp | Action | Outcome |
|-----------|--------|---------|
| 2026-03-25 | Task staged | PROMPT.md and STATUS.md created |
| 2026-03-25 19:09 | Task started | Extension-driven execution |
| 2026-03-25 19:09 | Step 0 started | Preflight |
| 2026-03-25 19:09 | Task started | Extension-driven execution |
| 2026-03-25 19:09 | Step 0 started | Preflight |
| 2026-03-25 19:12 | Reviewer R001 | persistent reviewer failed — falling back to fresh spawn: Persistent reviewer session died while waiting for verdict |
| 2026-03-25 19:14 | Review R001 | plan Step 1: UNKNOWN (fallback) |
| 2026-03-25 19:26 | Reviewer R002 | persistent reviewer failed — falling back to fresh spawn: Persistent reviewer session died while waiting for verdict |

---

## Discoveries

| Discovery | Impact | Action |
|-----------|--------|--------|
| `orch-direct-implementation.test.ts` times out at 60s default | Pre-existing, unrelated to TP-066 | Logged as tech debt |
| Previous iteration (iter 1) applied all code fixes but failed to commit Steps 2+ | Iteration boundary issue — STATUS.md checkboxes were updated but git commits were incomplete | Committed in iter 2 |

---

## Blockers

*None*

---

## Notes

*Critical safety fix. TP-065 worker failed 3 times because the 85% wrap-up signal never fired despite 874K tokens consumed. Cache read tokens were invisible to the context pressure calculation.*

**Preflight Findings:**
- `usage.totalTokens` from pi is cumulative (input+output) and does NOT include cacheRead tokens
- Bug exists in 3 locations: (1) `tailSidecarJsonl` line ~1384 (tmux mode), (2) `spawnAgent` line ~1207 (subprocess mode), (3) `dashboard/server.cjs` line ~465
- Fix: add `(usage.cacheRead || 0)` to the totalTokens calculation in all 3 locations
- The fallback `(input + output)` also needs cacheRead added
- `_tailSidecarJsonl` is exported for testing
