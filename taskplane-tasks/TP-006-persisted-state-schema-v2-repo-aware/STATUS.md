# TP-006: Persisted State Schema v2 with Repo-Aware Records — Status

**Current Step:** Step 4: Documentation & Delivery
**Status:** ✅ Step 3 Complete
**Last Updated:** 2026-03-15
**Review Level:** 3
**Review Counter:** 9
**Iteration:** 6
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
- [x] R004 fix: Align test reimplementations with source (mode, mergeResults, re-execute, worktreeExists)

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

**R004 fixes applied (iteration 2):**
- Serializer: `mode` uses `state.mode ?? "repo"` instead of hardcoded `"repo"`; `baseBranch` uses `state.baseBranch ?? ""`; `mergeResults` uses `state.mergeResults` with `waveIndex - 1` mapping (matches source)
- `reconcileTaskStates`: Added `existingWorktrees` parameter and `re-execute` action (precedence 4: dead session + no .DONE + worktree exists)
- `computeResumePoint`: Added `reExecuteTaskIds` tracking; pending-task loop uses `re-execute` (not `mark-failed`) for tasks needing re-execution
- `analyzeOrchestratorStartupState`: Added resumable-phase awareness (`paused`/`executing`/`merging` → resume; others → `cleanup-stale`)
- Test assertion: `mark-failed` tasks correctly route to `failedTaskIds` not `pendingTaskIds`
- All 207 tests passing after fixes

---

### Step 2: Handle schema v1 compatibility
**Status:** ✅ Complete

- [x] Confirm and lock compatibility policy (v1 in-memory upconvert, no implicit rewrite, v2 write-on-save, reject unsupported versions)
- [x] Implement/verify migration path in `persistence.ts` (`validatePersistedState` + `loadBatchState`) with explicit guardrail errors
- [x] Add `loadBatchState` regression tests for v1 fixture upconversion (assert schemaVersion=2, mode="repo", baseBranch="", records preserved)
- [x] Add `loadBatchState` regression tests for v2 fixtures (batch-state-valid.json, batch-state-v2-workspace.json)
- [x] Add regression test proving v1 file is not rewritten on load (on-disk content unchanged)
- [x] Add/verify negative-path tests for unsupported version, malformed JSON, and v2 missing required mode

---

### Step 3: Testing & Verification
**Status:** ✅ Complete

- [x] Run targeted persistence regression tests: `cd extensions && npx vitest run tests/orch-state-persistence.test.ts`
- [x] If targeted tests fail, fix failures and rerun targeted tests until green
- [x] Run full extension suite: `cd extensions && npx vitest run`
- [x] If full suite fails, fix failures and rerun full suite until green
- [x] Run CLI smoke from repo root: `node bin/taskplane.mjs help`
- [x] Record exact verification evidence in STATUS.md (files/tests count, failures=0, CLI smoke pass)

#### Step 3 Verification Evidence

**Targeted persistence tests:**
- Command: `cd extensions && npx vitest run tests/orch-state-persistence.test.ts --reporter=verbose`
- Result: 1 test file, 1 test suite, **499 internal assertions passed**, 0 failed
- Covers: validatePersistedState (36 assertions), serializeBatchState round-trip, file I/O, schema v1→v2 compatibility (8 regression tests), persistRuntimeState integration (13 tests), parseOrchSessionNames, analyzeOrchestratorStartupState, checkResumeEligibility, reconcileTaskStates, computeResumePoint, selectAbortTargetSessions, planAbortActions, mixed-outcome lane guard, cleanup suppression, parseMergeResult, end-to-end interruption scenario

**Full extension suite:**
- Command: `cd extensions && npx vitest run`
- Result: **11 test files, 207 tests, 0 failures**
- Duration: 47.06s

**CLI smoke check:**
- Command: `node bin/taskplane.mjs help` (from repo root)
- Result: ✅ Clean output, all commands listed, version v0.1.17, exit code 0

