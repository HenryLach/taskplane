# TP-112: Runtime V2 Resume and Monitor De-TMUX Parity — Status

**Current Step:** Step 5 — Documentation & Delivery
**Status:** ✅ Complete
**Last Updated:** 2026-03-31
**Review Level:** 3
**Review Counter:** 2
**Iteration:** 2
**Size:** L

---

### Step 0: Preflight mapping
**Status:** ✅ Complete

- [x] Enumerate Runtime V2 TMUX dependencies in resume/monitor paths
- [x] Separate legacy-only vs V2-critical dependencies
- [x] Record migration contract in STATUS.md

---

### Step 1: Resume path de-TMUX for V2
**Status:** ✅ Complete

- [x] Replace V2 reconnect/re-exec TMUX dependency chain
- [x] Keep legacy fallback behavior where required
- [x] Validate resumed task outcomes and persistence parity

---

### Step 2: Monitor path de-TMUX for V2
**Status:** ✅ Complete

- [x] Make monitoring/liveness checks backend-aware
- [x] Use registry/snapshot/event signals for V2 liveness
- [x] Preserve status transition semantics

---

### Step 3: Recovery and policy parity
**Status:** ✅ Complete

- [x] Validate stop-wave/skip-dependents/stop-all semantics
- [x] Validate pause/abort/resume behavior
- [x] Validate retry/escalation parity

---

### Step 4: Testing & verification
**Status:** ✅ Complete

- [x] Add behavioral tests for V2 no-TMUX resume/monitor correctness
- [x] Run targeted tests
- [x] Run full suite
- [x] Fix all failures

---

### Step 5: Documentation & delivery
**Status:** ✅ Complete

- [x] Update Runtime V2 rollout/process docs for de-TMUX status
- [x] Log discoveries and remaining boundaries

---

## Reviews

| # | Type | Step | Verdict | File |
|---|------|------|---------|------|
| 1 | Code Review | Steps 1-2 | Changes Requested | `.reviews/review-1.md` |
| 2 | Code Review | Steps 1-5 | Approved with final monitor-root fix | `.reviews/review-2.md` |

---

## Discoveries

| Discovery | Disposition | Location |
|-----------|-------------|----------|
| V2 monitor registry lookup used `repoRoot`, causing workspace-mode false liveness misses | Fixed by threading monitor state root (`resolveRuntimeStateRoot(repoRoot, wsRoot)`) into `monitorLanes` and using `readRegistrySnapshot(stateRootForRegistry ?? repoRoot, batchId)` | `extensions/taskplane/execution.ts` |

---

## Execution Log

| Timestamp | Action | Outcome |
|-----------|--------|---------|
| 2026-03-31 | Task staged | PROMPT.md and STATUS.md created |
| 2026-03-31 | Initial TP-112 implementation | V2 resume/monitor de-TMUX pass landed |
| 2026-03-31 | Review remediation pass 1 | TDZ, liveness, stall kill, terminate+rehydrate, identity fixes landed |
| 2026-03-31 | Review remediation pass 2 | Workspace monitor state-root registry lookup fixed |
| 2026-03-31 | Validation | Full suite green (3387 pass, 0 fail) |

---

## Blockers

*None*

---

## Notes

Runtime V2 correctness paths for resume + monitor now avoid TMUX dependence.
Legacy backend remains TMUX-based by design.
