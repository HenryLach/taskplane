# TP-002: Task-to-Repo Routing and Execution Target Parsing — Status

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

### Step 0: Parse execution target metadata
**Status:** ⬜ Not Started

- [ ] Extend PROMPT parser to read ## Execution Target / Repo: metadata
- [ ] Preserve backward compatibility for prompts that omit execution target

---

### Step 1: Implement routing precedence chain
**Status:** ⬜ Not Started

- [ ] Resolve repo using: prompt repo -> area map -> workspace default repo
- [ ] Emit explicit errors for unresolved or unknown repo IDs (TASK_REPO_UNRESOLVED, TASK_REPO_UNKNOWN)

---

### Step 2: Annotate discovery outputs
**Status:** ⬜ Not Started

- [ ] Attach resolved repoId to parsed tasks before planning
- [ ] Ensure routing errors fail planning with actionable messages

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
