# TP-055: Runtime Model Fallback — Status

**Current Step:** Step 0: Preflight
**Status:** 🟡 In Progress
**Last Updated:** 2026-03-24
**Review Level:** 2
**Review Counter:** 0
**Iteration:** 2
**Size:** M

> **Hydration:** Checkboxes represent meaningful outcomes, not individual code
> changes. Workers expand steps when runtime discoveries warrant it — aim for
> 2-5 outcome-level items per step, not exhaustive implementation scripts.

---

### Step 0: Preflight
**Status:** ✅ Complete

- [x] Read `classifyExit()` in `diagnostics.ts`
- [x] Read agent spawn flow in `execution.ts`
- [x] Read Tier 0 recovery patterns in `engine.ts`
- [x] Read config schema in `config-schema.ts`

---

### Step 1: Add Exit Classification for Model Access Errors
**Status:** 🟨 In Progress

- [ ] Add `model_access_error` to exit classification type
- [ ] Update `classifyExit()` to detect model access error patterns (401/403/429, model not found)
- [ ] Ensure classification is distinct from generic `agent_error`

---

### Step 2: Add Model Fallback Config
**Status:** 🟨 In Progress

- [ ] Add `modelFallback` setting to config schema with `"inherit"` default
- [ ] Update config loader to read and default the new field
- [ ] Thread setting through to execution context

---

### Step 3: Implement Fallback in Execution
**Status:** 🟨 In Progress

> ⚠️ Hydrate: Expand based on exact spawn/retry patterns discovered in Steps 0-1

- [ ] Implement model fallback retry for lane workers
- [ ] Implement model fallback for reviewers and merge agents
- [ ] Emit Tier 0 supervisor event on fallback
- [ ] Limit fallback to 1 retry attempt

---

### Step 4: Testing & Verification
**Status:** 🟨 In Progress

- [ ] Create `runtime-model-fallback.test.ts` with classification, config, and fallback tests
- [ ] Full test suite passing
- [ ] Build passes

---

### Step 5: Documentation & Delivery
**Status:** 🟨 In Progress

- [ ] Config reference docs updated with `modelFallback`
- [ ] "Check If Affected" docs reviewed
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
| 2026-03-24 | Task staged | PROMPT.md and STATUS.md created |
| 2026-03-24 17:11 | Task started | Extension-driven execution |
| 2026-03-24 17:11 | Step 0 started | Preflight |
| 2026-03-24 17:11 | Step 1 started | Add Exit Classification for Model Access Errors |
| 2026-03-24 17:11 | Step 2 started | Add Model Fallback Config |
| 2026-03-24 17:11 | Step 3 started | Implement Fallback in Execution |
| 2026-03-24 17:11 | Step 4 started | Testing & Verification |
| 2026-03-24 17:11 | Step 5 started | Documentation & Delivery |
| 2026-03-24 17:11 | Task started | Extension-driven execution |
| 2026-03-24 17:11 | Step 0 started | Preflight |
| 2026-03-24 17:11 | Step 1 started | Add Exit Classification for Model Access Errors |
| 2026-03-24 17:11 | Step 2 started | Add Model Fallback Config |
| 2026-03-24 17:11 | Step 3 started | Implement Fallback in Execution |
| 2026-03-24 17:11 | Step 4 started | Testing & Verification |
| 2026-03-24 17:11 | Step 5 started | Documentation & Delivery |

---

## Blockers

*None*

---

## Notes

*Reserved for execution notes*
