# TP-006: Persisted State Schema v2 with Repo-Aware Records — Status

**Current Step:** Step 1: Implement serialization and validation
**Status:** ✅ Complete
**Last Updated:** 2026-03-15
**Review Level:** 3
**Review Counter:** 3
**Iteration:** 2
**Size:** M

> **Hydration:** Checkboxes below must be granular — one per unit of work.
> Steps marked `⚠️ Hydrate` will be expanded by the worker.

---

### Step 0: Define schema v2
**Status:** ✅ Complete

- [x] Bump batch-state schema version and add repo-aware fields on lane/task records
- [x] Document field contracts and compatibility expectations
- [x] R002 fix: `mode` validation strict for v2 (missing mode → STATE_SCHEMA_INVALID)
- [x] R002 fix: `mode` set from execution context in engine.ts (fresh run) and resume.ts (resume)
- [x] R002 fix: v2 fixtures updated with `mode` field; v1 upconversion test added

#### Schema v2 Contract

**`BATCH_STATE_SCHEMA_VERSION`** bumped from `1` to `2` in `types.ts`.

**New/changed fields — top level (`PersistedBatchState`):**

| Field | Type | v1 behavior | v2 behavior | Default for v1→v2 |
|-------|------|-------------|-------------|-------------------|
| `mode` | `WorkspaceMode` ("repo" \| "workspace") | Not present | Required | `"repo"` |

**New fields — task records (`PersistedTaskRecord`):**

