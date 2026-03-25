# TP-058: Supervisor Template Pattern — Status

**Current Step:** Step 2: Refactor Prompt Building to Use Templates
**Status:** 🟡 In Progress
**Last Updated:** 2026-03-25
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

- [x] Read `buildSupervisorSystemPrompt()` and `buildRoutingSystemPrompt()` in supervisor.ts
- [x] Read worker base template format and `loadAgentDef()` composition pattern
- [x] Read `handleInit()` for template copy flow

---

### Step 1: Create Base and Local Templates
**Status:** ✅ Complete

- [x] Create `templates/agents/supervisor.md` with static prompt sections and template variables
- [x] Create routing template (separate file or marked section)
- [x] Create `templates/agents/local/supervisor.md` scaffold following existing pattern

---

### Step 2: Refactor Prompt Building to Use Templates
**Status:** 🟨 In Progress

- [ ] Add `loadSupervisorTemplate()` helper that uses `findPackageRoot()` + `parseAgentFile()` patterns from task-runner.ts to load base template + compose local override
- [ ] Refactor `buildSupervisorSystemPrompt()` to load template and replace `{{placeholders}}` with dynamic values (batchContext, guardrails, autonomy, paths)
- [ ] Refactor `buildRoutingSystemPrompt()` to load routing template and replace `{{placeholders}}` (scriptGuidance, routingState, contextMessage, primerPath)
- [ ] Implement fallback: if template file missing, use current inline prompt unchanged

---

### Step 3: Update Init and Onboarding
**Status:** 🟨 In Progress

- [ ] Add supervisor template copy to `handleInit()` in extension.ts
- [ ] Update `taskplane doctor` to check for supervisor template

---

### Step 4: Testing & Verification
**Status:** 🟨 In Progress

- [ ] Create `supervisor-template.test.ts` with template, composition, fallback, and init tests
- [ ] Full test suite passing
- [ ] Build passes

---

### Step 5: Documentation & Delivery
**Status:** 🟨 In Progress

- [ ] Update supervisor-primer.md
- [ ] "Check If Affected" docs reviewed
- [ ] Discoveries logged
- [ ] `.DONE` created

---

## Reviews

| # | Type | Step | Verdict | File |
| R001 | plan | Step 1 | APPROVE | .reviews/R001-plan-step1.md |
| R002 | plan | Step 2 | APPROVE | .reviews/R002-plan-step2.md |
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
| 2026-03-25 02:24 | Task started | Extension-driven execution |
| 2026-03-25 02:24 | Step 0 started | Preflight |
| 2026-03-25 02:24 | Step 1 started | Create Base and Local Templates |
| 2026-03-25 02:24 | Step 2 started | Refactor Prompt Building to Use Templates |
| 2026-03-25 02:24 | Step 3 started | Update Init and Onboarding |
| 2026-03-25 02:24 | Step 4 started | Testing & Verification |
| 2026-03-25 02:24 | Step 5 started | Documentation & Delivery |
| 2026-03-25 02:24 | Task started | Extension-driven execution |
| 2026-03-25 02:24 | Step 0 started | Preflight |
| 2026-03-25 02:24 | Step 1 started | Create Base and Local Templates |
| 2026-03-25 02:24 | Step 2 started | Refactor Prompt Building to Use Templates |
| 2026-03-25 02:24 | Step 3 started | Update Init and Onboarding |
| 2026-03-25 02:24 | Step 4 started | Testing & Verification |
| 2026-03-25 02:24 | Step 5 started | Documentation & Delivery |
| 2026-03-25 02:29 | Review R001 | plan Step 1: APPROVE |
| 2026-03-25 02:31 | Review R002 | plan Step 2: APPROVE |

---

## Blockers

*None*

---

## Notes

*This task is also a production test for TP-057 (persistent reviewer context). With review level 2 and 5 implementation steps, expect ~8 reviews through the same persistent reviewer session.*
