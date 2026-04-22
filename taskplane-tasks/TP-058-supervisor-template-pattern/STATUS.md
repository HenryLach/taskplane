# TP-058: Supervisor Template Pattern — Status

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

- [ ] Read `buildSupervisorSystemPrompt()` and `buildRoutingSystemPrompt()` in supervisor.ts
- [ ] Read worker base template format and `loadAgentDef()` composition pattern
- [ ] Read `handleInit()` for template copy flow

---

### Step 1: Create Base and Local Templates
**Status:** ⬜ Not Started

- [ ] Create `templates/agents/supervisor.md` with static prompt sections and template variables
- [ ] Create routing template (separate file or marked section)
- [ ] Create `templates/agents/local/supervisor.md` scaffold following existing pattern

---

### Step 2: Refactor Prompt Building to Use Templates
**Status:** ⬜ Not Started

> ⚠️ Hydrate: Expand based on actual static vs dynamic content split discovered in Step 0

- [ ] Refactor `buildSupervisorSystemPrompt()` to load base template and inject dynamic values
- [ ] Refactor `buildRoutingSystemPrompt()` to load template and inject values
- [ ] Append local override (`.pi/agents/supervisor.md`) when present
- [ ] Implement fallback to inline prompt when template is missing

---

### Step 3: Update Init and Onboarding
**Status:** ⬜ Not Started

- [ ] Add supervisor template copy to `handleInit()` in extension.ts
- [ ] Update `taskplane doctor` to check for supervisor template

---

### Step 4: Testing & Verification
**Status:** ⬜ Not Started

- [ ] Create `supervisor-template.test.ts` with template, composition, fallback, and init tests
- [ ] Full test suite passing
- [ ] Build passes

---

### Step 5: Documentation & Delivery
**Status:** ⬜ Not Started

- [ ] Update supervisor-primer.md
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

*This task is also a production test for TP-057 (persistent reviewer context). With review level 2 and 5 implementation steps, expect ~8 reviews through the same persistent reviewer session.*
