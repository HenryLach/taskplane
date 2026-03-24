# TP-047: Context Window Auto-Detect — Status

**Current Step:** Step 1: Auto-detect context window from pi model registry
**Status:** 🟡 In Progress
**Last Updated:** 2026-03-24
**Review Level:** 1
**Review Counter:** 0
**Iteration:** 2
**Size:** S

> **Hydration:** Checkboxes represent meaningful outcomes, not individual code
> changes. Workers expand steps when runtime discoveries warrant it.

---

### Step 0: Preflight
**Status:** ✅ Complete

- [x] Read task-runner.ts and locate all `worker_context_window`, `warn_percent`, `kill_percent` references
- [x] Read config-schema.ts and config-loader.ts to understand config chain
- [x] Verify `ctx.model.contextWindow` is accessible in extension context

---

### Step 1: Auto-detect context window from pi model registry
**Status:** 🟨 In Progress

- [ ] Change config default to signal "auto-detect" (0 or undefined)
- [ ] Add runtime resolution: user config → ctx.model.contextWindow → 200K fallback
- [ ] Update config-schema.ts and config-loader.ts defaults
- [ ] Log resolved context window at worker spawn time

---

### Step 2: Update warn_percent and kill_percent defaults
**Status:** ⬜ Not Started

- [ ] Change warn_percent default from 70 to 85
- [ ] Change kill_percent default from 85 to 95
- [ ] Update all three source locations (task-runner.ts, config-schema.ts, config-loader.ts)
- [ ] Update template task-runner.yaml

---

### Step 3: Testing & Verification
**Status:** ⬜ Not Started

- [ ] All existing tests pass
- [ ] Tests for context window resolution (explicit > auto-detect > fallback)
- [ ] Tests for new warn/kill defaults

---

### Step 4: Documentation & Delivery
**Status:** ⬜ Not Started

- [ ] Template task-runner.yaml updated with auto-detect explanation
- [ ] Check affected docs
- [ ] Discoveries logged
- [ ] `.DONE` created

---

## Reviews

| # | Type | Step | Verdict | File |
|---|------|------|---------|------|

---

## Discoveries

| Discovery | Disposition | Location |
|-----------|-------------|----------|

---

## Execution Log

| Timestamp | Action | Outcome |
|-----------|--------|---------|
| 2026-03-23 | Task staged | PROMPT.md and STATUS.md created |
| 2026-03-24 00:14 | Task started | Extension-driven execution |
| 2026-03-24 00:14 | Step 0 started | Preflight |
| 2026-03-24 00:14 | Skip plan review | Step 0 (Preflight) — low-risk |
| 2026-03-24 00:14 | Task started | Extension-driven execution |
| 2026-03-24 00:14 | Step 0 started | Preflight |
| 2026-03-24 00:14 | Skip plan review | Step 0 (Preflight) — low-risk |
| 2026-03-24 00:16 | Worker iter 2 | done in 127s, ctx: 37%, tools: 24 |
| 2026-03-24 00:16 | Step 0 complete | Preflight |
| 2026-03-24 00:16 | Step 1 started | Auto-detect context window from pi model registry |

---

## Blockers

*None*

---

## Notes

*Reserved for execution notes*
