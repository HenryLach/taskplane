# TP-199: Ruling commit trailer validation and unified `.DONE` authority (#627 Stage 2b) — Status

**Current Step:** Not Started
**Status:** 🔵 Ready for Execution
**Last Updated:** 2026-09-08
**Review Level:** 3
**Review Counter:** 0
**Iteration:** 0
**Size:** M

> **Hydration:** Checkboxes represent meaningful outcomes, not individual code
> changes. Workers expand steps when runtime discoveries warrant it — aim for
> 2-5 outcome-level items per step, not exhaustive implementation scripts.

---

### Step 0: Preflight
**Status:** ⬜ Not Started

- [ ] TP-198 artifacts present (`ratification.ts` exports confirmed)
- [ ] Full-suite baseline recorded (pass/fail counts, lint warning count)

---

### Step 1: `completion-authority.ts` — one predicate
**Status:** ⬜ Not Started

- [ ] `authorizeCompletion(ctx)` composing holds → review gates → ratification, reporting all blockers; non-final segments skip review/ratification only
- [ ] Lane-runner finalize path consolidated onto it (alert kinds and classification unchanged)
- [ ] `tests/completion-authority.test.ts` scenarios (allowed / each blocker alone / all together / non-final segment)
- [ ] Targeted tests pass (incl. held-state-runner, review-remediation-spawn, ratification-finalize)

---

### Step 2: Resume `.DONE` acceptance uses the same predicate
**Status:** ⬜ Not Started

- [ ] `collectDoneTaskIdsForResume` refuses `.DONE` when `authorizeCompletion` is not allowed (logged; reconciled as if absent)
- [ ] Behavioural tests: REVISE → not collected; unlinked APPROVE → collected; linked APPROVE w/o record → not collected
- [ ] Targeted tests pass (incl. held-state-recovery, resume-bug-fixes)

---

### Step 3: `Taskplane-Ruling:` trailer validation
**Status:** ⬜ Not Started

- [ ] `parseRulingCitations` (trailer ids + prose claims) — module name noted here: ___
- [ ] `validateRulingCitations` → flags unknown-ruling / wrong-unit / prose-claim
- [ ] Lane-runner post-iteration commit scan → STATUS log + audit entry + one alert per iteration; no status/hold/stall effect
- [ ] `templates/agents/task-worker.md` trailer contract
- [ ] `tests/ruling-trailer.test.ts` parser/validator + behavioural (a)–(c) with a real git worktree
- [ ] Targeted tests pass

---

### Step 4: Testing & Verification
**Status:** ⬜ Not Started

- [ ] FULL test suite passing (vs Step 0 baseline)
- [ ] typecheck 0 errors
- [ ] lint at or below baseline
- [ ] format:check clean
- [ ] CLI help + doctor exit 0

---

### Step 5: Documentation & Delivery
**Status:** ⬜ Not Started

- [ ] Primer: `Ruling citation flagged` alert guidance
- [ ] Spec status (Stage 2b)
- [ ] CHANGELOG `[Unreleased]` entry
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
| 2026-09-08 | Task staged | PROMPT.md and STATUS.md created |

---

## Blockers

*None*

---

## Notes

*Reserved for execution notes*
