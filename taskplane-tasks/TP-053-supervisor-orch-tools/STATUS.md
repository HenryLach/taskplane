# TP-053: Expose Orchestrator Commands as Tools for Supervisor Agent — Status

**Current Step:** Step 4: Documentation & Delivery
**Status:** 🟡 In Progress
**Last Updated:** 2026-03-24
**Review Level:** 2
**Review Counter:** 2
**Iteration:** 2
**Size:** M

---

### Step 0: Preflight
**Status:** ✅ Complete

- [x] Read each command handler (resume, integrate, pause, abort, status)
- [x] Read review_step tool registration as pattern reference
- [x] Understand pi registerTool() API
- [x] Identify execCtx dependencies per command

---

### Step 1: Register orchestrator tools
**Status:** ✅ Complete

- [x] Add `Type` import from `@mariozechner/pi-ai` to extension.ts
- [x] Extract `doOrchStatus` helper (shared by command + tool)
- [x] Extract `doOrchPause` helper (shared by command + tool)
- [x] Extract `doOrchResume` helper (shared by command + tool) — returns status message, calls startBatchAsync internally
- [x] Extract `doOrchAbort` helper (shared by command + tool) — works without execCtx
- [x] Extract `doOrchIntegrate` helper (shared by command + tool) — wraps parseIntegrateArgs + resolveIntegrationContext + executeIntegration
- [x] Refactor existing command handlers to call the extracted helpers
- [x] Register all 5 tools with Type.Object parameters, description, promptSnippet, promptGuidelines
- [x] Verify all tools return `{content: [{type: "text", text}], details: undefined}` and catch errors

---

### Step 2: Update supervisor prompt with tool awareness
**Status:** ✅ Complete

- [x] Add Available Orchestrator Tools section to supervisor monitoring prompt
- [x] Include tool names, parameters, and usage guidance
- [x] Add proactive usage examples

---

### Step 3: Testing & Verification
**Status:** ✅ Complete

- [x] All existing tests pass
- [x] Tests for each tool registration (5 tools)
- [x] Tests for tool parameter schemas
- [x] Tests for supervisor prompt mentions tools

---

### Step 4: Documentation & Delivery
**Status:** 🟨 In Progress

- [ ] Check affected docs
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
| 2026-03-24 15:00 | Task started | Extension-driven execution |
| 2026-03-24 15:00 | Step 0 started | Preflight |
| 2026-03-24 15:00 | Step 1 started | Register orchestrator tools |
| 2026-03-24 15:00 | Step 2 started | Update supervisor primer/prompt with tool awareness |
| 2026-03-24 15:00 | Step 3 started | Testing & Verification |
| 2026-03-24 15:00 | Step 4 started | Documentation & Delivery |
| 2026-03-24 15:00 | Task started | Extension-driven execution |
| 2026-03-24 15:00 | Step 0 started | Preflight |
| 2026-03-24 15:00 | Step 1 started | Register orchestrator tools |
| 2026-03-24 15:00 | Step 2 started | Update supervisor primer/prompt with tool awareness |
| 2026-03-24 15:00 | Step 3 started | Testing & Verification |
| 2026-03-24 15:00 | Step 4 started | Documentation & Delivery |
| 2026-03-24 15:07 | Review R001 | plan Step 1: REVISE |
| 2026-03-24 15:26 | Review R002 | code Step 1: REVISE |

---

## Blockers

*None*

---

## Notes

*Reserved for execution notes*
