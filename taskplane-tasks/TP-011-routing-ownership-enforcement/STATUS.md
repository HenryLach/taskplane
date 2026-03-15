# TP-011: Routing Ownership Enforcement and Strict Workspace Policy — Status

**Current Step:** Step 2: Cover governance scenarios
**Status:** 🟨 In Progress
**Last Updated:** 2026-03-15
**Review Level:** 2
**Review Counter:** 3
**Iteration:** 2
**Size:** M

> **Hydration:** Checkboxes below must be granular — one per unit of work.
> Steps marked `⚠️ Hydrate` will be expanded by the worker.

---

### Step 0: Add strict-routing policy controls
**Status:** ✅ Complete

- [x] Add `strict?: boolean` field to `WorkspaceRoutingConfig` type in `types.ts` (default: `false`)
- [x] Update `loadWorkspaceConfig()` in `workspace.ts` to parse `routing.strict` from YAML
- [x] Add `TASK_ROUTING_STRICT` error code to `DiscoveryError.code` union and `FATAL_DISCOVERY_CODES` in `types.ts`
- [x] Update `resolveTaskRouting()` in `discovery.ts` to enforce strict mode: error when `promptRepoId` is absent
- [x] Add remediation guidance in strict-mode error messages (actionable text pointing to `## Execution Target`)
- [x] Thread `strict` flag from `WorkspaceConfig` through `DiscoveryOptions` into `resolveTaskRouting()`
- [x] Add targeted unit tests in `discovery-routing.test.ts` for strict routing policy (19 tests: 19.x–24.x)

---

### Step 1: Enforce policy during discovery
**Status:** ✅ Complete
**Scope:** Verification-only — all runtime behavior was implemented in Step 0. Step 1 confirms correctness and documents the validation matrix.

- [x] Verify strict mode enforcement already applied in `runDiscovery()` → `resolveTaskRouting()` (workspace mode Step 6 in pipeline)
- [x] Add `TASK_ROUTING_STRICT` to command-surface helper hints in `extension.ts` (`/orch-plan` fatal error block)
- [x] Add `TASK_ROUTING_STRICT` to command-surface helper hints in `engine.ts` (`/orch` fatal error block)
- [x] Validate `routing.strict` type in `workspace.ts` — reject non-boolean values with `WORKSPACE_SCHEMA_INVALID` (close fail-open gap)
- [x] Verify targeted tests for Step 1 changes already exist and pass:
  - Strict config validation: workspace-config.test.ts 1.15–1.19 (5 tests: true/false/omitted/string/number)
  - Strict routing fatal behavior: discovery-routing.test.ts 19.x–22.x (13 tests)
  - End-to-end pipeline: discovery-routing.test.ts 24.x (4 tests)
  - Remediation text visibility: 19.2, 22.2, 24.4 verify error body and formatted output
  - Repo-mode non-regression: 23.x (1 test) confirms strict has no effect in repo mode
- [x] **Decision:** No additional command-surface hint needed beyond existing `/orch-plan` and `/orch` blocks — error body already contains full remediation text (Execution Target template + available repos)

---

### Step 2: Cover governance scenarios
**Status:** ⬜ Not Started

- [ ] Add tests for permissive vs strict routing behavior
- [ ] Ensure repo-mode defaults remain unaffected

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
| R001 | plan | Step 0 | RETHINK | .reviews/R001-plan-step0.md |
| R001 | plan | Step 0 | UNKNOWN | .reviews/R001-plan-step0.md |
| R002 | code | Step 0 | UNKNOWN | .reviews/R002-code-step0.md |
| R003 | plan | Step 1 | UNKNOWN | .reviews/R003-plan-step1.md |
| R002 | code | Step 0 | UNKNOWN | .reviews/R002-code-step0.md |
| R003 | plan | Step 1 | UNKNOWN | .reviews/R003-plan-step1.md |
|---|------|------|---------|------|

## Discoveries
| Discovery | Disposition | Location |
|-----------|-------------|----------|
| Pre-existing failures in orch-state-persistence.test.ts and task-runner-orchestration.test.ts (4 test files, 3 tests) | Noted — not caused by TP-011 changes | extensions/tests/ |
| Step 0 schema/types/parsing were already implemented from prior iteration; only tests were missing | Completed — added 19 tests | extensions/tests/discovery-routing.test.ts |

## Execution Log
| Timestamp | Action | Outcome |
|-----------|--------|---------|
| 2026-03-15 | Task staged | PROMPT.md and STATUS.md created |
| 2026-03-15 15:29 | Task started | Extension-driven execution |
| 2026-03-15 15:29 | Step 0 started | Add strict-routing policy controls |
| 2026-03-15 15:29 | Task started | Extension-driven execution |
| 2026-03-15 15:29 | Step 0 started | Add strict-routing policy controls |
| 2026-03-15 15:31 | Review R001 | plan Step 0: RETHINK |
| 2026-03-15 15:36 | Step 0 hydrated | Expanded to 6 concrete sub-tasks per R001 feedback |
| 2026-03-15 15:36 | Step 0 implemented | types.ts: WorkspaceRoutingConfig.strict, TASK_ROUTING_STRICT error code; workspace.ts: parse routing.strict from YAML; discovery.ts: strict mode enforcement in resolveTaskRouting() |
| 2026-03-15 15:36 | Step 0 verified | All 68 routing tests pass, 40 workspace tests pass |
| 2026-03-15 15:32 | Review R001 | plan Step 0: UNKNOWN |
| 2026-03-15 15:37 | Worker iter 1 | done in 359s, ctx: 37%, tools: 37 |
| 2026-03-15 | Step 0 tests added | 19 new tests (19.x–24.x) for strict routing in discovery-routing.test.ts — 87/87 pass |
| 2026-03-15 15:40 | Worker iter 1 | done in 505s, ctx: 43%, tools: 61 |
| 2026-03-15 15:41 | Review R002 | code Step 0: UNKNOWN |
| 2026-03-15 15:41 | Step 0 complete | Add strict-routing policy controls |
| 2026-03-15 15:41 | Step 1 started | Enforce policy during discovery |
| 2026-03-15 15:44 | Review R003 | plan Step 1: UNKNOWN |
| 2026-03-15 15:44 | Review R002 | code Step 0: UNKNOWN |
| 2026-03-15 15:44 | Step 0 complete | Add strict-routing policy controls |
| 2026-03-15 15:44 | Step 1 started | Enforce policy during discovery |
| 2026-03-15 15:46 | Review R003 | plan Step 1: UNKNOWN |
| 2026-03-15 15:48 | Step 1 verified | All runtime behavior implemented in Step 0; hydrated Step 1 with verification matrix per R003 feedback |
| 2026-03-15 15:48 | Step 1 tests | 87/87 discovery-routing tests pass, 45/45 workspace-config tests pass |
| 2026-03-15 15:48 | Step 1 complete | Enforce policy during discovery (verification-only) |

## Blockers

*None*

## Notes

*Reserved for execution notes*
