# TP-183: Soft-fail orchestrator startup when Taskplane is not configured — Status

**Current Step:** Step 4: Testing & Verification
**Status:** 🟡 In Progress
**Last Updated:** 2026-05-05
**Review Level:** 2
**Review Counter:** 0
**Iteration:** 1
**Size:** M

> **Hydration:** Checkboxes represent meaningful outcomes, not individual code
> changes. Workers expand steps when runtime discoveries warrant it.

---

### Step 0: Preflight
**Status:** ✅ Complete

- [x] On `main`, working tree clean
- [x] Baseline test count recorded — 3446 tests, 3445 pass, 1 skipped, 0 fail
- [x] Tier 3 source files read and understood
- [x] Bug reproduced locally (verified by reading code; non-git cwd raises WORKSPACE_SETUP_REQUIRED → notify(error) + setStatus(loud) at extension.ts:4828–4865)

---

### Step 1: Decide and document the soft-fail policy
**Status:** ✅ Complete

> ⚠️ Plan-review checkpoint. Decision logged in Discoveries before code changes.

- [x] Decision recorded: always-on soft-fail vs opt-in-to-loud config flag — **always-on** (no flag)
- [x] Decision recorded: what the quiet path displays — no `notify`; status line `"🔀 Orchestrator · disabled (no taskplane config in workspace)"`
- [x] Decision confirmed: only `WORKSPACE_SETUP_REQUIRED` becomes quiet; other codes stay loud
- [x] Rationale paragraph written into Discoveries

---

### Step 2: Implement the soft-fail branch
**Status:** ✅ Complete

- [x] `extension.ts` setupError branch updated: no error notify, quiet status line `"🔀 Orchestrator · disabled (no taskplane config in workspace)"`
- [x] Non-setupError branch (config invalid) untouched and still loud
- [x] Orchestrator commands still gracefully disabled — `execCtx` stays `null`, `execCtxInitError` stays populated, `requireExecCtx` / `getExecCtxInitErrorMessage` short-circuit preserved

---

### Step 3: Add tests for the new behavior
**Status:** ✅ Complete

- [x] New `orchestrator-startup-uxv2.test.ts` created with three scenarios (split into 6 fine-grained checks):
   - [x] `WORKSPACE_SETUP_REQUIRED` → no error notify, quiet status, commands disabled (3 checks)
   - [x] `WORKSPACE_CONFIG_INVALID` → loud notify still fires (regression guard) (2 checks)
   - [x] Successful config load → success path bypasses catch arm (sanity baseline) (1 check)
- [x] Existing `workspace-config.integration.test.ts` throw test still passes (94/94 unchanged)
- [x] Targeted test run is green: 100/100 (94 existing + 6 new)

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
| Soft-fail policy: always-on for `WORKSPACE_SETUP_REQUIRED`, no config flag. Rationale: the error code's semantic meaning is "user did not configure Taskplane in this directory" — by definition there is no scenario where a user wants the red wall of text in that case. Adding an opt-in-to-loud flag (`taskRunner.requireWorkspaceSetup`) would just be ceremony for a hypothetical user that doesn't exist; if such a user emerges later we can add the flag without breaking the new default. Quiet path: skip `ctx.ui.notify(…, "error")` for the setup case, set a non-error status line `"🔀 Orchestrator · disabled (no taskplane config in workspace)"`, keep `execCtxInitError` populated so `getExecCtxInitErrorMessage()` (used by command guards) still tells users why orch commands are unavailable when they actually try to invoke one. `WORKSPACE_CONFIG_INVALID` and every other `WorkspaceConfigErrorCode` continue to call the loud `notify(…, "error")` and the loud status line — those are real misconfigurations and the user needs to see them. | Implemented | extension.ts session_start handler |
| Test approach: source-pattern checks (matching the existing `5.x` suite in `workspace-config.integration.test.ts`). The repo has no fake-pi infrastructure for invoking `pi.on("session_start")` handlers in tests, and refactoring extension.ts to expose a unit-testable helper would expand scope beyond a soft-fail tweak. Source patterns are the established model for verifying the catch block's display behavior. | Implemented | tests/orchestrator-startup-uxv2.test.ts |

---

## Execution Log

| Timestamp | Action | Outcome |
|-----------|--------|---------|
| 2026-05-03 | Task staged | PROMPT.md and STATUS.md created |
| 2026-05-05 03:40 | Task started | Runtime V2 lane-runner execution |
| 2026-05-05 03:40 | Step 0 started | Preflight |

---

## Blockers

*None*

---

## Notes

*Reserved for execution notes*
