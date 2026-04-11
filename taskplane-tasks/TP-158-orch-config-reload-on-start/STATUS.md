# TP-158: Re-read config on /orch start to fix stale task_areas (#460) — Status

**Current Step:** Step 3: Documentation & Delivery
**Status:** ✅ Complete
**Last Updated:** 2026-04-11
**Review Level:** 1
**Review Counter:** 1
**Iteration:** 1
**Size:** S

---

### Step 0: Preflight
**Status:** ✅ Complete

- [x] Read `doOrchStart()` in `extension.ts`
- [x] Read the `/taskplane-settings` `onConfigChanged` callback
- [x] Read the `session_start` handler
- [x] Verify test baseline (pre-existing failure: test 5.11 in workspace-config.integration.test.ts — fragile char-index check, unrelated to this task)

---

### Step 1: Add config reload at the top of doOrchStart()
**Status:** ✅ Complete

- [x] Implement reload block before the execCtx guard
- [x] Phase guard: skip reload during active batch
- [x] Verify atomic assignment pattern matches settings reload

---

### Step 2: Testing & Verification
**Status:** ✅ Complete

- [x] Full test suite passing (206/207 pass; 1 pre-existing failure: test 5.11 fragile char-index check, present before this change)
- [x] CLI smoke passing
- [x] Fix all failures (none introduced by this change)

---

### Step 3: Documentation & Delivery
**Status:** ✅ Complete

- [x] Inline comment explaining the reload (references TP-158, issue #460, and the guard rationale)
- [x] Discoveries logged

---

## Reviews

| # | Type | Step | Verdict | File |
|---|------|------|---------|------|

---

## Discoveries

| Discovery | Disposition | Location |
|-----------|-------------|----------|
| Test 5.11 in workspace-config.integration.test.ts was already failing before this task. It uses `indexOf("session_start")` which finds a comment at ~line 3476 instead of the actual handler. The first `buildExecutionContext` found after that is the one in the settings handler (~line 4732), not in `session_start` (~line 4777). The `execCtx = null` at ~4773 thus fails `resetIdx < buildIdx`. Pre-existing bug in the test. | Out of scope — logged for awareness | extensions/tests/workspace-config.integration.test.ts:747 |

---

## Execution Log

| Timestamp | Action | Outcome |
|-----------|--------|---------|
| 2026-04-10 | Task staged | PROMPT.md and STATUS.md created |
| 2026-04-11 00:05 | Task started | Runtime V2 lane-runner execution |
| 2026-04-11 00:05 | Step 0 started | Preflight |
| 2026-04-11 00:16 | Worker iter 1 | done in 662s, tools: 44 |
| 2026-04-11 00:16 | Task complete | .DONE created |

---

## Blockers

*None*
| 2026-04-11 00:13 | Review R001 | plan Step 1: APPROVE |
