# TP-009: Dashboard Repo-Aware Lanes, Tasks, and Merge Panels — Status

**Current Step:** Complete
​**Status:** ✅ Complete
**Last Updated:** 2026-03-15
**Review Level:** 2
**Review Counter:** 10
**Iteration:** 5
**Size:** M

> **Hydration:** Checkboxes represent meaningful outcomes, not individual code
> changes. Workers expand steps when runtime discoveries warrant it — aim for
> 2-5 outcome-level items per step, not exhaustive implementation scripts.

---

### Step 0: Extend dashboard data model
**Status:** ✅ Complete

**Payload contract (additive-only — no field renames or removals):**

| Object                 | New Field(s)                   | Type                         | Absent semantics            |
|------------------------|-------------------------------|------------------------------|-----------------------------|
| `batch`                | `mode`                        | `"repo"\|"workspace"`        | Treat as `"repo"`           |
| `batch.lanes[]`        | `repoId`                      | `string\|undefined`          | Already persisted (TP-006)  |
| `batch.tasks[]`        | `repoId`, `resolvedRepoId`    | `string\|undefined`          | Already persisted (TP-006)  |
| `batch.mergeResults[]` | `repoResults`                 | `array\|undefined`           | Absent = single-repo merge  |

**Backward compatibility:** Additive fields only. When repo fields are absent (repo mode, v1 state), they are simply omitted from JSON (undefined). No renames, no removals. Frontend consumers must tolerate missing fields.

**Scope:** `dashboard/server.cjs` + `extensions/taskplane/persistence.ts` (enrich persisted merge results); `formatting.ts` TUI changes deferred to Step 1.

**Merge attribution strategy:** `PersistedMergeResult` currently lacks repo data. We enrich it in `serializeBatchState()` by serializing `MergeWaveResult.repoResults` into a new `repoResults` field on the persisted record. This is additive — v1/v2 state files without this field remain valid.

- [x] Add `mode` field to the `batch` object in `buildDashboardState()` (server.cjs)
- [x] Enrich persisted merge results with `repoResults` from `MergeWaveResult` in `serializeBatchState()` (persistence.ts)
- [x] Pass enriched merge results through to dashboard payload (server.cjs — already passes through)
- [x] Verify lane/task repo fields already flow through (server.cjs spreads all persisted fields)
- [x] Maintain backward compatibility — repo-mode payloads valid when repo fields undefined/absent

---

### Step 1: Implement repo-aware UI
**Status:** ✅ Complete

**Repo derivation rules:**
- Lane label: `lane.repoId` (with fallback: omit label when undefined)
- Task label: prefer `task.resolvedRepoId`, fallback to `task.repoId`, fallback to owning lane's `repoId`
- Merge grouping: `mergeResult.repoResults[]` (array of `PersistedRepoMergeOutcome`)
- Repo filter set: union of all known repoIds from lanes + tasks + merge repoResults; sorted lexicographically; include "All repos" default

**Filter semantics:**
- "All repos" is the default — shows everything (identical to current view)
- Filter affects lanes/tasks/merge panels consistently
- Summary bar and footer remain global (not filtered) — always show full batch progress
- When selected repo disappears in next SSE payload, revert to "All repos"

**Merge rendering contract:**
- Per wave: show overall merge status (existing behavior)
- If `repoResults` present and length >= 2: render repo-grouped sub-rows beneath the wave row
- If `repoResults` absent or length < 2: retain existing single-row behavior

**Mode gating:**
- Repo filter UI only shown when `batch.mode === "workspace"` AND there are 2+ distinct repos
- In repo mode (default/v1 state), no repo labels or filter clutter — existing rendering unchanged

**Step 1 verification matrix:**
- Workspace mode (>=2 repos): repo badges on lanes/tasks, filter dropdown, grouped merge outcomes
- Repo mode / older state files: no extra repo clutter; existing rendering fully intact
- Conversation/STATUS.md viewer still opens and updates normally (no changes to viewer)
- `formatting.ts` (TUI) is explicitly out of scope for Step 1

**Implementation outcomes:**
- [x] Add repo filter controls to `index.html` and filter styles to `style.css`
- [x] Implement repo-aware label rendering in `renderLanesTasks()` gated by mode/availability
- [x] Implement merge panel per-repo grouping in `renderMergeAgents()` with backward-compatible fallback
- [x] Implement repo filter logic: build repo set, filter lanes/tasks/merge, handle disappearing repos
- [x] Gate all repo UI by mode + repo count so monorepo views remain unchanged

---

### Step 2: Preserve existing UX guarantees
**Status:** ✅ Complete

