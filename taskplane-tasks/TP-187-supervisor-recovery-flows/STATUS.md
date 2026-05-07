# TP-187: Supervisor recovery flows — Status

**Current Step:** Step 1: Plan all three sub-fix designs
**Status:** 🟡 In Progress
**Last Updated:** 2026-05-07
**Review Level:** 3
**Review Counter:** 0
**Iteration:** 1
**Size:** L

> **Hydration:** Checkboxes represent meaningful outcomes, not individual code
> changes. Workers expand steps when runtime discoveries warrant it.
>
> **⚠️ Per TP-186's Order of Operations rule** (which should be live in the base
> worker prompt by the time this task runs): do NOT mark a step `Complete`
> until that step's code review (or test review for steps gated by it) has
> returned APPROVE. This task is Review Level 3 — code AND test reviews fire
> on Step 6.

---

### Step 0: Preflight
**Status:** ✅ Complete

- [x] On `main` (lane worktree)
- [x] TP-186 confirmed merged (grep `templates/agents/task-worker.md` for "Order of operations")
- [x] Baseline test count recorded
- [x] All Tier 3 context files read
- [x] Issues #538, #539, #540 read in full
- [x] Decision recorded: which optional sub-features (e.g., #540C tool-call summaries) included

---

### Step 1: Plan all three sub-fix designs
**Status:** ⬜ Not Started

> ⚠️ Plan-review checkpoint. Reviewer evaluates architectural choices.

- [ ] #538 design sketched (drain hook location, supervisor_takeover semantics)
- [ ] #539 design sketched (reconstruction logic, partial-state policy, multi-batch heuristic)
- [ ] #540 design sketched (fallback location, optional tool-call summary format)
- [ ] Drafts in Discoveries

---

### Step 2: Implement #538 — mailbox drain + supervisor_takeover
**Status:** ⬜ Not Started

- [ ] Synchronous mailbox drain at lane termination decision points in engine.ts
- [ ] `supervisor_takeover(reason)` tool registered in agent-bridge-extension.ts
- [ ] Supervisor tool list updated (NOT ENGINE_BRIDGE_TOOLS)
- [ ] `templates/agents/supervisor.md` documents the tool + text-reply parser
- [ ] Targeted tests pass

---

### Step 3: Implement #539 — resume reconstruction from disk
**Status:** ⬜ Not Started

- [ ] resume.ts force=true path reads from disk when in-memory state empty
- [ ] Loud failure with documented error message when no on-disk state
- [ ] Targeted integration test passes
- [ ] Multi-batch edge case handled (most recent wins, documented)

---

### Step 4: Implement #540 — non-empty reason + fallback
**Status:** ⬜ Not Started

- [ ] templates/agents/task-worker.md requires non-empty exit-no-progress reason
- [ ] lane-runner.ts falls back to most-recent assistant_message when reason empty
- [ ] (Optional) Last 2–3 tool-call summaries included in alert payload
- [ ] Targeted test passes

---

### Step 5: Add tests
**Status:** ⬜ Not Started

- [ ] supervisor-recovery-flows.test.ts created
- [ ] Coverage: mailbox drain, supervisor_takeover, resume reconstruction, worker-said fallback
- [ ] Targeted run passes

---

### Step 6: Testing & Verification
**Status:** ⬜ Not Started

> ZERO test failures allowed. Code AND test reviews fire here (Level 3).

- [ ] FULL fast suite passing
- [ ] Integration suite passing
- [ ] CLI smoke clean
- [ ] Code-review checkpoint at Step 6 (do NOT mark earlier steps Complete until APPROVE)
- [ ] Test-review checkpoint at Step 6

---

### Step 7: Documentation & Delivery
**Status:** ⬜ Not Started

- [ ] CHANGELOG.md three Unreleased / Fixed entries (#538, #539, #540)
- [ ] Discoveries logged

---

## Reviews

| # | Type | Step | Verdict | File |
|---|------|------|---------|------|

---

## Discoveries

| Discovery | Disposition | Location |
|-----------|-------------|----------|
| Baseline test count: 3496 passing, 1 skipped, 0 failed (107 test files) | Captured | Step 0 |
| TP-186 merged (Order of Operations rule live in templates/agents/task-worker.md:281) | Confirmed | Step 0 |
| Optional #540C (tool-call summaries) — DEFERRED. Most-recent assistant_message fallback is the spec-required minimum and addresses the issue. Tool-call summaries can land in a follow-up if needed. | Decision | Step 0 |
| Branch is `task/henrylach-lane-1-20260506T230236` (lane worktree branch, not `main`). Treating as the lane worktree per orchestrated run. | Note | Step 0 |
| Issue #538 architecture: alerts emitted by lane-runner via `config.onSupervisorAlert` are forwarded to extension.ts via `supervisor-alert` IPC, then queued via `pi.sendUserMessage(...)`. Multiple iterations queue multiple alerts in supervisor's pi message queue. After lane termination they remain queued — the "3-5 zombie alerts" the operator sees. | Architecture | engine.ts/extension.ts |
| Issue #539 root cause: `orch_abort()` calls `executeAbort()` which calls `deleteBatchState()`. This wipes `.pi/batch-state.json`. Then `orch_resume(force=true)` runs `loadBatchState()` → null → returns with `resumeNoState()` error message. `.pi/batch-history.json` is preserved across abort and contains the most recent batch summary. | Architecture | abort.ts/resume.ts/persistence.ts |
| Issue #540 location: `lane-runner.ts:691-712` — alert payload includes `Worker said: "${truncatedMsg}"` where `truncatedMsg = assistantMessage.slice(0, 500)`. The fallback should occur if `assistantMessage` is empty/whitespace. | Architecture | lane-runner.ts |

---

## Execution Log

| Timestamp | Action | Outcome |
|-----------|--------|---------|
| 2026-05-06 | Task staged | PROMPT.md and STATUS.md created |
| 2026-05-07 03:02 | Task started | Runtime V2 lane-runner execution |
| 2026-05-07 03:02 | Step 0 started | Preflight |

---

## Blockers

*None — but ideally TP-186 ships first so the death-spiral is fixed before
this task's worker is exposed to it during long-running review cycles.*

---

## Notes

- Bundles three P1/P2 issues filed together with TP-186's P0 in the same
  failed-batch postmortem. They cluster: #538 and #540 surface during the
  death-spiral; #539 surfaces when operators reach for `orch_abort` to escape.
- After TP-186 ships and is validated, this task can run safely. Recommended
  release: v0.28.7 with TP-187 + TP-188 bundled (both depend on TP-186 being
  live in the worker spawn pipeline for safe execution).
