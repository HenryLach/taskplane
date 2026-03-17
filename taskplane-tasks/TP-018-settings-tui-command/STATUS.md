# TP-018: /settings TUI Command — Status

**Current Step:** Step 0: Preflight
**Status:** 🟡 In Progress
**Last Updated:** 2026-03-17
**Review Level:** 2
**Review Counter:** 1
**Iteration:** 1
**Size:** L

> **Hydration:** Checkboxes represent meaningful outcomes, not individual code
> changes. Workers expand steps when runtime discoveries warrant it — aim for
> 2-5 outcome-level items per step, not exhaustive implementation scripts.

---

### Step 0: Preflight
**Status:** 🟨 In Progress

- [ ] Read pi's `ctx.ui` API capabilities
- [ ] Read config schema from TP-014
- [ ] Review Layer 2 allowlist and preferences boundary (R001 item 2)
- [ ] Review config root/path semantics in workspace mode (R001 item)
- [ ] Review JSON-first + YAML fallback behavior for write-back alignment (R001 item)
- [ ] Produce preflight findings: field/source inventory with UI control types + layer mapping (R001 item 3)

---

### Step 1: Design Settings Navigation
**Status:** ⬜ Not Started

- [ ] Section groupings and field types defined
- [ ] Layer 1 vs Layer 2 fields identified

---

### Step 2: Implement /settings Command
**Status:** ⬜ Not Started

- [ ] Command registered, section navigation working
- [ ] Field editing with validation
- [ ] Source indicators (project/user/default) displayed

---

### Step 3: Implement Write-Back
**Status:** ⬜ Not Started

- [ ] Layer 1 → project config, Layer 2 → user preferences
- [ ] Confirmation prompt for project config changes

---

### Step 4: Testing & Verification
**Status:** ⬜ Not Started

- [ ] Settings load/display tested
- [ ] Write-back tested
- [ ] `cd extensions && npx vitest run`

---

### Step 5: Documentation & Delivery
**Status:** ⬜ Not Started

- [ ] Commands reference updated
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
| 2026-03-17 17:24 | Review R001 | plan Step 0: REVISE |
| 2026-03-17 17:24 | Review R001 | plan Step 0: REVISE |

## Blockers
*None*

## Notes
*Reserved for execution notes*
