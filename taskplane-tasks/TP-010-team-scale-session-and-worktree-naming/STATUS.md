# TP-010: Team-Scale Session and Worktree Naming Hardening — Status

**Current Step:** Step 1: Apply naming contract consistently
​**Status:** 🟡 In Progress
**Last Updated:** 2026-03-15
**Review Level:** 3
**Review Counter:** 3
**Iteration:** 2
**Size:** M

> **Hydration:** Checkboxes below must be granular — one per unit of work.
> Steps marked `⚠️ Hydrate` will be expanded by the worker.

---

### Step 0: Define naming contract
**Status:** ✅ Complete

- [x] Design deterministic naming including repo slug + operator identifier + batch components
- [x] Document fallback rules when operator metadata is unavailable

---

### Step 1: Apply naming contract consistently
**Status:** 🟨 In Progress

- [x] Create `naming.ts` with `resolveOperatorId()`, `sanitizeNameComponent()`, `resolveRepoSlug()`
- [x] Add `operator_id` field to `OrchestratorConfig` and `DEFAULT_ORCHESTRATOR_CONFIG`
- [x] Add `opId` field to `CreateWorktreeOptions`
- [x] Update `generateTmuxSessionName()` in `waves.ts`: `{prefix}-{opId}-lane-{N}` (repo mode) / `{prefix}-{opId}-{repoId}-lane-{N}` (workspace mode)
- [x] Update `generateBranchName()` in `worktree.ts`: `task/{opId}-lane-{N}-{batchId}`
- [x] Update `generateWorktreePath()` in `worktree.ts`: `{prefix}-{opId}-{N}`
- [x] Update `createWorktree()` to destructure and pass `opId`
- [x] Update `listWorktrees()` to accept `opId` and match `{prefix}-{opId}-{N}` (operator-scoped discovery)
- [x] Add legacy pattern fallback for `listWorktrees()` (only when opId="op")
- [x] Update `createLaneWorktrees()` to resolve `opId` internally
- [x] Update `ensureLaneWorktrees()` to resolve `opId` and pass through
- [x] Update `removeAllWorktrees()` to accept `opId` parameter
- [x] Update `allocateLanes()` in `waves.ts` to resolve `opId` and pass to `generateTmuxSessionName()`
- [x] Update merge temp branch: `_merge-temp-{opId}-{batchId}`
- [x] Update merge workspace dir: `merge-workspace-{opId}` (operator-scoped)
- [x] Update merge session names: `{prefix}-{opId}-merge-{N}`
- [x] Update merge sidecar files: `merge-result-w{W}-lane{L}-{opId}-{batchId}.json` / `.txt`
- [x] Update call sites in `engine.ts` (cleanup, worktree reset)
- [x] Update call sites in `resume.ts` (cleanup, worktree reset)
- [x] Add `naming.ts` to barrel export in `index.ts`
- [x] Add `operator_id` to template config `task-orchestrator.yaml`
- [x] Ensure log/sidecar file naming aligns with new identifiers (lane log inherits from session name)
- [x] Update tests: `orch-pure-functions.test.ts` (generateWorktreePath, listWorktrees regex)
- [ ] All 207 tests passing (verified locally, pending final wrap-up)

---

### Step 2: Validate collision resistance
**Status:** ⬜ Not Started

- [ ] Add tests/smoke scenarios for concurrent runs in shared environments
- [ ] Confirm naming remains human-readable for debugging and lane-agent-style supervision views

---

### Step 3: Testing & Verification
**Status:** ⬜ Not Started

- [ ] Unit/regression tests passing
- [ ] Targeted tests for changed modules passing
- [ ] All failures fixed
- [ ] CLI smoke checks passing

---

### Step 4: Documentation & Delivery
**Status:** ⬜ Not Started

- [ ] "Must Update" docs modified
- [ ] "Check If Affected" docs reviewed
- [ ] Discoveries logged
- [ ] `.DONE` created
- [ ] Archive and push

---

## Reviews
| # | Type | Step | Verdict | File |
| R001 | plan | Step 0 | UNKNOWN | .reviews/R001-plan-step0.md |
| R001 | plan | Step 0 | UNKNOWN | .reviews/R001-plan-step0.md |
| R002 | code | Step 0 | UNKNOWN | .reviews/R002-code-step0.md |
| R002 | code | Step 0 | UNKNOWN | .reviews/R002-code-step0.md |
| R003 | plan | Step 1 | UNKNOWN | .reviews/R003-plan-step1.md |
| R003 | plan | Step 1 | UNKNOWN | .reviews/R003-plan-step1.md |
|---|------|------|---------|------|

## Discoveries
| Discovery | Disposition | Location |
|-----------|-------------|----------|

## Execution Log
| Timestamp | Action | Outcome |
|-----------|--------|---------|
| 2026-03-15 | Task staged | PROMPT.md and STATUS.md created |
| 2026-03-15 18:55 | Task started | Extension-driven execution |
| 2026-03-15 18:55 | Step 0 started | Define naming contract |
| 2026-03-15 18:55 | Task started | Extension-driven execution |
| 2026-03-15 18:55 | Step 0 started | Define naming contract |
| 2026-03-15 18:58 | Review R001 | plan Step 0: UNKNOWN |
| 2026-03-15 19:10 | Step 0 completed | naming-contract.md created with full contract table, operator fallback matrix, parser compat plan, test plan |
| 2026-03-15 18:59 | Review R001 | plan Step 0: UNKNOWN |
| 2026-03-15 19:03 | Worker iter 1 | done in 196s, ctx: 51%, tools: 32 |
| 2026-03-15 19:05 | Review R002 | code Step 0: UNKNOWN |
| 2026-03-15 19:05 | Step 0 complete | Define naming contract |
| 2026-03-15 19:05 | Step 1 started | Apply naming contract consistently |
| 2026-03-15 19:06 | Review R002 | code Step 0: UNKNOWN |
| 2026-03-15 19:06 | Step 0 complete | Define naming contract |
| 2026-03-15 19:06 | Step 1 started | Apply naming contract consistently |
| 2026-03-15 19:08 | Review R003 | plan Step 1: UNKNOWN |
| 2026-03-15 19:10 | Review R003 | plan Step 1: UNKNOWN |

## Blockers

*None*

## Notes

*Reserved for execution notes*
