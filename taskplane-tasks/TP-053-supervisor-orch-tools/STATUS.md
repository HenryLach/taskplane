# TP-053: Expose Orchestrator Commands as Tools for Supervisor Agent — Status

**Current Step:** Not Started
**Status:** 🔵 Ready for Execution
**Last Updated:** 2026-03-24
**Review Level:** 2
**Review Counter:** 0
**Iteration:** 0
**Size:** M

---

### Step 0: Preflight
**Status:** ⬜ Not Started

- [ ] Read each command handler (resume, integrate, pause, abort, status)
- [ ] Read review_step tool registration as pattern reference
- [ ] Understand pi registerTool() API
- [ ] Identify execCtx dependencies per command

---

### Step 1: Register orchestrator tools
**Status:** ⬜ Not Started

> ⚠️ Hydrate: Expand based on exact command handler structure found in Step 0

- [ ] Extract shared logic from each command handler into internal functions
- [ ] Register orch_resume tool with force parameter
- [ ] Register orch_integrate tool with mode/force/branch parameters
- [ ] Register orch_pause tool
- [ ] Register orch_abort tool with hard parameter
- [ ] Register orch_status tool
- [ ] All tools return text results, catch errors gracefully

---

### Step 2: Update supervisor prompt with tool awareness
**Status:** ⬜ Not Started

- [ ] Add Available Orchestrator Tools section to supervisor monitoring prompt
- [ ] Include tool names, parameters, and usage guidance
- [ ] Add proactive usage examples

---

### Step 3: Testing & Verification
**Status:** ⬜ Not Started

- [ ] All existing tests pass
- [ ] Tests for each tool registration (5 tools)
- [ ] Tests for tool parameter schemas
- [ ] Tests for supervisor prompt mentions tools

---

### Step 4: Documentation & Delivery
**Status:** ⬜ Not Started

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
| 2026-03-24 | Task staged | PROMPT.md and STATUS.md created |

---

## Blockers

*None*

---

## Notes

*Reserved for execution notes*
