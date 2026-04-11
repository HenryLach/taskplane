# TP-158: Re-read config on /orch start to fix stale task_areas (#460) — Status

**Current Step:** Step 0: Preflight
**Status:** 🟡 In Progress
**Last Updated:** 2026-04-11
**Review Level:** 1
**Review Counter:** 0
**Iteration:** 1
**Size:** S

---

### Step 0: Preflight
**Status:** 🟨 In Progress

- [x] Read `doOrchStart()` in `extension.ts`
- [x] Read the `/taskplane-settings` `onConfigChanged` callback
- [x] Read the `session_start` handler
- [x] Verify test baseline (pre-existing failure: test 5.11 in workspace-config.integration.test.ts — fragile char-index check, unrelated to this task)

---

### Step 1: Add config reload at the top of doOrchStart()
**Status:** ⬜ Not Started

- [ ] Implement reload block before the execCtx guard
- [ ] Phase guard: skip reload during active batch
- [ ] Verify atomic assignment pattern matches settings reload

---

### Step 2: Testing & Verification
**Status:** ⬜ Not Started

- [ ] Full test suite passing
- [ ] CLI smoke passing
- [ ] Fix all failures

---

### Step 3: Documentation & Delivery
**Status:** ⬜ Not Started

- [ ] Inline comment explaining the reload
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
| 2026-04-10 | Task staged | PROMPT.md and STATUS.md created |
| 2026-04-11 00:05 | Task started | Runtime V2 lane-runner execution |
| 2026-04-11 00:05 | Step 0 started | Preflight |

---

## Blockers

*None*
