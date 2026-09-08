# TP-199: Ruling commit trailer validation and unified `.DONE` authority (#627 Stage 2b) — Status

**Current Step:** Step 1: `completion-authority.ts`
**Status:** 🟡 In Progress
**Last Updated:** 2026-09-08
**Review Level:** 3
**Review Counter:** 0
**Iteration:** 1
**Size:** M

> **Hydration:** Checkboxes represent meaningful outcomes, not individual code
> changes. Workers expand steps when runtime discoveries warrant it — aim for
> 2-5 outcome-level items per step, not exhaustive implementation scripts.

---

### Step 0: Preflight
**Status:** ✅ Complete

- [x] TP-198 artifacts present (`ratification.ts` exports confirmed) — `validateRatification`, `isRatificationStale`, `readRatifications`, `parseRatificationLink` all exported
- [x] Full-suite baseline recorded (pass/fail counts, lint warning count)

**Baseline (Step 0):** 4092 tests, 4090 pass, 1 fail (`tests/project-config-loader.test.ts:1619` — pre-existing, unrelated to TP-199, repo-mode pointer test). Lint: 283 warnings, 675 infos.

---

### Step 1: `completion-authority.ts` — one predicate
**Status:** 🟨 In Progress

**Design (plan):**
- New module `completion-authority.ts`. To make the consolidation a literal
  no-behaviour-change move, I relocate `BlockingReviewGate`, `RatificationGateCtx`,
  `evaluateRatificationBlock`, and `findBlockingReviewGates` FROM `lane-runner.ts`
  INTO `completion-authority.ts` (re-imported by lane-runner). `formatBlockingGates`
  and `parseGateStepNumber` stay in lane-runner (pure formatting).
- `authorizeCompletion(ctx)` composes: `evaluateCompletionAuthority` (holds, never
  skipped) → when `isFinalSegment`, `findBlockingReviewGates(reviewsDir, ratifyCtx)`
  which itself does REVISE/RETHINK gates + linked-APPROVE ratification validity.
  Returns ALL blockers.
- `CompletionBlocker = { kind: "hold"|"review-gate"|"ratification"; ref; reason;
  gate?: BlockingReviewGate }`. The optional `gate` carries the raw record so the
  finalize path can keep `formatBlockingGates` output + `isInvalidRatification`
  detection byte-for-byte (behaviour-preservation). `CompletionDecision =
  {allowed:true} | {allowed:false; blockers}`.
- ctx extends the PROMPT baseline with optional `workingTreeDrift` (defaults to a
  clean probe) so the live finalize gate keeps its R004/R005 drift check while
  resume can omit it. Rationale logged here for the reviewer.
- Lane-runner refactor is scoped to THE FINALIZE PATH only: the post-loop held
  check (was `completionAuthority()`) and the finalize gate (was
  `findBlockingReviewGates(reviewsDir, finalizeRatifyCtx)`). In-loop step-marking/
  deferral uses of `completionAuthority()`/`findBlockingReviewGates` are left
  untouched (not the finalize decision; preserving behaviour). Alert kinds
  (`unresolved-verdict`/`invalid-ratification`) and `review_gate_refusal`
  classification unchanged.

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
| 2026-09-08 01:17 | Task started | Runtime V2 lane-runner execution |
| 2026-09-08 01:17 | Step 0 started | Preflight |

---

## Blockers

*None*

---

## Notes

*Reserved for execution notes*