---

### Step 4: Documentation & Delivery
**Status:** 🟨 In Progress

#### 4.1 — Update "Must Update" doc: `polyrepo-implementation-plan.md`
**Target:** `C:\dev\taskplane\.pi\local\docs\taskplane\polyrepo-implementation-plan.md` (outside worktree)

- [x] Update WS-F section with final delivered v2 schema contract:
  - Fields: `mode` (top-level), `repoId`/`resolvedRepoId` (task records), `repoId` (lane records)
  - `BATCH_STATE_SCHEMA_VERSION` bumped from 1 → 2
  - v1→v2 in-memory upconvert (no on-disk rewrite), v2 write-on-save
  - Validation: strict `mode` for v2, type checks on repo fields, unsupported version rejection
- [x] Update Section 10 (Implementation Readiness Checklist): mark "Persistence schema v2 approved" as done
- [x] Update Section 14 (Migration Plan Phase 1): N/A — Phase 1 section is in spec, not impl plan (handled in 4.2)
- [x] Log evidence of update in STATUS.md

#### 4.2 — Review "Check If Affected" doc: `polyrepo-support-spec.md`
**Target:** `C:\dev\taskplane\.pi\local\docs\taskplane\polyrepo-support-spec.md` (outside worktree)

- [x] Review Section 11 (Persistence / Resume Schema Changes) against delivered TP-006 behavior
- [x] Record decision: **updated**, with rationale, in STATUS.md

#### 4.3 — Discoveries
- [x] Confirm all discoveries from Steps 0–3 are logged in STATUS.md Discoveries table (5 entries total)

#### 4.4 — Closeout
- [ ] Create `.DONE` file in task folder

---

## Reviews
| # | Type | Step | Verdict | File |
| R001 | plan | Step 0 | UNKNOWN | .reviews/R001-plan-step0.md |
| R001 | plan | Step 0 | REVISE | .reviews/R001-plan-step0.md |
| R002 | code | Step 0 | REVISE | .reviews/R002-code-step0.md |
| R002 | code | Step 0 | REVISE | .reviews/R002-code-step0.md |
| R003 | plan | Step 1 | REVISE | .reviews/R003-plan-step1.md |
| R003 | plan | Step 1 | APPROVE | .reviews/R003-plan-step1.md |
| R004 | code | Step 1 | REVISE | .reviews/R004-code-step1.md |
| R004 | code | Step 1 | REVISE | .reviews/R004-code-step1.md |
| R005 | plan | Step 2 | REVISE | .reviews/R005-plan-step2.md |
| R005 | plan | Step 2 | REVISE | .reviews/R005-plan-step2.md |
| R006 | code | Step 2 | APPROVE | .reviews/R006-code-step2.md |
| R007 | plan | Step 3 | REVISE | .reviews/R007-plan-step3.md |
| R006 | code | Step 2 | APPROVE | .reviews/R006-code-step2.md |
| R007 | plan | Step 3 | APPROVE | .reviews/R007-plan-step3.md |
| R008 | code | Step 3 | APPROVE | .reviews/R008-code-step3.md |
| R008 | code | Step 3 | APPROVE | .reviews/R008-code-step3.md |
| R009 | plan | Step 4 | REVISE | .reviews/R009-plan-step4.md |
| R009 | plan | Step 4 | REVISE | .reviews/R009-plan-step4.md |
|---|------|------|---------|------|

#### Step 2 Audit Notes

**Compatibility policy (confirmed and locked):**
- v1 state files are accepted by `validatePersistedState()` and upconverted to v2 in-memory via `upconvertV1toV2()`
- On-disk v1 files are NOT rewritten during `loadBatchState()` — upconversion is purely in-memory
- `saveBatchState()` always writes `schemaVersion: 2` (via `serializeBatchState()` using `BATCH_STATE_SCHEMA_VERSION`)
- Schema versions other than 1 and 2 are rejected with `STATE_SCHEMA_INVALID`

