# TP-010: Team-Scale Session and Worktree Naming Hardening — Status

**Current Step:** Step 4: Documentation & Delivery
**Status:** ✅ Complete
**Last Updated:** 2026-03-15
**Review Level:** 3
**Review Counter:** 9
**Iteration:** 5
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
**Status:** ✅ Complete

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
- [x] All 207 vitest tests passing + 54 lifecycle tests + 160 pure function tests
- [x] Update tests: `waves-repo-scoped.test.ts` (generateTmuxSessionName with opId)
- [x] Update tests: `worktree-lifecycle.test.ts` (opId in createWorktree, branch names, listWorktrees, removeAllWorktrees)

---

### Step 2: Validate collision resistance
**Status:** ✅ Complete

#### 2a — Collision test matrix (new test file: `naming-collision.test.ts`)
- [x] Same operator + same tmux_prefix + different repos: TMUX sessions must differ (repo slug differentiates)
- [x] Different operators + same repo + same prefix: TMUX sessions, worktree paths, branch names, merge sessions must differ
- [x] Concurrent batches (same operator, different batchIds, overlapping lane numbers): branches and merge sidecars must differ
- [x] Same operator + same repo + workspace mode: sessions include repoId, no cross-repo collision
- [x] opId fallback ("op") combined with legacy worktree patterns: listWorktrees discovers both

#### 2b — Ownership-safe consumer validation (extend `naming-collision.test.ts`)
- [x] `parseOrchSessionNames()` with mixed-operator session list: prefix-only filtering returns ALL operators' sessions (expected behavior)
- [x] `listOrchSessions()` prefix filtering: verify all sessions matching prefix returned regardless of opId (batch-state enrichment distinguishes ownership)
- [x] Sidecar cleanup (`engine.ts` cleanup logic): verify prefix-based cleanup deletes all operators' sidecars (document as known cross-operator behavior in discoveries)
- [x] `/orch-abort` session kill: verify prefix-based kill hits all sessions (document as intended team behavior)

#### 2c — Human-readability validation (extend `naming-collision.test.ts`)
- [x] TMUX session names ≤ 64 chars for worst-case component lengths
- [x] Branch names ≤ 100 chars for worst-case
- [x] Generated names contain all expected tokens in correct order (snapshot assertions)
- [x] `/orch-sessions` display format: verify session names are parseable and supervision-friendly (token order: prefix → opId → [repoId] → lane-N)

---

### Step 3: Testing & Verification
**Status:** ✅ Complete

- [x] Unit/regression tests passing
- [x] Targeted tests for changed modules passing
- [x] All failures fixed
- [x] CLI smoke checks passing

---

### Step 4: Documentation & Delivery
**Status:** ✅ Complete

- [x] "Must Update" docs modified
- [x] "Check If Affected" docs reviewed
- [x] Discoveries logged
- [x] `.DONE` created
- [x] Archive and push

---

## Reviews
| # | Type | Step | Verdict | File |
| R001 | plan | Step 0 | UNKNOWN | .reviews/R001-plan-step0.md |
| R001 | plan | Step 0 | UNKNOWN | .reviews/R001-plan-step0.md |
| R002 | code | Step 0 | UNKNOWN | .reviews/R002-code-step0.md |
| R002 | code | Step 0 | UNKNOWN | .reviews/R002-code-step0.md |
| R003 | plan | Step 1 | UNKNOWN | .reviews/R003-plan-step1.md |
| R003 | plan | Step 1 | UNKNOWN | .reviews/R003-plan-step1.md |
| R004 | code | Step 1 | UNKNOWN | .reviews/R004-code-step1.md |
| R004 | code | Step 1 | UNKNOWN | .reviews/R004-code-step1.md |
| R005 | plan | Step 2 | UNKNOWN | .reviews/R005-plan-step2.md |
| R005 | plan | Step 2 | UNKNOWN | .reviews/R005-plan-step2.md |
| R006 | code | Step 2 | UNKNOWN | .reviews/R006-code-step2.md |
| R007 | plan | Step 3 | UNKNOWN | .reviews/R007-plan-step3.md |
| R006 | code | Step 2 | UNKNOWN | .reviews/R006-code-step2.md |
| R007 | plan | Step 3 | UNKNOWN | .reviews/R007-plan-step3.md |
| R008 | code | Step 3 | UNKNOWN | .reviews/R008-code-step3.md |
| R009 | plan | Step 4 | UNKNOWN | .reviews/R009-plan-step4.md |
| R008 | code | Step 3 | UNKNOWN | .reviews/R008-code-step3.md |
| R009 | plan | Step 4 | UNKNOWN | .reviews/R009-plan-step4.md |
|---|------|------|---------|------|

