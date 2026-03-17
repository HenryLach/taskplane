# TP-016: Pointer File Resolution Chain — Status

**Current Step:** Step 0: Preflight
**Status:** 🟡 In Progress
**Last Updated:** 2026-03-17
**Review Level:** 2
**Review Counter:** 1
**Iteration:** 1
**Size:** M

> **Hydration:** Checkboxes represent meaningful outcomes, not individual code
> changes. Workers expand steps when runtime discoveries warrant it — aim for
> 2-5 outcome-level items per step, not exhaustive implementation scripts.

---

### Step 0: Preflight
**Status:** 🟨 In Progress

- [ ] Inventory all config/agent/state resolution call sites (resolution map)
- [ ] Document mode matrix: repo mode vs workspace mode (pointer present/missing/invalid)
- [ ] Document env-var precedence interactions (TASKPLANE_WORKSPACE_ROOT, ORCH_SIDECAR_DIR, pointer)

---

### Step 1: Implement Pointer Resolution
**Status:** ⬜ Not Started

- [ ] `resolvePointer()` function created and validated
- [ ] Returns resolved paths for config, agents, and state

---

### Step 2: Thread Through Task-Runner
**Status:** ⬜ Not Started

- [ ] Agent and config loading uses pointer in workspace mode
- [ ] Repo mode unchanged

---

### Step 3: Thread Through Orchestrator
**Status:** ⬜ Not Started

- [ ] `buildExecutionContext()` uses pointer
- [ ] Sidecar and merge agent paths use pointer

---

### Step 4: Thread Through Dashboard
**Status:** ⬜ Not Started

- [ ] Dashboard follows pointer for state and STATUS.md

---

### Step 5: Testing & Verification
**Status:** ⬜ Not Started

- [ ] Pointer resolution tests
- [ ] `cd extensions && npx vitest run`

---

### Step 6: Documentation & Delivery
**Status:** ⬜ Not Started

- [ ] `.DONE` created
- [ ] Archive and push

---

## Reviews
| # | Type | Step | Verdict | File |
| R001 | plan | Step 0 | REVISE | .reviews/R001-plan-step0.md |
| R001 | plan | Step 0 | REVISE | .reviews/R001-plan-step0.md |
|---|------|------|---------|------|

## Discoveries
| Discovery | Disposition | Location |
|-----------|-------------|----------|

## Execution Log
| Timestamp | Action | Outcome |
|-----------|--------|---------|
| 2026-03-17 | Task staged | PROMPT.md and STATUS.md created |
| 2026-03-17 17:23 | Task started | Extension-driven execution |
| 2026-03-17 17:23 | Step 0 started | Preflight |
| 2026-03-17 17:23 | Task started | Extension-driven execution |
| 2026-03-17 17:23 | Step 0 started | Preflight |
| 2026-03-17 17:25 | Review R001 | plan Step 0: REVISE |
| 2026-03-17 17:25 | Review R001 | plan Step 0: REVISE |

## Blockers
*None*

## Notes
*Reserved for execution notes*
