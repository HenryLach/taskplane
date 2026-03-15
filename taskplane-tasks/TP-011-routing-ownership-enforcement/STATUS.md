# TP-011: Routing Ownership Enforcement and Strict Workspace Policy — Status

**Current Step:** Step 4: Documentation & Delivery
**Status:** 🟨 In Progress
**Last Updated:** 2026-03-15
**Review Level:** 2
**Review Counter:** 9
**Iteration:** 5
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
- [x] Add targeted tests for Step 1 changes:
  - Strict config validation: workspace-config.test.ts 1.15–1.19 (5 tests: true/false/omitted/string/number)
  - Command-surface hint verification: discovery-routing.test.ts 25.x (6 tests: source verification of extension.ts + engine.ts handling)
  - Strict routing fatal behavior: discovery-routing.test.ts 19.x–22.x (13 tests from Step 0)
  - End-to-end pipeline: discovery-routing.test.ts 24.x (4 tests from Step 0)
  - Remediation text visibility: 19.2, 22.2, 24.4 verify error body and formatted output
  - Repo-mode non-regression: 23.x (1 test) confirms strict has no effect in repo mode

---

### Step 2: Cover governance scenarios
**Status:** ✅ Complete
**Scope:** Incremental — fix `routing.strict: null` fail-open gap, add governance edge-case tests, document coverage matrix.

**Coverage Matrix (acceptance → test IDs):**
| Acceptance Bullet | Existing Tests | New Tests (Step 2) |
|---|---|---|
| Permissive routing behavior | 21.1–21.3, 24.3 | 27.2, 27.5 |
| Strict routing rejection | 19.1–19.5, 20.3, 24.1, 24.4 | 27.3, 27.4 |
| Strict routing acceptance | 20.1–20.2, 24.2 | 27.3 |
| Strict + unknown repo interaction | 20.2 | 27.1 (runDiscovery pipeline) |
| Strict blocks area fallback (governance) | 19.4 | 27.4 (explicit contrast pair) |
| Permissive allows area fallback | 21.1 | 27.5 (explicit contrast pair) |
| Mixed tasks strict pipeline | 20.3 | 27.3 (runDiscovery-level) |
| Repo-mode unaffected | 8.1, 18.3, 23.1 | 26.1 (runDiscovery-level repo-mode non-regression) |
| `routing.strict: null` rejected | — | 1.20 (workspace-config.test.ts) |
| Config → runtime strict pipeline | 1.15–1.19 | 1.20 (null edge case) |
| TASK_ROUTING_STRICT fatal classification | 22.1–22.3 | — (verified) |

- [x] Fix `routing.strict: null` fail-open gap in `workspace.ts` — reject null with `WORKSPACE_SCHEMA_INVALID`
- [x] Add test 1.20 in `workspace-config.test.ts`: `routing.strict: null` (bare YAML value) throws `WORKSPACE_SCHEMA_INVALID`
- [x] Add test 26.1 in `discovery-routing.test.ts`: repo-mode `runDiscovery` with strict-like task areas still skips routing
- [x] Add tests 27.1–27.5 in `discovery-routing.test.ts`: governance scenarios (strict+unknown, permissive+default, mixed pipeline, strict blocks area fallback, permissive allows area fallback)
- [x] Verify all existing governance tests pass (19.x–27.x, 1.15–1.20)
- [x] Run full test suite: 145/145 (discovery-routing + workspace-config); pre-existing failures only in unrelated modules

---

### Step 3: Testing & Verification
**Status:** ✅ Complete

- [x] Unit/regression tests passing — 202/205 pass; 3 failures are pre-existing in unrelated modules (orch-state-persistence, task-runner-orchestration, orch-pure-functions, orch-direct-implementation)
- [x] Targeted tests for changed modules passing — 145/145 pass (99 discovery-routing + 46 workspace-config)
- [x] All failures fixed — all TP-011-related tests pass; pre-existing failures documented in Discoveries
- [x] CLI smoke checks passing — `taskplane help` and `taskplane doctor` both execute successfully

---

### Step 4: Documentation & Delivery
**Status:** 🟨 In Progress

**4.1 — Update `.pi/local/docs/taskplane/polyrepo-support-spec.md` (Must Update)**
- [x] Add new section documenting `routing.strict` semantics (workspace-mode only, default `false`)
- [x] Document strict enforcement behavior during discovery (`TASK_ROUTING_STRICT` error when prompt target missing)
- [x] Document config validation guardrails (`routing.strict` must be boolean; `null` rejected as `WORKSPACE_SCHEMA_INVALID`)
- [x] Document recommended team policy: require explicit `## Execution Target` in PROMPT.md for multi-team workspaces

**4.2 — Review `docs/reference/configuration/task-orchestrator.yaml.md` (Check If Affected)**
- [x] Record decision: **NOT updated** — `routing.strict` is a workspace config field (`WorkspaceRoutingConfig` in `types.ts`, parsed in `workspace.ts` from `.pi/taskplane-workspace.yaml`), not an orchestrator config field. `task-orchestrator.yaml.md` documents `.pi/task-orchestrator.yaml` schema only. No changes needed.

**4.3 — Finalize STATUS.md**
- [x] Discoveries table complete (all findings from Steps 0–4)
- [ ] Execution log updated with Step 4 completion