**Implementation already existed from Step 0:**
- `upconvertV1toV2()` in `persistence.ts` — mutates in-place: bumps schemaVersion, defaults mode to "repo", baseBranch to ""
- `validatePersistedState()` — accepts v1 (isV1 flag), validates v2-specific fields only on v2, calls upconvert at end
- `loadBatchState()` — reads file, parses JSON, validates (with upconvert), returns in-memory v2 object; no write-back

**Regression tests added (sections 7.1–7.3 in test file):**
1. `loadBatchState` with v1 fixture → verifies schemaVersion=2, mode="repo", baseBranch="", all 3 task/2 lane records preserved, repo fields undefined
2. v1 file NOT rewritten on load → byte-level comparison of on-disk content before/after `loadBatchState`
3. v1 load → explicit save writes v2 on disk (schemaVersion=2, mode="repo", baseBranch="")
4. `loadBatchState` with v2 repo-mode fixture → verifies all fields preserved, no spurious repo fields in repo mode
5. `loadBatchState` with v2 workspace-mode fixture → verifies repo-aware fields on tasks (repoId, resolvedRepoId) and lanes
6. `loadBatchState` rejects unsupported schema version 99 (batch-state-wrong-version.json) → STATE_SCHEMA_INVALID with actionable message
7. `loadBatchState` rejects schema version 0 → STATE_SCHEMA_INVALID
8. `loadBatchState` rejects schema version 3 → STATE_SCHEMA_INVALID
9. `loadBatchState` rejects malformed JSON → STATE_FILE_PARSE_ERROR
10. `loadBatchState` rejects v2 state missing required mode field → STATE_SCHEMA_INVALID
11. v1 upconverted state usable in full resume pipeline: loadBatchState → checkResumeEligibility → reconcileTaskStates → computeResumePoint → analyzeOrchestratorStartupState

**Test results: 207 tests passing (11 test files, 0 failures)**

