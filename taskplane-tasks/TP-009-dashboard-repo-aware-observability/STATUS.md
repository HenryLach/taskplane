# TP-009: Dashboard Repo-Aware Lanes, Tasks, and Merge Panels — Status

**Current Step:** Step 1: Implement repo-aware UI
​**Status:** 🟡 In Progress
**Last Updated:** 2026-03-15
**Review Level:** 2
**Review Counter:** 2
**Iteration:** 1
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
**Status:** 🟨 In Progress

- [ ] Add repo labels and filters in dashboard frontend
- [ ] Group merge outcomes by repo for clear partial-result visibility

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

## Blockers

*None*

## Notes

*Reserved for execution notes*