**Verification approach:** Code trace + test suite confirmation.

**Monorepo UX guarantee verification:**
- `buildRepoSet()` returns `[]` when `mode !== "workspace"` (default is `"repo"`)
- `updateRepoFilter([])` hides repo dropdown and resets selection to "All"
- `renderLanesTasks()`: `showRepos` is `false` → no repo badges, no repo filtering
- `renderMergeAgents()`: `showRepos` is `false` → no per-repo sub-rows, no merge filtering
- `renderSummary()`: No repo-related changes — always shows full batch progress
- `server.cjs`: `mode` field defaults to `"repo"` for v1 state files (additive only)
- `renderNoBatch()`: calls `updateRepoFilter([])` to hide filter when no batch

**Conversation/sidecar panel regression check:**
- `viewConversation()`, `pollConversation()`: unchanged, still opens viewer for lane session
- `viewStatusMd()`, `pollStatusMd()`: unchanged, still opens STATUS.md viewer for task
- `closeViewer()`: unchanged, still properly cleans up viewer state
- Server endpoints `/api/conversation/:prefix` and `/api/status-md/:taskId`: unchanged
- HTML structure: `terminal-panel`, `terminal-title`, `terminal-body`, `terminal-close`, `auto-scroll-checkbox` all present
- CSS styles for `.conv-*`, `.status-md-*`, `.terminal-panel`, `.viewer-eye-btn`: all intact
- 290/290 tests pass

- [x] Ensure monorepo views remain clear and unchanged by default
- [x] Verify no regressions in conversation/sidecar panels

---

### Step 3: Testing & Verification
**Status:** ✅ Complete

**Verification commands:**
1. Full suite: `cd extensions && npx vitest run` → 12 files, 290/290 pass
2. Targeted modules: `npx vitest run tests/orch-state-persistence.test.ts tests/merge-repo-scoped.test.ts tests/waves-repo-scoped.test.ts tests/workspace-config.test.ts` → 4 files, 67/67 pass
3. CLI smoke: `node bin/taskplane.mjs help` → exits 0, all commands listed
4. CLI smoke: `node bin/taskplane.mjs doctor` → runs correctly (config warnings expected in worktree)

**Dashboard scenario matrix (code-trace verification):**
| Scenario | Expected | Verified |
|---|---|---|
| Repo mode (default/v1 state) | `buildRepoSet()` returns `[]`, `updateRepoFilter([])` hides dropdown, no repo badges, no merge sub-rows | ✅ Code trace confirmed |
| Workspace mode (2+ repos) | `buildRepoSet()` returns sorted repo list, filter shown, repo badges on lanes/tasks, merge per-repo sub-rows | ✅ Code trace confirmed |
| Workspace mode (1 repo) | `buildRepoSet()` returns `[]` (deduplicated < 2), filter hidden | ✅ Code trace confirmed |
| Repo filter → disappearing repo | `updateRepoFilter()` resets selection to "All" when `selectedRepo` not in new set | ✅ Code trace confirmed |
| Conversation viewer while filtering | `viewConversation()`/`pollConversation()` unchanged, opens viewer regardless of filter state | ✅ Code trace confirmed |
| STATUS.md viewer while filtering | `viewStatusMd()`/`pollStatusMd()` unchanged, opens viewer regardless of filter state | ✅ Code trace confirmed |
| No batch → repo filter hidden | `renderNoBatch()` calls `updateRepoFilter([])` | ✅ Code trace confirmed |

**Failure policy:** Any test failure or scenario mismatch blocks Step 3 close; fix and rerun required.

**Evidence:**
- 2026-03-15: Full suite 290/290 pass, targeted 67/67 pass, CLI help exit 0, doctor runs correctly
- All dashboard scenarios verified via code trace (no runtime dashboard available in worktree)

- [x] Unit/regression tests passing — 290/290 (12 test files, all green)
- [x] Targeted tests for changed modules passing — persistence, merge-repo-scoped, waves-repo-scoped, workspace-config: 67/67
- [x] All failures fixed — no failures encountered
- [x] CLI smoke checks passing — `help` exit 0, `doctor` runs correctly
- [x] Dashboard scenario matrix verified — 7/7 scenarios confirmed via code trace

---

### Step 4: Documentation & Delivery
**Status:** ✅ Complete

