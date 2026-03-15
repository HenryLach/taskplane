# TP-009: Dashboard Repo-Aware Lanes, Tasks, and Merge Panels — Status

**Current Step:** Step 2: Preserve existing UX guarantees
​**Status:** 🟡 In Progress
**Last Updated:** 2026-03-15
**Review Level:** 2
**Review Counter:** 3
**Iteration:** 2
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
**Status:** ⬜ Not Started

- [ ] Ensure monorepo views remain clear and unchanged by default
- [ ] Verify no regressions in conversation/sidecar panels

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
| R001 | plan | Step 0 | REVISE | .reviews/R001-plan-step0.md |
| R001 | plan | Step 0 | UNKNOWN | .reviews/R001-plan-step0.md |
| R002 | code | Step 0 | UNKNOWN | .reviews/R002-code-step0.md |
| R003 | plan | Step 1 | UNKNOWN | .reviews/R003-plan-step1.md |
| R002 | code | Step 0 | UNKNOWN | .reviews/R002-code-step0.md |
| R003 | plan | Step 1 | UNKNOWN | .reviews/R003-plan-step1.md |
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

## Blockers

*None*

## Notes

*Reserved for execution notes*
