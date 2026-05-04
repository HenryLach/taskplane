# TP-183: Soft-fail orchestrator startup when Taskplane is not configured — Status

**Current Step:** Not Started
**Status:** 🔵 Ready for Execution
**Last Updated:** 2026-05-03
**Review Level:** 2
**Review Counter:** 0
**Iteration:** 0
**Size:** M

> **Hydration:** Checkboxes represent meaningful outcomes, not individual code
> changes. Workers expand steps when runtime discoveries warrant it.

---

### Step 0: Preflight
**Status:** ⬜ Not Started

- [ ] On `main`, working tree clean
- [ ] Baseline test count recorded
- [ ] Tier 3 source files read and understood
- [ ] Bug reproduced locally (red error in non-git, non-taskplane dir)

---

### Step 1: Decide and document the soft-fail policy
**Status:** ⬜ Not Started

> ⚠️ Plan-review checkpoint. Decision logged in Discoveries before code changes.

- [ ] Decision recorded: always-on soft-fail vs opt-in-to-loud config flag
- [ ] Decision recorded: what the quiet path displays (no notify, quiet status line)
- [ ] Decision confirmed: only `WORKSPACE_SETUP_REQUIRED` becomes quiet; other codes stay loud
- [ ] Rationale paragraph written into Discoveries

---

### Step 2: Implement the soft-fail branch
**Status:** ⬜ Not Started

- [ ] `extension.ts` setupError branch updated: no error notify, quiet status line
- [ ] Non-setupError branch (config invalid) untouched and still loud
- [ ] Orchestrator commands still gracefully disabled (existing short-circuit preserved)

---

### Step 3: Add tests for the new behavior
**Status:** ⬜ Not Started

- [ ] New `orchestrator-startup-uxv2.test.ts` created with three scenarios:
   - [ ] `WORKSPACE_SETUP_REQUIRED` → no error notify, quiet status, commands disabled
   - [ ] `WORKSPACE_CONFIG_INVALID` → loud notify still fires (regression guard)
   - [ ] Successful config load → no notify, ready status (sanity baseline)
- [ ] Existing `workspace-config.integration.test.ts` throw test still passes
- [ ] Targeted test run is green

---

### Step 4: Testing & Verification
**Status:** ⬜ Not Started

- [ ] FULL test suite (incl. integration) passing
- [ ] Pass count = baseline + 3
- [ ] Manual smoke: non-git dir → no red error, quiet status
- [ ] Manual smoke: malformed taskplane config → red error still appears

---

### Step 5: Documentation & Delivery
**Status:** ⬜ Not Started

- [ ] `CHANGELOG.md` Unreleased / Fixed entry with @mwickens attribution
- [ ] If config flag added: `taskplane-settings.md` updated
- [ ] Issue #523 comment drafted (post-merge)
- [ ] Discoveries logged

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
| 2026-05-03 | Task staged | PROMPT.md and STATUS.md created |

---

## Blockers

*None*

---

## Notes

*Reserved for execution notes*