- [x] "Must Update" docs modified — created `.pi/local/docs/taskplane/polyrepo-implementation-plan.md` documenting final dashboard repo-grouping behavior (data model, frontend behavior, mode gating, backward compatibility, persistence changes, files changed)
- [x] "Check If Affected" docs reviewed — `docs/tutorials/use-the-dashboard.md` reviewed; no update needed now (PROMPT specifies "Update once repo-aware UI ships publicly"); current tutorial covers basic usage which remains unchanged
- [x] Discoveries logged — all 3 discoveries from execution already recorded in Discoveries table
- [x] `.DONE` created
- [x] Archive and push — deferred to orchestrator (orchestrated run)

---

## Reviews
| # | Type | Step | Verdict | File |
| R001 | plan | Step 0 | REVISE | .reviews/R001-plan-step0.md |
| R001 | plan | Step 0 | UNKNOWN | .reviews/R001-plan-step0.md |
| R002 | code | Step 0 | UNKNOWN | .reviews/R002-code-step0.md |
| R003 | plan | Step 1 | UNKNOWN | .reviews/R003-plan-step1.md |
| R002 | code | Step 0 | UNKNOWN | .reviews/R002-code-step0.md |
| R003 | plan | Step 1 | UNKNOWN | .reviews/R003-plan-step1.md |
| R004 | code | Step 1 | UNKNOWN | .reviews/R004-code-step1.md |
| R004 | code | Step 1 | UNKNOWN | .reviews/R004-code-step1.md |
| R005 | plan | Step 2 | UNKNOWN | .reviews/R005-plan-step2.md |
| R005 | plan | Step 2 | UNKNOWN | .reviews/R005-plan-step2.md |
| R006 | code | Step 2 | UNKNOWN | .reviews/R006-code-step2.md |
| R006 | code | Step 2 | UNKNOWN | .reviews/R006-code-step2.md |
| R007 | plan | Step 3 | UNKNOWN | .reviews/R007-plan-step3.md |
| R007 | plan | Step 3 | UNKNOWN | .reviews/R007-plan-step3.md |
| R008 | code | Step 3 | UNKNOWN | .reviews/R008-code-step3.md |
| R008 | code | Step 3 | UNKNOWN | .reviews/R008-code-step3.md |
| R009 | plan | Step 4 | UNKNOWN | .reviews/R009-plan-step4.md |
| R009 | plan | Step 4 | UNKNOWN | .reviews/R009-plan-step4.md |
| R010 | code | Step 4 | UNAVAILABLE | .reviews/R010-code-step4.md |
|---|------|------|---------|------|

## Discoveries
| Discovery | Disposition | Location |
|-----------|-------------|----------|
| Lane/task repo fields (repoId, resolvedRepoId) already pass through to dashboard via JSON spread — no server.cjs filtering needed | No action | persistence.ts, server.cjs |
| MergeWaveResult has repoResults at runtime (TP-006) but PersistedMergeResult did NOT serialize them — added PersistedRepoMergeOutcome type + serialization + validation | Implemented (iter 2) | types.ts, persistence.ts |
| Top-level `mode` field was missing from dashboard payload — added in server.cjs (iter 1) | Implemented | dashboard/server.cjs |

