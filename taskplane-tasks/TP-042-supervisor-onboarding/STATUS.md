# TP-042: Supervisor Onboarding & /orch Routing — Status

**Current Step:** Step 2: Onboarding Flow (Scripts 1-5)
**Status:** 🟡 In Progress
**Last Updated:** 2026-03-22
**Review Level:** 2
**Review Counter:** 4
**Iteration:** 3
**Size:** M

---

### Step 0: Preflight
**Status:** ✅ Complete
- [x] Read spec Section 14
- [x] Read /orch command handler
- [x] Read supervisor.ts

---

### Step 1: /orch Routing Logic
**Status:** ✅ Complete
- [x] Implement `detectOrchState()` helper with explicit state enum and precedence: no-config → active-batch → completed-batch-needs-integration → pending-tasks → no-tasks
- [x] Modify /orch handler: when args is empty, call detectOrchState and route to supervisor activation with appropriate context message
- [x] Preserve existing /orch WITH args behavior (start batch directly, no changes)
- [x] R001-1: Include "completed batch, not integrated" state with orch branch check
- [x] R001-2: Enforce explicit evaluation order matching PROMPT.md routing matrix
- [x] R002-1: Fix root selection — use pointer configRoot for config detection, repoRoot for batch-state detection
- [x] R002-2: Validate orch branch existence in completed-batch state (don't trust stale batchState.orchBranch)

---

### Step 2: Onboarding Flow (Scripts 1-5)
**Status:** 🟡 In Progress (R004 revisions)
- [x] Routing-aware system prompt: build onboarding/routing prompt (separate from batch-monitoring prompt) and wire into before_agent_start hook; add routingContext field to SupervisorState
- [x] Script 1/2/3 trigger discrimination in primer: add all three onboarding scripts to supervisor-primer.md with trigger conditions based on repo maturity (no .pi/ dir → Script 1; empty/new project → Script 2; established codebase → Script 3), with delegation to Scripts 4/5
- [x] Scripts 4 and 5 in primer: add Task Area Design and Git Branching & Protection scripts as delegated sub-flows
- [x] Returning-user script stubs in primer: add Scripts 6/7/8 trigger/goal summaries so the routing prompt can reference them for non-onboarding states (pending-tasks, no-tasks, completed-batch)
- [x] Full config/scaffolding artifact set: onboarding prompt instructs supervisor to create .pi/taskplane-config.json, area CONTEXT.md files, .pi/agents/ overrides, and .gitignore entries (idempotent, create-if-missing)
- [ ] R004-1: Clear routingContext on non-routing activation so prompt hook switches from routing to batch-monitoring prompt
- [ ] R004-2: Fix testing.commands template in supervisor-primer.md to use Record<string,string> shape instead of array

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
| R001 | plan | Step 1 | REVISE | .reviews/R001-plan-step1.md |
| R001 | plan | Step 1 | REVISE | .reviews/R001-plan-step1.md |
| R002 | code | Step 1 | REVISE | .reviews/R002-code-step1.md |
| R002 | code | Step 1 | REVISE | .reviews/R002-code-step1.md |
| R003 | plan | Step 2 | REVISE | .reviews/R003-plan-step2.md |
| R003 | plan | Step 2 | REVISE | .reviews/R003-plan-step2.md |
| R004 | code | Step 2 | REVISE | .reviews/R004-code-step2.md |
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
| 2026-03-22 23:09 | Worker iter 2 | done in 94s, ctx: 40%, tools: 21 |
| 2026-03-22 23:09 | Skip code review | Step 0 (Preflight) — low-risk |
| 2026-03-22 23:09 | Step 0 complete | Preflight |
| 2026-03-22 23:09 | Step 1 started | /orch Routing Logic |
| 2026-03-22 23:11 | Review R001 | plan Step 1: REVISE |
| 2026-03-22 23:12 | Review R001 | plan Step 1: REVISE |
| 2026-03-22 23:26 | Worker iter 2 | done in 839s, ctx: 46%, tools: 86 |
| 2026-03-22 23:26 | Worker iter 3 | done in 884s, ctx: 51%, tools: 84 |
| 2026-03-22 23:29 | Review R002 | code Step 1: REVISE |
| 2026-03-22 23:30 | Review R002 | code Step 1: REVISE |
| 2026-03-22 23:37 | Worker iter 3 | done in 483s, ctx: 15%, tools: 38 |
| 2026-03-22 23:37 | Step 1 complete | /orch Routing Logic |
| 2026-03-22 23:37 | Step 2 started | Onboarding Flow (Scripts 1-5) |
| 2026-03-22 23:38 | Worker iter 2 | done in 512s, ctx: 21%, tools: 46 |
| 2026-03-22 23:38 | Step 1 complete | /orch Routing Logic |
| 2026-03-22 23:38 | Step 2 started | Onboarding Flow (Scripts 1-5) |
| 2026-03-22 23:40 | Review R003 | plan Step 2: REVISE |
| 2026-03-22 23:40 | Review R003 | plan Step 2: REVISE |
| 2026-03-22 23:49 | Worker iter 4 | done in 566s, ctx: 35%, tools: 51 |
| 2026-03-22 23:52 | Review R004 | code Step 2: REVISE |

## Blockers

*None*

## Notes

*Reserved for execution notes*
