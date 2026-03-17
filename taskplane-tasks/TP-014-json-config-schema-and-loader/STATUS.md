# TP-014: JSON Config Schema and Loader — Status

**Current Step:** Not Started
**Status:** 🔵 Ready for Execution
**Last Updated:** 2026-03-17
**Review Level:** 2
**Review Counter:** 0
**Iteration:** 0
**Size:** M

> **Hydration:** Checkboxes represent meaningful outcomes, not individual code
> changes. Workers expand steps when runtime discoveries warrant it — aim for
> 2-5 outcome-level items per step, not exhaustive implementation scripts.

---

### Step 0: Preflight
**Status:** ⬜ Not Started

- [ ] Read current config loading paths
- [ ] Read YAML config reference docs

---

### Step 1: Define JSON Schema
**Status:** ⬜ Not Started

- [ ] TypeScript interfaces for unified config schema defined
- [ ] Schema merges task-runner + orchestrator settings
- [ ] `configVersion` field included

---

### Step 2: Implement Unified Config Loader
**Status:** ⬜ Not Started

- [ ] `loadProjectConfig()` reads JSON first, falls back to YAML
- [ ] YAML fallback produces identical config shape
- [ ] task-runner and orchestrator both use unified loader

---

### Step 3: Testing & Verification
**Status:** ⬜ Not Started

- [ ] Tests for JSON, YAML fallback, defaults, and schema validation
- [ ] Existing tests pass
- [ ] `cd extensions && npx vitest run`

---

### Step 4: Documentation & Delivery
**Status:** ⬜ Not Started

- [ ] Config reference docs updated
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
| 2026-03-17 | Task staged | PROMPT.md and STATUS.md created |

## Blockers
*None*

## Notes
*Reserved for execution notes*
