# TP-042: Supervisor Onboarding & /orch Routing — Status

**Current Step:** Step 1: /orch Routing Logic
**Status:** 🟡 In Progress
**Last Updated:** 2026-03-22
**Review Level:** 2
**Review Counter:** 0
**Iteration:** 2
**Size:** M

---

### Step 0: Preflight
**Status:** ✅ Complete
- [x] Read spec Section 14
- [x] Read /orch command handler
- [x] Read supervisor.ts

---

### Step 1: /orch Routing Logic
**Status:** 🟨 In Progress
- [ ] Implement state detection (config, batch, tasks)
- [ ] Route to appropriate supervisor flow
- [ ] Preserve existing /orch with args behavior

---

### Step 2: Onboarding Flow (Scripts 1-5)
**Status:** ⬜ Not Started
- [ ] Project detection and analysis
- [ ] Task area setup conversation
- [ ] Git branching assessment
- [ ] Config generation
- [ ] First-task guidance

---

### Step 3: Returning User Flows (Scripts 6-8)
**Status:** ⬜ Not Started
- [ ] Batch planning flow
- [ ] Health check flow
- [ ] Retrospective flow

---

### Step 4: Testing & Verification
**Status:** ⬜ Not Started
- [ ] Routing tests for all project states
- [ ] Existing behavior preserved test
- [ ] Full test suite passes

---

### Step 5: Documentation & Delivery
**Status:** ⬜ Not Started
- [ ] Commands reference updated
- [ ] Tutorial updated
- [ ] `.DONE` created

---

## Reviews

| # | Type | Step | Verdict | File |
|---|------|------|---------|------|

## Discoveries

| Discovery | Disposition | Location |
|-----------|-------------|----------|
| /orch handler currently returns usage message when no args — routing logic replaces this | In scope (Step 1) | extension.ts:L470-480 |
| supervisor.ts already has full activation/deactivation/lockfile/event-tailing — onboarding adds scripts to primer, routing in extension | In scope (Step 2-3) | supervisor.ts |
| Spec Section 14 defines 9 scripts — Scripts 1-5 are onboarding (Step 2), Scripts 6-8 are returning user (Step 3), Script 9 is integration (out of scope per PROMPT) | Noted | spec §14.4 |

## Execution Log

| Timestamp | Action | Outcome |
|-----------|--------|---------|
| 2026-03-21 | Task staged | PROMPT.md and STATUS.md created |
| 2026-03-22 23:08 | Task started | Extension-driven execution |
| 2026-03-22 23:08 | Step 0 started | Preflight |
| 2026-03-22 23:08 | Skip plan review | Step 0 (Preflight) — low-risk |
| 2026-03-22 23:08 | Task started | Extension-driven execution |
| 2026-03-22 23:08 | Step 0 started | Preflight |
| 2026-03-22 23:08 | Skip plan review | Step 0 (Preflight) — low-risk |
| 2026-03-22 | Step 0 complete | Read spec §14 (all scripts), extension.ts /orch handler, supervisor.ts |
| 2026-03-22 23:09 | Worker iter 1 | done in 82s, ctx: 20%, tools: 17 |
| 2026-03-22 23:09 | Skip code review | Step 0 (Preflight) — low-risk |
| 2026-03-22 23:09 | Step 0 complete | Preflight |
| 2026-03-22 23:09 | Step 1 started | /orch Routing Logic |

## Blockers

*None*

## Notes

*Reserved for execution notes*
