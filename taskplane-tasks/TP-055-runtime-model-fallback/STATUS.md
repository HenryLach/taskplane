# TP-055: Runtime Model Fallback — Status

**Current Step:** Not Started
**Status:** 🔵 Ready for Execution
**Last Updated:** 2026-03-24
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

- [ ] Read `classifyExit()` in `diagnostics.ts`
- [ ] Read agent spawn flow in `execution.ts`
- [ ] Read Tier 0 recovery patterns in `engine.ts`
- [ ] Read config schema in `config-schema.ts`

---

### Step 1: Add Exit Classification for Model Access Errors
**Status:** ⬜ Not Started

- [ ] Add `model_access_error` to exit classification type
- [ ] Update `classifyExit()` to detect model access error patterns (401/403/429, model not found)
- [ ] Ensure classification is distinct from generic `agent_error`

---

### Step 2: Add Model Fallback Config
**Status:** ⬜ Not Started

- [ ] Add `modelFallback` setting to config schema with `"inherit"` default
- [ ] Update config loader to read and default the new field
- [ ] Thread setting through to execution context

---

### Step 3: Implement Fallback in Execution
**Status:** ⬜ Not Started

> ⚠️ Hydrate: Expand based on exact spawn/retry patterns discovered in Steps 0-1

- [ ] Implement model fallback retry for lane workers
- [ ] Implement model fallback for reviewers and merge agents
- [ ] Emit Tier 0 supervisor event on fallback
- [ ] Limit fallback to 1 retry attempt

---

### Step 4: Testing & Verification
**Status:** ⬜ Not Started

- [ ] Create `runtime-model-fallback.test.ts` with classification, config, and fallback tests
- [ ] Full test suite passing
- [ ] Build passes

---

### Step 5: Documentation & Delivery
**Status:** ⬜ Not Started

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

---

## Blockers

*None*

---

## Notes

*Reserved for execution notes*