## Discoveries
| Discovery | Disposition | Location |
|-----------|-------------|----------|
| Sidecar cleanup (engine.ts) and /orch-abort use prefix-only matching, affecting ALL operators' files/sessions. This is intended: state lock serializes access, abort is a hard-stop escape hatch. | Accepted (by design) | engine.ts:651-655, extension.ts:475 |
| sanitizeNameComponent collapses dots/underscores to hyphens, so `john.doe` and `john-doe` resolve to same opId. Operators with names differing only in special chars may collide. | Accepted (document in config reference) | naming.ts:34 |
| Truncation to 12 chars can cause opId collision for long names sharing a prefix (e.g. `ci-runner-team-alpha` vs `ci-runner-team-beta` both → `ci-runner-te`). | Accepted (recommend unique 12-char prefixes in CI) | naming.ts:73 |

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
| 2026-03-15 19:26 | Worker iter 2 | done in 1077s, ctx: 81%, tools: 122 |
| 2026-03-15 19:27 | Worker iter 3 | done in 24s, ctx: 6%, tools: 4 |
| 2026-03-15 19:31 | Step 1 iter 2 | Updated remaining test files (waves-repo-scoped, worktree-lifecycle) for opId. All 207+54+160 tests passing. |
| 2026-03-15 19:28 | Worker iter 2 | done in 1073s, ctx: 81%, tools: 162 |
| 2026-03-15 19:34 | Review R004 | code Step 1: UNKNOWN |
| 2026-03-15 19:34 | Step 1 complete | Apply naming contract consistently |
| 2026-03-15 19:34 | Step 2 started | Validate collision resistance |
| 2026-03-15 19:35 | Review R004 | code Step 1: UNKNOWN |
| 2026-03-15 19:35 | Step 1 complete | Apply naming contract consistently |
| 2026-03-15 19:35 | Step 2 started | Validate collision resistance |
| 2026-03-15 19:37 | Review R005 | plan Step 2: UNKNOWN |
| 2026-03-15 19:37 | Review R005 | plan Step 2: UNKNOWN |
| 2026-03-15 19:41 | Step 2 iter 4 | Hydrated Step 2 per R005 review. Created naming-collision.test.ts with 48 tests covering collision matrix (2a), ownership-safe consumers (2b), human-readability (2c), and sanitization edge cases (2d). All 255 tests passing. |
| 2026-03-15 19:43 | Step 2 iter 5 | Rewrote naming-collision.test.ts with 83 comprehensive tests: collision matrix (2a: 20 tests), shared-env interference (2b: 28 tests), human-readability (2c: 23 tests), naming utilities (12 tests). All 290 tests passing (207 existing + 83 new). |
| 2026-03-15 19:44 | Worker iter 4 | done in 450s, ctx: 26%, tools: 51 |
| 2026-03-15 19:46 | Worker iter 3 | done in 495s, ctx: 46%, tools: 52 |
| 2026-03-15 19:46 | Review R006 | code Step 2: UNKNOWN |
| 2026-03-15 19:46 | Step 2 complete | Validate collision resistance |
| 2026-03-15 19:46 | Step 3 started | Testing & Verification |
| 2026-03-15 19:48 | Review R007 | plan Step 3: UNKNOWN |
| 2026-03-15 19:50 | Step 3 iter 5 | All 290 tests passing (12 test files). Targeted: naming-collision (83), orch-pure-functions (160), waves-repo-scoped (19), worktree-lifecycle (54). CLI smoke: help + doctor OK. Zero failures. |
| 2026-03-15 19:49 | Review R006 | code Step 2: UNKNOWN |
| 2026-03-15 19:49 | Step 2 complete | Validate collision resistance |
| 2026-03-15 19:49 | Step 3 started | Testing & Verification |
| 2026-03-15 19:50 | Review R007 | plan Step 3: UNKNOWN |
| 2026-03-15 19:52 | Worker iter 5 | done in 249s, ctx: 14%, tools: 16 |
| 2026-03-15 19:54 | Worker iter 4 | done in 259s, ctx: 16%, tools: 12 |
| 2026-03-15 19:59 | Review R008 | code Step 3: UNKNOWN |
| 2026-03-15 19:59 | Step 3 complete | Testing & Verification |
| 2026-03-15 19:59 | Step 4 started | Documentation & Delivery |
| 2026-03-15 20:02 | Review R009 | plan Step 4: UNKNOWN |
| 2026-03-15 20:05 | Step 4 iter 6 | Updated docs: task-orchestrator.yaml.md (operator_id field + naming section), lane-agent-design.md (Appendix B naming contract), polyrepo-support-spec.md (§10.1 naming contract), polyrepo-execution-backlog.md (TP-POLY-007 marked delivered). All 290 tests passing. .DONE created. |
| 2026-03-15 20:02 | Review R008 | code Step 3: UNKNOWN |
| 2026-03-15 20:02 | Step 3 complete | Testing & Verification |
| 2026-03-15 20:02 | Step 4 started | Documentation & Delivery |
| 2026-03-15 20:04 | Review R009 | plan Step 4: UNKNOWN |

## Blockers

*None*

## Notes

*Reserved for execution notes*