**4.4 — Pre-`.DONE` gate**
- [x] Confirm all TP-011-related tests pass (targeted: 145/145 — 99 discovery-routing + 46 workspace-config)
- [x] Confirm pre-existing failures are documented in Discoveries and not caused by TP-011 (3 pre-existing failures in unrelated modules)
- [x] Confirm prompt completion criteria met: all steps complete, docs updated, tests passing

**4.5 — Create `.DONE`**
- [ ] `.DONE` created in task folder

---

## Reviews
| # | Type | Step | Verdict | File |
| R001 | plan | Step 0 | RETHINK | .reviews/R001-plan-step0.md |
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
|---|------|------|---------|------|

## Discoveries
| Discovery | Disposition | Location |
|-----------|-------------|----------|
| Pre-existing failures in orch-state-persistence.test.ts and task-runner-orchestration.test.ts (4 test files, 3 tests) | Noted — not caused by TP-011 changes | extensions/tests/ |
| Step 0 schema/types/parsing were already implemented from prior iteration; only tests were missing | Completed — added 19 tests | extensions/tests/discovery-routing.test.ts |
| `routing.strict: null` fail-open gap: bare YAML `strict:` or explicit `null` was treated as falsy (permissive), bypassing strict enforcement silently | Fixed in Step 2 — null now rejected with `WORKSPACE_SCHEMA_INVALID` | extensions/taskplane/workspace.ts |
| `routing.strict` lives in workspace config (`.pi/taskplane-workspace.yaml`), not orchestrator config (`.pi/task-orchestrator.yaml`) | No changes to `task-orchestrator.yaml.md` needed | extensions/taskplane/types.ts, workspace.ts |
| Step 1 was verification-only: all runtime enforcement was already implemented in Step 0 | Documented in Step 1 scope note; added 11 verification tests instead | extensions/tests/ |

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
| 2026-03-15 15:48 | Step 1 tests | 93/93 discovery-routing tests pass (87+6 new §25.x), 45/45 workspace-config tests pass (40+5 new §1.15–1.19) |
| 2026-03-15 15:48 | Step 1 complete | Enforce policy during discovery (verification-only) |
| 2026-03-15 15:49 | Worker iter 2 | done in 210s, ctx: 32%, tools: 35 |
| 2026-03-15 15:50 | Worker iter 2 | done in 397s, ctx: 47%, tools: 62 |
| 2026-03-15 15:51 | Review R004 | code Step 1: UNKNOWN |
| 2026-03-15 15:51 | Step 1 complete | Enforce policy during discovery |
| 2026-03-15 15:51 | Step 2 started | Cover governance scenarios |
| 2026-03-15 15:53 | Review R004 | code Step 1: UNKNOWN |
| 2026-03-15 15:53 | Step 1 complete | Enforce policy during discovery |
| 2026-03-15 15:53 | Step 2 started | Cover governance scenarios |
| 2026-03-15 15:53 | Review R005 | plan Step 2: UNKNOWN |
| 2026-03-15 15:54 | Review R005 | plan Step 2: UNKNOWN |
| 2026-03-15 | Step 2 implemented | Added 5 governance tests (27.1–27.5): strict+unknown pipeline, permissive+default pipeline, strict mixed pipeline, strict blocks area fallback, permissive allows area fallback |
| 2026-03-15 | Step 2 verified | 99/99 discovery-routing tests pass, 46/46 workspace-config tests pass |
| 2026-03-15 | Step 2 complete | Cover governance scenarios (incremental coverage) |
| 2026-03-15 15:58 | Worker iter 3 | done in 242s, ctx: 29%, tools: 38 |
| 2026-03-15 15:59 | Worker iter 3 | done in 338s, ctx: 34%, tools: 46 |
| 2026-03-15 16:00 | Review R006 | code Step 2: UNKNOWN |
| 2026-03-15 16:00 | Step 2 complete | Cover governance scenarios |
| 2026-03-15 16:00 | Step 3 started | Testing & Verification |
| 2026-03-15 16:00 | Review R006 | code Step 2: UNKNOWN |
| 2026-03-15 16:00 | Step 2 complete | Cover governance scenarios |
| 2026-03-15 16:00 | Step 3 started | Testing & Verification |
| 2026-03-15 16:03 | Review R007 | plan Step 3: UNKNOWN |
| 2026-03-15 16:03 | Review R007 | plan Step 3: UNKNOWN |
| 2026-03-15 | Step 3 verified | Full test suite: 202/205 pass (3 pre-existing failures); targeted: 145/145 pass; CLI smoke: help + doctor pass |
| 2026-03-15 | Step 3 complete | Testing & Verification |
| 2026-03-15 16:06 | Worker iter 4 | done in 160s, ctx: 12%, tools: 18 |
| 2026-03-15 16:06 | Worker iter 4 | done in 235s, ctx: 13%, tools: 26 |
| 2026-03-15 16:08 | Review R008 | code Step 3: UNKNOWN |
| 2026-03-15 16:08 | Step 3 complete | Testing & Verification |
| 2026-03-15 16:08 | Step 4 started | Documentation & Delivery |
| 2026-03-15 16:09 | Review R008 | code Step 3: UNKNOWN |
| 2026-03-15 16:09 | Step 3 complete | Testing & Verification |
| 2026-03-15 16:09 | Step 4 started | Documentation & Delivery |
| 2026-03-15 16:10 | Review R009 | plan Step 4: UNKNOWN |
| 2026-03-15 16:12 | Review R009 | plan Step 4: UNKNOWN |

## Blockers

*None*

## Notes

*Reserved for execution notes*