## Execution Log
| Timestamp | Action | Outcome |
|-----------|--------|---------|
| 2026-03-15 | Task staged | PROMPT.md and STATUS.md created |
| 2026-03-15 23:17 | Task started | Extension-driven execution |
| 2026-03-15 23:17 | Step 0 started | Extend dashboard data model |
| 2026-03-15 23:17 | Task started | Extension-driven execution |
| 2026-03-15 23:17 | Step 0 started | Extend dashboard data model |
| 2026-03-15 23:20 | Review R001 | plan Step 0: REVISE |
| 2026-03-15 23:20 | Review R001 | plan Step 0: UNKNOWN |
| 2026-03-15 23:25 | Step 0 impl | Added mode field to buildDashboardState; verified lane/task/merge repo fields already flow through |
| 2026-03-15 23:25 | Step 0 complete | All checkboxes checked, 290/290 tests pass |
| 2026-03-15 23:25 | Worker iter 1 | done in 291s, ctx: 45%, tools: 37 |
| 2026-03-16 | Step 0 iter 2 | Added PersistedRepoMergeOutcome type, serialization in serializeBatchState, validation in validatePersistedState. 290/290 tests pass. |
| 2026-03-15 23:26 | Review R002 | code Step 0: UNKNOWN |
| 2026-03-15 23:26 | Step 0 complete | Extend dashboard data model |
| 2026-03-15 23:26 | Step 1 started | Implement repo-aware UI |
| 2026-03-15 23:27 | Worker iter 1 | done in 418s, ctx: 50%, tools: 55 |
| 2026-03-15 23:28 | Review R003 | plan Step 1: UNKNOWN |
| 2026-03-16 | Step 1 impl | Hydrated plan per R003 review. Implemented repo filter (index.html, style.css), repo badges on lanes/tasks (app.js renderLanesTasks), per-repo merge sub-rows (app.js renderMergeAgents), filter logic with disappearing-repo handling. All gated by mode=workspace + 2+ repos. 290/290 tests pass. |
| 2026-03-15 23:30 | Review R002 | code Step 0: UNKNOWN |
| 2026-03-15 23:30 | Step 0 complete | Extend dashboard data model |
| 2026-03-15 23:30 | Step 1 started | Implement repo-aware UI |
| 2026-03-15 23:31 | Review R003 | plan Step 1: UNKNOWN |
| 2026-03-15 23:34 | Worker iter 2 | done in 390s, ctx: 36%, tools: 48 |
| 2026-03-15 23:35 | Worker iter 2 | done in 250s, ctx: 27%, tools: 23 |
| 2026-03-15 23:37 | Review R004 | code Step 1: UNKNOWN |
| 2026-03-15 23:37 | Step 1 complete | Implement repo-aware UI |
| 2026-03-15 23:37 | Step 2 started | Preserve existing UX guarantees |
| 2026-03-15 23:38 | Review R004 | code Step 1: UNKNOWN |
| 2026-03-15 23:38 | Step 1 complete | Implement repo-aware UI |
| 2026-03-15 23:38 | Step 2 started | Preserve existing UX guarantees |
| 2026-03-15 23:38 | Review R005 | plan Step 2: UNKNOWN |
| 2026-03-16 | Step 2 complete | Verified monorepo UX unchanged (code trace: buildRepoSet/updateRepoFilter/renderLanesTasks/renderMergeAgents all properly gated). Verified conversation/sidecar panels have no regressions (viewer functions, server endpoints, HTML/CSS all intact). 290/290 tests pass. |
| 2026-03-15 23:39 | Review R005 | plan Step 2: UNKNOWN |
| 2026-03-15 23:41 | Worker iter 3 | done in 174s, ctx: 27%, tools: 23 |
| 2026-03-15 23:42 | Worker iter 3 | done in 180s, ctx: 26%, tools: 20 |
| 2026-03-15 23:44 | Review R006 | code Step 2: UNKNOWN |
| 2026-03-15 23:44 | Step 2 complete | Preserve existing UX guarantees |
| 2026-03-15 23:44 | Step 3 started | Testing & Verification |
| 2026-03-15 23:45 | Review R006 | code Step 2: UNKNOWN |
| 2026-03-15 23:45 | Step 2 complete | Preserve existing UX guarantees |
| 2026-03-15 23:45 | Step 3 started | Testing & Verification |
| 2026-03-15 23:46 | Review R007 | plan Step 3: UNKNOWN |
| 2026-03-16 | Step 3 complete | Full suite 290/290 pass, targeted 67/67 pass, CLI smoke OK, dashboard scenario matrix 7/7 verified via code trace. No failures. |
| 2026-03-15 23:47 | Review R007 | plan Step 3: UNKNOWN |
| 2026-03-15 23:50 | Worker iter 4 | done in 228s, ctx: 12%, tools: 26 |
| 2026-03-15 23:50 | Worker iter 4 | done in 217s, ctx: 17%, tools: 22 |
| 2026-03-15 23:53 | Review R008 | code Step 3: UNKNOWN |
| 2026-03-15 23:53 | Step 3 complete | Testing & Verification |
| 2026-03-15 23:53 | Step 4 started | Documentation & Delivery |
| 2026-03-15 23:53 | Review R008 | code Step 3: UNKNOWN |
| 2026-03-15 23:53 | Step 3 complete | Testing & Verification |
| 2026-03-15 23:53 | Step 4 started | Documentation & Delivery |
| 2026-03-15 23:55 | Review R009 | plan Step 4: UNKNOWN |
| 2026-03-15 23:55 | Review R009 | plan Step 4: UNKNOWN |
| 2026-03-16 | Step 4 complete | Created polyrepo-implementation-plan.md, reviewed dashboard tutorial (no update needed), verified discoveries logged, created .DONE |
| 2026-03-15 23:59 | Reviewer R010 | code review — reviewer did not produce output |
| 2026-03-15 23:59 | Review R010 | code Step 4: UNAVAILABLE |
| 2026-03-15 23:59 | Step 4 complete | Documentation & Delivery |
| 2026-03-15 23:59 | Task complete | .DONE created |

## Blockers

*None*

## Notes

*Reserved for execution notes*