## Discoveries
| Discovery | Disposition | Location |
|-----------|-------------|----------|
| TP-004 already added `repoId` to `AllocatedLane`, `ParsedTask`, `LaneAssignment`, `MergeLaneResult` runtime types — v2 persistence leverages these existing runtime contracts | Noted | `types.ts` |
| `baseBranch` was added to v1 state with backward-compat defaulting to `""` — v2 upconversion preserves this behavior | Noted | `persistence.ts:323`, `persistence.ts:536` |
| Polyrepo spec/backlog docs referenced in PROMPT.md context do not exist in this worktree — schema design proceeded from types.ts runtime contracts alone | Noted | `.pi/local/docs/taskplane/` |
| Spec Section 11 listed `worktree.repoRoot` as a persisted field; TP-006 intentionally omitted it — repo roots are resolved at resume time from workspace config + repoId to keep state files portable and avoid stale path snapshots | Design decision — spec updated | `polyrepo-support-spec.md` §11 |
| `resolvedRepoId` was added to task records beyond what spec originally listed (`repoId` only) — captures the final routing resolution distinct from prompt-declared repo | Enhancement — spec updated | `types.ts`, `persistence.ts` |

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
| 2026-03-15 18:24 | Worker iter 2 | done in 446s, ctx: 58%, tools: 54 |
| 2026-03-15 18:25 | Worker iter 2 | done in 346s, ctx: 63%, tools: 46 |
| 2026-03-15 18:27 | Review R004 | code Step 1: REVISE |
| 2026-03-15 18:27 | Review R004 | code Step 1: REVISE |
| 2026-03-15 18:31 | Step 1 R004 fix | Aligned test reimplementations with source: mode from state, resumable-phase logic, re-execute/worktree handling, pending-task categorization |
| 2026-03-15 18:33 | Worker iter 2 | done in 350s, ctx: 26%, tools: 58 |
| 2026-03-15 18:33 | Step 1 complete | Implement serialization and validation |
| 2026-03-15 18:33 | Step 2 started | Handle schema v1 compatibility |
| 2026-03-15 18:33 | Worker iter 2 | done in 379s, ctx: 48%, tools: 45 |
| 2026-03-15 18:33 | Step 1 complete | Implement serialization and validation |
| 2026-03-15 18:33 | Step 2 started | Handle schema v1 compatibility |
| 2026-03-15 18:34 | Review R005 | plan Step 2: REVISE |
| 2026-03-15 18:38 | Step 2 hydrated | R005 feedback: 6 granular checkboxes, compatibility policy explicit |
| 2026-03-15 18:40 | Step 2 impl | 8 regression tests added in section 1.4, all 207 tests passing |
| 2026-03-15 18:40 | Step 2 complete | Handle schema v1 compatibility |
| 2026-03-15 18:35 | Review R005 | plan Step 2: REVISE |
| 2026-03-15 18:39 | Worker iter 3 | done in 288s, ctx: 43%, tools: 29 |
| 2026-03-15 18:41 | Step 2 impl (iter 3) | Added 11 regression tests in sections 7.1–7.3: v1 load path, no-rewrite, v2 repo/workspace load, version guardrails (v0/v3/v99), malformed JSON, v2 missing mode, v1 resume pipeline. 207 tests passing. |
| 2026-03-15 18:42 | Worker iter 3 | done in 410s, ctx: 48%, tools: 50 |
| 2026-03-15 18:43 | Review R006 | code Step 2: APPROVE |
| 2026-03-15 18:43 | Step 2 complete | Handle schema v1 compatibility |
| 2026-03-15 18:43 | Step 3 started | Testing & Verification |
| 2026-03-15 18:44 | Review R007 | plan Step 3: REVISE |
| 2026-03-15 18:45 | Step 3 hydrated | R007 feedback: 6 granular checkboxes with explicit commands and evidence requirements |
| 2026-03-15 18:46 | Step 3 targeted tests | orch-state-persistence.test.ts: 499 assertions passed, 0 failures |
| 2026-03-15 18:46 | Step 3 full suite | 11 test files, 207 tests, 0 failures |
| 2026-03-15 18:46 | Step 3 CLI smoke | `node bin/taskplane.mjs help` — clean output, exit 0 |
| 2026-03-15 18:46 | Step 3 complete | Testing & Verification |
| 2026-03-15 18:45 | Review R006 | code Step 2: APPROVE |
| 2026-03-15 18:45 | Step 2 complete | Handle schema v1 compatibility |
| 2026-03-15 18:45 | Step 3 started | Testing & Verification |
| 2026-03-15 18:45 | Review R007 | plan Step 3: APPROVE |
| 2026-03-15 18:47 | Worker iter 4 | done in 192s, ctx: 13%, tools: 24 |
| 2026-03-15 18:47 | Worker iter 4 | done in 112s, ctx: 10%, tools: 12 |
| 2026-03-15 18:49 | Review R008 | code Step 3: APPROVE |
| 2026-03-15 18:49 | Step 3 complete | Testing & Verification |
| 2026-03-15 18:49 | Step 4 started | Documentation & Delivery |
| 2026-03-15 18:50 | Review R008 | code Step 3: APPROVE |
| 2026-03-15 18:50 | Step 3 complete | Testing & Verification |
| 2026-03-15 18:50 | Step 4 started | Documentation & Delivery |
| 2026-03-15 18:51 | Review R009 | plan Step 4: REVISE |
| 2026-03-15 18:51 | Review R009 | plan Step 4: REVISE |
| 2026-03-15 18:54 | Worker iter 5 | error (code 3221225786) in 206s, ctx: 23%, tools: 33 |

## Blockers

*None*

## Notes

*Reserved for execution notes*
