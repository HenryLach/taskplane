# TP-187: Supervisor recovery flows — Status

**Current Step:** Not Started
**Status:** 🔵 Ready for Execution
**Last Updated:** 2026-05-06
**Review Level:** 3
**Review Counter:** 0
**Iteration:** 0
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
**Status:** ⬜ Not Started

- [ ] On `main` (lane worktree)
- [ ] TP-186 confirmed merged (grep `templates/agents/task-worker.md` for "Order of operations")
- [ ] Baseline test count recorded
- [ ] All Tier 3 context files read
- [ ] Issues #538, #539, #540 read in full
- [ ] Decision recorded: which optional sub-features (e.g., #540C tool-call summaries) included

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

---

## Execution Log

| Timestamp | Action | Outcome |
|-----------|--------|---------|
| 2026-05-06 | Task staged | PROMPT.md and STATUS.md created |

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
