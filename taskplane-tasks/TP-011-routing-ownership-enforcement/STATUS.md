# TP-011: Routing Ownership Enforcement and Strict Workspace Policy — Status

**Current Step:** Step 0: Add strict-routing policy controls
​**Status:** ✅ Complete
**Last Updated:** 2026-03-15
**Review Level:** 2
**Review Counter:** 1
**Iteration:** 1
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

---

### Step 1: Enforce policy during discovery
**Status:** ⬜ Not Started

- [ ] Apply strict mode validation in workspace-mode discovery pipeline
- [ ] Emit clear errors with remediation instructions for contributors

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
|---|------|------|---------|------|

## Discoveries
| Discovery | Disposition | Location |
|-----------|-------------|----------|

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

## Blockers

*None*

## Notes

*Reserved for execution notes*
