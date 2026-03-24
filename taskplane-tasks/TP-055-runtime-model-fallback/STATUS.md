# TP-055: Runtime Model Fallback — Status

**Current Step:** Step 4: Testing & Verification
**Status:** 🟡 In Progress
**Last Updated:** 2026-03-24
**Review Level:** 2
**Review Counter:** 2
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
**Status:** ✅ Complete

- [x] Add `model_access_error` to exit classification type
- [x] Update `classifyExit()` to detect model access error patterns (401/403/429, model not found)
- [x] Ensure classification is distinct from generic `api_error`

---

### Step 2: Add Model Fallback Config
**Status:** ✅ Complete

- [x] Add `modelFallback` setting to config schema with `"inherit"` default
- [x] Update config loader to read and default the new field
- [x] Thread setting through to execution context

---

### Step 3: Implement Fallback in Execution
**Status:** ✅ Complete

> ⚠️ Hydrate: Expand based on exact spawn/retry patterns discovered in Steps 0-1

- [x] Add `model_fallback` Tier0RecoveryPattern + budget in types.ts
- [x] In engine.ts `attemptWorkerCrashRetry()`, add model_access_error-specific retry path that sets TASKPLANE_MODEL_FALLBACK=1 env var on the retry lane
- [x] In task-runner.ts, read TASKPLANE_MODEL_FALLBACK env var and override worker/reviewer model to empty (inherit session model)
- [x] Emit Tier 0 supervisor event (`model_fallback` pattern) on fallback attempt/success/exhaustion
- [x] Ensure fallback is limited to 1 retry attempt via budget

---

### Step 4: Testing & Verification
**Status:** ✅ Complete

- [x] Create `runtime-model-fallback.test.ts` with classification, config, and fallback tests
- [x] Full test suite passing
- [x] Build passes

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
| R001 | plan | Step 1 | REVISE | .reviews/R001-plan-step1.md |
| R002 | code | Step 1 | REVISE | .reviews/R002-code-step1.md |
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
| 2026-03-24 17:19 | Review R001 | plan Step 1: REVISE |
| 2026-03-24 17:32 | Review R002 | code Step 1: REVISE |

---

## Blockers

*None*

---

## Notes

*Reserved for execution notes*
