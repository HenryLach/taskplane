# TP-001: Workspace Config and Execution Context Foundations — Status

**Current Step:** Not Started
​**Status:** 🔵 Ready for Execution
**Last Updated:** 2026-03-15
**Review Level:** 2
**Review Counter:** 0
**Iteration:** 0
**Size:** M

> **Hydration:** Checkboxes below must be granular — one per unit of work.
> Steps marked `⚠️ Hydrate` will be expanded by the worker.

---

### Step 0: Define workspace/runtime contracts
**Status:** ⬜ Not Started

- [ ] Add workspace-mode types (WorkspaceConfig, repo/routing structures, execution context) in types.ts
- [ ] Define clear validation/error surfaces for invalid workspace configuration

---

### Step 1: Implement workspace config loading
**Status:** ⬜ Not Started

- [ ] Create extensions/taskplane/workspace.ts loader/validator for .pi/taskplane-workspace.yaml
- [ ] Resolve canonical workspace/task roots and repo map with normalized absolute paths

---

### Step 2: Wire orchestrator startup context
**Status:** ⬜ Not Started

- [ ] Load execution context during session start in extension.ts
- [ ] Thread execution context into engine entry points without changing repo-mode defaults

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
|---|------|------|---------|------|

## Discoveries
| Discovery | Disposition | Location |
|-----------|-------------|----------|

## Execution Log
| Timestamp | Action | Outcome |
|-----------|--------|---------|
| 2026-03-15 | Task staged | PROMPT.md and STATUS.md created |

## Blockers

*None*

## Notes

*Reserved for execution notes*