| Field | Type | Required | Mode semantics | Default for v1→v2 |
|-------|------|----------|----------------|-------------------|
| `repoId` | `string \| undefined` | Optional | Repo mode: `undefined`. Workspace mode: PROMPT.md-declared repo ID (may be `undefined` if task didn't declare one). | `undefined` (omitted) |
| `resolvedRepoId` | `string \| undefined` | Optional | Repo mode: `undefined`. Workspace mode: final repo ID after routing precedence (prompt→area→workspace-default). | `undefined` (omitted) |

**Formalized fields — lane records (`PersistedLaneRecord`):**

| Field | Type | Required | Mode semantics | Default for v1→v2 |
|-------|------|----------|----------------|-------------------|
| `repoId` | `string \| undefined` | Optional | Repo mode: `undefined`. Workspace mode: non-empty string matching a key in `WorkspaceConfig.repos`. | `undefined` (omitted) |

**Source of truth for each persisted field:**

- **`mode`**: From `OrchBatchRuntimeState.mode` (set at batch start from `ExecutionContext.mode`).
- **Task `repoId`**: From `ParsedTask.promptRepoId` via `serializeBatchState()` for allocated tasks, or via `persistRuntimeState()` discovery enrichment for unallocated tasks.
- **Task `resolvedRepoId`**: From `ParsedTask.resolvedRepoId` via same paths as `repoId`.
- **Lane `repoId`**: From `AllocatedLane.repoId` via `serializeBatchState()`.

**Compatibility policy (v1 → v2):**

- `loadBatchState()` accepts v1 files and auto-upconverts to v2 in memory via `upconvertV1toV2()`.
- On-disk file is NOT rewritten during upconversion.
- `saveBatchState()` always writes `schemaVersion: 2`.
- Schema versions > 2 are rejected with `STATE_SCHEMA_INVALID`.
- Upconversion defaults: `mode → "repo"`, `baseBranch → ""`, repo fields → `undefined` (omitted from JSON).

**Test/fixture impact:**

- `batch-state-valid.json` — Update to v2 (add `mode: "repo"`, bump `schemaVersion: 2`).
- `batch-state-v2-workspace.json` — New fixture: workspace mode with repo fields populated.
- `batch-state-wrong-version.json` — Keep as-is (version 99, still invalid).
- `batch-state-v1-valid.json` — New fixture: copy of current v1 valid fixture for backward-compat tests.
- `batch-state-bad-enums.json` — Update to v2 schemaVersion.
- `batch-state-bad-task-status.json` — Update to v2 schemaVersion.
- `batch-state-missing-fields.json` — Update to v2 schemaVersion.
- `batch-state-malformed.json` — Keep as-is (invalid JSON).
- Test `orch-state-persistence.test.ts` — Update `BATCH_STATE_SCHEMA_VERSION` to 2, update `validatePersistedState` reimplementation to handle v2 fields, add v1 upconversion tests.

**Documentation targets:**

- `types.ts` — Schema type comments (done).
- `polyrepo-implementation-plan.md` — Create/update with final persistence schema and migration strategy (Step 4).

---

### Step 1: Implement serialization and validation
**Status:** ✅ Complete

- [x] Confirm all runtime write triggers route through `persistRuntimeState()` (engine, resume, abort)
- [x] Ensure `serializeBatchState()` writes lane/task repo-aware fields for allocated tasks
- [x] Ensure `persistRuntimeState()` enrichment writes repo-aware fields for unallocated tasks
- [x] Add/adjust v2 validation rules for malformed repo-aware records with explicit `STATE_SCHEMA_INVALID` errors
- [x] Add/update fixtures for malformed v2 repo-aware states
- [x] Add/update persistence tests for checkpoint serialization and validator failures

#### Step 1 Audit Notes

**Checkpoint coverage confirmation:** All runtime write triggers route through `persistRuntimeState()` → `serializeBatchState()` → `saveBatchState()`. No direct `saveBatchState()` callers outside `persistence.ts`. Verified by grep across engine.ts (11 calls), resume.ts (11 calls), abort.ts (1 call).

**Serialization behavior by checkpoint class:**
- **Allocated tasks** (current wave): repo fields sourced from `AllocatedTask.task.promptRepoId` and `.resolvedRepoId` via `serializeBatchState()`.
- **Unallocated tasks** (future waves): repo fields enriched by `persistRuntimeState()` from `discovery.pending` ParsedTask after initial serialization.
- **Wave transitions, merge, pause, abort:** All use same `persistRuntimeState()` path — repo fields persist correctly at every checkpoint.

**Validation matrix (malformed repo-aware records):**
- `null` → rejected for task `repoId`, `resolvedRepoId`, lane `repoId` (not a string)
- `number` → rejected for all repo fields
- `object` → rejected for all repo fields
- `array` → rejected for `resolvedRepoId`
- `boolean` → rejected for `mode`
- `""` (empty string) → accepted (structurally valid; semantic validation is mode-aware, not structural)
- Invalid mode values → rejected ("polyrepo", numeric, boolean)
- Missing `mode` in v2 → rejected (required in v2; optional in v1 via upconvert)

**Fixtures added/verified:**
- `batch-state-v2-bad-repo-fields.json` — New: workspace mode with non-string repo fields
- `batch-state-v2-workspace.json` — Existing: valid workspace mode with repo fields
- `batch-state-valid.json` — Existing: valid repo mode (no repo fields)

**Test coverage added:**
- 14 new validation tests for malformed repo-aware records (type violations)
- 4 new serialization checkpoint tests (allocated, repo-mode, discovery enrichment, round-trip)
- E2E test updated for full task registry from wavePlan

---

### Step 2: Handle schema v1 compatibility
**Status:** ⬜ Not Started

- [ ] Add v1->v2 up-conversion or explicit migration guardrails
- [ ] Add regression tests covering v1 and v2 loading paths

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
| R001 | plan | Step 0 | REVISE | .reviews/R001-plan-step0.md |
| R002 | code | Step 0 | REVISE | .reviews/R002-code-step0.md |
| R002 | code | Step 0 | REVISE | .reviews/R002-code-step0.md |
| R003 | plan | Step 1 | REVISE | .reviews/R003-plan-step1.md |
| R003 | plan | Step 1 | APPROVE | .reviews/R003-plan-step1.md |
|---|------|------|---------|------|

## Discoveries
| Discovery | Disposition | Location |
|-----------|-------------|----------|
| TP-004 already added `repoId` to `AllocatedLane`, `ParsedTask`, `LaneAssignment`, `MergeLaneResult` runtime types — v2 persistence leverages these existing runtime contracts | Noted | `types.ts` |
| `baseBranch` was added to v1 state with backward-compat defaulting to `""` — v2 upconversion preserves this behavior | Noted | `persistence.ts:323`, `persistence.ts:536` |
| Polyrepo spec/backlog docs referenced in PROMPT.md context do not exist in this worktree — schema design proceeded from types.ts runtime contracts alone | Noted | `.pi/local/docs/taskplane/` |

## Execution Log
| Timestamp | Action | Outcome |
|-----------|--------|---------|
| 2026-03-15 | Task staged | PROMPT.md and STATUS.md created |
| 2026-03-15 17:50 | Task started | Extension-driven execution |
| 2026-03-15 17:50 | Step 0 started | Define schema v2 |
| 2026-03-15 17:50 | Task started | Extension-driven execution |
| 2026-03-15 17:50 | Step 0 started | Define schema v2 |
| 2026-03-15 17:53 | Review R001 | plan Step 0: UNKNOWN |
| 2026-03-15 17:54 | Review R001 | plan Step 0: REVISE |
| 2026-03-15 18:00 | Step 0 completed | Schema v2 defined in types.ts; contract documented in STATUS.md |
| 2026-03-15 17:58 | Worker iter 1 | done in 237s, ctx: 38%, tools: 34 |
| 2026-03-15 18:02 | Step 0 impl updated | R001 revise feedback addressed: v1→v2 upconvert, validation, fixtures, tests |
| 2026-03-15 18:07 | Worker iter 1 | done in 804s, ctx: 58%, tools: 112 |
| 2026-03-15 18:09 | Review R002 | code Step 0: REVISE |
| 2026-03-15 18:15 | Step 0 R002 fix | Strict mode validation for v2, mode set in engine/resume, fixtures+tests updated |
| 2026-03-15 18:12 | Review R002 | code Step 0: REVISE |
| 2026-03-15 18:15 | Worker iter 1 | done in 391s, ctx: 23%, tools: 68 |
| 2026-03-15 18:15 | Step 0 complete | Define schema v2 |
| 2026-03-15 18:15 | Step 1 started | Implement serialization and validation |
| 2026-03-15 18:16 | Review R003 | plan Step 1: REVISE |
| 2026-03-15 18:22 | Step 1 hydrated | Plan expanded per R003: 6 granular checkboxes |
| 2026-03-15 18:25 | Step 1 impl | Validation + serialization + fixtures + tests added, 207 tests passing |
| 2026-03-15 18:25 | Step 1 complete | Implement serialization and validation |
| 2026-03-15 18:18 | Worker iter 1 | done in 336s, ctx: 20%, tools: 42 |
| 2026-03-15 18:18 | Step 0 complete | Define schema v2 |
| 2026-03-15 18:18 | Step 1 started | Implement serialization and validation |
| 2026-03-15 18:19 | Review R003 | plan Step 1: APPROVE |

## Blockers

*None*

## Notes

*Reserved for execution notes*
